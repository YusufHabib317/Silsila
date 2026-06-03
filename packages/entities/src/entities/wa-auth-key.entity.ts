import { Column, Entity, PrimaryColumn } from 'typeorm'

// Key-value store for Baileys auth state, scoped per session.
//   key = 'creds'        -> the credentials blob
//   key = '<type>-<id>'  -> a signal key (pre-keys, sessions, sender-keys, ...)
// Value is JSON serialized with Baileys' BufferJSON (Buffers survive round-trips).
// Stored in Postgres so Render's ephemeral disk never costs us the QR pairing.
@Entity({ name: 'wa_auth_key' })
export class WaAuthKey {
  @PrimaryColumn({ type: 'varchar', length: 128, name: 'session_id' })
  sessionId!: string

  @PrimaryColumn({ type: 'varchar', length: 255 })
  key!: string

  @Column({ type: 'text' })
  value!: string
}
