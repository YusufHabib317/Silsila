import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm'

@Entity({ name: 'chats' })
@Index(['waJid'], { unique: true })
export class Chat {
  @PrimaryColumn({ type: 'uuid' })
  id!: string

  @Column({ type: 'varchar', length: 255, name: 'wa_jid' })
  waJid!: string

  @Column({ type: 'varchar', length: 32 })
  type!: string

  @Column({ type: 'varchar', length: 255, nullable: true })
  subject!: string | null

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date
}
