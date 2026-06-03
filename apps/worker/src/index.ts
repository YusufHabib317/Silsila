import 'reflect-metadata'
import { config as loadEnv } from 'dotenv'
import { join } from 'node:path'
import { AppDataSource, Account } from '@wa/entities'
import { WaConnection } from './wa-connection'
import { startMediaProcessor } from './queue/media-processor'
import { logger } from './logger'

// Load the monorepo-root .env (pnpm --filter runs us with cwd = apps/worker).
loadEnv({ path: join(__dirname, '../../../.env') })

// One process can hold several Baileys sockets (one per number). ACCOUNT_IDS is a
// comma list (e.g. "client-main,client-2"); falls back to the single ACCOUNT_ID.
function resolveAccountIds(): string[] {
  const multi = (process.env.ACCOUNT_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (multi.length > 0) return multi
  return [process.env.ACCOUNT_ID || 'default']
}

async function main() {
  await AppDataSource.initialize()
  logger.info('database connected')

  const accountIds = resolveAccountIds()
  logger.info(`starting ${accountIds.length} account(s): ${accountIds.join(', ')}`)

  // Ensure an accounts row exists per number WITHOUT clobbering a human-customized
  // media_policy on restart — new rows get the column's default policy, existing
  // rows are left untouched.
  for (const id of accountIds) {
    await AppDataSource.createQueryBuilder()
      .insert()
      .into(Account)
      .values({ id, label: id })
      .orIgnore()
      .execute()
  }

  // Single in-process media queue worker drains downloads for all numbers.
  const processor = startMediaProcessor(AppDataSource)

  const connections = accountIds.map((id) => new WaConnection(AppDataSource, id))
  for (const conn of connections) await conn.start()

  const shutdown = async () => {
    logger.info('shutting down...')
    await Promise.all(connections.map((c) => c.stop()))
    await processor.close()
    await AppDataSource.destroy()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((e) => {
  logger.error(e)
  process.exit(1)
})
