import 'reflect-metadata'
import { config as loadEnv } from 'dotenv'
import { join } from 'node:path'
import { DataSource } from 'typeorm'
import * as neon from '@neondatabase/serverless'
import ws from 'ws'
import { Account } from './entities/account.entity'
import { WaAuthKey } from './entities/wa-auth-key.entity'
import { Contact } from './entities/contact.entity'
import { Chat } from './entities/chat.entity'
import { AccountChat } from './entities/account-chat.entity'
import { ChatParticipant } from './entities/chat-participant.entity'
import { ArchivedMessage } from './entities/archived-message.entity'
import { Media } from './entities/media.entity'
import { Tag } from './entities/tag.entity'
import { ContactTag } from './entities/contact-tag.entity'
import { Transaction } from './entities/transaction.entity'
import { TransactionMessage } from './entities/transaction-message.entity'
import { TransactionStatusHistory } from './entities/transaction-status-history.entity'
import { Payment } from './entities/payment.entity'
import { InitWaAuth1700000000000 } from './migrations/1700000000000-InitWaAuth'
import { CreateRawArchive1700000001000 } from './migrations/1700000001000-CreateRawArchive'
import { Phase2MediaPipeline1700000002000 } from './migrations/1700000002000-Phase2MediaPipeline'
import { Phase3Tracking1700000003000 } from './migrations/1700000003000-Phase3Tracking'

// Load the monorepo-root .env explicitly. dotenv's default looks in process.cwd(),
// but `pnpm --filter` runs these scripts with cwd set to this package dir, so the
// root .env would never be found.
loadEnv({ path: join(__dirname, '../../../.env') })

// Raw Postgres (port 5432) is blocked on some networks; Neon's serverless driver
// tunnels the connection over a WebSocket on 443 instead. In Node it needs an
// explicit WebSocket implementation (browsers supply one natively).
neon.neonConfig.webSocketConstructor = ws

// Neon (and most managed PG) require TLS. Locally we keep it off.
const useSsl = process.env.DATABASE_SSL === 'true'

export const AppDataSource = new DataSource({
  type: 'postgres',
  // Use the Neon serverless driver instead of `pg` so traffic goes over 443.
  driver: neon,
  url: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  entities: [
    Account,
    WaAuthKey,
    Contact,
    Chat,
    AccountChat,
    ChatParticipant,
    ArchivedMessage,
    Media,
    Tag,
    ContactTag,
    Transaction,
    TransactionMessage,
    TransactionStatusHistory,
    Payment,
  ],
  migrations: [
    InitWaAuth1700000000000,
    CreateRawArchive1700000001000,
    Phase2MediaPipeline1700000002000,
    Phase3Tracking1700000003000,
  ],
  // NEVER turn this on in production — it silently alters your tables.
  // We use explicit migrations instead.
  synchronize: false,
  logging: ['error'],
})
