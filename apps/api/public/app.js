const state = {
  messages: {
    q: '',
    chat: '',
    limit: 50,
    offset: 0,
    total: 0,
  },
  transactions: {
    q: '',
    status: '',
    limit: 50,
    offset: 0,
    total: 0,
  },
  view: 'messages',
}

const TRANSACTION_STATUSES = ['draft', 'pending', 'in_transit', 'completed', 'refunded', 'lost', 'cancelled']

const els = {
  health: document.getElementById('health'),
  messagesCount: document.getElementById('messagesCount'),
  chatsCount: document.getElementById('chatsCount'),
  contactsCount: document.getElementById('contactsCount'),
  mediaCount: document.getElementById('mediaCount'),
  transactionsCount: document.getElementById('transactionsCount'),
  chatList: document.getElementById('chatList'),
  rows: document.getElementById('messageRows'),
  searchForm: document.getElementById('searchForm'),
  searchInput: document.getElementById('searchInput'),
  clearButton: document.getElementById('clearButton'),
  refreshButton: document.getElementById('refreshButton'),
  prevButton: document.getElementById('prevButton'),
  nextButton: document.getElementById('nextButton'),
  pageInfo: document.getElementById('pageInfo'),
  messagesTab: document.getElementById('messagesTab'),
  transactionsTab: document.getElementById('transactionsTab'),
  messagesPane: document.getElementById('messagesPane'),
  transactionsPane: document.getElementById('transactionsPane'),
  transactionSearchInput: document.getElementById('transactionSearchInput'),
  transactionStatusFilter: document.getElementById('transactionStatusFilter'),
  transactionClearButton: document.getElementById('transactionClearButton'),
  transactionFilterForm: document.getElementById('transactionFilterForm'),
  txPrevButton: document.getElementById('txPrevButton'),
  txNextButton: document.getElementById('txNextButton'),
  txPageInfo: document.getElementById('txPageInfo'),
  txRows: document.getElementById('transactionRows'),
  transactionFrom: document.getElementById('transactionFrom'),
  transactionTo: document.getElementById('transactionTo'),
  transactionDirection: document.getElementById('transactionDirection'),
  transactionProduct: document.getElementById('transactionProduct'),
  transactionQuantity: document.getElementById('transactionQuantity'),
  transactionAmount: document.getElementById('transactionAmount'),
  transactionCurrency: document.getElementById('transactionCurrency'),
  transactionStatus: document.getElementById('transactionStatus'),
  transactionNotes: document.getElementById('transactionNotes'),
  transactionCreateForm: document.getElementById('createTransactionForm'),
}

async function api(path, options = {}) {
  const isGet = (options.method ?? 'GET') === 'GET'
  const fetchOptions = { ...options, headers: { ...options.headers } }

  if (!isGet && options.body && !fetchOptions.headers['content-type']) {
    fetchOptions.headers['content-type'] = 'application/json'
  }

  const res = await fetch(path, fetchOptions)
  let payload = null
  try {
    payload = await res.json()
  } catch {
    payload = null
  }

  if (!res.ok) {
    throw new Error(payload?.error || `${res.status} ${res.statusText}`)
  }
  return payload
}

async function loadAll() {
  await Promise.all([loadHealth(), loadStats(), loadChats(), loadMessages(), loadTransactions()])
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
  if (els.transactionsCount) {
    els.transactionsCount.textContent = formatNumber(counts.transactions)
  }
}

async function loadChats() {
  const { rows } = await api('/api/chats')
  els.chatList.innerHTML = ''

  const all = document.createElement('button')
  all.className = `chatItem ${state.messages.chat ? '' : 'active'}`
  all.innerHTML = `<span class="chatName">All chats</span><span class="count">â€¢</span><span class="jid">archive</span>`
  all.addEventListener('click', () => {
    state.messages.chat = ''
    state.messages.offset = 0
    loadChats()
    loadMessages()
  })
  els.chatList.appendChild(all)

  for (const chat of rows) {
    const button = document.createElement('button')
    button.className = `chatItem ${state.messages.chat === chat.wa_jid ? 'active' : ''}`
    button.innerHTML = `
      <span class="chatName">${escapeHtml(chat.subject || chat.wa_jid)}</span>
      <span class="count">${formatNumber(chat.message_count)}</span>
      <span class="jid">${escapeHtml(chat.type)} Â· ${escapeHtml(chat.wa_jid)}</span>
    `
    button.addEventListener('click', () => {
      state.messages.chat = chat.wa_jid
      state.messages.offset = 0
      loadChats()
      loadMessages()
    })
    els.chatList.appendChild(button)
  }
}

