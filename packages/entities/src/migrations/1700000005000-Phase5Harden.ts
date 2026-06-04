import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm'

export class Phase5Harden1700000005000 implements MigrationInterface {
  name = 'Phase5Harden1700000005000'

  public async up(q: QueryRunner): Promise<void> {
    await q.createTable(
      new Table({
        name: 'users',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true },
          { name: 'email', type: 'varchar', length: '255', isNullable: false },
          { name: 'password_hash', type: 'text', isNullable: false },
          { name: 'name', type: 'varchar', length: '160', isNullable: false },
          { name: 'role', type: 'varchar', length: '32', isNullable: false, default: `'staff'` },
          { name: 'is_active', type: 'boolean', isNullable: false, default: true },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
      }),
      true,
    )
    await q.createIndex('users', new TableIndex({ name: 'idx_users_email', columnNames: ['email'], isUnique: true }))

    await q.createTable(
      new Table({
        name: 'audit_log',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true },
          { name: 'user_id', type: 'uuid', isNullable: true },
          { name: 'action', type: 'varchar', length: '64', isNullable: false },
          { name: 'entity_type', type: 'varchar', length: '64', isNullable: false },
          { name: 'entity_id', type: 'varchar', length: '255', isNullable: false },
          { name: 'before', type: 'jsonb', isNullable: true },
          { name: 'after', type: 'jsonb', isNullable: true },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
      }),
      true,
    )
    await q.createIndex(
      'audit_log',
      new TableIndex({
        name: 'idx_audit_log_user_action_created',
        columnNames: ['user_id', 'action', 'created_at'],
      }),
    )
    await q.createIndex(
      'audit_log',
      new TableIndex({ name: 'idx_audit_log_entity', columnNames: ['entity_type', 'entity_id', 'created_at'] }),
    )

    await q.createForeignKey(
      'audit_log',
      new TableForeignKey({
        columnNames: ['user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    )
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.dropTable('audit_log')
    await q.dropTable('users')
  }
}
