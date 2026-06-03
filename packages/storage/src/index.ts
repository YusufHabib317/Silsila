import { config as loadEnv } from 'dotenv'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// Load the monorepo-root .env (pnpm --filter runs consumers with cwd = their dir).
loadEnv({ path: join(__dirname, '../../../.env') })

const accountId = process.env.R2_ACCOUNT_ID
const accessKeyId = process.env.R2_ACCESS_KEY_ID
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
const bucket = process.env.R2_BUCKET

// All four R2 settings must be present for storage to be active. Until then the
// pipeline parks media as `pending` instead of failing — see StorageDisabledError.
const enabled = Boolean(accountId && accessKeyId && secretAccessKey && bucket)

// Thrown by put/get when R2 is not configured. The media processor treats this as
// "leave the row pending", distinct from a real upload failure.
export class StorageDisabledError extends Error {
  constructor() {
    super('storage disabled: set R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET')
    this.name = 'StorageDisabledError'
  }
}

const client =
  enabled && accountId
    ? new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
        forcePathStyle: true,
      })
    : null

export const storage = {
  /** True only when every R2_* env var is set. */
  isEnabled: enabled,
  bucket,

  async put(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void> {
    if (!client || !bucket) throw new StorageDisabledError()
    await client.send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
    )
  },

  /** Short-lived presigned GET URL — the API redirects the browser here. */
  async getSignedUrl(key: string, ttlSeconds = 300): Promise<string> {
    if (!client || !bucket) throw new StorageDisabledError()
    return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: ttlSeconds,
    })
  },

  /** Stream an object's bytes (used if the API proxies instead of redirecting). */
  async getStream(key: string): Promise<{ body: Readable; contentType?: string }> {
    if (!client || !bucket) throw new StorageDisabledError()
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    return { body: res.Body as Readable, contentType: res.ContentType }
  },

  async head(key: string) {
    if (!client || !bucket) throw new StorageDisabledError()
    return client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
  },
}
