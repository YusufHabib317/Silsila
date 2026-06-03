import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  WASocket,
} from 'baileys'
import qrcode from 'qrcode-terminal'
import { DataSource } from 'typeorm'
import { WaSession } from '@wa/entities'
import { useDbAuthState } from './db-auth-state'
import { baileysLogger, logger } from './logger'

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

    this.sock.ev.on('creds.update', saveCreds)
    this.sock.ev.on('connection.update', (u) => this.onConnectionUpdate(u))
    this.sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') return // ignore history backfill, only live msgs
      for (const msg of messages) this.logMessage(msg)
    })
  }

  private async onConnectionUpdate(update: any): Promise<void> {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      logger.info(`[${this.sessionId}] scan this QR (phone > Linked devices):`)
      qrcode.generate(qr, { small: true })
    }

    if (connection === 'open') {
      this.reconnectAttempts = 0
      logger.info(`[${this.sessionId}] connected`)
      await this.markSession('connected')
    }

    if (connection === 'close') {
      await this.markSession('disconnected')
      const statusCode = lastDisconnect?.error?.output?.statusCode

      // Logged out = the session is dead. Reconnecting would loop forever;
      // a human must re-pair with a fresh QR.
      if (statusCode === DisconnectReason.loggedOut) {
        logger.warn(`[${this.sessionId}] logged out — needs a fresh QR. Not reconnecting.`)
        return
      }
      if (this.stopped) return
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    const delay = Math.min(BASE_DELAY_MS * 2 ** this.reconnectAttempts, MAX_DELAY_MS)
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

  private logMessage(msg: any): void {
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
      .getRepository(WaSession)
      .upsert({ id: this.sessionId, status, lastSeenAt: new Date() }, ['id'])
  }
}
