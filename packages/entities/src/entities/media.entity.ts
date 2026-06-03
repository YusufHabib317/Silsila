import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm'

@Entity({ name: 'media' })
export class Media {
  @PrimaryColumn({ type: 'uuid' })
  id!: string

  @Column({ type: 'uuid', name: 'message_id' })
  messageId!: string

  @Column({ type: 'varchar', length: 32 })
  type!: string

  @Column({ type: 'varchar', length: 32, name: 'storage_status' })
  storageStatus!: string

  @Column({ type: 'varchar', length: 512, name: 'r2_key', nullable: true })
  r2Key!: string | null

  @Column({ type: 'varchar', length: 255, nullable: true })
  mime!: string | null

  @Column({ type: 'bigint', name: 'size_bytes', nullable: true })
  sizeBytes!: string | null

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
