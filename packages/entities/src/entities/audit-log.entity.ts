import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm'

@Entity({ name: 'audit_log' })
export class AuditLog {
  @PrimaryColumn({ type: 'uuid' })
  id!: string

  @Column({ type: 'uuid', name: 'user_id', nullable: true })
  userId!: string | null

  @Column({ type: 'varchar', length: 64 })
  action!: string

  @Column({ type: 'varchar', length: 64, name: 'entity_type' })
  entityType!: string

  @Column({ type: 'varchar', length: 255, name: 'entity_id' })
  entityId!: string

  @Column({ type: 'jsonb', name: 'before', nullable: true })
  before!: unknown | null

  @Column({ type: 'jsonb', name: 'after', nullable: true })
  after!: unknown | null

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date
}
