import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm'

@Entity({ name: 'messages' })
@Index(['accountId', 'waMessageId'], { unique: true })
export class ArchivedMessage {
  @PrimaryColumn({ type: 'uuid' })
  id!: string

  @Column({ type: 'varchar', length: 255, name: 'wa_message_id' })
  waMessageId!: string

  @Column({ type: 'varchar', length: 128, name: 'account_id' })
  accountId!: string

  @Column({ type: 'uuid', name: 'chat_id' })
  chatId!: string

  @Column({ type: 'uuid', name: 'sender_contact_id', nullable: true })
  senderContactId!: string | null

  @Column({ type: 'boolean', name: 'from_me' })
  fromMe!: boolean

  @Column({ type: 'timestamptz', nullable: true })
  timestamp!: Date | null

  @Column({ type: 'varchar', length: 64 })
  type!: string

  @Column({ type: 'text', nullable: true })
  text!: string | null

  @Column({ type: 'jsonb' })
  raw!: unknown

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date
}
