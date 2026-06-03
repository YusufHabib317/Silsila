import 'reflect-metadata'
import { createReadStream, existsSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { URL } from 'node:url'
import { AppDataSource } from '@wa/entities'

const port = Number(process.env.API_PORT ?? 3000)
const publicDir = join(__dirname, '../public')

type MessageRow = {
  id: string
  wa_message_id: string
  account_id: string
  timestamp: string | null
  type: string
  text: string | null
  from_me: boolean
  chat_wa_jid: string
  chat_type: string
  chat_subject: string | null
  sender_wa_jid: string | null
  sender_name: string | null
  media_count: string
}

async function main() {
  await AppDataSource.initialize()
  console.log('database connected')

  const server = createServer((req, res) => {
    void route(req, res).catch((e) => {
      console.error(e)
      sendJson(res, 500, { error: 'internal_error' })
    })
  })

  server.listen(port, () => {
    console.log(`api listening on http://localhost:${port}`)
  })

  const shutdown = async () => {
    console.log('shutting down...')
    server.close()
    await AppDataSource.destroy()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

  if (url.pathname === '/api/health') {
    sendJson(res, 200, { ok: true })
    return
  }

  if (url.pathname === '/api/stats') {
    sendJson(res, 200, await getStats())
    return
  }

  if (url.pathname === '/api/messages') {
    sendJson(res, 200, await getMessages(url))
    return
  }

  if (url.pathname === '/api/chats') {
    sendJson(res, 200, await getChats())
    return
  }

  if (url.pathname === '/favicon.ico') {
    res.statusCode = 204
    res.end()
    return
  }

  await serveStatic(url.pathname, res)
}

async function getStats() {
  const [counts] = await AppDataSource.query(`
    select
      (select count(*)::int from messages) as messages,
      (select count(*)::int from chats) as chats,
      (select count(*)::int from contacts) as contacts,
      (select count(*)::int from media) as media
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
        c.wa_jid as chat_wa_jid,
        c.type as chat_type,
        c.subject as chat_subject,
        s.wa_jid as sender_wa_jid,
        coalesce(s.display_name, s.push_name) as sender_name,
        count(md.id)::int as media_count
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

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const requested = pathname === '/' ? '/index.html' : pathname
  const target = normalize(join(publicDir, requested))

  if (!target.startsWith(publicDir) || !existsSync(target)) {
    sendJson(res, 404, { error: 'not_found' })
    return
  }

  res.setHeader('content-type', contentType(target))
  createReadStream(target).pipe(res)
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
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
