import 'reflect-metadata'
import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { URL } from 'node:url'
import IORedis from 'ioredis'
import QRCode from 'qrcode'
import { AppDataSource } from '@wa/entities'
import { storage } from '@wa/storage'

const configuredPort = parsePositiveEnvInt(process.env.API_PORT, 3000)
const MAX_PORT_FALLBACK = 10
const publicDir = join(__dirname, '../public')

// Must match the worker's WA_EVENTS_CHANNEL.
const WA_EVENTS_CHANNEL = 'wa:events'
const QR_CACHE_TTL_MS = parsePositiveEnvInt(process.env.API_QR_CACHE_TTL_SECONDS, 60) * 1000

// Connected dashboard SSE clients; the Redis subscriber fans events out to them.
const sseClients = new Set<ServerResponse>()
const latestQrByAccount = new Map<string, { qr: string; createdAt: string; expiresAt: number }>()

const TRANSACTION_STATUSES = ['draft', 'pending', 'in_transit', 'completed', 'refunded', 'lost', 'cancelled'] as const
const TERMINAL_TRANSACTION_STATUSES = new Set(['completed', 'refunded', 'lost', 'cancelled'])
const DIRECTION_VALUES = ['incoming', 'outgoing'] as const
const TAG_KINDS = ['role', 'custom'] as const
const PAYMENT_DIRECTIONS = ['incoming', 'outgoing'] as const
const ALERT_RULE_KINDS = ['keyword', 'stale_pending', 'no_movement'] as const
const ALARM_EVAL_INTERVAL_MS = Number.parseInt(process.env.ALERT_EVAL_INTERVAL_MS ?? '60000', 10)
const USER_ROLES = ['admin', 'staff'] as const
const ACCESS_TOKEN_COOKIE_NAME = process.env.ACCESS_TOKEN_COOKIE_NAME ?? process.env.AUTH_COOKIE_NAME ?? 'wa_access'
const REFRESH_TOKEN_COOKIE_NAME = process.env.REFRESH_TOKEN_COOKIE_NAME ?? 'wa_refresh'
const CSRF_TOKEN_COOKIE_NAME = process.env.CSRF_TOKEN_COOKIE_NAME ?? 'wa_csrf'
const ACCESS_TOKEN_TTL_SECONDS = parsePositiveEnvInt(process.env.API_ACCESS_TOKEN_TTL_SECONDS, 900)
const REFRESH_TOKEN_TTL_SECONDS = parsePositiveEnvInt(process.env.API_REFRESH_TOKEN_TTL_SECONDS, 30 * 24 * 3600)
const ACCESS_TOKEN_SECRET = process.env.API_JWT_ACCESS_SECRET || process.env.API_SESSION_SECRET || process.env.JWT_SECRET || ''
const REFRESH_TOKEN_SECRET = process.env.API_JWT_REFRESH_SECRET || process.env.API_SESSION_SECRET || process.env.JWT_SECRET || ''
const CSRF_TOKEN_BYTES = Number.parseInt(process.env.API_CSRF_TOKEN_BYTES ?? '24', 10)
const SENSITIVE_PASSWORD_MIN_LENGTH = 12
const PASSWORD_HASH_SEPARATOR = '$'
const LOGIN_RATE_LIMIT_WINDOW_MS = Number.parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS ?? '60000', 10)
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = Number.parseInt(process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS ?? '10', 10)
const MAX_PAGE_SIZE = 200
const MEILISEARCH_URL = process.env.MEILISEARCH_URL ?? ''
const MEILISEARCH_API_KEY = process.env.MEILISEARCH_API_KEY ?? ''
const MEILISEARCH_INDEX = process.env.MEILISEARCH_MESSAGES_INDEX ?? 'messages'
const ALERT_EVAL_INTERVAL_MS = Number.isFinite(ALARM_EVAL_INTERVAL_MS) && ALARM_EVAL_INTERVAL_MS >= 10_000
  ? ALARM_EVAL_INTERVAL_MS
  : 60_000
const IS_PRODUCTION = process.env.NODE_ENV === 'production'
type AlertSeverity = 'info' | 'warning' | 'critical'

type MessageRow = {
  id: string
  wa_message_id: string
  account_id: string
  timestamp: string | null
  type: string
  text: string | null
  from_me: boolean
  sender_contact_id: string | null
  chat_wa_jid: string
  chat_type: string
  chat_subject: string | null
  sender_wa_jid: string | null
  sender_name: string | null
  media_count: string
  media: { id: string; type: string; storage_status: string }[]
}

type AlertRuleRow = {
  id: string
  name: string
  kind: string
  params: Record<string, unknown>
  thresholdMinutes: number | null
  cooldownMinutes: number
  enabled: boolean
}

type AlertNotificationRow = {
  id: string
  alertRuleId: string
  entityType: string
  entityId: string
  severity: string
  title: string
  details: Record<string, unknown>
  isRead: boolean
  createdAt: string
  alertRuleName?: string
}

type TransactionRow = {
  id: string
  from_contact_id: string
  to_contact_id: string
  direction: string
  product_text: string | null
  quantity: string | null
  amount: string
  currency: string
  status: string
  opened_at: string | null
  closed_at: string | null
  created_at: string
  updated_at: string
  payments_count: string
  from_contact_wa_jid: string
  to_contact_wa_jid: string
  linked_messages: string
  notes: string | null
}

type TransactionMessageRow = {
  message_id: string
  wa_message_id: string
  account_id: string
  timestamp: string | null
  type: string
  text: string | null
}

type TransactionStatusHistoryRow = {
  id: string
  from_status: string | null
  to_status: string
  changed_by_user_id: string | null
  note: string | null
  changed_at: string
}

type AuthenticatedUser = {
  id: string
  email: string
  role: (typeof USER_ROLES)[number]
  name: string
}

type JwtAccessPayload = {
  sub: string
  email: string
  role: (typeof USER_ROLES)[number]
  jti: string
  type: 'access'
  iat: number
  exp: number
}

type JwtRefreshPayload = {
  sub: string
  jti: string
  type: 'refresh'
  iat: number
  exp: number
}

type RefreshSessionRow = {
  id: string
  user_id: string
  token_hash: string
  csrf_hash: string
  expires_at: string
  ip_address_hash: string | null
  user_agent: string | null
}

type UserRow = {
  id: string
  email: string
  name: string
  password_hash: string
  role: string
  is_active: boolean
}

type AccountRow = {
  id: string
  label: string | null
  phoneNumber: string | null
  status: string
  lastSeenAt: string | null
  createdAt: string
  updatedAt: string
}

type AuthenticatedRequest = IncomingMessage & {
  authUser?: AuthenticatedUser
}

type AuditLogRow = {
  id: string
  userId: string | null
  userEmail: string | null
  action: string
  entityType: string
  entityId: string
  before: unknown
  after: unknown
  createdAt: string
}

type PaymentRow = {
  id: string
  amount: string
  currency: string
  direction: string
  method: string | null
  paid_at: string
  note: string | null
}

