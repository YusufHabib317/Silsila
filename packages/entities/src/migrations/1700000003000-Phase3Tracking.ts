import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm'

export class Phase3Tracking1700000003000 implements MigrationInterface {
  name = 'Phase3Tracking1700000003000'

  public async up(q: QueryRunner): Promise<void> {
    await q.createTable(
      new Table({
        name: 'tags',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true },
          { name: 'name', type: 'varchar', length: '64', isNullable: false },
          { name: 'kind', type: 'varchar', length: '32', isNullable: false },
          { name: 'color', type: 'varchar', length: '16', isNullable: true },
        ],
      }),
      true,
    )
    await q.createIndex('tags', new TableIndex({ name: 'idx_tags_name_kind', columnNames: ['name', 'kind'], isUnique: true }))

    await q.createTable(
      new Table({
        name: 'contact_tags',
        columns: [
          { name: 'contact_id', type: 'uuid', isPrimary: true },
          { name: 'tag_id', type: 'uuid', isPrimary: true },
        ],
      }),
      true,
    )

    await q.createTable(
      new Table({
        name: 'transactions',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true },
          { name: 'from_contact_id', type: 'uuid', isNullable: false },
          { name: 'to_contact_id', type: 'uuid', isNullable: false },
          { name: 'direction', type: 'varchar', length: '16', isNullable: false },
          { name: 'product_text', type: 'text', isNullable: true },
          { name: 'quantity', type: 'numeric', isNullable: true },
          { name: 'amount', type: 'numeric', isNullable: false },
          { name: 'currency', type: 'varchar', length: '16', isNullable: false },
          { name: 'status', type: 'varchar', length: '32', default: `'draft'` },
          { name: 'opened_by_user_id', type: 'uuid', isNullable: true },
          { name: 'opened_at', type: 'timestamptz', isNullable: true },
          { name: 'closed_at', type: 'timestamptz', isNullable: true },
          { name: 'notes', type: 'text', isNullable: true },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    )
    await q.createIndex('transactions', new TableIndex({ name: 'idx_transactions_status', columnNames: ['status'] }))

    await q.createTable(
      new Table({
        name: 'transaction_messages',
        columns: [
          { name: 'transaction_id', type: 'uuid', isPrimary: true },
          { name: 'message_id', type: 'uuid', isPrimary: true },
        ],
      }),
      true,
    )
    await q.createIndex(
      'transaction_messages',
      new TableIndex({ name: 'idx_transaction_messages_message', columnNames: ['message_id'] }),
    )

    await q.createTable(
      new Table({
        name: 'transaction_status_history',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true },
          { name: 'transaction_id', type: 'uuid', isNullable: false },
          { name: 'from_status', type: 'varchar', length: '32', isNullable: true },
          { name: 'to_status', type: 'varchar', length: '32', isNullable: false },
          { name: 'changed_by_user_id', type: 'uuid', isNullable: true },
          { name: 'note', type: 'text', isNullable: true },
          { name: 'changed_at', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    )
    await q.createIndex(
      'transaction_status_history',
      new TableIndex({ name: 'idx_transaction_status_history_tx', columnNames: ['transaction_id', 'changed_at'] }),
    )

    await q.createTable(
      new Table({
        name: 'payments',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true },
          { name: 'transaction_id', type: 'uuid', isNullable: false },
          { name: 'amount', type: 'numeric', isNullable: false },
          { name: 'currency', type: 'varchar', length: '16', isNullable: false },
          { name: 'direction', type: 'varchar', length: '16', isNullable: false },
          { name: 'method', type: 'varchar', length: '64', isNullable: true },
          { name: 'paid_at', type: 'timestamptz', isNullable: false },
          { name: 'note', type: 'text', isNullable: true },
        ],
      }),
      true,
    )

    await q.createForeignKeys('transaction_messages', [
      new TableForeignKey({
        columnNames: ['transaction_id'],
        referencedTableName: 'transactions',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
      new TableForeignKey({
        columnNames: ['message_id'],
        referencedTableName: 'messages',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    ])
    await q.createForeignKeys('transaction_status_history', [
      new TableForeignKey({
        columnNames: ['transaction_id'],
        referencedTableName: 'transactions',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    ])
    await q.createForeignKeys('payments', [
      new TableForeignKey({
        columnNames: ['transaction_id'],
        referencedTableName: 'transactions',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    ])
    await q.createForeignKeys('contact_tags', [
      new TableForeignKey({
        columnNames: ['contact_id'],
        referencedTableName: 'contacts',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
      new TableForeignKey({
        columnNames: ['tag_id'],
        referencedTableName: 'tags',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    ])
    await q.createForeignKeys('transactions', [
      new TableForeignKey({
        columnNames: ['from_contact_id'],
        referencedTableName: 'contacts',
        referencedColumnNames: ['id'],
        onDelete: 'RESTRICT',
      }),
      new TableForeignKey({
        columnNames: ['to_contact_id'],
        referencedTableName: 'contacts',
        referencedColumnNames: ['id'],
        onDelete: 'RESTRICT',
      }),
    ])
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.dropTable('payments')
    await q.dropTable('transaction_status_history')
    await q.dropTable('transaction_messages')
    await q.dropTable('transactions')
    await q.dropTable('contact_tags')
    await q.dropTable('tags')
  }
}

