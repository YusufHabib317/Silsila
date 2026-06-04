import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm'

export class Phase5RefreshTokens1700000006000 implements MigrationInterface {
  name = 'Phase5RefreshTokens1700000006000'

  public async up(q: QueryRunner): Promise<void> {
    await q.createTable(
      new Table({
        name: 'refresh_tokens',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true },
          { name: 'user_id', type: 'uuid', isNullable: false },
          { name: 'token_hash', type: 'text', isNullable: false },
          { name: 'csrf_hash', type: 'text', isNullable: false },
          { name: 'expires_at', type: 'timestamptz', isNullable: false },
          { name: 'ip_address_hash', type: 'text', isNullable: true },
          { name: 'user_agent', type: 'text', isNullable: true },
          { name: 'revoked_at', type: 'timestamptz', isNullable: true },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
      }),
      true,
    )

    await q.createIndex(
      'refresh_tokens',
      new TableIndex({ name: 'idx_refresh_tokens_token_hash', columnNames: ['token_hash'], isUnique: true }),
    )
    await q.createIndex(
      'refresh_tokens',
      new TableIndex({ name: 'idx_refresh_tokens_user_id_created_at', columnNames: ['user_id', 'created_at'] }),
    )
    await q.createIndex(
      'refresh_tokens',
      new TableIndex({ name: 'idx_refresh_tokens_expires_at', columnNames: ['expires_at'] }),
    )

    await q.createForeignKey(
      'refresh_tokens',
      new TableForeignKey({
        columnNames: ['user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    )
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.dropTable('refresh_tokens')
  }
}