function parsePositiveEnvInt(rawValue: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(rawValue ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

async function main() {
  await AppDataSource.initialize()
  console.log('database connected')
  startEventSubscriber()
  startAlertEngine()

  const server = createServer((req, res) => {
    void route(req, res).catch((e) => {
      console.error(e)
      sendJson(res, 500, { error: 'internal_error' })
    })
  })

  const port = await listenWithFallback(server, configuredPort)
  console.log(`api listening on http://localhost:${port}`)

  const shutdown = async () => {
    console.log('shutting down...')
    server.close()
    await AppDataSource.destroy()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

function listenWithFallback(server: ReturnType<typeof createServer>, startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let attempts = 0

    const tryPort = (candidatePort: number) => {
      const onError = (error: unknown) => {
        const err = error as { code?: string } & Error
        if (err.code === 'EADDRINUSE' && attempts < MAX_PORT_FALLBACK - 1) {
          attempts++
          const nextPort = startPort + attempts
          server.removeListener('error', onError)
          console.warn(`api port ${candidatePort} is in use. switching to ${nextPort}`)
          tryPort(nextPort)
          return
        }
        reject(err)
      }

      server.once('error', onError)
      server.listen(candidatePort, () => {
        server.removeListener('error', onError)
        resolve(candidatePort)
      })
    }

    tryPort(startPort)
  })
}

// Subscribe to worker-published live events and push them to all SSE clients.
function startEventSubscriber() {
  const url = process.env.REDIS_URL || 'redis://localhost:6379'
  const sub = new IORedis(url, { maxRetriesPerRequest: null })
  sub.on('message', (_channel: string, payload: string) => {
    handleWorkerEventPayload(payload)
  })
  sub.on('error', (e: Error) => console.error('redis subscriber error:', e.message))
  sub.subscribe(WA_EVENTS_CHANNEL).catch((e: unknown) => console.error('redis subscribe failed:', e))
}

function handleWorkerEventPayload(payload: string): void {
  let event: unknown
  try {
    event = JSON.parse(payload)
  } catch {
    publishSseEventRaw(payload)
    return
  }

  if (isQrEvent(event)) {
    const createdAt = typeof event.createdAt === 'string' ? event.createdAt : new Date().toISOString()
    latestQrByAccount.set(event.accountId, {
      qr: event.qr,
      createdAt,
      expiresAt: Date.now() + QR_CACHE_TTL_MS,
    })
    publishSseEvent({ type: 'qr_available', accountId: event.accountId, createdAt })
    return
  }

  if (isConnectionEvent(event) && event.status === 'connected') {
    latestQrByAccount.delete(event.accountId)
  }

  publishSseEventRaw(payload)
}

function isQrEvent(event: unknown): event is { type: 'qr'; accountId: string; qr: string; createdAt?: string } {
  const candidate = event as { type?: unknown; accountId?: unknown; qr?: unknown }
  return candidate?.type === 'qr' && typeof candidate.accountId === 'string' && typeof candidate.qr === 'string'
}

function isConnectionEvent(event: unknown): event is { type: 'connection'; accountId: string; status: string } {
  const candidate = event as { type?: unknown; accountId?: unknown; status?: unknown }
  return candidate?.type === 'connection' && typeof candidate.accountId === 'string' && typeof candidate.status === 'string'
}

function startAlertEngine() {
  void evaluateAlerts().catch((e) => console.error('alert eval error:', e))
  setInterval(() => {
    void evaluateAlerts().catch((e) => console.error('alert eval error:', e))
  }, ALERT_EVAL_INTERVAL_MS)
}

function publishSseEvent(payload: unknown) {
  publishSseEventRaw(JSON.stringify(payload))
}

function publishSseEventRaw(payload: string) {
  for (const res of sseClients) {
    res.write(`data: ${payload}\n\n`)
  }
}

function isOneOf<T extends string>(value: string, allowed: readonly T[]): value is T {
  return allowed.includes(value as T)
}

function validateStatus(status: string): status is (typeof TRANSACTION_STATUSES)[number] {
  return isOneOf(status, TRANSACTION_STATUSES)
}

function validateDirection(direction: string): direction is (typeof DIRECTION_VALUES)[number] {
  return isOneOf(direction, DIRECTION_VALUES)
}

function validateTagKind(kind: string): kind is (typeof TAG_KINDS)[number] {
  return isOneOf(kind, TAG_KINDS)
}

function toErrorCode(e: unknown): { code: number; error: string } {
  if (e instanceof Error) {
    if (e.message === 'unauthorized') return { code: 401, error: 'unauthorized' }
    if (e.message === 'forbidden') return { code: 403, error: 'forbidden' }
    if (e.message === 'validation_error:too_many_login_attempts') return { code: 429, error: 'too_many_login_attempts' }
    if (e.message === 'invalid_json') return { code: 400, error: 'invalid_json' }
    if (e.message === 'auth_token_expired') return { code: 401, error: 'auth_token_expired' }
    if (e.message === 'auth_secret_missing') return { code: 500, error: 'server_auth_config_missing' }
    if (e.message === 'invalid_refresh_token') return { code: 401, error: 'invalid_refresh_token' }
    if (e.message === 'invalid_csrf_token') return { code: 403, error: 'invalid_csrf_token' }
    if (e.message === 'not_found') return { code: 404, error: 'not_found' }
    if (e.message.startsWith('validation_error:')) {
      return { code: 400, error: e.message.replace('validation_error:', '') }
    }
  }
  return { code: 500, error: 'internal_error' }
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    const method = req.method ?? 'GET'
    const authReq = req as AuthenticatedRequest
    const isApiRoute = url.pathname.startsWith('/api/')

    if (url.pathname === '/api/health') {
      sendJson(res, 200, { ok: true })
      return
    }

    if (url.pathname.startsWith('/api/auth')) {
      await handleAuthRoutes(req, res, url, method)
      return
    }

    if (isApiRoute) {
      const user = await getAuthenticatedUser(req)
      authReq.authUser = user
    }

    if (url.pathname === '/api/stats') {
      await requireRole(authReq, ['admin', 'staff'])
      if (method !== 'GET') {
        sendJson(res, 405, { error: 'method_not_allowed' })
        return
      }
      sendJson(res, 200, await getStats())
      return
    }

    if (url.pathname === '/api/qr-code') {
      await requireRole(authReq, ['admin', 'staff'])
      if (method !== 'POST') {
        sendJson(res, 405, { error: 'method_not_allowed' })
        return
      }
      const payload = await readJsonBody(req)
      sendJson(res, 200, await generateQrCode(payload))
      return
    }

    if (url.pathname === '/api/alert-rules') {
      await requireRole(authReq, ['admin', 'staff'])
      if (method === 'GET') {
        sendJson(res, 200, await getAlertRules())
        return
      }
      if (method === 'POST') {
        await requireRole(authReq, ['admin'])
        const payload = await readJsonBody(req)
        sendJson(res, 201, await createAlertRule(authReq, payload))
        return
      }
      sendJson(res, 405, { error: 'method_not_allowed' })
      return
    }

    if (url.pathname.startsWith('/api/alerts')) {
      await requireRole(authReq, ['admin', 'staff'])
      await handleAlertsRoutes(req, res, url, method)
      return
    }

    if (url.pathname === '/api/messages') {
      await requireRole(authReq, ['admin', 'staff'])
      if (method !== 'GET') {
        sendJson(res, 405, { error: 'method_not_allowed' })
        return
      }
      sendJson(res, 200, await getMessages(url))
      return
    }

    if (url.pathname === '/api/chats') {
      await requireRole(authReq, ['admin', 'staff'])
      if (method !== 'GET') {
        sendJson(res, 405, { error: 'method_not_allowed' })
        return
      }
      sendJson(res, 200, await getChats())
      return
    }

    if (url.pathname === '/api/stream') {
      await requireRole(authReq, ['admin', 'staff'])
      if (method !== 'GET') {
        sendJson(res, 405, { error: 'method_not_allowed' })
        return
      }
      handleStream(req, res)
      return
    }

    if (url.pathname.startsWith('/api/media/')) {
      await requireRole(authReq, ['admin', 'staff'])
      if (method !== 'GET') {
        sendJson(res, 405, { error: 'method_not_allowed' })
        return
      }
      await handleMedia(decodeURIComponent(url.pathname.slice('/api/media/'.length)), res)
      return
    }

    if (url.pathname.startsWith('/api/transactions')) {
      await requireRole(authReq, ['admin', 'staff'])
      await handleTransactions(req, res, url, method)
      return
    }

    if (url.pathname === '/api/tags') {
      await requireRole(authReq, ['admin', 'staff'])
      if (method === 'GET') {
        sendJson(res, 200, await getTags())
        return
      }
      if (method === 'POST') {
        await requireRole(authReq, ['admin', 'staff'])
        const payload = await readJsonBody(req)
        sendJson(res, 201, await createTag(authReq, payload))
        return
      }
      sendJson(res, 405, { error: 'method_not_allowed' })
      return
    }

    if (url.pathname.startsWith('/api/contacts/')) {
      await requireRole(authReq, ['admin', 'staff'])
      await handleContactRoutes(req, res, url, method)
      return
    }

    if (url.pathname === '/api/users') {
      if (method === 'GET') {
        await requireRole(authReq, ['admin'])
        sendJson(res, 200, await getUsers(url))
        return
      }
      if (method === 'POST') {
        await requireRole(authReq, ['admin'])
        const payload = await readJsonBody(req)
        sendJson(res, 201, await createUser(authReq, payload))
        return
      }
      sendJson(res, 405, { error: 'method_not_allowed' })
      return
    }

    if (url.pathname === '/api/accounts') {
      if (method === 'GET') {
        await requireRole(authReq, ['admin', 'staff'])
        sendJson(res, 200, await getAccounts())
        return
      }
      sendJson(res, 405, { error: 'method_not_allowed' })
      return
    }

    if (url.pathname.startsWith('/api/accounts/')) {
      await handleAccountsRoutes(req, res, url, method)
      return
    }

    if (url.pathname === '/api/audit-logs') {
      if (method !== 'GET') {
        sendJson(res, 405, { error: 'method_not_allowed' })
        return
      }
      await requireRole(authReq, ['admin'])
      sendJson(res, 200, await getAuditLogs(url))
      return
    }

    if (url.pathname === '/favicon.ico') {
      res.statusCode = 204
      res.end()
      return
    }

    await serveStatic(url.pathname, res)
  } catch (err) {
    const mapped = toErrorCode(err)
    if (mapped.code === 500) {
      console.error(err)
    }
    sendJson(res, mapped.code, { error: mapped.error })
  }
}

const loginAttempts = new Map<string, { count: number; resetAt: number }>()

async function handleAuthRoutes(req: IncomingMessage, res: ServerResponse, url: URL, method: string): Promise<void> {
  const path = url.pathname.toLowerCase()
  const methodUpper = method.toUpperCase()
  const authReq = req as AuthenticatedRequest

  if (path === '/api/auth/register' && methodUpper === 'POST') {
    if (!ACCESS_TOKEN_SECRET || !REFRESH_TOKEN_SECRET) {
      throw new Error('auth_secret_missing')
    }
    const body = (await readJsonBody(req)) as Record<string, unknown>
    const email = String(body.email ?? '').trim().toLowerCase()
    const name = String(body.name ?? '').trim()
    const password = String(body.password ?? '')

    if (!email.includes('@')) throw new Error('validation_error:email')
    if (!name) throw new Error('validation_error:name')
    if (!password || password.length < SENSITIVE_PASSWORD_MIN_LENGTH) throw new Error('validation_error:password')

    const [countRow] = await AppDataSource.query(`select count(*)::int as count from users`)
    const existingUsers = Number(countRow?.count ?? 0)
    if (existingUsers > 0) {
      throw new Error('forbidden')
    }

    const id = randomUUID()
    const passwordHash = hashPassword(password)
    await AppDataSource.query(
      `
        insert into users (id, email, password_hash, name, role, is_active, created_at, updated_at)
        values ($1,$2,$3,$4,'admin',true, now(), now())
      `,
      [id, email, passwordHash, name],
    )

    const authUser: AuthenticatedUser = {
      id,
      email,
      name,
      role: 'admin',
    }
    await issueAuthCookies(res, authUser, req)
    sendJson(res, 201, {
      user: sanitizeUserForClient(authUser),
      accessTokenExpiresIn: ACCESS_TOKEN_TTL_SECONDS,
      tokenType: 'Bearer',
    })
    return
  }

  if (path === '/api/auth/register') {
    sendJson(res, 405, { error: 'method_not_allowed' })
    return
  }

  if (path === '/api/auth/me' && method === 'GET') {
    const user = await getAuthenticatedUser(req)
    authReq.authUser = user
    sendJson(res, 200, { user: sanitizeUserForClient(user) })
    return
  }

  if (path === '/api/auth/logout' && methodUpper === 'POST') {
    await revokeCurrentRefreshSession(req)
    clearAuthCookies(res)
    sendJson(res, 200, { ok: true })
    return
  }

  if (path === '/api/auth/logout-all' && methodUpper === 'POST') {
    const user = await getAuthenticatedUser(req)
    await revokeAllRefreshTokensForUser(user.id)
    clearAuthCookies(res)
    sendJson(res, 200, { ok: true })
    return
  }

  if (path === '/api/auth/refresh' && methodUpper === 'POST') {
    const { user, accessExpiresAt } = await refreshAccessToken(req, res)
    sendJson(res, 200, {
      user: sanitizeUserForClient(user),
      accessTokenExpiresAt: accessExpiresAt,
      tokenType: 'Bearer',
    })
    return
  }

  if (path === '/api/auth/login' && methodUpper === 'POST') {
    if (!ACCESS_TOKEN_SECRET || !REFRESH_TOKEN_SECRET) {
      throw new Error('auth_secret_missing')
    }
    const body = (await readJsonBody(req)) as Record<string, unknown>
    const ip = req.socket.remoteAddress ?? 'unknown'
    const rate = loginAttempts.get(ip) ?? { count: 0, resetAt: Date.now() + LOGIN_RATE_LIMIT_WINDOW_MS }
    if (Date.now() > rate.resetAt) {
      rate.count = 0
      rate.resetAt = Date.now() + LOGIN_RATE_LIMIT_WINDOW_MS
    }
    if (rate.count >= LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
      throw new Error('validation_error:too_many_login_attempts')
    }

    const email = String(body.email ?? '').trim().toLowerCase()
    const password = String(body.password ?? '')
    if (!email || !password) throw new Error('validation_error:credentials')

    const [user] = (await AppDataSource.query(
      `select id, email, name, role, is_active, password_hash from users where lower(email) = lower($1)`,
      [email],
    )) as UserRow[]
    rate.count += 1
    loginAttempts.set(ip, rate)

    if (!user || !user.is_active || !verifyPassword(password, user.password_hash)) {
      throw new Error('unauthorized')
    }
    const authUser: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: isOneOf(user.role, USER_ROLES) ? user.role : 'staff',
    }
    await AppDataSource.query(`update users set updated_at = now() where id = $1`, [authUser.id])
    await issueAuthCookies(res, authUser, req)
    authReq.authUser = authUser
    rate.count = 0
    loginAttempts.set(ip, rate)
    sendJson(res, 200, {
      user: sanitizeUserForClient(authUser),
      accessTokenExpiresIn: ACCESS_TOKEN_TTL_SECONDS,
      tokenType: 'Bearer',
    })
    return
  }

  if (
    path === '/api/auth/login' ||
    path === '/api/auth/me' ||
    path === '/api/auth/logout' ||
    path === '/api/auth/refresh' ||
    path === '/api/auth/logout-all'
  ) {
    sendJson(res, 405, { error: 'method_not_allowed' })
    return
  }

  sendJson(res, 404, { error: 'not_found' })
}

