import { MigrationInterface, QueryRunner, Table } from 'typeorm'

export class InitWaAuth1700000000000 implements MigrationInterface {
  name = 'InitWaAuth1700000000000'

  public async up(q: QueryRunner): Promise<void> {
    await q.createTable(
      new Table({
        name: 'wa_session',
        columns: [
          { name: 'id', type: 'varchar', length: '128', isPrimary: true },
          { name: 'status', type: 'varchar', length: '32', default: "'unknown'" },
          { name: 'last_seen_at', type: 'timestamptz', isNullable: true },
          { name: 'updated_at', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    )

    await q.createTable(
      new Table({
        name: 'wa_auth_key',
        columns: [
          { name: 'session_id', type: 'varchar', length: '128', isPrimary: true },
          { name: 'key', type: 'varchar', length: '255', isPrimary: true },
          { name: 'value', type: 'text' },
        ],
      }),
      true,
    )
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.dropTable('wa_auth_key')
    await q.dropTable('wa_session')
  }
}
