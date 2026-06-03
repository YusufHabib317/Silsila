import { Column, Entity, PrimaryColumn } from 'typeorm'

@Entity({ name: 'payments' })
export class Payment {
  @PrimaryColumn({ type: 'uuid' })
  id!: string

  @Column({ type: 'uuid', name: 'transaction_id' })
  transactionId!: string

  @Column({ type: 'numeric' })
  amount!: string

  @Column({ type: 'varchar', length: 16 })
  currency!: string

  @Column({ type: 'varchar', length: 16 })
  direction!: string

  @Column({ type: 'varchar', length: 64, nullable: true })
  method!: string | null

  @Column({ type: 'timestamptz', name: 'paid_at' })
  paidAt!: Date

  @Column({ type: 'text', nullable: true })
  note!: string | null
}

