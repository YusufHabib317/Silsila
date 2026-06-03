import { MigrationInterface, QueryRunner } from 'typeorm'

// Phase 2: grow wa_session into accounts (with per-type media_policy) and extend
// the media table with the columns the R2 compression pipeline needs.
const DEFAULT_MEDIA_POLICY = JSON.stringify({
  image: 'compress',
  audio: 'skip',
  video: 'skip',
  document: 'skip',
  sticker: 'skip',
})

export class Phase2MediaPipeline1700000002000 implements MigrationInterface {
  name = 'Phase2MediaPipeline1700000002000'

  public async up(q: QueryRunner): Promise<void> {
    // Rename the table; Postgres auto-repoints the existing FKs that reference it
    // (messages.account_id, account_chats.account_id) — they follow the table OID.
    await q.query(`ALTER TABLE "wa_session" RENAME TO "accounts"`)

    await q.query(`ALTER TABLE "accounts" ADD COLUMN "label" varchar(255)`)
    await q.query(`ALTER TABLE "accounts" ADD COLUMN "phone_number" varchar(64)`)
    await q.query(
      `ALTER TABLE "accounts" ADD COLUMN "media_policy" jsonb NOT NULL DEFAULT '${DEFAULT_MEDIA_POLICY}'::jsonb`,
    )
    await q.query(`ALTER TABLE "accounts" ADD COLUMN "created_at" timestamptz NOT NULL DEFAULT now()`)

    // media: storage pipeline columns + status lifecycle (pending|stored|skipped|failed)
    await q.query(`ALTER TABLE "media" ADD COLUMN "stored_bytes" bigint`)
    await q.query(`ALTER TABLE "media" ADD COLUMN "stored_mime" varchar(255)`)
    await q.query(`ALTER TABLE "media" ADD COLUMN "storage_error" text`)
    await q.query(`ALTER TABLE "media" ADD COLUMN "processed_at" timestamptz`)

    await q.query(`CREATE INDEX "idx_media_storage_status" ON "media" ("storage_status")`)
    await q.query(`CREATE INDEX "idx_media_sha256" ON "media" ("sha256")`)
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "idx_media_sha256"`)
    await q.query(`DROP INDEX IF EXISTS "idx_media_storage_status"`)
    await q.query(`ALTER TABLE "media" DROP COLUMN "processed_at"`)
    await q.query(`ALTER TABLE "media" DROP COLUMN "storage_error"`)
    await q.query(`ALTER TABLE "media" DROP COLUMN "stored_mime"`)
    await q.query(`ALTER TABLE "media" DROP COLUMN "stored_bytes"`)

    await q.query(`ALTER TABLE "accounts" DROP COLUMN "created_at"`)
    await q.query(`ALTER TABLE "accounts" DROP COLUMN "media_policy"`)
    await q.query(`ALTER TABLE "accounts" DROP COLUMN "phone_number"`)
    await q.query(`ALTER TABLE "accounts" DROP COLUMN "label"`)

    await q.query(`ALTER TABLE "accounts" RENAME TO "wa_session"`)
  }
}
