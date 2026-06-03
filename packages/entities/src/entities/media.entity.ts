import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm'

@Entity({ name: 'media' })
export class Media {
  @PrimaryColumn({ type: 'uuid' })
  id!: string

  @Column({ type: 'uuid', name: 'message_id' })
  messageId!: string

  @Column({ type: 'varchar', length: 32 })
  type!: string

  // pending | stored | skipped | failed
  @Column({ type: 'varchar', length: 32, name: 'storage_status' })
  storageStatus!: string

  @Column({ type: 'varchar', length: 512, name: 'r2_key', nullable: true })
  r2Key!: string | null

  @Column({ type: 'varchar', length: 255, nullable: true })
  mime!: string | null

  @Column({ type: 'bigint', name: 'size_bytes', nullable: true })
  sizeBytes!: string | null

  // Size of the object actually written to storage (after compression).
  @Column({ type: 'bigint', name: 'stored_bytes', nullable: true })
  storedBytes!: string | null

  // MIME of the stored object (e.g. image/webp after compression).
  @Column({ type: 'varchar', length: 255, name: 'stored_mime', nullable: true })
  storedMime!: string | null

  @Column({ type: 'text', name: 'storage_error', nullable: true })
  storageError!: string | null

  @Column({ type: 'timestamptz', name: 'processed_at', nullable: true })
  processedAt!: Date | null

  @Column({ type: 'numeric', name: 'duration_seconds', nullable: true })
  durationSeconds!: string | null

  @Column({ type: 'integer', nullable: true })
  width!: number | null

  @Column({ type: 'integer', nullable: true })
  height!: number | null

  @Column({ type: 'varchar', length: 255, name: 'original_filename', nullable: true })
  originalFilename!: string | null

  @Column({ type: 'varchar', length: 128, nullable: true })
  sha256!: string | null

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date
}
