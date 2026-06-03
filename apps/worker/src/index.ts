import 'reflect-metadata'
import { config as loadEnv } from 'dotenv'
import { join } from 'node:path'
import { AppDataSource } from '@wa/entities'
import { WaConnection } from './wa-connection'
import { logger } from './logger'

// Load the monorepo-root .env (pnpm --filter runs us with cwd = apps/worker).
loadEnv({ path: join(__dirname, '../../../.env') })

async function main() {
  await AppDataSource.initialize()
  logger.info('database connected')

  const sessionId = process.env.ACCOUNT_ID || 'default'
  const conn = new WaConnection(AppDataSource, sessionId)
  await conn.start()

  const shutdown = async () => {
    logger.info('shutting down...')
    await conn.stop()
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
