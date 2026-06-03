const state = {
  q: '',
  chat: '',
  limit: 50,
  offset: 0,
  total: 0,
}

const els = {
  health: document.getElementById('health'),
  messagesCount: document.getElementById('messagesCount'),
  chatsCount: document.getElementById('chatsCount'),
  contactsCount: document.getElementById('contactsCount'),
  mediaCount: document.getElementById('mediaCount'),
  chatList: document.getElementById('chatList'),
  rows: document.getElementById('messageRows'),
  searchForm: document.getElementById('searchForm'),
  searchInput: document.getElementById('searchInput'),
  clearButton: document.getElementById('clearButton'),
  refreshButton: document.getElementById('refreshButton'),
  prevButton: document.getElementById('prevButton'),
  nextButton: document.getElementById('nextButton'),
  pageInfo: document.getElementById('pageInfo'),
}

async function api(path) {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

async function loadAll() {
  await Promise.all([loadHealth(), loadStats(), loadChats(), loadMessages()])
}

async function loadHealth() {
  try {
    await api('/api/health')
    els.health.textContent = 'Connected'
    els.health.className = 'status ok'
  } catch {
    els.health.textContent = 'Offline'
    els.health.className = 'status bad'
  }
}

async function loadStats() {
  const { counts } = await api('/api/stats')
  els.messagesCount.textContent = formatNumber(counts.messages)
  els.chatsCount.textContent = formatNumber(counts.chats)
  els.contactsCount.textContent = formatNumber(counts.contacts)
  els.mediaCount.textContent = formatNumber(counts.media)
}

async function loadChats() {
  const { rows } = await api('/api/chats')
  els.chatList.innerHTML = ''

  const all = document.createElement('button')
  all.className = `chatItem ${state.chat ? '' : 'active'}`
  all.innerHTML = `<span class="chatName">All chats</span><span class="count">•</span><span class="jid">archive</span>`
  all.addEventListener('click', () => {
    state.chat = ''
    state.offset = 0
    loadChats()
    loadMessages()
  })
  els.chatList.appendChild(all)

  for (const chat of rows) {
    const button = document.createElement('button')
    button.className = `chatItem ${state.chat === chat.wa_jid ? 'active' : ''}`
    button.innerHTML = `
      <span class="chatName">${escapeHtml(chat.subject || chat.wa_jid)}</span>
      <span class="count">${formatNumber(chat.message_count)}</span>
      <span class="jid">${escapeHtml(chat.type)} · ${escapeHtml(chat.wa_jid)}</span>
    `
    button.addEventListener('click', () => {
      state.chat = chat.wa_jid
      state.offset = 0
      loadChats()
      loadMessages()
    })
    els.chatList.appendChild(button)
  }
}

async function loadMessages() {
  const params = new URLSearchParams({
    limit: String(state.limit),
    offset: String(state.offset),
  })
  if (state.q) params.set('q', state.q)
  if (state.chat) params.set('chat', state.chat)

  const data = await api(`/api/messages?${params}`)
  state.total = data.total
  els.rows.innerHTML = ''

  if (data.rows.length === 0) {
    els.rows.innerHTML = `<tr><td colspan="6" class="empty">No messages found.</td></tr>`
  } else {
    for (const msg of data.rows) {
      const row = document.createElement('tr')
      row.innerHTML = `
        <td>${formatDate(msg.timestamp)}</td>
        <td><strong>${escapeHtml(msg.chat_subject || msg.chat_wa_jid)}</strong><br><span class="snippet">${escapeHtml(msg.chat_wa_jid)}</span></td>
        <td>${escapeHtml(msg.sender_name || msg.sender_wa_jid || (msg.from_me ? 'Me' : 'Unknown'))}</td>
        <td>${escapeHtml(msg.type)}</td>
        <td class="messageText">${escapeHtml(msg.text || `[${msg.type}]`)}</td>
        <td class="mediaCol">${renderMedia(msg)}</td>
      `
      els.rows.appendChild(row)
    }
  }

  const start = state.total === 0 ? 0 : state.offset + 1
  const end = Math.min(state.offset + state.limit, state.total)
  els.pageInfo.textContent = `${formatNumber(start)}-${formatNumber(end)} of ${formatNumber(state.total)}`
  els.prevButton.disabled = state.offset === 0
  els.nextButton.disabled = state.offset + state.limit >= state.total
}

els.searchForm.addEventListener('submit', (event) => {
  event.preventDefault()
  state.q = els.searchInput.value.trim()
  state.offset = 0
  loadMessages()
})

els.clearButton.addEventListener('click', () => {
  state.q = ''
  state.chat = ''
  state.offset = 0
  els.searchInput.value = ''
  loadChats()
  loadMessages()
})

els.refreshButton.addEventListener('click', loadAll)
els.prevButton.addEventListener('click', () => {
  state.offset = Math.max(0, state.offset - state.limit)
  loadMessages()
})
els.nextButton.addEventListener('click', () => {
  state.offset += state.limit
  loadMessages()
})

function renderMedia(msg) {
  const media = Array.isArray(msg.media) ? msg.media : []
  if (media.length === 0) return '<span class="muted">—</span>'

  return media
    .map((m) => {
      const isImage = m.type === 'image' || m.type === 'sticker'
      if (m.storage_status === 'stored' && isImage) {
        const src = `/api/media/${encodeURIComponent(m.id)}`
        return `<a href="${src}" target="_blank" rel="noopener"><img class="thumb" src="${src}" alt="${escapeHtml(m.type)}" loading="lazy" /></a>`
      }
      const suffix = m.storage_status === 'pending' ? '…' : m.storage_status === 'failed' ? ' ✗' : ''
      return `<span class="mediaBadge ${escapeHtml(m.storage_status)}">${escapeHtml(m.type)}${suffix}</span>`
    })
    .join('')
}

// Live updates: the API streams worker events over SSE. Coalesce bursts (a group
// dumping 40 photos) into one refresh so we don't thrash the table.
let refreshTimer = null
function scheduleRefresh() {
  if (refreshTimer) return
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    loadStats().catch(() => {})
    if (state.offset === 0 && !state.q) {
      loadChats().catch(() => {})
      loadMessages().catch(() => {})
    }
  }, 500)
}

function startLiveUpdates() {
  const es = new EventSource('/api/stream')
  es.onmessage = (event) => {
    let parsed
    try {
      parsed = JSON.parse(event.data)
    } catch {
      return
    }
    if (parsed.type === 'message' || parsed.type === 'media') scheduleRefresh()
  }
  // EventSource auto-reconnects on error; nothing to do here.
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(Number(value || 0))
}

function formatDate(value) {
  if (!value) return 'No timestamp'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

loadAll().catch((error) => {
  console.error(error)
  els.health.textContent = 'Error'
  els.health.className = 'status bad'
})

startLiveUpdates()
