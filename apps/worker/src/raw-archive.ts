import { createHash } from 'node:crypto'
import { BufferJSON, proto } from 'baileys'
import { DataSource, EntityManager } from 'typeorm'
import {
  Account,
  AccountChat,
  ArchivedMessage,
  Chat,
  ChatParticipant,
  Contact,
  DEFAULT_MEDIA_POLICY,
  Media,
  MediaPolicy,
} from '@wa/entities'
import type { MediaJobData } from './queue/media-queue'

const CONTACT_NS = 'contact'
const CHAT_NS = 'chat'
const MESSAGE_NS = 'message'
const MEDIA_NS = 'media'

type MessageContent = Record<string, any>

// A newly-stored message + any media that needs downloading. wa-connection turns
// these into queue jobs and SSE events.
export interface PersistedMessage {
  messageId: string
  chatJid: string
  type: string
  timestamp: string | null
  mediaJobs: MediaJobData[]
}

export interface PersistResult {
  stored: number
  messages: PersistedMessage[]
  mediaJobs: MediaJobData[]
}

export async function persistRawMessages(
  dataSource: DataSource,
  accountId: string,
  messages: proto.IWebMessageInfo[],
): Promise<PersistResult> {
  const result: PersistResult = { stored: 0, messages: [], mediaJobs: [] }

  await dataSource.transaction(async (manager) => {
    await manager.getRepository(Account).upsert(
      { id: accountId, status: 'connected', lastSeenAt: new Date() },
      ['id'],
    )

    // Resolve the account's capture policy once per batch (fresh each upsert event).
    const policy = await loadMediaPolicy(manager, accountId)

    for (const msg of messages) {
      const persisted = await persistOneMessage(manager, accountId, msg, policy)
      if (persisted) {
        result.stored++
        result.messages.push(persisted)
        result.mediaJobs.push(...persisted.mediaJobs)
      }
    }
  })

  return result
}

async function loadMediaPolicy(
  manager: EntityManager,
  accountId: string,
): Promise<MediaPolicy> {
  const account = await manager.getRepository(Account).findOne({
    where: { id: accountId },
    select: { mediaPolicy: true },
  })
  return account?.mediaPolicy ?? DEFAULT_MEDIA_POLICY
}

async function persistOneMessage(
  manager: EntityManager,
  accountId: string,
  msg: proto.IWebMessageInfo,
  policy: MediaPolicy,
): Promise<PersistedMessage | null> {
  const remoteJid = msg.key?.remoteJid
  const waMessageId = msg.key?.id
  if (!remoteJid || !waMessageId || remoteJid === 'status@broadcast') return null

  const chatId = stableUuid(CHAT_NS, remoteJid)
  const chatType = remoteJid.endsWith('@g.us') ? 'group' : 'dm'
  const content = unwrapMessageContent(msg.message as MessageContent | undefined)
  const messageType = classifyMessage(content)
  const messageId = stableUuid(MESSAGE_NS, `${accountId}:${waMessageId}`)
  const senderJid = getSenderJid(msg, remoteJid, chatType)
  const senderContactId = senderJid ? stableUuid(CONTACT_NS, senderJid) : null

  await upsertChat(manager, { id: chatId, waJid: remoteJid, type: chatType, subject: null })
  await upsertAccountChat(manager, accountId, chatId)

  if (chatType === 'dm') {
    await upsertContact(manager, remoteJid, msg.pushName ?? null)
  }
  if (senderJid) {
    const participantContactId = stableUuid(CONTACT_NS, senderJid)
    await upsertContact(manager, senderJid, msg.pushName ?? null)
    if (chatType === 'group') {
      await manager.getRepository(ChatParticipant).upsert(
        {
          chatId,
          contactId: participantContactId,
          roleInGroup: null,
          joinedAt: null,
        },
        ['chatId', 'contactId'],
      )
    }
  }

  const existing = await manager.getRepository(ArchivedMessage).findOne({
    where: { accountId, waMessageId },
    select: { id: true },
  })
  if (existing) return null

  const timestamp = toMessageDate(msg.messageTimestamp)

  await manager.getRepository(ArchivedMessage).insert({
    id: messageId,
    waMessageId,
    accountId,
    chatId,
    senderContactId,
    fromMe: Boolean(msg.key?.fromMe),
    timestamp,
    type: messageType,
    text: extractText(content),
    raw: JSON.parse(JSON.stringify(msg, BufferJSON.replacer)),
  })

  // Apply the per-type media policy: 'skip' → metadata-only row; otherwise write a
  // 'pending' row and queue a download/compress/upload job.
  const mediaJobs: MediaJobData[] = []
  const mediaRows = extractMedia(content).map((media, index) => {
    const id = stableUuid(MEDIA_NS, `${messageId}:${index}:${media.type}`)
    const action = policy[media.type] ?? 'skip'
    const capture = action !== 'skip'
    if (capture) {
      mediaJobs.push({ accountId, mediaId: id, messageId, mediaType: media.type })
    }
    return {
      id,
      messageId,
      type: media.type,
      storageStatus: capture ? 'pending' : 'skipped',
      r2Key: null,
      mime: media.mime,
      sizeBytes: media.sizeBytes,
      durationSeconds: media.durationSeconds,
      width: media.width,
      height: media.height,
      originalFilename: media.originalFilename,
      sha256: media.sha256,
    }
  })

  if (mediaRows.length > 0) {
    await manager.getRepository(Media).insert(mediaRows)
  }

  return {
    messageId,
    chatJid: remoteJid,
    type: messageType,
    timestamp: timestamp ? timestamp.toISOString() : null,
    mediaJobs,
  }
}