async function getAuthenticatedUser(req: IncomingMessage): Promise<AuthenticatedUser> {
  const token = getAccessToken(req)
  if (!token) throw new Error('unauthorized')
  const payload = parseJwtAccessToken(token)
  const user = await getUserById(payload.sub)
  if (!user) throw new Error('unauthorized')
  if (!user.is_active) throw new Error('forbidden')

  return {
    id: user.id,
    email: user.email,
    role: isOneOf(user.role, USER_ROLES) ? user.role : 'staff',
    name: user.name,
  }
}

async function requireRole(req: IncomingMessage, roles: readonly (typeof USER_ROLES)[number][]): Promise<AuthenticatedUser> {
  const user = await getAuthenticatedUser(req)
  if (!roles.includes(user.role)) throw new Error('forbidden')
  ;(req as AuthenticatedRequest).authUser = user
  return user
}

function sanitizeUserForClient(user: AuthenticatedUser) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  }
}

function getCookieValue(req: IncomingMessage, name: string): string | null {
  const cookies = parseCookieHeader(req.headers.cookie ?? '')
  return cookies[name] ?? null
}

function getAccessToken(req: IncomingMessage): string | null {
  const cookie = getCookieValue(req, ACCESS_TOKEN_COOKIE_NAME)
  if (cookie) return cookie
  const authHeader = req.headers.authorization
  if (!authHeader) return null
  const match = /^Bearer\s+(.+)$/.exec(authHeader)
  return match?.[1] ?? null
}

function getRefreshToken(req: IncomingMessage): string | null {
  return getCookieValue(req, REFRESH_TOKEN_COOKIE_NAME)
}

function getCsrfTokenFromRequest(req: IncomingMessage): string | null {
  const raw = req.headers['x-csrf-token']
  if (!raw) return null
  const candidate = Array.isArray(raw) ? raw[0] : raw
  if (typeof candidate !== 'string') return null
  const token = candidate.trim()
  return token.length > 0 ? token : null
}

function isBase64Url(value: string): boolean {
  return /^[A-Za-z0-9_-]+={0,2}$/.test(value)
}

function parseJwtParts(token: string) {
  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new Error('unauthorized')
  }
  if (!parts.every(isBase64Url)) {
    throw new Error('unauthorized')
  }
  return parts
}

function parseSignedJwt(token: string, secret: string): unknown {
  if (!secret) {
    throw new Error('auth_secret_missing')
  }

  const [headerB64, payloadB64, signatureB64] = parseJwtParts(token)
  const expectedSig = createHmac('sha256', secret).update(`${headerB64}.${payloadB64}`).digest('base64url')
  const expectedSigBytes = Buffer.from(expectedSig, 'base64url')
  const providedSigBytes = Buffer.from(signatureB64, 'base64url')
  if (expectedSigBytes.length !== providedSigBytes.length || !timingSafeEqual(expectedSigBytes, providedSigBytes)) {
    throw new Error('unauthorized')
  }

  let payload: unknown
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
  } catch {
    throw new Error('unauthorized')
  }
  return payload
}

function parseJwtAccessToken(token: string): JwtAccessPayload {
  const payload = parseSignedJwt(token, ACCESS_TOKEN_SECRET)
  if (!payload || typeof payload !== 'object') throw new Error('unauthorized')
  const normalized = payload as Record<string, unknown>
  if (normalized.type !== 'access') throw new Error('unauthorized')
  if (typeof normalized.sub !== 'string' || normalized.sub.length < 1) throw new Error('unauthorized')
  if (typeof normalized.email !== 'string' || !normalized.email) throw new Error('unauthorized')
  if (!Number.isFinite(normalized.iat as number) || !Number.isFinite(normalized.exp as number)) {
    throw new Error('unauthorized')
  }
  const role = normalized.role
  if (typeof role !== 'string' || !isOneOf(role, USER_ROLES)) {
    throw new Error('unauthorized')
  }
  const now = Math.floor(Date.now() / 1000)
  const exp = Number(normalized.exp)
  if (exp < now) throw new Error('auth_token_expired')
  if (typeof normalized.jti !== 'string' || !normalized.jti) throw new Error('unauthorized')
  return {
    sub: normalized.sub,
    email: normalized.email,
    role,
    jti: normalized.jti,
    type: 'access',
    iat: Number(normalized.iat),
    exp,
  }
}

function parseJwtRefreshToken(token: string): JwtRefreshPayload {
  const payload = parseSignedJwt(token, REFRESH_TOKEN_SECRET)
  if (!payload || typeof payload !== 'object') throw new Error('unauthorized')
  const normalized = payload as Record<string, unknown>
  if (normalized.type !== 'refresh') throw new Error('unauthorized')
  if (typeof normalized.sub !== 'string' || normalized.sub.length < 1) throw new Error('unauthorized')
  if (!Number.isFinite(normalized.iat as number) || !Number.isFinite(normalized.exp as number)) {
    throw new Error('unauthorized')
  }
  if (typeof normalized.jti !== 'string' || !normalized.jti) throw new Error('unauthorized')
  const now = Math.floor(Date.now() / 1000)
  const exp = Number(normalized.exp)
  if (exp < now) throw new Error('auth_token_expired')
  return {
    sub: normalized.sub,
    jti: normalized.jti,
    type: 'refresh',
    iat: Number(normalized.iat),
    exp,
  }
}

