import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm'

@Entity({ name: 'notifications' })
@Index(['alertRuleId', 'entityType', 'entityId'])
export class Notification {
  @PrimaryColumn({ type: 'uuid' })
  id!: string

  @Column({ type: 'uuid', name: 'alert_rule_id' })
  alertRuleId!: string

  @Column({ type: 'varchar', length: 32, name: 'entity_type' })
  entityType!: string

  @Column({ type: 'uuid', name: 'entity_id' })
  entityId!: string

  @Column({ type: 'varchar', length: 16 })
  severity!: string

  @Column({ type: 'text' })
  title!: string

  @Column({ type: 'jsonb' })
  details!: unknown

  @Column({ type: 'boolean', name: 'is_read', default: false })
  isRead!: boolean

  @Column({ type: 'timestamptz', name: 'read_at', nullable: true })
  readAt!: Date | null

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date
}
