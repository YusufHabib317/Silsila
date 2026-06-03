import 'reflect-metadata'
import { config as loadEnv } from 'dotenv'
import { join } from 'node:path'
import { AppDataSource } from '@wa/entities'
import { enqueueMediaJob, getMediaQueue } from '../queue/media-queue'
import { logger } from '../logger'

// One-shot: enqueue every `pending` media row so the running worker downloads it.
// Use this after adding R2 keys to drain the backlog that accumulated while storage
// was disabled. Run it WHILE the worker is up so sockets are available for reupload
// of any media whose CDN URL has expired.
loadEnv({ path: join(__dirname, '../../../../.env') })

async function main() {
  await AppDataSource.initialize()

  // accountId lives on the parent message, not the media row — join to get it.
  const rows: { media_id: string; message_id: string; type: string; account_id: string }[] =
    await AppDataSource.query(`
      select md.id as media_id, md.message_id, md.type, m.account_id
      from media md
      join messages m on m.id = md.message_id
      where md.storage_status = 'pending'
    `)

  logger.info(`backfill: enqueueing ${rows.length} pending media job(s)`)
  for (const r of rows) {
    await enqueueMediaJob({
      accountId: r.account_id,
      mediaId: r.media_id,
      messageId: r.message_id,
      mediaType: r.type,
    })
  }

  await getMediaQueue().close()
  await AppDataSource.destroy()
  logger.info('backfill: done')
  process.exit(0)
}

main().catch((e) => {
  logger.error(e)
  process.exit(1)
})
