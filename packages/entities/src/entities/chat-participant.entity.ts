import { Column, Entity, PrimaryColumn } from 'typeorm'

@Entity({ name: 'chat_participants' })
export class ChatParticipant {
  @PrimaryColumn({ type: 'uuid', name: 'chat_id' })
  chatId!: string

  @PrimaryColumn({ type: 'uuid', name: 'contact_id' })
  contactId!: string

  @Column({ type: 'varchar', length: 32, name: 'role_in_group', nullable: true })
  roleInGroup!: string | null

  @Column({ type: 'timestamptz', name: 'joined_at', nullable: true })
  joinedAt!: Date | null
}
