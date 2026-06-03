import { getPublisher, WA_EVENTS_CHANNEL } from './redis'
import { logger } from './logger'

// Live events fanned out to dashboard SSE clients via Redis pub/sub. Best-effort:
// a publish failure must never break ingestion.
export type WaEvent =
  | {
      type: 'message'
      accountId: string
      messageId: string
      chatJid: string
      messageType: string
      timestamp: string | null
    }
  | {
      type: 'media'
      mediaId: string
      messageId: string
      mediaType: string
      storageStatus: string
    }

export async function publishEvent(event: WaEvent): Promise<void> {
  try {
    await getPublisher().publish(WA_EVENTS_CHANNEL, JSON.stringify(event))
  } catch (e) {
    logger.warn(`event publish failed: ${(e as Error)?.message}`)
  }
}
