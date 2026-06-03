import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm'

// One row per linked WhatsApp number. Tracks live connection status so the
// dashboard can later show "connected / disconnected" per account.
@Entity({ name: 'wa_session' })
export class WaSession {
  @PrimaryColumn({ type: 'varchar', length: 128 })
  id!: string // == ACCOUNT_ID, a stable human label for the number

  @Column({ type: 'varchar', length: 32, default: 'unknown' })
  status!: string // connected | disconnected | unknown

  @Column({ type: 'timestamptz', name: 'last_seen_at', nullable: true })
  lastSeenAt!: Date | null

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date
}
