import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm'

@Entity({ name: 'alert_rules' })
@Index(['kind'])
export class AlertRule {
  @PrimaryColumn({ type: 'uuid' })
  id!: string

  @Column({ type: 'varchar', length: 120 })
  name!: string

  @Column({ type: 'varchar', length: 32 })
  kind!: string

  @Column({ type: 'jsonb' })
  params!: unknown

  @Column({ type: 'int', name: 'threshold_minutes', nullable: true })
  thresholdMinutes!: number | null

  @Column({ type: 'int', name: 'cooldown_minutes', default: 60 })
  cooldownMinutes!: number

  @Column({ type: 'boolean', default: true })
  enabled!: boolean

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date
}