function createSignedJwt(payload: Record<string, unknown>, secret: string): string {
  if (!secret) {
    throw new Error('auth_secret_missing')
  }
  const header = Buffer.from('{"alg":"HS256","typ":"JWT"}', 'utf8').toString('base64url')
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${signature}`
}

function createAccessToken(user: AuthenticatedUser): string {
  const now = Math.floor(Date.now() / 1000)
  const exp = now + Math.max(ACCESS_TOKEN_TTL_SECONDS, 60)
  const payload: JwtAccessPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    jti: randomUUID(),
    type: 'access',
    iat: now,
    exp,
  }
  return createSignedJwt(payload, ACCESS_TOKEN_SECRET)
}

function createRefreshToken(user: AuthenticatedUser): string {
  const now = Math.floor(Date.now() / 1000)
  const exp = now + Math.max(REFRESH_TOKEN_TTL_SECONDS, 60)
  const payload: JwtRefreshPayload = {
    sub: user.id,
    jti: randomUUID(),
    type: 'refresh',
    iat: now,
    exp,
  }
  return createSignedJwt(payload, REFRESH_TOKEN_SECRET)
}

function generateRandomToken(bytes: number): string {
  const safeBytes = Number.isFinite(bytes) && bytes > 0 ? bytes : 24
  return randomBytes(safeBytes).toString('base64url')
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('base64url')
}

function buildCookie(name: string, value: string, maxAgeSeconds: number, httpOnly = true): string {
  const maxAge = Math.max(Math.floor(maxAgeSeconds), 60)
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    `Expires=${new Date(Date.now() + maxAge * 1000).toUTCString()}`,
    'SameSite=Strict',
  ]
  if (IS_PRODUCTION) parts.push('Secure')
  if (httpOnly) parts.push('HttpOnly')
  return parts.join('; ')
}

function clearCookie(name: string): string {
  return `${name}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Strict${IS_PRODUCTION ? '; Secure' : ''}`
}

async function issueAuthCookies(res: ServerResponse, user: AuthenticatedUser, req: IncomingMessage): Promise<void> {
  const accessToken = createAccessToken(user)
  const csrfToken = generateRandomToken(CSRF_TOKEN_BYTES)
  const refreshSession = await createRefreshSession(user, req, csrfToken)

  res.setHeader('Set-Cookie', [
    buildCookie(ACCESS_TOKEN_COOKIE_NAME, accessToken, ACCESS_TOKEN_TTL_SECONDS, true),
    buildCookie(REFRESH_TOKEN_COOKIE_NAME, refreshSession.token, REFRESH_TOKEN_TTL_SECONDS, true),
    buildCookie(CSRF_TOKEN_COOKIE_NAME, csrfToken, REFRESH_TOKEN_TTL_SECONDS, false),
  ])
}

function clearAuthCookies(res: ServerResponse): void {
  res.setHeader('Set-Cookie', [
    clearCookie(ACCESS_TOKEN_COOKIE_NAME),
    clearCookie(REFRESH_TOKEN_COOKIE_NAME),
    clearCookie(CSRF_TOKEN_COOKIE_NAME),
  ])
}

type IssuedRefreshSession = {
  id: string
  token: string
}

async function createRefreshSession(
  user: AuthenticatedUser,
  req: IncomingMessage,
  csrfToken: string,
): Promise<IssuedRefreshSession> {
  const now = Date.now()
  const token = createRefreshToken(user)
  const tokenPayload = parseJwtRefreshToken(token)
  const expiresAt = new Date(now + Math.max(REFRESH_TOKEN_TTL_SECONDS, 60) * 1000)
  const ip = req.socket.remoteAddress
  const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null
  await AppDataSource.query(
    `
      insert into refresh_tokens (
        id,
        user_id,
        token_hash,
        csrf_hash,
        expires_at,
        ip_address_hash,
        user_agent,
        created_at,
        updated_at
      ) values (
        $1, $2, $3, $4, $5, $6, $7, now(), now()
      )
    `,
    [
      tokenPayload.jti,
      user.id,
      hashToken(token),
      hashToken(csrfToken),
      expiresAt,
      ip ? hashToken(ip) : null,
      userAgent,
    ],
  )
  return {
    id: tokenPayload.jti,
    token,
  }
}

async function getRefreshSessionByToken(token: string): Promise<RefreshSessionRow | null> {
  const [row] = (await AppDataSource.query(
    `
      select
        id,
        user_id,
        token_hash,
        csrf_hash,
        expires_at,
        ip_address_hash,
        user_agent
      from refresh_tokens
      where token_hash = $1
        and revoked_at is null
        and expires_at > now()
    `,
    [hashToken(token)],
  )) as RefreshSessionRow[]
  return row ?? null
}

async function revokeRefreshSession(sessionId: string): Promise<void> {
  await AppDataSource.query(`update refresh_tokens set revoked_at = now(), updated_at = now() where id = $1`, [sessionId])
}

async function revokeCurrentRefreshSession(req: IncomingMessage): Promise<void> {
  const token = getRefreshToken(req)
  if (!token) return
  const row = await getRefreshSessionByToken(token)
  if (!row) return
  await revokeRefreshSession(row.id)
}

async function revokeAllRefreshTokensForUser(userId: string): Promise<void> {
  await AppDataSource.query(`update refresh_tokens set revoked_at = now(), updated_at = now() where user_id = $1 and revoked_at is null`, [userId])
}

async function refreshAccessToken(req: IncomingMessage, res: ServerResponse): Promise<{ user: AuthenticatedUser; accessExpiresAt: number }> {
  const refreshToken = getRefreshToken(req)
  if (!refreshToken) throw new Error('unauthorized')
  const payload = parseJwtRefreshToken(refreshToken)
  const session = await getRefreshSessionByToken(refreshToken)
  if (!session || session.id !== payload.jti) throw new Error('invalid_refresh_token')
  const csrfToken = getCsrfTokenFromRequest(req)
  if (!csrfToken || !session.csrf_hash || !validateTokenHash(csrfToken, session.csrf_hash)) {
    throw new Error('invalid_csrf_token')
  }
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    await revokeRefreshSession(session.id)
    throw new Error('auth_token_expired')
  }

  const user = await getUserById(payload.sub)
  if (!user) throw new Error('unauthorized')
  if (!user.is_active) {
    await revokeRefreshSession(session.id)
    throw new Error('forbidden')
  }

  await revokeRefreshSession(session.id)
  const authUser: AuthenticatedUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: isOneOf(user.role, USER_ROLES) ? user.role : 'staff',
  }
  const accessExpiresAt = Math.floor(Date.now() / 1000) + Math.max(ACCESS_TOKEN_TTL_SECONDS, 60)
  await issueAuthCookies(res, authUser, req)
  return { user: authUser, accessExpiresAt }
}

function validateTokenHash(rawToken: string, expectedHash: string): boolean {
  try {
    return timingSafeEqual(Buffer.from(hashToken(rawToken), 'base64url'), Buffer.from(expectedHash, 'base64url'))
  } catch {
    return false
  }
}

async function getUserById(id: string) {
  const [user] = await AppDataSource.query(
    `select id, email, name, role, is_active, password_hash from users where id = $1`,
    [id],
  )
  return user as (UserRow | undefined)
}

function parseCookieHeader(raw: string): Record<string, string> {
  if (!raw) return {}
  return raw
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((acc, pair) => {
      const i = pair.indexOf('=')
      if (i <= 0) return acc
      acc[pair.slice(0, i)] = decodeURIComponent(pair.slice(i + 1))
      return acc
    }, {} as Record<string, string>)
}

function hashPassword(raw: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(raw, Buffer.from(salt, 'hex'), 64)
  return `v1${PASSWORD_HASH_SEPARATOR}${salt}${PASSWORD_HASH_SEPARATOR}${hash.toString('base64url')}`
}

function verifyPassword(raw: string, stored: string): boolean {
  const [version, salt, expected] = stored.split(PASSWORD_HASH_SEPARATOR)
  if (version !== 'v1' || !salt || !expected) return false
  const expectedBytes = Buffer.from(expected, 'base64url')
  const candidate = scryptSync(raw, Buffer.from(salt, 'hex'), expectedBytes.length)
  return expectedBytes.length === candidate.length && timingSafeEqual(expectedBytes, candidate)
}

async function getUsers(url: URL) {
  const rawLimit = Number(url.searchParams.get('limit') ?? 50)
  const rawOffset = Number(url.searchParams.get('offset') ?? 0)
  const limit = Math.min(Math.max(rawLimit || 1, 1), MAX_PAGE_SIZE)
  const offset = Math.max(rawOffset || 0, 0)
  const role = (url.searchParams.get('role') ?? '').trim()
  const activeOnly = url.searchParams.get('isActive')
  const q = (url.searchParams.get('q') ?? '').trim()

  const params: unknown[] = []
  const where: string[] = []

  if (role) {
    if (!isOneOf(role, USER_ROLES)) {
      throw new Error('validation_error:role')
    }
    params.push(role)
    where.push(`u.role = $${params.length}`)
  }

  if (activeOnly !== null) {
    const parsed = parseBoolean(activeOnly)
    if (parsed === null) throw new Error('validation_error:isActive')
    params.push(parsed)
    where.push(`u.is_active = $${params.length}`)
  }

  if (q) {
    params.push(`%${q}%`)
    const i = params.length
    where.push(`(u.email ilike $${i} or u.name ilike $${i})`)
  }

  const whereSql = where.length ? `where ${where.join(' and ')}` : ''

  params.push(limit, offset)
  const rows = (await AppDataSource.query(
    `
      select
        u.id,
        u.email,
        u.name,
        u.role,
        u.is_active as "isActive",
        u.created_at as "createdAt",
        u.updated_at as "updatedAt"
      from users u
      ${whereSql}
      order by u.created_at desc
      limit $${params.length - 1}
      offset $${params.length}
    `,
    params,
  )) as {
    id: string
    email: string
    name: string
    role: string
    isActive: boolean
    createdAt: string
    updatedAt: string
  }[]

  const [{ total }] = (await AppDataSource.query(
    `
      select count(*)::int as total
      from users u
      ${whereSql}
    `,
    params.slice(0, params.length - 2),
  )) as Array<{ total: number }>

  return { rows, total: Number(total), limit, offset }
}

async function createUser(req: IncomingMessage, payload: unknown) {
  const actor = await requireRole(req as AuthenticatedRequest, ['admin'])
  const body = (payload ?? {}) as Record<string, unknown>
  const email = String(body.email ?? '').trim().toLowerCase()
  const name = String(body.name ?? '').trim()
  const rawRole = String(body.role ?? '').trim()
  const rawActive = body.isActive

  const role = isOneOf(rawRole, USER_ROLES) ? rawRole : 'staff'
  const password = String(body.password ?? '')
  const isActive = rawActive === undefined ? true : parseBoolean(String(rawActive)) ?? undefined

  if (!email.includes('@')) throw new Error('validation_error:email')
  if (!name) throw new Error('validation_error:name')
  if (!password || password.length < SENSITIVE_PASSWORD_MIN_LENGTH) throw new Error('validation_error:password')
  if (!isOneOf(role, USER_ROLES)) throw new Error('validation_error:role')
  if (rawActive !== undefined && isActive === undefined) throw new Error('validation_error:isActive')

  const [existing] = (await AppDataSource.query(
    `select 1 from users where lower(email) = lower($1)`,
    [email],
  )) as Array<{ one: number }>
  if (existing) throw new Error('validation_error:email_exists')

  const id = randomUUID()
  const passwordHash = hashPassword(password)

  await AppDataSource.query(
    `
      insert into users (id, email, password_hash, name, role, is_active, created_at, updated_at)
      values ($1,$2,$3,$4,$5,$6, now(), now())
    `,
    [id, email, passwordHash, name, role, isActive],
  )

  const [row] = (await AppDataSource.query(
    `
      select
        id,
        email,
        name,
        role,
        is_active as "isActive",
        created_at as "createdAt",
        updated_at as "updatedAt"
      from users
      where id = $1
    `,
    [id],
  )) as {
    id: string
    email: string
    name: string
    role: string
    isActive: boolean
    createdAt: string
    updatedAt: string
  }[]

      await recordAudit({
        user: actor,
        action: 'create_user',
        entityType: 'user',
        entityId: id,
        before: null,
        after: row[0] ?? null,
  })

  return row[0]
}

async function handleAccountsRoutes(req: IncomingMessage, res: ServerResponse, url: URL, method: string): Promise<void> {
  const parts = url.pathname.split('/').filter(Boolean)
  const hasWhatsappRoute = parts.length === 4 && parts[1] === 'accounts'
  if (!hasWhatsappRoute) {
    sendJson(res, 404, { error: 'not_found' })
    return
  }

  const accountId = decodeURIComponent(parts[2] ?? '')
  const action = parts[3]
  if (action === 'qr-code') {
    if (method !== 'POST') {
      sendJson(res, 405, { error: 'method_not_allowed' })
      return
    }
    await requireRole(req as AuthenticatedRequest, ['admin', 'staff'])
    sendJson(res, 200, await requestAccountQrCode(accountId))
    return
  }

  if (action !== 'whatsapp-number') {
    sendJson(res, 404, { error: 'not_found' })
    return
  }

  if (method !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed' })
    return
  }

  const actor = await requireRole(req as AuthenticatedRequest, ['admin'])
  const body = (await readJsonBody(req)) as Record<string, unknown>
  const rawPhoneNumber = String(body.phoneNumber ?? body.phone_number ?? '').trim()
  const phoneNumber = normalizePhoneNumber(rawPhoneNumber)
  if (!phoneNumber) {
    throw new Error('validation_error:phone_number')
  }

  const [existing] = (await AppDataSource.query(
    `select id, coalesce(label, id) as label, phone_number as "phoneNumber", status, last_seen_at as "lastSeenAt"
     from accounts
     where id = $1`,
    [accountId],
  )) as Array<AccountRow>
  if (!existing) {
    throw new Error('not_found')
  }

  await AppDataSource.query(
    `update accounts set phone_number = $1, updated_at = now() where id = $2`,
    [phoneNumber, existing.id],
  )

  const [updated] = (await AppDataSource.query(
    `select id, label, phone_number as "phoneNumber", status, last_seen_at as "lastSeenAt", created_at as "createdAt", updated_at as "updatedAt"
     from accounts
     where id = $1`,
    [accountId],
  )) as AccountRow[]

  await recordAudit({
    user: actor,
    action: 'update_account_phone_number',
    entityType: 'account',
    entityId: accountId,
    before: existing,
    after: updated,
  })

  sendJson(res, 200, updated)
}

async function requestAccountQrCode(accountId: string) {
  const [account] = (await AppDataSource.query(
    `select id, coalesce(label, id) as label, status
     from accounts
     where id = $1`,
    [accountId],
  )) as Array<{ id: string; label: string; status: string }>
  if (!account) {
    throw new Error('not_found')
  }

  if (account.status === 'connected') {
    latestQrByAccount.delete(accountId)
    return {
      accountId,
      status: 'connected',
      qr: null,
      createdAt: null,
    }
  }

  const cached = getCachedQr(accountId)
  return {
    accountId,
    status: cached ? 'ready' : 'preparing',
    qr: cached?.qr ?? null,
    createdAt: cached?.createdAt ?? null,
  }
}

function getCachedQr(accountId: string): { qr: string; createdAt: string } | null {
  const cached = latestQrByAccount.get(accountId)
  if (!cached) return null
  if (cached.expiresAt <= Date.now()) {
    latestQrByAccount.delete(accountId)
    return null
  }
  return { qr: cached.qr, createdAt: cached.createdAt }
}

async function getAccounts() {
  const rows = (await AppDataSource.query(
    `select id, coalesce(label, id) as label, phone_number as "phoneNumber", status, last_seen_at as "lastSeenAt", created_at as "createdAt", updated_at as "updatedAt"
     from accounts
     order by id`,
  )) as AccountRow[]
  return { rows }
}

function normalizePhoneNumber(raw: string): string | null {
  const cleaned = raw.replace(/[().\s-]/g, '')
  if (!/^\+?\d{7,24}$/.test(cleaned)) {
    return null
  }
  return cleaned
}

async function getAuditLogs(url: URL) {
  const rawLimit = Number(url.searchParams.get('limit') ?? 50)
  const rawOffset = Number(url.searchParams.get('offset') ?? 0)
  const action = (url.searchParams.get('action') ?? '').trim()
  const entityType = (url.searchParams.get('entityType') ?? '').trim()
  const entityId = (url.searchParams.get('entityId') ?? '').trim()
  const userId = (url.searchParams.get('userId') ?? '').trim()
  const limit = Math.min(Math.max(rawLimit || 1, 1), MAX_PAGE_SIZE)
  const offset = Math.max(rawOffset || 0, 0)

  const params: unknown[] = []
  const where: string[] = []

  if (action) {
    params.push(action)
    where.push(`al.action = $${params.length}`)
  }
  if (entityType) {
    params.push(entityType)
    where.push(`al.entity_type = $${params.length}`)
  }
  if (entityId) {
    params.push(entityId)
    where.push(`al.entity_id = $${params.length}`)
  }
  if (userId) {
    params.push(userId)
    where.push(`al.user_id = $${params.length}`)
  }

  const whereSql = where.length ? `where ${where.join(' and ')}` : ''

  params.push(limit, offset)
  const rows = (await AppDataSource.query(
    `
      select
        al.id,
        al.user_id as "userId",
        u.email as "userEmail",
        al.action,
        al.entity_type as "entityType",
        al.entity_id as "entityId",
        al.before,
        al.after,
        al.created_at as "createdAt"
      from audit_log al
      left join users u on u.id = al.user_id
      ${whereSql}
      order by al.created_at desc
      limit $${params.length - 1}
      offset $${params.length}
    `,
    params,
  )) as AuditLogRow[]

  const [{ total }] = (await AppDataSource.query(
    `
      select count(*)::int as total
      from audit_log al
      ${whereSql}
    `,
    params.slice(0, params.length - 2),
  )) as Array<{ total: number }>

  return { rows, total: Number(total), limit, offset }
}

async function recordAudit(input: {
  user: AuthenticatedUser
  action: string
  entityType: string
  entityId: string
  before: unknown
  after: unknown
}) {
  await AppDataSource.query(
    `
      insert into audit_log (id, user_id, action, entity_type, entity_id, before, after)
      values ($1,$2,$3,$4,$5,$6,$7)
    `,
    [randomUUID(), input.user.id, input.action, input.entityType, input.entityId, input.before ?? null, input.after ?? null],
  )
}

function parseBoolean(raw: string): boolean | undefined {
  const normalized = raw.trim().toLowerCase()
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false
  return undefined
}

async function handleTransactions(req: IncomingMessage, res: ServerResponse, url: URL, method: string): Promise<void> {
  if (url.pathname === '/api/transactions') {
    await requireRole(req as AuthenticatedRequest, ['admin', 'staff'])
    if (method === 'GET') {
      sendJson(res, 200, await getTransactions(url))
      return
    }
    if (method === 'POST') {
      const payload = await readJsonBody(req)
      sendJson(res, 201, await createTransaction(req, payload))
      return
    }
    sendJson(res, 405, { error: 'method_not_allowed' })
    return
  }

  const parts = url.pathname.split('/').filter(Boolean)
  const id = parts[2] ?? ''
  if (!id) {
    sendJson(res, 404, { error: 'not_found' })
    return
  }

  const action = parts[3]
  if (!action) {
    if (method !== 'GET') {
      sendJson(res, 405, { error: 'method_not_allowed' })
      return
    }
    sendJson(res, 200, await getTransactionById(id))
    return
  }

  if (action === 'messages') {
    if (method !== 'POST') {
      sendJson(res, 405, { error: 'method_not_allowed' })
      return
    }
    await requireRole(req as AuthenticatedRequest, ['admin', 'staff'])
    const payload = await readJsonBody(req)
    sendJson(res, 201, await linkMessageToTransaction(req, id, payload))
    return
  }

  if (action === 'payments') {
    if (method === 'GET') {
      sendJson(res, 200, await getPaymentsByTransaction(id))
      return
    }
    if (method === 'POST') {
      await requireRole(req as AuthenticatedRequest, ['admin', 'staff'])
      const payload = await readJsonBody(req)
      sendJson(res, 201, await createPayment(req, id, payload))
      return
    }
    sendJson(res, 405, { error: 'method_not_allowed' })
    return
  }

  if (action === 'status') {
    if (method !== 'POST') {
      sendJson(res, 405, { error: 'method_not_allowed' })
      return
    }
    await requireRole(req as AuthenticatedRequest, ['admin', 'staff'])
    const payload = await readJsonBody(req)
    sendJson(res, 200, await updateTransactionStatus(req, id, payload))
    return
  }

  sendJson(res, 404, { error: 'not_found' })
}

async function handleContactRoutes(req: IncomingMessage, res: ServerResponse, url: URL, method: string): Promise<void> {
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length < 4) {
    sendJson(res, 404, { error: 'not_found' })
    return
  }

  const contactId = parts[2]
  const action = parts[3]
  if (action !== 'tags') {
    sendJson(res, 404, { error: 'not_found' })
    return
  }

  if (method === 'GET') {
    await requireRole(req as AuthenticatedRequest, ['admin', 'staff'])
    sendJson(res, 200, await getContactTags(contactId))
    return
  }

  if (method === 'POST') {
    await requireRole(req as AuthenticatedRequest, ['admin', 'staff'])
    const payload = await readJsonBody(req)
    sendJson(res, 201, await addContactTag(req, contactId, payload))
    return
  }

  sendJson(res, 405, { error: 'method_not_allowed' })
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }

  if (chunks.length === 0) return {}
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error('invalid_json')
  }
}

// SSE: hold the connection open, register it, and let the Redis subscriber push
// `message`/`media` events. A periodic comment keeps proxies from timing out.
function handleStream(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  res.write('retry: 3000\n\n')
  sseClients.add(res)

  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000)
  req.on('close', () => {
    clearInterval(heartbeat)
    sseClients.delete(res)
  })
}

async function getStats() {
  const [counts] = await AppDataSource.query(`
    select
      (select count(*)::int from messages) as messages,
      (select count(*)::int from chats) as chats,
      (select count(*)::int from contacts) as contacts,
      (select count(*)::int from media) as media,
      (select count(*)::int from transactions) as transactions,
      (select count(*)::int from transactions where status = 'pending') as pending_transactions,
      (select count(*)::int from messages where timestamp >= now() - interval '24 hours') as messages_last_24h,
      (select count(*)::int from messages where timestamp >= now() - interval '7 days') as messages_last_7d,
      (select count(*)::int from transactions where updated_at >= now() - interval '24 hours') as transactions_updated_last_24h,
      (select count(*)::int from notifications where is_read = false) as unread_alerts,
      (select count(*)::int from notifications where is_read = false and severity = 'critical') as critical_alerts,
      (
        select coalesce(jsonb_object_agg(status, count), '{}'::jsonb)
        from (
          select t.status, count(*)::int as count
          from transactions t
          group by t.status
        ) t
      ) as transactions_by_status,
      (
        select coalesce(jsonb_object_agg(severity, count), '{}'::jsonb)
        from (
          select n.severity, count(*)::int as count
          from notifications n
          where n.is_read = false
          group by n.severity
        ) n
      ) as alerts_by_severity
  `)

  const recent = await AppDataSource.query(`
    select
      c.wa_jid,
      c.type,
      c.subject,
      count(m.id)::int as message_count,
      max(m.timestamp) as last_message_at
    from chats c
    join messages m on m.chat_id = c.id
    group by c.id
    order by last_message_at desc nulls last
    limit 8
  `)

  return { counts, recent }
}

async function getMessages(url: URL) {
  const rawLimit = Number(url.searchParams.get('limit') ?? 50)
  const rawOffset = Number(url.searchParams.get('offset') ?? 0)
  const limit = Math.min(Math.max(rawLimit, 1), 100)
  const offset = Math.max(rawOffset, 0)
  const q = (url.searchParams.get('q') ?? '').trim()
  const chat = (url.searchParams.get('chat') ?? '').trim()

  if (q && MEILISEARCH_URL) {
    const byMeili = await searchMessagesWithMeilisearch(q, chat, limit, offset)
    if (byMeili) {
      return byMeili
    }
  }

  const where: string[] = []
  const params: unknown[] = []

  if (q) {
    params.push(q)
    const idx = params.length
    where.push(`(
      to_tsvector('simple', coalesce(m.text, '')) @@ websearch_to_tsquery('simple', $${idx})
      or m.text ilike '%' || $${idx} || '%'
      or c.wa_jid ilike '%' || $${idx} || '%'
      or coalesce(s.wa_jid, '') ilike '%' || $${idx} || '%'
      or coalesce(s.display_name, '') ilike '%' || $${idx} || '%'
      or coalesce(s.push_name, '') ilike '%' || $${idx} || '%'
    )`)
  }

  if (chat) {
    params.push(chat)
    where.push(`c.wa_jid = $${params.length}`)
  }

  params.push(limit, offset)
  const limitParam = params.length - 1
  const offsetParam = params.length
  const whereSql = where.length ? `where ${where.join(' and ')}` : ''

  const rows = (await AppDataSource.query(
    `
      select
        m.id,
        m.wa_message_id,
        m.account_id,
        m.timestamp,
        m.type,
        m.text,
        m.from_me,
        m.sender_contact_id,
        c.wa_jid as chat_wa_jid,
        c.type as chat_type,
        c.subject as chat_subject,
        s.wa_jid as sender_wa_jid,
        coalesce(s.display_name, s.push_name) as sender_name,
        count(md.id)::int as media_count,
        coalesce(
          json_agg(
            json_build_object('id', md.id, 'type', md.type, 'storage_status', md.storage_status)
            order by md.created_at
          ) filter (where md.id is not null),
          '[]'
        ) as media
      from messages m
      join chats c on c.id = m.chat_id
      left join contacts s on s.id = m.sender_contact_id
      left join media md on md.message_id = m.id
      ${whereSql}
      group by m.id, c.id, s.id
      order by m.timestamp desc nulls last, m.created_at desc
      limit $${limitParam}
      offset $${offsetParam}
    `,
    params,
  )) as MessageRow[]

  const [{ total }] = await AppDataSource.query(
    `
      select count(*)::int as total
      from messages m
      join chats c on c.id = m.chat_id
      left join contacts s on s.id = m.sender_contact_id
      ${whereSql}
    `,
    params.slice(0, params.length - 2),
  )

  return { rows, total, limit, offset }
}

async function getChats() {
  const rows = await AppDataSource.query(`
    select
      c.wa_jid,
      c.type,
      c.subject,
      count(m.id)::int as message_count,
      max(m.timestamp) as last_message_at
    from chats c
    left join messages m on m.chat_id = c.id
    group by c.id
    order by last_message_at desc nulls last, c.wa_jid asc
    limit 200
  `)

  return { rows }
}

async function generateQrCode(payload: unknown): Promise<{ svg: string }> {
  const body = (payload ?? {}) as Record<string, unknown>
  const text = typeof body.text === 'string' ? body.text : ''
  if (!text) throw new Error('validation_error:qr_text')
  if (text.length > 4096) throw new Error('validation_error:qr_text_too_long')

  const svg = await QRCode.toString(text, {
    type: 'svg',
    width: 240,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#17211c',
      light: '#ffffff',
    },
  })

  return { svg }
}

async function handleAlertsRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<void> {
  const parts = url.pathname.split('/').filter(Boolean)
  const topLevel = parts[1]
  if (topLevel !== 'alerts') {
    sendJson(res, 404, { error: 'not_found' })
    return
  }

  if (parts.length === 2) {
    if (method !== 'GET') {
      sendJson(res, 405, { error: 'method_not_allowed' })
      return
    }
    sendJson(res, 200, await getNotifications(url))
    return
  }

  const action = parts[2]
  if (parts.length === 3 && action && method === 'GET') {
    sendJson(res, 404, { error: 'not_found' })
    return
  }

  if (action && url.pathname.endsWith('/ack') && method === 'POST') {
    const [, , alertId] = parts
    if (!alertId) {
      sendJson(res, 404, { error: 'not_found' })
      return
    }
    sendJson(res, 200, await ackNotification(alertId))
    return
  }
  if (action && url.pathname.endsWith('/ack')) {
    sendJson(res, 405, { error: 'method_not_allowed' })
    return
  }

  sendJson(res, 404, { error: 'not_found' })
}

async function getNotifications(url: URL) {
  const rawLimit = Number(url.searchParams.get('limit') ?? 25)
  const rawOffset = Number(url.searchParams.get('offset') ?? 0)
  const unreadOnly = (url.searchParams.get('unread') ?? 'true') !== 'false'
  const entityType = (url.searchParams.get('entityType') ?? '').trim()
  const ruleKind = (url.searchParams.get('kind') ?? '').trim()
  const limit = Math.min(Math.max(rawLimit, 1), 100)
  const offset = Math.max(rawOffset, 0)

  const where: string[] = []
  const params: unknown[] = []

  if (unreadOnly) {
    where.push('n.is_read = false')
  }
  if (entityType) {
    params.push(entityType)
    where.push(`n.entity_type = $${params.length}`)
  }
  if (ruleKind) {
    params.push(ruleKind)
    where.push(`ar.kind = $${params.length}`)
  }

  const whereSql = where.length ? `where ${where.join(' and ')}` : ''

  params.push(limit, offset)
  const limitParam = params.length - 1
  const offsetParam = params.length
  const rows = (await AppDataSource.query(
    `
      select
        n.id,
        n.alert_rule_id as "alertRuleId",
        n.entity_type as "entityType",
        n.entity_id as "entityId",
        n.severity,
        n.title,
        n.details,
        n.is_read as "isRead",
        n.created_at as "createdAt",
        ar.name as "alertRuleName"
      from notifications n
      join alert_rules ar on ar.id = n.alert_rule_id
      ${whereSql}
      order by n.created_at desc
      limit $${limitParam}
      offset $${offsetParam}
    `,
    params,
  )) as AlertNotificationRow[]

  const countParams = params.slice(0, params.length - 2)
  const [{ total }] = await AppDataSource.query(
    `
      select count(*)::int as total
      from notifications n
      join alert_rules ar on ar.id = n.alert_rule_id
      ${whereSql}
    `,
    countParams,
  )

  return { rows, total, limit, offset }
}

async function ackNotification(id: string) {
  const [row] = (await AppDataSource.query(
    `
      update notifications
      set is_read = true, read_at = now()
      where id = $1
      returning id, is_read
    `,
    [id],
  )) as { id: string; is_read: boolean }[]
  if (!row) throw new Error('not_found')
  return row
}

async function getAlertRules() {
  const rows = (await AppDataSource.query(
    `select id, name, kind, params, threshold_minutes as "thresholdMinutes", cooldown_minutes as "cooldownMinutes", enabled, created_at, updated_at from alert_rules order by created_at desc`,
  )) as AlertRuleRow[]
  return { rows }
}

function parseAlertRuleKind(kind: string): (typeof ALERT_RULE_KINDS)[number] | null {
  return isOneOf(kind, ALERT_RULE_KINDS) ? kind : null
}

async function createAlertRule(req: IncomingMessage, payload: unknown) {
  const actor = await requireRole(req as AuthenticatedRequest, ['admin'])
  const body = (payload ?? {}) as Record<string, unknown>
  const name = String(body.name ?? '').trim() || 'Untitled rule'
  const rawKind = String(body.kind ?? '').trim()
  const kind = parseAlertRuleKind(rawKind)
  const thresholdMinutes = normalizePositiveInteger(body.thresholdMinutes ?? body.threshold_minutes, 60)
  const cooldownMinutes = normalizePositiveInteger(body.cooldownMinutes ?? body.cooldown_minutes, 30)
  const rawParams = (body.params ?? {}) as Record<string, unknown>

  if (!kind) throw new Error('validation_error:kind')
  if (!name) throw new Error('validation_error:name')

  const params = buildRuleParams(kind, rawParams, body)
  const id = randomUUID()

  await AppDataSource.query(
    `
      insert into alert_rules (
        id, name, kind, params, threshold_minutes, cooldown_minutes, enabled
      ) values ($1, $2, $3, $4, $5, $6, $7)
    `,
    [id, name, kind, params, thresholdMinutes, cooldownMinutes, body.enabled !== false],
  )

  const [row] = (await AppDataSource.query(
    `
      select
        id, name, kind, params,
        threshold_minutes as "thresholdMinutes",
        cooldown_minutes as "cooldownMinutes",
        enabled,
        created_at,
        updated_at
      from alert_rules
      where id = $1
    `,
    [id],
  )) as AlertRuleRow[]

  await recordAudit({
    user: actor,
    action: 'create_alert_rule',
    entityType: 'alert_rule',
    entityId: id,
    before: null,
    after: row[0] ?? null,
  })

  return row
}

function buildRuleParams(
  kind: (typeof ALERT_RULE_KINDS)[number],
  rawParams: Record<string, unknown>,
  body: Record<string, unknown>,
): Record<string, unknown> {
  const params: Record<string, unknown> = {
    ...rawParams,
  }
  if (kind === 'keyword') {
    const keyword = String(rawParams.keyword ?? body.keyword ?? '').trim()
    if (!keyword) {
      throw new Error('validation_error:keyword')
    }
    params.keyword = keyword
  }
  return params
}

async function evaluateAlerts() {
  if (evaluateAlertsRunning) return
  evaluateAlertsRunning = true

  try {
    const rules = (await AppDataSource.query(
      `
        select
          id, name, kind, params,
          threshold_minutes as "thresholdMinutes",
          cooldown_minutes as "cooldownMinutes",
          enabled
        from alert_rules
        where enabled = true
      `,
    )) as AlertRuleRow[]

    for (const rule of rules) {
      const entityType = rule.kind === 'keyword' ? 'message' : 'transaction'
      const cooldown = rule.cooldownMinutes || 60
      if (rule.kind === 'keyword') {
        await evaluateKeywordRule(rule, cooldown, entityType)
        continue
      }
      if (rule.kind === 'stale_pending') {
        await evaluateStalePendingRule(rule, cooldown, entityType)
        continue
      }
      await evaluateNoMovementRule(rule, cooldown, entityType)
    }
  } finally {
    evaluateAlertsRunning = false
  }
}

async function evaluateKeywordRule(rule: AlertRuleRow, cooldownMinutes: number, entityType: string) {
  const keyword = String((rule.params as Record<string, unknown>).keyword ?? '').trim()
  if (!keyword) return
  const matchedMessages = (await AppDataSource.query(
    `
      select m.id, c.wa_jid as chatWaJid
      from messages m
      join chats c on c.id = m.chat_id
      where coalesce(m.text, '') ilike '%' || $1 || '%'
      order by m.created_at desc
      limit 100
    `,
    [keyword],
  )) as { id: string; chatWaJid: string }[]

  for (const msg of matchedMessages) {
    const isRecent = await hasRecentNotification(rule.id, entityType, msg.id, cooldownMinutes)
    if (isRecent) continue

    await createNotification(rule, {
      alertEntityType: entityType,
      alertEntityId: msg.id,
      severity: 'info',
      title: `Keyword match: ${rule.name}`,
      details: { keyword, chatWaJid: msg.chatWaJid },
    })
  }
}

async function evaluateStalePendingRule(rule: AlertRuleRow, cooldownMinutes: number, entityType: string) {
  const thresholdMinutes = rule.thresholdMinutes ?? 60
  const staleTransactions = (await AppDataSource.query(
    `
      select t.id, t.opened_at
      from transactions t
      where t.status = 'pending'
        and t.opened_at is not null
        and t.opened_at < now() - $1::interval
      order by opened_at asc
      limit 100
    `,
    [`${thresholdMinutes} minutes`],
  )) as { id: string; openedAt: string }[]

  for (const tx of staleTransactions) {
    const isRecent = await hasRecentNotification(rule.id, entityType, tx.id, cooldownMinutes)
    if (isRecent) continue

    await createNotification(rule, {
      alertEntityType: entityType,
      alertEntityId: tx.id,
      severity: 'warning',
      title: `Stale pending transaction ${rule.name}`,
      details: { transactionId: tx.id, openedAt: tx.openedAt },
    })
  }
}

async function evaluateNoMovementRule(rule: AlertRuleRow, cooldownMinutes: number, entityType: string) {
  const thresholdMinutes = rule.thresholdMinutes ?? 120
  const transactions = (await AppDataSource.query(
    `
      select t.id, COALESCE(h.changed_at, t.created_at) as lastStatusAt
      from transactions t
      left join LATERAL (
        select changed_at
        from transaction_status_history
        where transaction_id = t.id
        order by changed_at desc
        limit 1
      ) h on true
      where t.status not in ('completed', 'refunded', 'lost', 'cancelled')
        and COALESCE(h.changed_at, t.created_at) < now() - $1::interval
      order by lastStatusAt asc
      limit 100
    `,
    [`${thresholdMinutes} minutes`],
  )) as { id: string; lastStatusAt: string }[]

  for (const tx of transactions) {
    const isRecent = await hasRecentNotification(rule.id, entityType, tx.id, cooldownMinutes)
    if (isRecent) continue

    await createNotification(rule, {
      alertEntityType: entityType,
      alertEntityId: tx.id,
      severity: 'warning',
      title: `No movement: ${rule.name}`,
      details: { transactionId: tx.id, lastStatusAt: tx.lastStatusAt },
    })
  }
}

async function hasRecentNotification(ruleId: string, entityType: string, entityId: string, cooldownMinutes: number) {
  const [row] = (await AppDataSource.query(
    `
      select 1
      from notifications
      where alert_rule_id = $1
        and entity_type = $2
        and entity_id = $3
        and is_read = false
        and created_at > now() - $4::interval
      limit 1
    `,
    [ruleId, entityType, entityId, `${cooldownMinutes} minutes`],
  )) as { one?: number }[]

  return !!row
}

async function createNotification(
  rule: AlertRuleRow,
  options: {
    alertEntityType: string
    alertEntityId: string
    severity: AlertSeverity
    title: string
    details: Record<string, unknown>
  },
) {
  const id = randomUUID()
  await AppDataSource.query(
    `
      insert into notifications (
        id, alert_rule_id, entity_type, entity_id, severity, title, details
      ) values ($1, $2, $3, $4, $5, $6, $7)
    `,
    [id, rule.id, options.alertEntityType, options.alertEntityId, options.severity, options.title, options.details],
  )
  publishSseEvent({
    type: 'alert',
    alertRuleId: rule.id,
    entityType: options.alertEntityType,
    entityId: options.alertEntityId,
    severity: options.severity,
    title: options.title,
    details: options.details,
  })
  return { id, inserted: true }
}

let evaluateAlertsRunning = false

function normalizePositiveInteger(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value)
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return fallback
}

async function searchMessagesWithMeilisearch(
  q: string,
  chat: string,
  limit: number,
  offset: number,
): Promise<{ rows: MessageRow[]; total: number; limit: number; offset: number } | null> {
  if (!MEILISEARCH_URL) return null

  try {
    const base = MEILISEARCH_URL.replace(/\/$/, '')
    const payload = {
      q,
      limit,
      offset,
      attributesToRetrieve: ['id'],
    }
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (MEILISEARCH_API_KEY) {
      headers.Authorization = `Bearer ${MEILISEARCH_API_KEY}`
    }

    const res = await fetch(`${base}/indexes/${encodeURIComponent(MEILISEARCH_INDEX)}/search`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })
    if (!res.ok) return null

    const payloadJson = (await res.json()) as {
      hits?: Array<{ id?: string }>
      estimatedTotalHits?: number
      totalHits?: number
    }
    const ids = (payloadJson.hits ?? []).map((hit) => (typeof hit.id === 'string' ? hit.id : null)).filter(Boolean) as string[]
    if (!ids.length) {
      return {
        rows: [],
        total: Number(payloadJson.totalHits ?? payloadJson.estimatedTotalHits ?? 0),
        limit,
        offset,
      }
    }

    const params: Array<unknown> = [ids]
    const chatClause = chat ? 'where c.wa_jid = $2' : ''
    if (chat) params.push(chat)

    const rows = (await AppDataSource.query(
      `
        with ids as (
          select * from unnest($1::uuid[]) with ordinality as x(id, ord)
        )
        select
          m.id,
          m.wa_message_id,
          m.account_id,
          m.timestamp,
          m.type,
          m.text,
          m.from_me,
          m.sender_contact_id,
          c.wa_jid as chat_wa_jid,
          c.type as chat_type,
          c.subject as chat_subject,
          s.wa_jid as sender_wa_jid,
          coalesce(s.display_name, s.push_name) as sender_name,
          count(md.id)::int as media_count,
          coalesce(
            json_agg(
              json_build_object('id', md.id, 'type', md.type, 'storage_status', md.storage_status)
              order by md.created_at
            ) filter (where md.id is not null),
            '[]'
          ) as media
        from ids
        join messages m on m.id = ids.id
        join chats c on c.id = m.chat_id
        left join contacts s on s.id = m.sender_contact_id
        left join media md on md.message_id = m.id
        ${chatClause}
        group by ids.ord, m.id, c.id, s.id
        order by ids.ord
      `,
      params,
    )) as MessageRow[]

    return {
      rows,
      total: Number(payloadJson.totalHits ?? payloadJson.estimatedTotalHits ?? 0),
      limit,
      offset,
    }
  } catch (error) {
    console.error('meilisearch search fallback to postgres:', error)
    return null
  }
}

async function handleMedia(id: string, res: ServerResponse): Promise<void> {
  const [row] = await AppDataSource.query(
    `select storage_status, r2_key from media where id = $1`,
    [id],
  )
  if (!row) {
    sendJson(res, 404, { error: 'not_found' })
    return
  }
  if (row.storage_status !== 'stored' || !row.r2_key) {
    sendJson(res, 409, { status: row.storage_status })
    return
  }
  if (!storage.isEnabled) {
    sendJson(res, 503, { error: 'storage_disabled' })
    return
  }
  const signed = await storage.getSignedUrl(row.r2_key, 300)
  res.statusCode = 302
  res.setHeader('location', signed)
  res.end()
}

async function getTransactions(url: URL) {
  const rawLimit = Number(url.searchParams.get('limit') ?? 50)
  const rawOffset = Number(url.searchParams.get('offset') ?? 0)
  const status = (url.searchParams.get('status') ?? '').trim()
  const q = (url.searchParams.get('q') ?? '').trim()

  const limit = Math.min(Math.max(rawLimit, 1), 100)
  const offset = Math.max(rawOffset, 0)

  const filters: unknown[] = []
  const where: string[] = []

  if (status && isOneOf(status, TRANSACTION_STATUSES)) {
    filters.push(status)
    where.push(`t.status = $${filters.length}`)
  }

  if (q) {
    filters.push(`%${q}%`)
    const idx = filters.length
    where.push(`(
      t.product_text ilike $${idx} or
      coalesce(t.notes, '') ilike $${idx} or
      fc.wa_jid ilike $${idx} or
      tc.wa_jid ilike $${idx} or
      t.currency ilike $${idx}
    )`)
  }

  const whereSql = where.length ? `where ${where.join(' and ')}` : ''
  const rows = (await AppDataSource.query(
    `
      select
        t.id,
        t.from_contact_id,
        t.to_contact_id,
        t.direction,
        t.product_text,
        t.quantity::text as quantity,
        t.amount::text as amount,
        t.currency,
        t.status,
        t.opened_at,
        t.closed_at,
        t.notes,
        t.created_at,
        t.updated_at,
        fc.wa_jid as from_contact_wa_jid,
        tc.wa_jid as to_contact_wa_jid,
        count(distinct tm.message_id)::int as linked_messages,
        count(distinct p.id)::int as payments_count
      from transactions t
      join contacts fc on fc.id = t.from_contact_id
      join contacts tc on tc.id = t.to_contact_id
      left join transaction_messages tm on tm.transaction_id = t.id
      left join payments p on p.transaction_id = t.id
      ${whereSql}
      group by t.id, fc.wa_jid, tc.wa_jid
      order by t.updated_at desc nulls last, t.created_at desc
      limit $${filters.length + 1}
      offset $${filters.length + 2}
    `,
    [...filters, limit, offset],
  )) as TransactionRow[]

  const [{ total }] = await AppDataSource.query(
    `
      select count(*)::int as total
      from transactions t
      join contacts fc on fc.id = t.from_contact_id
      join contacts tc on tc.id = t.to_contact_id
      ${whereSql}
    `,
    filters,
  )

  return { rows, total, limit, offset }
}

async function getTransactionById(id: string) {
  const [row] = await AppDataSource.query(
    `
      select
        t.id,
        t.from_contact_id,
        t.to_contact_id,
        t.direction,
        t.product_text,
        t.quantity::text as quantity,
        t.amount::text as amount,
        t.currency,
        t.status,
        t.opened_at,
        t.closed_at,
        t.notes,
        t.created_at,
        t.updated_at,
        fc.wa_jid as from_contact_wa_jid,
        tc.wa_jid as to_contact_wa_jid
      from transactions t
      join contacts fc on fc.id = t.from_contact_id
      join contacts tc on tc.id = t.to_contact_id
      where t.id = $1
    `,
    [id],
  )
  if (!row) throw new Error('not_found')

  const messageRows = (await AppDataSource.query(
    `
      select
        tm.message_id,
        m.wa_message_id,
        m.account_id,
        m.timestamp,
        m.type,
        m.text
      from transaction_messages tm
      join messages m on m.id = tm.message_id
      where tm.transaction_id = $1
      order by m.timestamp desc nulls last
    `,
    [id],
  )) as TransactionMessageRow[]

  const history = (await AppDataSource.query(
    `
      select
        id,
        from_status,
        to_status,
        changed_by_user_id,
        note,
        changed_at
      from transaction_status_history
      where transaction_id = $1
      order by changed_at asc
    `,
    [id],
  )) as TransactionStatusHistoryRow[]

  const payments = (await AppDataSource.query(
    `
      select
        id,
        amount::text as amount,
        currency,
        direction,
        method,
        paid_at,
        note
      from payments
      where transaction_id = $1
      order by paid_at desc
    `,
    [id],
  )) as PaymentRow[]

  return { ...row, message_rows: messageRows, history, payments }
}

async function createTransaction(req: IncomingMessage, payload: unknown) {
  const actor = await requireRole(req as AuthenticatedRequest, ['admin', 'staff'])
  const body = (payload ?? {}) as Record<string, unknown>
  const direction = String(body.direction ?? '').trim()
  const productText = body.productText ?? body.product_text
  const fromWaJid = body.fromContactWaJid ?? body.from_contact_wa_jid
  const toWaJid = body.toContactWaJid ?? body.to_contact_wa_jid
  const fromContactId = await resolveContactId(body.fromContactId, fromWaJid)
  const toContactId = await resolveContactId(body.toContactId, toWaJid)
  const currency = String(body.currency ?? 'USD').trim().toUpperCase()
  const rawStatus = String(body.status ?? 'draft')
  const status = isOneOf(rawStatus, TRANSACTION_STATUSES) ? rawStatus : 'draft'
  const quantity = normalizeNumeric(body.quantity)
  const amount = normalizeNumeric(body.amount)
  const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null

  if (!validateDirection(direction)) throw new Error('validation_error:direction')
  if (!fromContactId) throw new Error('validation_error:fromContactId')
  if (!toContactId) throw new Error('validation_error:toContactId')
  if (!amount) throw new Error('validation_error:amount')
  if (!currency) throw new Error('validation_error:currency')
  if (!isOneOf(currency, ['SYP', 'USD'])) throw new Error('validation_error:currency')

  const id = randomUUID()
  const openedAt = status === 'draft' ? null : new Date()

  await AppDataSource.query(
    `
      insert into transactions (
        id, from_contact_id, to_contact_id, direction, product_text, quantity, amount,
        currency, status, opened_by_user_id, opened_at, notes
      ) values (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
      )
    `,
    [
      id,
      fromContactId,
      toContactId,
      direction,
      productText ?? null,
      quantity,
      amount,
      currency,
      status,
      actor.id,
      openedAt,
      notes,
    ],
  )

  await AppDataSource.query(
    `
      insert into transaction_status_history (id, transaction_id, from_status, to_status, changed_by_user_id, note, changed_at)
      values ($1, $2, null, $3, $4, $5, now())
    `,
    [randomUUID(), id, status, actor.id, body.note ?? null],
  )

  await recordAudit({
    user: actor,
    action: 'create_transaction',
    entityType: 'transaction',
    entityId: id,
    before: null,
    after: {
      direction,
      fromContactId,
      toContactId,
      productText: productText ?? null,
      quantity,
      amount,
      currency,
      status,
      notes,
      openedByUserId: actor.id,
    },
  })

  return getTransactionById(id)
}

async function linkMessageToTransaction(req: IncomingMessage, transactionId: string, payload: unknown) {
  const actor = await requireRole(req as AuthenticatedRequest, ['admin', 'staff'])
  const body = (payload ?? {}) as Record<string, unknown>
  const messageId = String(body.messageId ?? body.message_id ?? '')

  if (!messageId) throw new Error('validation_error:messageId')

  const [transaction] = await AppDataSource.query(`select id from transactions where id = $1`, [transactionId])
  if (!transaction) throw new Error('not_found')
  const [message] = await AppDataSource.query(`select id from messages where id = $1`, [messageId])
  if (!message) throw new Error('validation_error:message_not_found')

  await AppDataSource.query(
    `
      insert into transaction_messages (transaction_id, message_id)
      values ($1, $2)
      on conflict (transaction_id, message_id) do nothing
    `,
    [transactionId, messageId],
  )

  await recordAudit({
    user: actor,
    action: 'link_transaction_message',
    entityType: 'transaction',
    entityId: transactionId,
    before: null,
    after: { messageId },
  })

  return { ok: true, transaction_id: transactionId, message_id: messageId }
}

async function updateTransactionStatus(req: IncomingMessage, transactionId: string, payload: unknown) {
  const actor = await requireRole(req as AuthenticatedRequest, ['admin', 'staff'])
  const body = (payload ?? {}) as Record<string, unknown>
  const rawStatus = String(body.status ?? '')
  if (!validateStatus(rawStatus)) throw new Error('validation_error:status')

  const note = typeof body.note === 'string' ? body.note.trim() : null
  const [current] = await AppDataSource.query(
    `select status from transactions where id = $1`,
    [transactionId],
  ) as Array<{ status: string }>
  if (!current) throw new Error('not_found')
  if (current.status === rawStatus) return getTransactionById(transactionId)

  const shouldSetOpenedAt = current.status === 'draft' && rawStatus !== 'draft'
  const closedAt = TERMINAL_TRANSACTION_STATUSES.has(rawStatus) ? new Date() : null

  await AppDataSource.query(
    `
      update transactions
      set status = $1,
          updated_at = now(),
          opened_at = CASE WHEN $3 = true AND opened_at IS NULL THEN now() ELSE opened_at END,
          closed_at = $4::timestamptz
      where id = $2
    `,
    [rawStatus, transactionId, shouldSetOpenedAt, closedAt],
  )

  await AppDataSource.query(
    `
      insert into transaction_status_history (
        id, transaction_id, from_status, to_status, changed_by_user_id, note, changed_at
      ) values ($1, $2, $3, $4, $5, $6, now())
    `,
    [randomUUID(), transactionId, current.status, rawStatus, actor.id, note],
  )

  await recordAudit({
    user: actor,
    action: 'update_transaction_status',
    entityType: 'transaction',
    entityId: transactionId,
    before: { status: current.status },
    after: { status: rawStatus },
  })

  return getTransactionById(transactionId)
}

async function getTags() {
  const rows = await AppDataSource.query(`
    select id, name, kind, color
    from tags
    order by lower(name), kind
  `)
  return { rows }
}

async function createTag(req: IncomingMessage, payload: unknown) {
  const actor = await requireRole(req as AuthenticatedRequest, ['admin', 'staff'])
  const body = (payload ?? {}) as Record<string, unknown>
  const name = String(body.name ?? '').trim()
  const kind = String(body.kind ?? 'custom').trim()
  const color = typeof body.color === 'string' ? body.color.trim() : null

  if (!name) throw new Error('validation_error:name')
  if (!validateTagKind(kind)) throw new Error('validation_error:kind')

  const existing = await AppDataSource.query(
    `select id, name, kind, color from tags where lower(name) = lower($1) and kind = $2`,
    [name, kind],
  )
  if (existing.length > 0) {
    return existing[0]
  }

  const id = randomUUID()
  await AppDataSource.query(
    `insert into tags (id, name, kind, color) values ($1, $2, $3, $4)`,
    [id, name, kind, color],
  )

  await recordAudit({
    user: actor,
    action: 'create_tag',
    entityType: 'tag',
    entityId: id,
    before: null,
    after: { name, kind, color },
  })

  return { id, name, kind, color }
}

async function getPaymentsByTransaction(transactionId: string) {
  const [transaction] = await AppDataSource.query(`select id from transactions where id = $1`, [transactionId])
  if (!transaction) throw new Error('not_found')

  const rows = (await AppDataSource.query(
    `
      select
        id,
        amount::text as amount,
        currency,
        direction,
        method,
        paid_at,
        note
      from payments
      where transaction_id = $1
      order by paid_at desc
    `,
    [transactionId],
  )) as PaymentRow[]

  return { rows, total: rows.length }
}

async function createPayment(req: IncomingMessage, transactionId: string, payload: unknown) {
  const actor = await requireRole(req as AuthenticatedRequest, ['admin', 'staff'])
  const body = (payload ?? {}) as Record<string, unknown>
  const amount = normalizeNumeric(body.amount)
  const currency = String(body.currency ?? 'USD').trim().toUpperCase()
  const rawDirection = String(body.direction ?? '').trim()
  const direction = isOneOf(rawDirection, PAYMENT_DIRECTIONS) ? rawDirection : ''
  const method = typeof body.method === 'string' && body.method.trim() ? body.method.trim() : null
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null
  const rawPaidAt = typeof body.paidAt === 'string' ? body.paidAt.trim() : ''
  const paidAt = rawPaidAt ? new Date(rawPaidAt) : new Date()

  if (!amount) throw new Error('validation_error:amount')
  if (!isOneOf(currency, ['SYP', 'USD'])) throw new Error('validation_error:currency')
  if (!direction) throw new Error('validation_error:direction')
  if (Number.isNaN(paidAt.getTime())) throw new Error('validation_error:paidAt')

  const [transaction] = await AppDataSource.query(`select id from transactions where id = $1`, [transactionId])
  if (!transaction) throw new Error('not_found')

  const id = randomUUID()
  await AppDataSource.query(
    `
      insert into payments (
        id, transaction_id, amount, currency, direction, method, paid_at, note
      ) values ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [id, transactionId, amount, currency, direction, method, paidAt, note],
  )

  const [payment] = (await AppDataSource.query(
    `
      select
        id,
        amount::text as amount,
        currency,
        direction,
        method,
        paid_at,
        note
      from payments
      where id = $1
    `,
    [id],
  )) as PaymentRow[]

  await recordAudit({
    user: actor,
    action: 'create_payment',
    entityType: 'payment',
    entityId: id,
    before: null,
    after: payment[0] ?? null,
  })

  return payment
}

