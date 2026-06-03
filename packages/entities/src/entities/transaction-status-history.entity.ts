import { Column, Entity, PrimaryColumn } from 'typeorm'

@Entity({ name: 'transaction_status_history' })
export class TransactionStatusHistory {
  @PrimaryColumn({ type: 'uuid' })
  id!: string

  @Column({ type: 'uuid', name: 'transaction_id' })
  transactionId!: string

  @Column({ type: 'varchar', length: 32, name: 'from_status', nullable: true })
  fromStatus!: string | null

  @Column({ type: 'varchar', length: 32, name: 'to_status' })
  toStatus!: string

  @Column({ type: 'uuid', name: 'changed_by_user_id', nullable: true })
  changedByUserId!: string | null

  @Column({ type: 'text', nullable: true })
  note!: string | null

  @Column({ type: 'timestamptz', name: 'changed_at', default: () => 'now()' })
  changedAt!: Date
}