async function loadMessages() {
  const params = new URLSearchParams({
    limit: String(state.messages.limit),
    offset: String(state.messages.offset),
  })
  if (state.messages.q) params.set('q', state.messages.q)
  if (state.messages.chat) params.set('chat', state.messages.chat)

  const data = await api(`/api/messages?${params}`)
  state.messages.total = data.total
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

  const start = state.messages.total === 0 ? 0 : state.messages.offset + 1
  const end = Math.min(state.messages.offset + state.messages.limit, state.messages.total)
  els.pageInfo.textContent = `${formatNumber(start)}-${formatNumber(end)} of ${formatNumber(state.messages.total)}`
  els.prevButton.disabled = state.messages.offset === 0
  els.nextButton.disabled = state.messages.offset + state.messages.limit >= state.messages.total
}

async function loadTransactions() {
  const params = new URLSearchParams({
    limit: String(state.transactions.limit),
    offset: String(state.transactions.offset),
  })
  if (state.transactions.q) params.set('q', state.transactions.q)
  if (state.transactions.status) params.set('status', state.transactions.status)

  const data = await api(`/api/transactions?${params}`)
  state.transactions.total = data.total
  els.txRows.innerHTML = ''

  if (data.rows.length === 0) {
    els.txRows.innerHTML = `<tr><td colspan="8" class="empty">No transactions found.</td></tr>`
  } else {
    for (const tx of data.rows) {
      const row = document.createElement('tr')
      row.innerHTML = `
        <td>${formatDate(tx.created_at)}</td>
        <td>
          <strong>From:</strong> ${escapeHtml(tx.from_contact_wa_jid)}<br />
          <strong>To:</strong> ${escapeHtml(tx.to_contact_wa_jid)}
        </td>
        <td>${escapeHtml(tx.direction)}</td>
        <td>${escapeHtml(tx.product_text || '')}</td>
        <td>${formatNumber(tx.amount)} ${escapeHtml(tx.currency || '')}</td>
        <td>
          <select class="txStatusSelect" data-transaction-id="${escapeHtml(tx.id)}">
            ${TRANSACTION_STATUSES.map((status) => `<option value="${status}" ${status === tx.status ? 'selected' : ''}>${status}</option>`).join('')}
          </select>
        </td>
        <td>
          <span class="countLike">${formatNumber(tx.linked_messages)}</span>
          <button class="smallButton" type="button" data-action="linkMessage" data-id="${escapeHtml(tx.id)}">Link message</button>
        </td>
        <td>
          <span class="countLike">${formatNumber(tx.payments_count)}</span>
          <button class="smallButton" type="button" data-action="addPayment" data-id="${escapeHtml(tx.id)}">Add payment</button>
        </td>
      `
      row.querySelector('.txStatusSelect')?.addEventListener('change', async (event) => {
        const target = event.currentTarget
        if (!(target instanceof HTMLSelectElement)) return
        const nextStatus = target.value
        const txId = target.dataset.transactionId
        if (!txId) return
        try {
          await api(`/api/transactions/${encodeURIComponent(txId)}/status`, {
            method: 'POST',
            body: JSON.stringify({ status: nextStatus }),
          })
          await loadTransactions()
          await loadStats()
        } catch (error) {
          console.error(error)
          alert(`Failed to update status: ${error.message}`)
        }
      })

      row.querySelector('[data-action="linkMessage"]')?.addEventListener('click', async (event) => {
        if (!(event.currentTarget instanceof HTMLButtonElement)) return
        const txId = event.currentTarget.dataset.id
        if (!txId) return
        const messageId = window.prompt(`Message ID for ${txId}`)
        if (!messageId) return
        try {
          await api(`/api/transactions/${encodeURIComponent(txId)}/messages`, {
            method: 'POST',
            body: JSON.stringify({ messageId: messageId.trim() }),
          })
          await loadTransactions()
        } catch (error) {
          console.error(error)
          alert(`Failed to link message: ${error.message}`)
        }
      })
      row.querySelector('[data-action="addPayment"]')?.addEventListener('click', async (event) => {
        if (!(event.currentTarget instanceof HTMLButtonElement)) return
        const txId = event.currentTarget.dataset.id
        if (!txId) return

        const amount = window.prompt('Payment amount')
        if (!amount) return
        const currency = window.prompt('Currency (USD, SYP)', 'USD') ?? ''
        const direction = window.prompt('Direction (incoming or outgoing)', 'incoming') ?? ''
        const method = window.prompt('Payment method (optional)') || ''
        const note = window.prompt('Payment note (optional)') || ''

        try {
          await api(`/api/transactions/${encodeURIComponent(txId)}/payments`, {
            method: 'POST',
            body: JSON.stringify({
              amount: amount.trim(),
              currency: currency.trim(),
              direction: direction.trim(),
              method: method.trim() || null,
              note: note.trim() || null,
            }),
          })
          await loadTransactions()
        } catch (error) {
          console.error(error)
          alert(`Failed to add payment: ${error.message}`)
        }
      })

      els.txRows.appendChild(row)
    }
  }

  const start = state.transactions.total === 0 ? 0 : state.transactions.offset + 1
  const end = Math.min(state.transactions.offset + state.transactions.limit, state.transactions.total)
  els.txPageInfo.textContent = `${formatNumber(start)}-${formatNumber(end)} of ${formatNumber(state.transactions.total)}`
  els.txPrevButton.disabled = state.transactions.offset === 0
  els.txNextButton.disabled = state.transactions.offset + state.transactions.limit >= state.transactions.total
}