async function getContactTags(contactId: string) {
  const [contact] = await AppDataSource.query(`select id from contacts where id = $1`, [contactId])
  if (!contact) throw new Error('not_found')

  const rows = await AppDataSource.query(
    `
      select t.id, t.name, t.kind, t.color
      from tags t
      join contact_tags ct on ct.tag_id = t.id
      where ct.contact_id = $1
      order by t.kind, t.name
    `,
    [contactId],
  )

  return { rows }
}

async function addContactTag(req: IncomingMessage, contactId: string, payload: unknown) {
  const actor = await requireRole(req as AuthenticatedRequest, ['admin', 'staff'])
  const body = (payload ?? {}) as Record<string, unknown>
  const requestedTagId = typeof body.tagId === 'string' ? body.tagId.trim() : ''

  const [contact] = await AppDataSource.query(`select id from contacts where id = $1`, [contactId])
  if (!contact) throw new Error('not_found')

  let tagId = requestedTagId
  if (!tagId) {
    const name = String(body.name ?? '').trim()
    const kind = String(body.kind ?? 'custom').trim()
    const color = typeof body.color === 'string' ? body.color.trim() : null

    if (!name) throw new Error('validation_error:tagId')
    if (!validateTagKind(kind)) throw new Error('validation_error:kind')

    const existing = await AppDataSource.query(
      `select id from tags where lower(name) = lower($1) and kind = $2`,
      [name, kind],
    )
    if (existing.length > 0) {
      tagId = existing[0].id
    } else {
      tagId = randomUUID()
      await AppDataSource.query(`insert into tags (id, name, kind, color) values ($1, $2, $3, $4)`, [
        tagId,
        name,
        kind,
        color,
      ])
    }
  }

  await AppDataSource.query(
    `insert into contact_tags (contact_id, tag_id) values ($1, $2) on conflict (contact_id, tag_id) do nothing`,
    [contactId, tagId],
  )

  const [row] = await AppDataSource.query(`select id, name, kind, color from tags where id = $1`, [tagId])

  await recordAudit({
    user: actor,
    action: 'add_contact_tag',
    entityType: 'contact',
    entityId: contactId,
    before: null,
    after: { tagId },
  })

  return row
}

