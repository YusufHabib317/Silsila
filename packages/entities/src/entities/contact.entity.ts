import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm'

@Entity({ name: 'contacts' })
@Index(['waJid'], { unique: true })
export class Contact {
  @PrimaryColumn({ type: 'uuid' })
  id!: string

  @Column({ type: 'varchar', length: 255, name: 'wa_jid' })
  waJid!: string

  @Column({ type: 'varchar', length: 255, name: 'display_name', nullable: true })
  displayName!: string | null

  @Column({ type: 'varchar', length: 255, name: 'push_name', nullable: true })
  pushName!: string | null

  @Column({ type: 'varchar', length: 64, name: 'phone_number', nullable: true })
  phoneNumber!: string | null

  @Column({ type: 'boolean', name: 'is_business', nullable: true })
  isBusiness!: boolean | null

  @Column({ type: 'text', nullable: true })
  notes!: string | null

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date
}
