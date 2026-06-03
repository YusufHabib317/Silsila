import { Job, Worker } from 'bullmq'
import { BufferJSON, downloadMediaMessage, proto } from 'baileys'
import { DataSource } from 'typeorm'
import { ArchivedMessage, Media } from '@wa/entities'
import { storage } from '@wa/storage'
import { createRedisConnection } from '../redis'
import { socketRegistry } from '../socket-registry'
import { compressImage } from '../media/compress'
import { publishEvent } from '../events'
import { baileysLogger, logger } from '../logger'
import { MEDIA_QUEUE_NAME, MediaJobData } from './media-queue'

// Starts the in-process BullMQ worker that drains the media queue: download →
// compress (images) → upload to R2 → flip the row to `stored`.
export function startMediaProcessor(dataSource: DataSource): Worker<MediaJobData> {
  const worker = new Worker<MediaJobData>(
    MEDIA_QUEUE_NAME,
    (job) => processMediaJob(dataSource, job),
    { connection: createRedisConnection(), concurrency: 4 },
  )

  worker.on('failed', (job, err) => {
    if (!job) return
    logger.warn(`[media ${job.id}] attempt ${job.attemptsMade} failed: ${err?.message}`)
    const maxAttempts = job.opts.attempts ?? 1
    if (job.attemptsMade >= maxAttempts) {
      void markFailed(dataSource, job.data.mediaId, err?.message ?? 'unknown error')
    }
  })

  worker.on('error', (err) => logger.error(err))
  return worker
}

async function processMediaJob(dataSource: DataSource, job: Job<MediaJobData>): Promise<void> {
  const { mediaId, accountId } = job.data
  const mediaRepo = dataSource.getRepository(Media)

  const media = await mediaRepo.findOne({ where: { id: mediaId } })
  if (!media) {
    logger.warn(`[media ${mediaId}] row missing — skipping`)
    return
  }
  if (media.storageStatus === 'stored') return

  // Storage not configured yet: park as pending (no download). `backfill-media`
  // re-enqueues these once R2 keys are added.
  if (!storage.isEnabled) {
    logger.info(`[media ${mediaId}] storage disabled — parked pending`)
    return
  }

  // Content dedupe: if the same bytes are already stored, reuse the object.
  if (media.sha256) {
    const twin = await mediaRepo.findOne({
      where: { sha256: media.sha256, storageStatus: 'stored' },
    })
    if (twin?.r2Key) {
      await mediaRepo.update(
        { id: mediaId },
        {
          storageStatus: 'stored',
          r2Key: twin.r2Key,
          storedBytes: twin.storedBytes,
          storedMime: twin.storedMime,
          width: twin.width,
          height: twin.height,
          processedAt: new Date(),
          storageError: null,
        },
      )
      await publishStored(media.messageId, mediaId, media.type)
      logger.info(`[media ${mediaId}] deduped → ${twin.r2Key}`)
      return
    }
  }

  const message = await loadMessage(dataSource, media.messageId)
  if (!message) throw new Error(`message ${media.messageId} not found for media ${mediaId}`)

  const sock = socketRegistry.get(accountId)
  // reuploadRequest is required by Baileys; with no live socket we throw so BullMQ
  // retries later (when the account has reconnected) instead of failing hard.
  const reuploadRequest =
    sock?.updateMediaMessage ??
    (async (): Promise<proto.IWebMessageInfo> => {
      throw new Error(`no live socket for ${accountId} to reupload media`)
    })

  const buffer = (await downloadMediaMessage(
    message,
    'buffer',
    {},
    { logger: baileysLogger, reuploadRequest },
  )) as Buffer

  let body: Buffer = buffer
  let storedMime = media.mime ?? 'application/octet-stream'
  let width = media.width
  let height = media.height
  let ext = extensionFor(storedMime)

  // Images/stickers are compressed; other "store" types keep original bytes.
  if (media.type === 'image' || media.type === 'sticker') {
    const compressed = await compressImage(buffer)
    body = compressed.buffer
    storedMime = compressed.mime
    width = compressed.width ?? width
    height = compressed.height ?? height
    ext = compressed.ext
  }

  const key = buildKey(accountId, mediaId, ext)
  await storage.put(key, body, storedMime)

  await mediaRepo.update(
    { id: mediaId },
    {
      storageStatus: 'stored',
      r2Key: key,
      storedBytes: String(body.length),
      storedMime,
      width,
      height,
      processedAt: new Date(),
      storageError: null,
    },
  )
  await publishStored(media.messageId, mediaId, media.type)
  logger.info(`[media ${mediaId}] stored ${body.length}B → ${key}`)
}

// Rebuild the original WhatsApp message from stored raw JSON. raw was serialized
// with BufferJSON.replacer at ingestion, so reviver reconstructs its Buffers
// (mediaKey, etc.) that downloadMediaMessage needs.
async function loadMessage(
  dataSource: DataSource,
  messageId: string,
): Promise<proto.IWebMessageInfo | null> {
  const row = await dataSource
    .getRepository(ArchivedMessage)
    .findOne({ where: { id: messageId }, select: { raw: true } })
  if (!row) return null
  return JSON.parse(JSON.stringify(row.raw), BufferJSON.reviver) as proto.IWebMessageInfo
}

async function markFailed(dataSource: DataSource, mediaId: string, error: string): Promise<void> {
  try {
    await dataSource
      .getRepository(Media)
      .update({ id: mediaId }, { storageStatus: 'failed', storageError: error.slice(0, 1000) })
  } catch (e) {
    logger.error(e)
  }
}

async function publishStored(messageId: string, mediaId: string, mediaType: string): Promise<void> {
  await publishEvent({ type: 'media', mediaId, messageId, mediaType, storageStatus: 'stored' })
}

function buildKey(accountId: string, mediaId: string, ext: string): string {
  const now = new Date()
  const yyyy = now.getUTCFullYear()
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  return `media/${accountId}/${yyyy}/${mm}/${mediaId}.${ext}`
}

function extensionFor(mime: string): string {
  if (mime.includes('webp')) return 'webp'
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  if (mime.includes('png')) return 'png'
  if (mime.includes('gif')) return 'gif'
  if (mime.includes('mp4')) return 'mp4'
  if (mime.includes('ogg')) return 'ogg'
  if (mime.includes('mpeg')) return 'mp3'
  if (mime.includes('pdf')) return 'pdf'
  const sub = mime.split('/')[1]?.split(';')[0]
  return sub || 'bin'
}
