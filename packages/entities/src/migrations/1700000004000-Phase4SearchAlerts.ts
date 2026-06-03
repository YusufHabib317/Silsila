import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm'

export class Phase4SearchAlerts1700000004000 implements MigrationInterface {
  name = 'Phase4SearchAlerts1700000004000'

  public async up(q: QueryRunner): Promise<void> {
    await q.createTable(
      new Table({
        name: 'alert_rules',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true },
          { name: 'name', type: 'varchar', length: '120', isNullable: false },
          { name: 'kind', type: 'varchar', length: '32', isNullable: false },
          { name: 'params', type: 'jsonb', isNullable: false, default: `'{}'::jsonb` },
          { name: 'threshold_minutes', type: 'int', isNullable: true },
          { name: 'cooldown_minutes', type: 'int', isNullable: false, default: 60 },
          { name: 'enabled', type: 'boolean', isNullable: false, default: true },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
      }),
      true,
    )
    await q.createIndex(
      'alert_rules',
      new TableIndex({ name: 'idx_alert_rules_enabled_kind', columnNames: ['enabled', 'kind'] }),
    )

    await q.createTable(
      new Table({
        name: 'notifications',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true },
          { name: 'alert_rule_id', type: 'uuid', isNullable: false },
          { name: 'entity_type', type: 'varchar', length: '32', isNullable: false },
          { name: 'entity_id', type: 'uuid', isNullable: false },
          { name: 'severity', type: 'varchar', length: '16', isNullable: false, default: `'warning'` },
          { name: 'title', type: 'text', isNullable: false },
          { name: 'details', type: 'jsonb', isNullable: false, default: `'{}'::jsonb` },
          { name: 'is_read', type: 'boolean', isNullable: false, default: false },
          { name: 'read_at', type: 'timestamptz', isNullable: true },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
      }),
      true,
    )
    await q.createIndex(
      'notifications',
      new TableIndex({ name: 'idx_notifications_rule_created', columnNames: ['alert_rule_id', 'created_at'] }),
    )
    await q.createIndex(
      'notifications',
      new TableIndex({ name: 'idx_notifications_entity', columnNames: ['entity_type', 'entity_id'] }),
    )
    await q.createIndex(
      'notifications',
      new TableIndex({ name: 'idx_notifications_unread', columnNames: ['is_read', 'created_at'] }),
    )

    await q.createForeignKeys('notifications', [
      new TableForeignKey({
        columnNames: ['alert_rule_id'],
        referencedTableName: 'alert_rules',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    ])
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.dropTable('notifications')
    await q.dropTable('alert_rules')
  }
}
