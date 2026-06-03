import { Column, Entity, PrimaryColumn } from 'typeorm'

@Entity({ name: 'account_chats' })
export class AccountChat {
  @PrimaryColumn({ type: 'varchar', length: 128, name: 'account_id' })
  accountId!: string

  @PrimaryColumn({ type: 'uuid', name: 'chat_id' })
  chatId!: string

  @Column({ type: 'timestamptz', name: 'first_seen_at' })
  firstSeenAt!: Date

  @Column({ type: 'timestamptz', name: 'last_seen_at' })
  lastSeenAt!: Date
}