async function upsertChat(
  manager: EntityManager,
  chat: Pick<Chat, 'id' | 'waJid' | 'type' | 'subject'>,
): Promise<void> {
  await manager.getRepository(Chat).upsert(chat, ['waJid'])
}

async function upsertAccountChat(
  manager: EntityManager,
  accountId: string,
  chatId: string,
): Promise<void> {
  const now = new Date()
  await manager
    .createQueryBuilder()
    .insert()
    .into(AccountChat)
    .values({ accountId, chatId, firstSeenAt: now, lastSeenAt: now })
    .orUpdate(['last_seen_at'], ['account_id', 'chat_id'])
    .execute()
}

async function upsertContact(
  manager: EntityManager,
  waJid: string,
  pushName: string | null,
): Promise<void> {
  await manager
    .createQueryBuilder()
    .insert()
    .into(Contact)
    .values({
      id: stableUuid(CONTACT_NS, waJid),
      waJid,
      displayName: pushName,
      pushName,
      phoneNumber: extractPhoneNumber(waJid),
      isBusiness: null,
      notes: null,
    })
    .orUpdate(['display_name', 'push_name', 'phone_number', 'is_business'], ['wa_jid'])
    .execute()
}

function getSenderJid(
  msg: proto.IWebMessageInfo,
  remoteJid: string,
  chatType: string,
): string | null {
  if (chatType === 'group') return msg.key?.participant ?? null
  if (msg.key?.fromMe) return null
  return remoteJid
}

function unwrapMessageContent(content: MessageContent | undefined): MessageContent {
  let current = content ?? {}

  for (let i = 0; i < 6; i++) {
    const next =
      current.ephemeralMessage?.message ??
      current.viewOnceMessage?.message ??
      current.viewOnceMessageV2?.message ??
      current.viewOnceMessageV2Extension?.message ??
      current.documentWithCaptionMessage?.message

    if (!next) break
    current = next
  }

  return current
}

function classifyMessage(content: MessageContent): string {
  const kind = Object.keys(content)[0] ?? 'unknown'
  if (kind === 'conversation' || kind === 'extendedTextMessage') return 'text'
  if (kind.endsWith('Message')) return kind.slice(0, -'Message'.length)
  return kind
}

function extractText(content: MessageContent): string | null {
  return (
    content.conversation ??
    content.extendedTextMessage?.text ??
    content.imageMessage?.caption ??
    content.videoMessage?.caption ??
    content.documentMessage?.caption ??
    content.buttonsResponseMessage?.selectedDisplayText ??
    content.listResponseMessage?.title ??
    null
  )
}

function extractMedia(content: MessageContent) {
  const specs = [
    ['image', content.imageMessage],
    ['video', content.videoMessage],
    ['audio', content.audioMessage],
    ['document', content.documentMessage],
    ['sticker', content.stickerMessage],
  ] as const

  return specs
    .filter(([, value]) => Boolean(value))
    .map(([type, value]) => ({
      type,
      mime: value.mimetype ?? null,
      sizeBytes: toDecimalString(value.fileLength),
      durationSeconds: toDecimalString(value.seconds),
      width: toNullableNumber(value.width),
      height: toNullableNumber(value.height),
      originalFilename: value.fileName ?? null,
      sha256: toHex(value.fileSha256),
    }))
}

function toMessageDate(value: proto.IWebMessageInfo['messageTimestamp']): Date | null {
  const seconds = Number(toDecimalString(value))
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null
}

function toDecimalString(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'toString' in value) return String(value)
  return null
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value !== 'number') return null
  return Number.isFinite(value) ? value : null
}

function toHex(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (value instanceof Uint8Array) return Buffer.from(value).toString('hex')
  if (typeof value === 'object' && 'data' in value && Array.isArray(value.data)) {
    return Buffer.from(value.data).toString('hex')
  }
  return null
}

function extractPhoneNumber(waJid: string): string | null {
  const user = waJid.split('@')[0]
  return /^\d+$/.test(user) ? user : null
}

function stableUuid(namespace: string, value: string): string {
  const bytes = createHash('sha1').update(`${namespace}\0${value}`).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20)}`
}
