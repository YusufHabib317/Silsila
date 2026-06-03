import { Queue } from 'bullmq'
import { createRedisConnection } from '../redis'

export const MEDIA_QUEUE_NAME = 'media'

// The tiny payload the socket handler enqueues. Everything else (the original
// WhatsApp message) is reloaded from `messages.raw` by the processor, so a Redis
// flush never loses what's needed to (re)download.
export interface MediaJobData {
  accountId: string
  mediaId: string
  messageId: string
  mediaType: string
}

let queue: Queue | undefined

// Untyped Queue (data is validated at the enqueue boundary below) — avoids BullMQ's
// generic `add()` friction under strict mode.
export function getMediaQueue(): Queue {
  if (!queue) {
    queue = new Queue(MEDIA_QUEUE_NAME, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    })
  }
  return queue
}

// jobId = mediaId makes enqueues idempotent: a replayed message won't double-queue
// the same attachment while a job for it already exists.
export async function enqueueMediaJob(data: MediaJobData): Promise<void> {
  await getMediaQueue().add('download', data, { jobId: data.mediaId })
}
