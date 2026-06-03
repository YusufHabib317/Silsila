import { Entity, PrimaryColumn } from 'typeorm'

@Entity({ name: 'transaction_messages' })
export class TransactionMessage {
  @PrimaryColumn({ type: 'uuid', name: 'transaction_id' })
  transactionId!: string

  @PrimaryColumn({ type: 'uuid', name: 'message_id' })
  messageId!: string
}

