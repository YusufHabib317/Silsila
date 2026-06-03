import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm'

@Entity({ name: 'transactions' })
export class Transaction {
  @PrimaryColumn({ type: 'uuid' })
  id!: string

  @Column({ type: 'uuid', name: 'from_contact_id' })
  fromContactId!: string

  @Column({ type: 'uuid', name: 'to_contact_id' })
  toContactId!: string

  @Column({ type: 'varchar', length: 16 })
  direction!: string

  @Column({ type: 'text', name: 'product_text', nullable: true })
  productText!: string | null

  @Column({ type: 'numeric', nullable: true })
  quantity!: string | null

  @Column({ type: 'numeric' })
  amount!: string

  @Column({ type: 'varchar', length: 16 })
  currency!: string

  @Column({ type: 'varchar', length: 32, default: 'draft' })
  status!: string

  @Column({ type: 'uuid', name: 'opened_by_user_id', nullable: true })
  openedByUserId!: string | null

  @Column({ type: 'timestamptz', name: 'opened_at', nullable: true })
  openedAt!: Date | null

  @Column({ type: 'timestamptz', name: 'closed_at', nullable: true })
  closedAt!: Date | null

  @Column({ type: 'text', nullable: true })
  notes!: string | null

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date
}