els.searchForm.addEventListener('submit', (event) => {
  event.preventDefault()
  state.messages.q = els.searchInput.value.trim()
  state.messages.offset = 0
  loadMessages()
})

els.clearButton.addEventListener('click', () => {
  state.messages.q = ''
  state.messages.chat = ''
  state.messages.offset = 0
  els.searchInput.value = ''
  loadChats()
  loadMessages()
})

els.transactionFilterForm.addEventListener('submit', (event) => {
  event.preventDefault()
  state.transactions.q = els.transactionSearchInput.value.trim()
  state.transactions.status = els.transactionStatusFilter.value
  state.transactions.offset = 0
  loadTransactions()
})

els.transactionClearButton.addEventListener('click', () => {
  state.transactions.q = ''
  state.transactions.status = ''
  state.transactions.offset = 0
  els.transactionSearchInput.value = ''
  els.transactionStatusFilter.value = ''
  loadTransactions()
})

els.transactionCreateForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  const fromContactWaJid = els.transactionFrom.value.trim()
  const toContactWaJid = els.transactionTo.value.trim()
  const amount = els.transactionAmount.value.trim()
  const currency = els.transactionCurrency.value.trim().toUpperCase()
  const direction = els.transactionDirection.value

  if (!fromContactWaJid || !toContactWaJid || !amount) {
    alert('From JID, To JID and Amount are required.')
    return
  }

  try {
    await api('/api/transactions', {
      method: 'POST',
      body: JSON.stringify({
        fromContactWaJid,
        toContactWaJid,
        direction,
        productText: els.transactionProduct.value.trim(),
        quantity: els.transactionQuantity.value.trim(),
        amount,
        currency: currency || 'USD',
        status: els.transactionStatus.value,
        notes: els.transactionNotes.value.trim(),
      }),
    })
    els.transactionCreateForm.reset()
    state.transactions.offset = 0
    await loadTransactions()
    await loadStats()
  } catch (error) {
    console.error(error)
    alert(`Failed to create transaction: ${error.message}`)
  }
})

els.refreshButton.addEventListener('click', loadAll)

els.prevButton.addEventListener('click', () => {
  state.messages.offset = Math.max(0, state.messages.offset - state.messages.limit)
  loadMessages()
})
els.nextButton.addEventListener('click', () => {
  state.messages.offset += state.messages.limit
  loadMessages()
})

els.txPrevButton.addEventListener('click', () => {
  state.transactions.offset = Math.max(0, state.transactions.offset - state.transactions.limit)
  loadTransactions()
})
els.txNextButton.addEventListener('click', () => {
  state.transactions.offset += state.transactions.limit
  loadTransactions()
})

els.messagesTab.addEventListener('click', () => {
  setActiveView('messages')
})
els.transactionsTab.addEventListener('click', () => {
  setActiveView('transactions')
})

function setActiveView(view) {
  state.view = view
  const isMessages = view === 'messages'
  els.messagesTab.classList.toggle('active', isMessages)
  els.transactionsTab.classList.toggle('active', !isMessages)
  els.messagesTab.setAttribute('aria-selected', isMessages ? 'true' : 'false')
  els.transactionsTab.setAttribute('aria-selected', isMessages ? 'false' : 'true')
  els.messagesPane.classList.toggle('hidden', !isMessages)
  els.transactionsPane.classList.toggle('hidden', isMessages)
  els.messagesPane.setAttribute('aria-hidden', String(!isMessages))
  els.transactionsPane.setAttribute('aria-hidden', String(isMessages))

  if (!isMessages) {
    loadTransactions()
  } else {
    loadMessages()
  }
}

function renderMedia(msg) {
  const media = Array.isArray(msg.media) ? msg.media : []
  if (media.length === 0) return '<span class="muted">â€”</span>'

  return media
    .map((m) => {
      const isImage = m.type === 'image' || m.type === 'sticker'
      if (m.storage_status === 'stored' && isImage) {
        const src = `/api/media/${encodeURIComponent(m.id)}`
        return `<a href="${src}" target="_blank" rel="noopener"><img class="thumb" src="${src}" alt="${escapeHtml(m.type)}" loading="lazy" /></a>`
      }
      const suffix = m.storage_status === 'pending' ? 'â€¦' : m.storage_status === 'failed' ? ' âœ—' : ''
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
    loadChats().catch(() => {})
    if (state.view === 'messages' && state.messages.offset === 0 && !state.messages.q) {
      loadMessages().catch(() => {})
    }
    if (state.view === 'transactions') {
      loadTransactions().catch(() => {})
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
setActiveView('messages')
startLiveUpdates()
