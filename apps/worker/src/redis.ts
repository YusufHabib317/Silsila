import IORedis from 'ioredis'

// Shared Redis wiring for BullMQ (queue + processor) and the live-event pub/sub
// channel the API subscribes to for SSE.
export const WA_EVENTS_CHANNEL = 'wa:events'

function redisUrl(): string {
  return process.env.REDIS_URL || 'redis://localhost:6379'
}

// BullMQ requires `maxRetriesPerRequest: null` on the connections it owns.
// Read REDIS_URL lazily so the root .env (loaded in index.ts) is already applied.
export function createRedisConnection(): IORedis {
  return new IORedis(redisUrl(), { maxRetriesPerRequest: null })
}

let publisher: IORedis | undefined

// A dedicated connection for publishing live events (kept off BullMQ's blocking
// connections so publishes are never queued behind a BRPOPLPUSH).
export function getPublisher(): IORedis {
  if (!publisher) publisher = createRedisConnection()
  return publisher
}
