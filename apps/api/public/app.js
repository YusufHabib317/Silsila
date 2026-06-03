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
  alerts: {
    unreadOnly: true,
    ruleKind: '',
    limit: 25,
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
  alertsTab: document.getElementById('alertsTab'),
  alertsPane: document.getElementById('alertsPane'),
  alertFilterForm: document.getElementById('alertFilterForm'),
  alertsUnreadOnly: document.getElementById('alertsUnreadOnly'),
  alertsRuleKindFilter: document.getElementById('alertsRuleKindFilter'),
  alertsClearButton: document.getElementById('alertsClearButton'),
  alertRulesRows: document.getElementById('alertRulesRows'),
  alertsRows: document.getElementById('alertsRows'),
  alertsPrevButton: document.getElementById('alertsPrevButton'),
  alertsNextButton: document.getElementById('alertsNextButton'),
  alertsPageInfo: document.getElementById('alertsPageInfo'),
  createAlertRuleForm: document.getElementById('createAlertRuleForm'),
  alertRuleName: document.getElementById('alertRuleName'),
  alertRuleKind: document.getElementById('alertRuleKind'),
  alertRuleThreshold: document.getElementById('alertRuleThreshold'),
  alertRuleCooldown: document.getElementById('alertRuleCooldown'),
  alertRuleKeyword: document.getElementById('alertRuleKeyword'),
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
  await Promise.all([
    loadHealth(),
    loadStats(),
    loadChats(),
    loadMessages(),
    loadTransactions(),
    loadAlertRules(),
    loadAlerts(),
  ])
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
  if (els.pendingTransactionsCount) {
    els.pendingTransactionsCount.textContent = formatNumber(counts.pending_transactions)
  }
  if (els.unreadAlertsCount) {
    els.unreadAlertsCount.textContent = formatNumber(counts.unread_alerts)
  }
  if (els.criticalAlertsCount) {
    els.criticalAlertsCount.textContent = formatNumber(counts.critical_alerts)
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

async function loadAlertRules() {
  const { rows } = await api('/api/alert-rules')
  if (!els.alertRulesRows) return
  els.alertRulesRows.innerHTML = ''

  if (!rows.length) {
    els.alertRulesRows.innerHTML = `<tr><td colspan="7" class="empty">No alert rules configured.</td></tr>`
    return
  }

  for (const rule of rows) {
    const row = document.createElement('tr')
    const enabledText = rule.enabled ? 'Enabled' : 'Disabled'
    const paramsText = typeof rule.params === 'object' && rule.params ? safeStringify(rule.params) : ''
    row.innerHTML = `
      <td>${escapeHtml(rule.name || 'Unnamed rule')}</td>
      <td>${escapeHtml(rule.kind || '')}</td>
      <td>${formatNumber(rule.thresholdMinutes || 0)}</td>
      <td>${formatNumber(rule.cooldownMinutes || 0)}</td>
      <td>${escapeHtml(paramsText)}</td>
      <td>${escapeHtml(enabledText)}</td>
      <td>${formatDate(rule.created_at || rule.createdAt)}</td>
    `
    els.alertRulesRows.appendChild(row)
  }
}

async function loadAlerts() {
  const params = new URLSearchParams({
    limit: String(state.alerts.limit),
    offset: String(state.alerts.offset),
    unread: state.alerts.unreadOnly ? 'true' : 'false',
  })
  if (state.alerts.ruleKind) params.set('kind', state.alerts.ruleKind)

  const data = await api(`/api/alerts?${params}`)
  state.alerts.total = data.total
  els.alertsRows.innerHTML = ''

  if (!data.rows.length) {
    els.alertsRows.innerHTML = `<tr><td colspan="8" class="empty">No alerts found.</td></tr>`
    els.alertsPageInfo.textContent = '0 alerts'
    els.alertsPrevButton.disabled = true
    els.alertsNextButton.disabled = true
    return
  }

  for (const alert of data.rows) {
    const row = document.createElement('tr')
    const entity = `${escapeHtml(alert.entityType || '')}: ${escapeHtml(alert.entityId || '')}`
    const createdAt = formatDate(alert.createdAt || alert.created_at)
    const severity = String(alert.severity || 'info')
    row.innerHTML = `
      <td>${createdAt}</td>
      <td><span class="severityPill ${escapeHtml(severity)}">${escapeHtml(severity)}</span></td>
      <td>${escapeHtml(alert.alertRuleName || '')}</td>
      <td>${escapeHtml(entity)}</td>
      <td><span class="snippet">${escapeHtml(alert.entityId || '')}</span></td>
      <td>${escapeHtml(alert.title || '')}</td>
      <td class="alertsRowDetails">${escapeHtml(formatAlertDetails(alert.details))}</td>
      <td>
        ${alert.isRead ? '<span class="muted">Read</span>' : `<button class="smallButton" type="button" data-action="ackAlert" data-id="${escapeHtml(alert.id)}">Acknowledge</button>`}
      </td>
    `
    const ackButton = row.querySelector('[data-action="ackAlert"]')
    if (ackButton instanceof HTMLButtonElement) {
      ackButton.addEventListener('click', async () => {
        const alertId = ackButton.dataset.id
        if (!alertId) return
        try {
          await api(`/api/alerts/${encodeURIComponent(alertId)}/ack`, { method: 'POST' })
          await Promise.all([loadAlerts(), loadAlertRules(), loadStats()])
        } catch (error) {
          console.error(error)
          alert(`Failed to acknowledge alert: ${error.message}`)
        }
      })
    }

    els.alertsRows.appendChild(row)
  }

  const start = state.alerts.total === 0 ? 0 : state.alerts.offset + 1
  const end = Math.min(state.alerts.offset + state.alerts.limit, state.alerts.total)
  els.alertsPageInfo.textContent = `${formatNumber(start)}-${formatNumber(end)} of ${formatNumber(state.alerts.total)}`
  els.alertsPrevButton.disabled = state.alerts.offset === 0
  els.alertsNextButton.disabled = state.alerts.offset + state.alerts.limit >= state.alerts.total
}

function formatAlertDetails(details) {
  if (details == null) return ''
  if (typeof details === 'string') return details
  if (typeof details === 'object') return safeStringify(details)
  return String(details)
}

function safeStringify(value) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
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

els.alertFilterForm?.addEventListener('submit', (event) => {
  event.preventDefault()
  state.alerts.unreadOnly = !!els.alertsUnreadOnly?.checked
  state.alerts.ruleKind = (els.alertsRuleKindFilter?.value ?? '').trim()
  state.alerts.offset = 0
  loadAlerts().catch((error) => {
    console.error(error)
    alert(`Failed to load alerts: ${error.message}`)
  })
})

els.alertsClearButton?.addEventListener('click', () => {
  state.alerts.unreadOnly = true
  state.alerts.ruleKind = ''
  state.alerts.offset = 0
  if (els.alertsUnreadOnly) els.alertsUnreadOnly.checked = true
  if (els.alertsRuleKindFilter) els.alertsRuleKindFilter.value = ''
  loadAlerts().catch((error) => {
    console.error(error)
    alert(`Failed to load alerts: ${error.message}`)
  })
})

els.createAlertRuleForm?.addEventListener('submit', async (event) => {
  event.preventDefault()
  const kind = (els.alertRuleKind?.value ?? '').trim()
  const thresholdMinutes = Number.parseInt((els.alertRuleThreshold?.value ?? '').trim(), 10)
  const cooldownMinutes = Number.parseInt((els.alertRuleCooldown?.value ?? '').trim(), 10)
  const keyword = (els.alertRuleKeyword?.value ?? '').trim()

  if (kind === 'keyword' && !keyword) {
    alert('Keyword is required for keyword rules.')
    return
  }

  try {
    await api('/api/alert-rules', {
      method: 'POST',
      body: JSON.stringify({
        name: (els.alertRuleName?.value ?? '').trim() || 'Untitled rule',
        kind,
        thresholdMinutes: Number.isFinite(thresholdMinutes) ? thresholdMinutes : null,
        cooldownMinutes: Number.isFinite(cooldownMinutes) ? cooldownMinutes : null,
        params: kind === 'keyword' ? { keyword } : {},
      }),
    })
    els.createAlertRuleForm.reset()
    state.alerts.offset = 0
    state.alerts.ruleKind = kind
    await Promise.all([loadAlertRules(), loadAlerts(), loadStats()])
  } catch (error) {
    console.error(error)
    alert(`Failed to create alert rule: ${error.message}`)
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

els.alertsPrevButton?.addEventListener('click', () => {
  state.alerts.offset = Math.max(0, state.alerts.offset - state.alerts.limit)
  loadAlerts()
})
els.alertsNextButton?.addEventListener('click', () => {
  state.alerts.offset += state.alerts.limit
  loadAlerts()
})

els.messagesTab.addEventListener('click', () => {
  setActiveView('messages')
})
els.transactionsTab.addEventListener('click', () => {
  setActiveView('transactions')
})
els.alertsTab?.addEventListener('click', () => {
  setActiveView('alerts')
})

function setActiveView(view) {
  state.view = view
  const isMessages = view === 'messages'
  const isTransactions = view === 'transactions'
  const isAlerts = view === 'alerts'

  els.messagesTab.classList.toggle('active', isMessages)
  els.transactionsTab.classList.toggle('active', isTransactions)
  if (els.alertsTab) {
    els.alertsTab.classList.toggle('active', isAlerts)
  }
  els.messagesTab.setAttribute('aria-selected', isMessages ? 'true' : 'false')
  els.transactionsTab.setAttribute('aria-selected', isTransactions ? 'true' : 'false')
  if (els.alertsTab) {
    els.alertsTab.setAttribute('aria-selected', isAlerts ? 'true' : 'false')
  }

  els.messagesPane.classList.toggle('hidden', !isMessages)
  els.transactionsPane.classList.toggle('hidden', !isTransactions)
  if (els.alertsPane) {
    els.alertsPane.classList.toggle('hidden', !isAlerts)
  }
  els.messagesPane.setAttribute('aria-hidden', String(!isMessages))
  els.transactionsPane.setAttribute('aria-hidden', String(!isTransactions))
  if (els.alertsPane) {
    els.alertsPane.setAttribute('aria-hidden', String(!isAlerts))
  }

  if (isTransactions) {
    loadTransactions()
  } else if (isMessages) {
    loadMessages()
  } else {
    loadAlertRules().catch(() => {})
    loadAlerts()
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
    if (state.view === 'alerts') {
      loadAlerts().catch(() => {})
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
    if (parsed.type === 'message' || parsed.type === 'media' || parsed.type === 'alert') scheduleRefresh()
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
