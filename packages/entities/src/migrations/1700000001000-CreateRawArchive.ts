import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm'

export class CreateRawArchive1700000001000 implements MigrationInterface {
  name = 'CreateRawArchive1700000001000'

  public async up(q: QueryRunner): Promise<void> {
    await q.createTable(
      new Table({
        name: 'contacts',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true },
          { name: 'wa_jid', type: 'varchar', length: '255', isNullable: false },
          { name: 'display_name', type: 'varchar', length: '255', isNullable: true },
          { name: 'push_name', type: 'varchar', length: '255', isNullable: true },
          { name: 'phone_number', type: 'varchar', length: '64', isNullable: true },
          { name: 'is_business', type: 'boolean', isNullable: true },
          { name: 'notes', type: 'text', isNullable: true },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    )
    await q.createIndex('contacts', new TableIndex({ name: 'idx_contacts_wa_jid', columnNames: ['wa_jid'], isUnique: true }))

    await q.createTable(
      new Table({
        name: 'chats',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true },
          { name: 'wa_jid', type: 'varchar', length: '255', isNullable: false },
          { name: 'type', type: 'varchar', length: '32' },
          { name: 'subject', type: 'varchar', length: '255', isNullable: true },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    )
    await q.createIndex('chats', new TableIndex({ name: 'idx_chats_wa_jid', columnNames: ['wa_jid'], isUnique: true }))

    await q.createTable(
      new Table({
        name: 'account_chats',
        columns: [
          { name: 'account_id', type: 'varchar', length: '128', isPrimary: true },
          { name: 'chat_id', type: 'uuid', isPrimary: true },
          { name: 'first_seen_at', type: 'timestamptz', default: 'now()' },
          { name: 'last_seen_at', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    )

    await q.createTable(
      new Table({
        name: 'chat_participants',
        columns: [
          { name: 'chat_id', type: 'uuid', isPrimary: true },
          { name: 'contact_id', type: 'uuid', isPrimary: true },
          { name: 'role_in_group', type: 'varchar', length: '32', isNullable: true },
          { name: 'joined_at', type: 'timestamptz', isNullable: true },
        ],
      }),
      true,
    )

    await q.createTable(
      new Table({
        name: 'messages',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true },
          { name: 'wa_message_id', type: 'varchar', length: '255' },
          { name: 'account_id', type: 'varchar', length: '128' },
          { name: 'chat_id', type: 'uuid' },
          { name: 'sender_contact_id', type: 'uuid', isNullable: true },
          { name: 'from_me', type: 'boolean' },
          { name: 'timestamp', type: 'timestamptz', isNullable: true },
          { name: 'type', type: 'varchar', length: '64' },
          { name: 'text', type: 'text', isNullable: true },
          { name: 'raw', type: 'jsonb' },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    )
    await q.createIndex(
      'messages',
      new TableIndex({
        name: 'idx_messages_account_wa_message',
        columnNames: ['account_id', 'wa_message_id'],
        isUnique: true,
      }),
    )
    await q.createIndex('messages', new TableIndex({ name: 'idx_messages_chat_timestamp', columnNames: ['chat_id', 'timestamp'] }))

    await q.createTable(
      new Table({
        name: 'media',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true },
          { name: 'message_id', type: 'uuid' },
          { name: 'type', type: 'varchar', length: '32' },
          { name: 'storage_status', type: 'varchar', length: '32' },
          { name: 'r2_key', type: 'varchar', length: '512', isNullable: true },
          { name: 'mime', type: 'varchar', length: '255', isNullable: true },
          { name: 'size_bytes', type: 'bigint', isNullable: true },
          { name: 'duration_seconds', type: 'numeric', isNullable: true },
          { name: 'width', type: 'integer', isNullable: true },
          { name: 'height', type: 'integer', isNullable: true },
          { name: 'original_filename', type: 'varchar', length: '255', isNullable: true },
          { name: 'sha256', type: 'varchar', length: '128', isNullable: true },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    )

    await q.createForeignKeys('account_chats', [
      new TableForeignKey({ columnNames: ['account_id'], referencedTableName: 'wa_session', referencedColumnNames: ['id'], onDelete: 'CASCADE' }),
      new TableForeignKey({ columnNames: ['chat_id'], referencedTableName: 'chats', referencedColumnNames: ['id'], onDelete: 'CASCADE' }),
    ])
    await q.createForeignKeys('chat_participants', [
      new TableForeignKey({ columnNames: ['chat_id'], referencedTableName: 'chats', referencedColumnNames: ['id'], onDelete: 'CASCADE' }),
      new TableForeignKey({ columnNames: ['contact_id'], referencedTableName: 'contacts', referencedColumnNames: ['id'], onDelete: 'CASCADE' }),
    ])
    await q.createForeignKeys('messages', [
      new TableForeignKey({ columnNames: ['account_id'], referencedTableName: 'wa_session', referencedColumnNames: ['id'], onDelete: 'CASCADE' }),
      new TableForeignKey({ columnNames: ['chat_id'], referencedTableName: 'chats', referencedColumnNames: ['id'], onDelete: 'RESTRICT' }),
      new TableForeignKey({ columnNames: ['sender_contact_id'], referencedTableName: 'contacts', referencedColumnNames: ['id'], onDelete: 'SET NULL' }),
    ])
    await q.createForeignKey(
      'media',
      new TableForeignKey({ columnNames: ['message_id'], referencedTableName: 'messages', referencedColumnNames: ['id'], onDelete: 'CASCADE' }),
    )
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.dropTable('media')
    await q.dropTable('messages')
    await q.dropTable('chat_participants')
    await q.dropTable('account_chats')
    await q.dropTable('chats')
    await q.dropTable('contacts')
  }
}
