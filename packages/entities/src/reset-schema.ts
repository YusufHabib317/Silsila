import 'reflect-metadata'
import { AppDataSource } from './data-source'

/**
 * Full schema reset. Drops and recreates the `public` schema through the app's
 * own DataSource (the Neon serverless driver), so it definitely runs against the
 * same database the API/worker use.
 *
 * We do this instead of `typeorm schema:drop` because TypeORM's clearDatabase()
 * path is unreliable over the Neon WebSocket driver and can silently no-op,
 * leaving old rows (e.g. the bootstrap admin user) in place.
 *
 * Run `pnpm migration:run` afterwards to recreate the tables empty.
 */
async function main() {
  await AppDataSource.initialize()
  try {
    console.log('dropping schema public (cascade)...')
    await AppDataSource.query('DROP SCHEMA IF EXISTS public CASCADE')
    await AppDataSource.query('CREATE SCHEMA public')
    console.log('schema reset complete — run `pnpm migration:run` to recreate tables')
  } finally {
    await AppDataSource.destroy()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
