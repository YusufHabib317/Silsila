import makeWASocket, {
  DisconnectReason,
  type BaileysEventMap,
  fetchLatestBaileysVersion,
  proto,
  WASocket,
} from 'baileys'
import { DataSource } from 'typeorm'
import { Account } from '@wa/entities'
import { useDbAuthState } from './db-auth-state'
import { baileysLogger, logger } from './logger'
import { persistRawMessages } from './raw-archive'
import { enqueueMediaJob } from './queue/media-queue'
import { publishEvent } from './events'
import { socketRegistry } from './socket-registry'

const BASE_DELAY_MS = 2_000
const MAX_DELAY_MS = 60_000

// Owns the lifecycle of a single WhatsApp number: connect, show QR, log
// messages, and reconnect with exponential backoff. One instance == one number.
export class WaConnection {
  private sock?: WASocket
  private reconnectAttempts = 0
  private stopped = false

  constructor(
    private readonly dataSource: DataSource,
    private readonly sessionId: string,
  ) {}

  async start(): Promise<void> {
    this.stopped = false
    await this.connect().catch((e) => {
      logger.error(e)
      if (!this.stopped) this.scheduleReconnect()
    })
  }

  async stop(): Promise<void> {
    this.stopped = true
    socketRegistry.unregister(this.sessionId, this.sock)
    this.sock?.end(undefined)
  }

  private async connect(): Promise<void> {
    const { state, saveCreds } = await useDbAuthState(this.dataSource, this.sessionId)
    const { version } = await fetchLatestBaileysVersion()

    this.sock = makeWASocket({
      version,
      auth: state,
      logger: baileysLogger,
      // Stay invisible — we never want to look "online" or send. Read-only.
      markOnlineOnConnect: false,
      syncFullHistory: false,
    })

    // Expose this socket so the media processor can reupload expired media URLs.
    socketRegistry.register(this.sessionId, this.sock)

    this.sock.ev.on('creds.update', saveCreds)
    this.sock.ev.on('connection.update', (u) => this.onConnectionUpdate(u))
    this.sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') return // ignore history backfill, only live msgs
      void this.onMessages(messages)
    })
  }

  private async onMessages(messages: proto.IWebMessageInfo[]): Promise<void> {
    for (const msg of messages) this.logMessage(msg)
    try {
      // DB-only work — fast. Returns the media that needs downloading + the new
      // messages to announce; neither touches the socket event loop.
      const result = await persistRawMessages(this.dataSource, this.sessionId, messages)
      if (result.stored > 0) logger.info(`[${this.sessionId}] archived ${result.stored} message(s)`)

      for (const job of result.mediaJobs) {
        await enqueueMediaJob(job)
      }
      for (const m of result.messages) {
        await publishEvent({
          type: 'message',
          accountId: this.sessionId,
          messageId: m.messageId,
          chatJid: m.chatJid,
          messageType: m.type,
          timestamp: m.timestamp,
        })
      }
    } catch (e) {
      logger.error(e)
    }
  }

  private async onConnectionUpdate(update: BaileysEventMap['connection.update']): Promise<void> {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      logger.info(`[${this.sessionId}] scan this QR (phone > Linked devices):`)
      await publishEvent({
        type: 'qr',
        accountId: this.sessionId,
        qr,
        createdAt: new Date().toISOString(),
      })
    }

    if (connection === 'open') {
      this.reconnectAttempts = 0
      logger.info(`[${this.sessionId}] connected`)
      await publishEvent({ type: 'connection', accountId: this.sessionId, status: 'connected' })
      await this.markSession('connected')
    }

    if (connection === 'close') {
      socketRegistry.unregister(this.sessionId, this.sock)
      await publishEvent({ type: 'connection', accountId: this.sessionId, status: 'disconnected' })
      await this.markSession('disconnected')
      const statusCode =
        (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode ??
        null

      // Logged out = the session is dead. Reconnecting would loop forever;
      // a human must re-pair with a fresh QR.
      if (statusCode === DisconnectReason.loggedOut) {
        logger.warn(`[${this.sessionId}] logged out — needs a fresh QR. Not reconnecting.`)
        return
      }
      // Another device took over this session. Reconnecting would fight it (a classic
      // ban trigger) — stop and let a human sort the linked devices out.
      if (statusCode === DisconnectReason.connectionReplaced) {
        logger.warn(`[${this.sessionId}] connection replaced by another session. Not reconnecting.`)
        return
      }
      if (this.stopped) return

      // Normal right after pairing — reconnect immediately, not on the backoff curve.
      if (statusCode === DisconnectReason.restartRequired) {
        logger.info(`[${this.sessionId}] restart required — reconnecting now.`)
        this.reconnectAttempts = 0
        void this.connect().catch((e) => {
          logger.error(e)
          if (!this.stopped) this.scheduleReconnect()
        })
        return
      }
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    // Exponential backoff with jitter so many numbers reconnecting at once don't
    // hammer WhatsApp in lockstep (looks bot-like).
    const base = Math.min(BASE_DELAY_MS * 2 ** this.reconnectAttempts, MAX_DELAY_MS)
    const delay = base + Math.random() * 0.3 * base
    this.reconnectAttempts++
    logger.warn(
      `[${this.sessionId}] reconnecting in ${Math.round(delay / 1000)}s ` +
        `(attempt ${this.reconnectAttempts})`,
    )
    setTimeout(() => {
      if (this.stopped) return
      this.connect().catch((e) => {
        logger.error(e)
        if (!this.stopped) this.scheduleReconnect()
      })
    }, delay)
  }

  private logMessage(msg: proto.IWebMessageInfo): void {
    const from = msg.key?.remoteJid
    const fromMe = msg.key?.fromMe
    const kind = Object.keys(msg.message ?? {})[0] ?? 'unknown'
    const text =
      msg.message?.conversation ??
      msg.message?.extendedTextMessage?.text ??
      `[${kind}]`
    logger.info(`[${this.sessionId}] from=${from} me=${fromMe} type=${kind} :: ${text}`)
  }

  private async markSession(status: string): Promise<void> {
    await this.dataSource
      .getRepository(Account)
      .upsert({ id: this.sessionId, status, lastSeenAt: new Date() }, ['id'])
  }
}
