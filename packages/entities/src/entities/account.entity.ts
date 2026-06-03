import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm'

// Per-attachment-type capture policy. 'compress' applies image compression (WebP),
// 'store' keeps the original bytes, 'skip' writes a metadata-only row (no download).
export type MediaAction = 'compress' | 'store' | 'skip'
export type MediaPolicy = Record<string, MediaAction>

// Default policy from docs/ARCHITECTURE.md §7: only images are worth keeping by
// default; everything else is metadata-only until a per-account override turns it on.
export const DEFAULT_MEDIA_POLICY: MediaPolicy = {
  image: 'compress',
  audio: 'skip',
  video: 'skip',
  document: 'skip',
  sticker: 'skip',
}

// One row per linked WhatsApp number (the business view of a number). Tracks live
// connection status and the per-type media capture policy. Grew out of the Phase 0
// `wa_session` table — see migration Phase2MediaPipeline.
@Entity({ name: 'accounts' })
export class Account {
  @PrimaryColumn({ type: 'varchar', length: 128 })
  id!: string // == ACCOUNT_ID, a stable human label for the number

  @Column({ type: 'varchar', length: 255, nullable: true })
  label!: string | null

  @Column({ type: 'varchar', length: 64, name: 'phone_number', nullable: true })
  phoneNumber!: string | null

  @Column({ type: 'varchar', length: 32, default: 'unknown' })
  status!: string // connected | disconnected | unknown

  @Column({ type: 'timestamptz', name: 'last_seen_at', nullable: true })
  lastSeenAt!: Date | null

  @Column({ type: 'jsonb', name: 'media_policy', default: () => `'${JSON.stringify(DEFAULT_MEDIA_POLICY)}'` })
  mediaPolicy!: MediaPolicy

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date
}