async function resolveContactId(contactId: unknown, waJid: unknown): Promise<string | null> {
  if (typeof contactId === 'string' && contactId.trim()) return contactId.trim()
  if (typeof waJid === 'string' && waJid.trim()) {
    const [row] = await AppDataSource.query(`select id from contacts where wa_jid = $1`, [waJid.trim()])
    return row ? row.id : null
  }
  return null
}

function normalizeNumeric(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null
  if (typeof value === 'string') return value.trim() ? value.trim() : null
  return null
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const requested = pathname === '/' ? '/index.html' : pathname
  const target = normalize(join(publicDir, requested))

  if (!target.startsWith(publicDir) || !existsSync(target)) {
    sendJson(res, 404, { error: 'not_found' })
    return
  }

  await serveFile(target, res, 'no-cache')
}

async function serveFile(target: string, res: ServerResponse, cacheControl: string): Promise<void> {
  if (!existsSync(target)) {
    sendJson(res, 404, { error: 'not_found' })
    return
  }

  res.setHeader('Cache-Control', cacheControl)
  setSecurityHeaders(res)
  res.setHeader('content-type', contentType(target))
  createReadStream(target).pipe(res)
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  setSecurityHeaders(res)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

function setSecurityHeaders(res: ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  if (IS_PRODUCTION) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
}

function contentType(path: string): string {
  switch (extname(path)) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.js':
      return 'application/javascript; charset=utf-8'
    default:
      return 'application/octet-stream'
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
