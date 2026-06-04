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

const stateAuth = {
  user: null,
  loaded: false,
  eventSource: null,
  appStarted: false,
}

const els = {
  authShell: document.getElementById('authShell'),
  appShell: document.getElementById('appShell'),
  bootShell: document.getElementById('bootShell'),
  bootMessage: document.getElementById('bootMessage'),
  loginForm: document.getElementById('loginForm'),
  loginEmail: document.getElementById('loginEmail'),
  loginPassword: document.getElementById('loginPassword'),
  loginSubmit: document.getElementById('loginSubmit'),
  showRegisterButton: document.getElementById('showRegisterButton'),
  showLoginButton: document.getElementById('showLoginButton'),
  registerForm: document.getElementById('registerForm'),
  registerName: document.getElementById('registerName'),
  registerEmail: document.getElementById('registerEmail'),
  registerPassword: document.getElementById('registerPassword'),
  registerPasswordConfirm: document.getElementById('registerPasswordConfirm'),
  registerSubmit: document.getElementById('registerSubmit'),
  authError: document.getElementById('authError'),
  loggedUser: document.getElementById('loggedUser'),
  logoutButton: document.getElementById('logoutButton'),
  health: document.getElementById('health'),
  messagesCount: document.getElementById('messagesCount'),
  chatsCount: document.getElementById('chatsCount'),
  contactsCount: document.getElementById('contactsCount'),
  mediaCount: document.getElementById('mediaCount'),
  transactionsCount: document.getElementById('transactionsCount'),
  pendingTransactionsCount: document.getElementById('pendingTransactionsCount'),
  unreadAlertsCount: document.getElementById('unreadAlertsCount'),
  criticalAlertsCount: document.getElementById('criticalAlertsCount'),
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
  accountSelect: document.getElementById('accountSelect'),
  accountPhoneInput: document.getElementById('accountPhoneInput'),
  registerWhatsappForm: document.getElementById('registerWhatsappForm'),
  requestQrButton: document.getElementById('requestQrButton'),
  accountActionMessage: document.getElementById('accountActionMessage'),
  accountQrPanel: document.getElementById('accountQrPanel'),
  accountQrStatus: document.getElementById('accountQrStatus'),
  accountQrImage: document.getElementById('accountQrImage'),
  accountList: document.getElementById('accountList'),
  toastViewport: document.getElementById('toastViewport'),
}

const accountsState = { rows: [] }
const pendingQrCodes = new Map()
const renderedQrImages = new Map()
const qrRequestState = {
  accountId: '',
  deadline: 0,
  timer: null,
  inFlight: false,
}
const QR_REQUEST_POLL_MS = 2000
const QR_REQUEST_TIMEOUT_MS = 45000
let toastId = 0
let liveEventToastTimer = null
const liveEventCounts = {
  message: 0,
  media: 0,
  alert: 0,
}

function showToast(message, type = 'info', options = {}) {
  if (!message || !els.toastViewport) return

  const toast = document.createElement('div')
  const id = `toast-${++toastId}`
  const duration = Number.isFinite(options.duration) ? options.duration : 4200
  toast.id = id
  toast.className = `toast ${type}`
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status')

  const messageEl = document.createElement('span')
  messageEl.textContent = message

  const closeButton = document.createElement('button')
  closeButton.type = 'button'
  closeButton.className = 'toastClose'
  closeButton.setAttribute('aria-label', 'Dismiss notification')
  closeButton.textContent = 'x'
  closeButton.addEventListener('click', () => removeToast(toast))

  toast.append(messageEl, closeButton)
  els.toastViewport.appendChild(toast)
  window.requestAnimationFrame(() => toast.classList.add('visible'))

  if (duration > 0) {
    window.setTimeout(() => removeToast(toast), duration)
  }
}

function removeToast(toast) {
  if (!toast || !toast.parentElement) return
  toast.classList.remove('visible')
  window.setTimeout(() => toast.remove(), 180)
}

function queueLiveEventToast(type) {
  if (!Object.prototype.hasOwnProperty.call(liveEventCounts, type)) return
  liveEventCounts[type] += 1
  if (liveEventToastTimer) return

  liveEventToastTimer = window.setTimeout(() => {
    liveEventToastTimer = null
    const parts = []
    if (liveEventCounts.message) parts.push(`${formatNumber(liveEventCounts.message)} message${liveEventCounts.message === 1 ? '' : 's'}`)
    if (liveEventCounts.media) parts.push(`${formatNumber(liveEventCounts.media)} media item${liveEventCounts.media === 1 ? '' : 's'}`)
    if (liveEventCounts.alert) parts.push(`${formatNumber(liveEventCounts.alert)} alert${liveEventCounts.alert === 1 ? '' : 's'}`)
    const hasAlert = liveEventCounts.alert > 0
    liveEventCounts.message = 0
    liveEventCounts.media = 0
    liveEventCounts.alert = 0
    if (parts.length) {
      showToast(`Live update: ${parts.join(', ')}`, hasAlert ? 'warning' : 'info', { duration: 3200 })
    }
  }, 700)
}

function isAuthError(error) {
  return error instanceof Error && error.message === 'unauthorized'
}

function getErrorMessage(error, fallback = 'Something went wrong.') {
  return error instanceof Error ? error.message : fallback
}

function showAuthForm(message = '') {
  if (els.bootShell) {
    els.bootShell.classList.add('hidden')
  }
  if (els.authShell) {
    els.authShell.classList.remove('hidden')
  }
  if (els.appShell) {
    els.appShell.classList.add('hidden')
  }
  if (els.authError && message) {
    els.authError.textContent = message
  }
}

function setAuthMode(mode) {
  if (!els.loginForm || !els.registerForm || !els.showRegisterButton || !els.showLoginButton) return
  const isLogin = mode === 'login'

  els.loginForm.classList.toggle('hidden', !isLogin)
  els.showRegisterButton.classList.toggle('hidden', !isLogin)
  els.registerForm.classList.toggle('hidden', isLogin)
  els.showLoginButton.classList.toggle('hidden', isLogin)
  if (!isLogin) {
    if (els.registerName) els.registerName.focus()
  } else if (els.loginEmail) {
    els.loginEmail.focus()
  }
}

function showDashboard() {
  if (els.bootShell) {
    els.bootShell.classList.add('hidden')
  }
  if (els.authShell) {
    els.authShell.classList.add('hidden')
  }
  if (els.appShell) {
    els.appShell.classList.remove('hidden')
  }
  if (els.authError) {
    els.authError.textContent = ''
  }
}

function showBootstrap(message = 'Checking your session...') {
  if (els.authShell) {
    els.authShell.classList.add('hidden')
  }
  if (els.appShell) {
    els.appShell.classList.add('hidden')
  }
  if (els.bootMessage && message) {
    els.bootMessage.textContent = message
  }
  if (els.bootShell) {
    els.bootShell.classList.remove('hidden')
  }
}

function setLoggedUser(user) {
  if (!els.loggedUser) return
  const name = user?.name ? `Signed in as ${user.name}` : 'Signed in'
  const role = user?.role ? ` (${user.role})` : ''
  els.loggedUser.textContent = `${name}${role}`
}

function handleAuthExpiration(message = 'Session expired, please sign in again.') {
  stateAuth.user = null
  stateAuth.appStarted = false
  pendingQrCodes.clear()
  renderedQrImages.clear()
  resetQrRequestState()
  clearAccountQrView()
  stopLiveUpdates()
  if (els.loginEmail) {
    els.loginEmail.value = ''
  }
  if (els.loginPassword) {
    els.loginPassword.value = ''
  }
  showAuthForm(message)
}

function clearActionMessage() {
  if (els.accountActionMessage) {
    els.accountActionMessage.textContent = ''
  }
}

function setActionMessage(message, type = 'info') {
  if (els.accountActionMessage) {
    els.accountActionMessage.textContent = message
  }
  showToast(message, type)
}

function clearQrRequestTimer() {
  if (qrRequestState.timer) {
    window.clearTimeout(qrRequestState.timer)
    qrRequestState.timer = null
  }
}

function resetQrRequestState() {
  clearQrRequestTimer()
  qrRequestState.accountId = ''
  qrRequestState.deadline = 0
  qrRequestState.inFlight = false
  syncQrRequestButton()
}

function syncQrRequestButton() {
  if (!els.requestQrButton) return
  const account = getSelectedAccount()
  const isBusy = qrRequestState.inFlight || (account?.id && qrRequestState.accountId === account.id && !!qrRequestState.timer)
  els.requestQrButton.disabled = !account || account.status === 'connected' || !!isBusy
  els.requestQrButton.textContent = isBusy ? 'Preparing...' : account?.status === 'connected' ? 'Connected' : 'Request QR'
}

function getSelectedAccountId() {
  return els.accountSelect?.value || ''
}

function getSelectedAccountLabel() {
  const accountId = getSelectedAccountId()
  const account = accountsState.rows.find((item) => item.id === accountId)
  return account?.label || accountId || 'selected account'
}

function getSelectedAccount() {
  const accountId = getSelectedAccountId()
  return accountsState.rows.find((item) => item.id === accountId) || null
}

function clearAccountQrView() {
  if (!els.accountQrPanel || !els.accountQrStatus || !els.accountQrImage) return
  els.accountQrPanel.classList.add('hidden')
  els.accountQrStatus.textContent = ''
  els.accountQrImage.removeAttribute('src')
  els.accountQrImage.alt = ''
  els.accountQrImage.classList.add('hidden')
  els.accountQrImage.closest('.qrFrame')?.classList.remove('loading')
}

function forgetAccountQr(accountId) {
  const qr = pendingQrCodes.get(accountId)
  if (qr) {
    renderedQrImages.delete(qr)
  }
  pendingQrCodes.delete(accountId)
}

function showQrPreparing(accountLabel) {
  if (!els.accountQrPanel || !els.accountQrStatus || !els.accountQrImage) return
  els.accountQrStatus.textContent = `Preparing QR code for ${accountLabel}. It will appear here as soon as WhatsApp sends it.`
  els.accountQrPanel.classList.remove('hidden')
  setQrVisualMode('loading')
}

async function renderAccountQrForSelectedAccount(options = {}) {
  if (!els.accountQrPanel || !els.accountQrStatus || !els.accountQrImage) return
  const accountId = getSelectedAccountId()
  if (!accountId) {
    clearAccountQrView()
    return
  }

  const accountLabel = getSelectedAccountLabel()
  const qr = pendingQrCodes.get(accountId)
  if (!qr) {
    clearAccountQrView()
    return
  }

  els.accountQrStatus.textContent = `Preparing QR code for ${accountLabel}...`
  els.accountQrPanel.classList.remove('hidden')
  setQrVisualMode('loading')

  try {
    const rendered = await renderQrGraphic(qr, accountLabel)
    if (rendered) {
      els.accountQrStatus.textContent = `QR code ready. Scan it to connect ${accountLabel} on your phone.`
      if (options.notifyReady) {
        showToast(`QR code ready for ${accountLabel}.`, 'success')
      }
      return
    }
  } catch (error) {
    console.error('Failed to render QR code', error)
  }

  showQrRenderError(accountLabel)
}

async function requestQrForSelectedAccount(options = {}) {
  const accountId = getSelectedAccountId()
  const accountLabel = getSelectedAccountLabel()
  if (!accountId) {
    setActionMessage('Please choose an account first.', 'warning')
    return
  }

  clearQrRequestTimer()
  qrRequestState.accountId = accountId
  qrRequestState.deadline = options.deadline || Date.now() + QR_REQUEST_TIMEOUT_MS
  qrRequestState.inFlight = true
  syncQrRequestButton()
  showQrPreparing(accountLabel)

  try {
    const data = await api(`/api/accounts/${encodeURIComponent(accountId)}/qr-code`, { method: 'POST' })
    if (getSelectedAccountId() !== accountId || qrRequestState.accountId !== accountId) return

    if (data?.status === 'connected') {
      forgetAccountQr(accountId)
      resetQrRequestState()
      clearAccountQrView()
      showToast(`${accountLabel} is already connected.`, 'success')
      await loadAccounts()
      return
    }

    if (typeof data?.qr === 'string' && data.qr) {
      const previousQr = pendingQrCodes.get(accountId)
      if (previousQr && previousQr !== data.qr) {
        renderedQrImages.delete(previousQr)
      }
      pendingQrCodes.set(accountId, data.qr)
      qrRequestState.inFlight = false
      clearQrRequestTimer()
      syncQrRequestButton()
      await renderAccountQrForSelectedAccount({ notifyReady: options.notifyReady })
      resetQrRequestState()
      return
    }

    qrRequestState.inFlight = false
    if (Date.now() < qrRequestState.deadline) {
      syncQrRequestButton()
      qrRequestState.timer = window.setTimeout(() => {
        qrRequestState.timer = null
        void requestQrForSelectedAccount({ notifyReady: true, deadline: qrRequestState.deadline })
      }, QR_REQUEST_POLL_MS)
      syncQrRequestButton()
      return
    }

    resetQrRequestState()
    els.accountQrStatus.textContent = `QR code for ${accountLabel} is still preparing. Try Request QR again in a moment.`
    setQrVisualMode('loading')
    showToast('QR is still preparing. Try again in a moment.', 'warning')
  } catch (error) {
    console.error(error)
    if (isAuthError(error)) return
    resetQrRequestState()
    showQrRenderError(accountLabel)
  } finally {
    qrRequestState.inFlight = false
    syncQrRequestButton()
  }
}

function handleWaQrEvent(event) {
  if (typeof event?.accountId !== 'string' || typeof event.qr !== 'string') return
  if (qrRequestState.accountId !== event.accountId) return
  const previousQr = pendingQrCodes.get(event.accountId)
  if (previousQr && previousQr !== event.qr) {
    renderedQrImages.delete(previousQr)
  }
  pendingQrCodes.set(event.accountId, event.qr)
  if (getSelectedAccountId() === event.accountId) {
    void renderAccountQrForSelectedAccount({ notifyReady: true }).finally(() => resetQrRequestState())
  }
}

function handleWaQrAvailableEvent(event) {
  if (typeof event?.accountId !== 'string') return
  if (qrRequestState.accountId === event.accountId && getSelectedAccountId() === event.accountId) {
    void requestQrForSelectedAccount({ notifyReady: true, deadline: qrRequestState.deadline || Date.now() + QR_REQUEST_TIMEOUT_MS })
  }
}

function handleWaConnectionEvent(event) {
  if (typeof event?.accountId !== 'string') return
  if (event.status === 'connected') {
    forgetAccountQr(event.accountId)
    if (qrRequestState.accountId === event.accountId) {
      resetQrRequestState()
    }
    if (getSelectedAccountId() === event.accountId) {
      clearAccountQrView()
    }
    showToast(`WhatsApp connected for ${event.accountId}.`, 'success')
  } else if (event.status === 'disconnected') {
    showToast(`WhatsApp disconnected for ${event.accountId}.`, 'warning')
  }
}

function setQrVisualMode(mode) {
  els.accountQrImage?.classList.toggle('hidden', mode !== 'image')
  const frame = els.accountQrImage?.closest('.qrFrame')
  frame?.classList.remove('hidden')
  frame?.classList.toggle('loading', mode === 'loading')
}

async function renderQrGraphic(qr, accountLabel) {
  let dataUrl = renderedQrImages.get(qr)
  if (!dataUrl) {
    const data = await api('/api/qr-code', {
      method: 'POST',
      body: JSON.stringify({ text: qr }),
    })
    if (!data?.svg || typeof data.svg !== 'string') return false
    dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data.svg)}`
    renderedQrImages.set(qr, dataUrl)
  }

  await loadQrImage(dataUrl, accountLabel)
  setQrVisualMode('image')
  return true
}

function loadQrImage(dataUrl, accountLabel) {
  return new Promise((resolve, reject) => {
    if (!(els.accountQrImage instanceof window.HTMLImageElement)) {
      reject(new Error('qr_image_missing'))
      return
    }
    els.accountQrImage.onload = () => {
      els.accountQrImage.onload = null
      els.accountQrImage.onerror = null
      els.accountQrImage.alt = `QR code for ${accountLabel}`
      resolve()
    }
    els.accountQrImage.onerror = () => {
      els.accountQrImage.onload = null
      els.accountQrImage.onerror = null
      reject(new Error('qr_image_failed'))
    }
    els.accountQrImage.src = dataUrl
  })
}

function showQrRenderError(accountLabel) {
  els.accountQrStatus.textContent = `QR image for ${accountLabel} is not ready. Refresh the dashboard to try again.`
  els.accountQrImage.removeAttribute('src')
  els.accountQrImage.alt = ''
  els.accountQrImage?.classList.add('hidden')
  const frame = els.accountQrImage?.closest('.qrFrame')
  frame?.classList.remove('loading')
  frame?.classList.add('hidden')
  showToast('QR image could not be rendered. Refresh the dashboard to request a new code.', 'error')
}

function sanitizeAuthPayload(payload) {
  if (!payload || typeof payload !== 'object') return null
  if (payload.user && typeof payload.user.email === 'string') return payload
  return null
}

async function api(path, options = {}, cfg = { authAware: true }) {
  const method = options.method ?? 'GET'
  const fetchOptions = {
    ...options,
    headers: {
      ...options.headers,
    },
  }

  if (method !== 'GET' && options.body && !fetchOptions.headers['content-type']) {
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
    const errorCode = payload?.error || `${res.status} ${res.statusText}`
    if (cfg.authAware !== false && errorCode === 'unauthorized') {
      handleAuthExpiration()
    }
    throw new Error(errorCode)
  }

  return payload
}

async function bootstrapAuth() {
  if (stateAuth.loaded) return
  try {
    const session = await api('/api/auth/me', {}, { authAware: false })
    const user = sanitizeAuthPayload(session)?.user
    if (!user) throw new Error('Session lookup failed')

    stateAuth.user = user
    setLoggedUser(user)
    showDashboard()
    await startDashboard()
  } catch (error) {
    if (isAuthError(error)) {
      showAuthForm('Please sign in to continue.')
      return
    }
    throw error
  } finally {
    stateAuth.loaded = true
  }
}

async function startDashboard() {
  if (stateAuth.appStarted) return
  stateAuth.appStarted = true

  clearActionMessage()
  try {
    await Promise.all([
      loadHealth(),
      loadAccounts(),
      loadStats(),
      loadChats(),
      loadMessages(),
      loadTransactions(),
      loadAlertRules(),
      loadAlerts(),
    ])
    setActiveView('messages')
    startLiveUpdates()
  } catch (error) {
    if (!isAuthError(error)) {
      console.error(error)
      throw error
    }
  }
}

async function loadHealth() {
  try {
    await api('/api/health', {}, { authAware: false })
    els.health.textContent = ''
    els.health.className = 'status statusDot ok'
    els.health.setAttribute('aria-label', 'Connected')
    els.health.setAttribute('title', 'Connected')
  } catch {
    els.health.textContent = ''
    els.health.className = 'status statusDot bad'
    els.health.setAttribute('aria-label', 'Offline')
    els.health.setAttribute('title', 'Offline')
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
  all.innerHTML = `<span class="chatName">All chats</span><span class="count">•</span><span class="jid">archive</span>`
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
      <span class="jid">${escapeHtml(chat.type)} · ${escapeHtml(chat.wa_jid)}</span>
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
          showToast(`Transaction status updated to ${nextStatus}.`, 'success')
        } catch (error) {
          console.error(error)
          showToast(`Failed to update status: ${getErrorMessage(error)}`, 'error')
          await loadTransactions()
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
          showToast('Message linked to transaction.', 'success')
        } catch (error) {
          console.error(error)
          showToast(`Failed to link message: ${getErrorMessage(error)}`, 'error')
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
          showToast('Payment added to transaction.', 'success')
        } catch (error) {
          console.error(error)
          showToast(`Failed to add payment: ${getErrorMessage(error)}`, 'error')
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
          showToast('Alert acknowledged.', 'success')
        } catch (error) {
          console.error(error)
          showToast(`Failed to acknowledge alert: ${getErrorMessage(error)}`, 'error')
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
      const suffix = m.storage_status === 'pending' ? '…' : m.storage_status === 'failed' ? ' ⚠' : ''
      return `<span class="mediaBadge ${escapeHtml(m.storage_status)}">${escapeHtml(m.type)}${suffix}</span>`
    })
    .join('')
}

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

async function loadAccounts() {
  const data = await api('/api/accounts')
  accountsState.rows = Array.isArray(data?.rows) ? data.rows : []
  renderAccountList()
  syncQrRequestButton()
}

function renderAccountList() {
  if (!els.accountSelect || !els.accountList) return
  const rows = accountsState.rows
  const selectedAccountId = els.accountSelect.value
  els.accountList.innerHTML = ''
  els.accountSelect.innerHTML = '<option value="">Choose account</option>'

  if (rows.length === 0) {
    els.accountList.innerHTML = '<li class="muted">No accounts available.</li>'
    return
  }

  for (const account of rows) {
    const option = document.createElement('option')
    option.value = account.id
    option.textContent = `${account.label || account.id} (${account.phoneNumber || 'No WhatsApp number'})`
    if (account.id === selectedAccountId) {
      option.selected = true
    }
    els.accountSelect.appendChild(option)

    const row = document.createElement('li')
    row.innerHTML = `
      <span>${escapeHtml(account.label || account.id)}</span>
      <span class="muted">${escapeHtml(account.phoneNumber || 'not set')}</span>
    `
    els.accountList.appendChild(row)
  }

  if (!selectedAccountId && rows.length > 0 && els.accountPhoneInput) {
    const fallbackId = rows[0].id
    const fallback = rows[0]
    if (fallbackId) {
      els.accountSelect.value = fallbackId
      els.accountPhoneInput.value = fallback.phoneNumber || ''
    }
  }

}

async function setAccountPhoneNumber(event) {
  event.preventDefault()
  clearActionMessage()

  if (!els.accountSelect || !els.accountPhoneInput) return
  const accountId = els.accountSelect.value
  const rawNumber = els.accountPhoneInput.value.trim()
  if (!accountId) {
    setActionMessage('Please choose an account first.', 'warning')
    return
  }
  if (!rawNumber) {
    setActionMessage('Please enter a WhatsApp number.', 'warning')
    return
  }

  try {
    const updated = await api(`/api/accounts/${encodeURIComponent(accountId)}/whatsapp-number`, {
      method: 'POST',
      body: JSON.stringify({ phoneNumber: rawNumber }),
    })
    const row = (Array.isArray(accountsState.rows) ? accountsState.rows : []).find((candidate) => candidate.id === updated?.id)
    if (row) {
      row.phoneNumber = updated.phoneNumber
    }
    renderAccountList()
    clearAccountQrView()
    syncQrRequestButton()
    setActionMessage('WhatsApp number saved. Request QR when you are ready to scan.', 'success')
  } catch (error) {
    if (error instanceof Error && error.message === 'forbidden') {
      setActionMessage('Only admins can register WhatsApp numbers.', 'warning')
      return
    }
    if (isAuthError(error)) return
    setActionMessage(`Failed to save WhatsApp number: ${getErrorMessage(error)}`, 'error')
  }
}

function autofillSelectedAccount() {
  if (!els.accountSelect || !els.accountPhoneInput) return
  const accountId = els.accountSelect.value
  const account = accountsState.rows.find((item) => item.id === accountId)
  els.accountPhoneInput.value = account?.phoneNumber || ''
  clearActionMessage()
  resetQrRequestState()
  clearAccountQrView()
  syncQrRequestButton()
}

async function login(event) {
  event.preventDefault()
  if (!els.loginEmail || !els.loginPassword || !els.loginSubmit) return

  const email = els.loginEmail.value.trim().toLowerCase()
  const password = els.loginPassword.value
  if (!email || !password) {
    if (els.authError) {
      els.authError.textContent = 'Email and password are required.'
    }
    return
  }

  els.loginSubmit.disabled = true
  if (els.authError) {
    els.authError.textContent = 'Signing in...'
  }

  try {
    const data = await api(
      '/api/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      },
      { authAware: false },
    )

    const user = sanitizeAuthPayload(data)?.user
    if (!user) throw new Error('Invalid auth response')

    stateAuth.user = user
    stateAuth.loaded = true
    setLoggedUser(user)
    showDashboard()
    clearActionMessage()
    await startDashboard()
    showToast(`Signed in as ${user.name || user.email}.`, 'success')
  } catch (error) {
    if (els.authError) {
      if (error instanceof Error) {
        els.authError.textContent = error.message === 'unauthorized' ? 'Invalid email or password.' : error.message
      } else {
        els.authError.textContent = 'Unable to sign in.'
      }
    }
    showToast(els.authError?.textContent || 'Unable to sign in.', 'error')
  } finally {
    els.loginSubmit.disabled = false
  }
}

async function register(event) {
  event.preventDefault()
  if (
    !els.registerName ||
    !els.registerEmail ||
    !els.registerPassword ||
    !els.registerPasswordConfirm ||
    !els.registerSubmit
  ) {
    return
  }

  const name = els.registerName.value.trim()
  const email = els.registerEmail.value.trim().toLowerCase()
  const password = els.registerPassword.value
  const passwordConfirm = els.registerPasswordConfirm.value

  if (!name || !email || !password || !passwordConfirm) {
    if (els.authError) {
      els.authError.textContent = 'Name, email, and password are required.'
    }
    return
  }

  if (password.length < 12) {
    if (els.authError) {
      els.authError.textContent = 'Password must be at least 12 characters.'
    }
    return
  }

  if (password !== passwordConfirm) {
    if (els.authError) {
      els.authError.textContent = 'Passwords do not match.'
    }
    return
  }

  els.registerSubmit.disabled = true
  if (els.authError) {
    els.authError.textContent = 'Creating account...'
  }

  try {
    const data = await api(
      '/api/auth/register',
      {
        method: 'POST',
        body: JSON.stringify({ name, email, password }),
      },
      { authAware: false },
    )
    const user = sanitizeAuthPayload(data)?.user
    if (!user) throw new Error('Invalid auth response')

    stateAuth.user = user
    stateAuth.loaded = true
    setLoggedUser(user)
    showDashboard()
    if (els.registerForm) {
      els.registerForm.reset?.()
    }
    clearActionMessage()
    await startDashboard()
    showToast('Account created and signed in.', 'success')
  } catch (error) {
    if (error instanceof Error && error.message === 'forbidden') {
      if (els.authError) {
        els.authError.textContent = 'Registration is locked. Ask an admin to create an account.'
      }
      showToast('Registration is locked. Ask an admin to create an account.', 'warning')
      return
    }
    if (els.authError) {
      if (error instanceof Error) {
        els.authError.textContent = error.message
      } else {
        els.authError.textContent = 'Unable to register.'
      }
    }
    showToast(els.authError?.textContent || 'Unable to register.', 'error')
  } finally {
    els.registerSubmit.disabled = false
  }
}

function switchToRegister(event) {
  event.preventDefault()
  setAuthMode('register')
}

function switchToLogin(event) {
  event.preventDefault()
  setAuthMode('login')
}

async function logout() {
  try {
    await api('/api/auth/logout', { method: 'POST' }, { authAware: false })
  } catch {
    // ignore logout errors; user is asked to login again below
  } finally {
    stateAuth.user = null
    stateAuth.loaded = true
    handleAuthExpiration('Signed out.')
    showToast('Signed out.', 'success')
  }
}

function stopLiveUpdates() {
  if (stateAuth.eventSource) {
    stateAuth.eventSource.close()
    stateAuth.eventSource = null
  }
}

// Live updates: the API streams worker events over SSE. Coalesce bursts into one refresh.
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
  stopLiveUpdates()
  const es = new EventSource('/api/stream')
  stateAuth.eventSource = es
  es.onmessage = (event) => {
    let parsed
    try {
      parsed = JSON.parse(event.data)
    } catch {
      return
    }
    if (parsed.type === 'qr') {
      handleWaQrEvent(parsed)
      return
    }
    if (parsed.type === 'qr_available') {
      handleWaQrAvailableEvent(parsed)
      return
    }
    if (parsed.type === 'connection') {
      handleWaConnectionEvent(parsed)
      return
    }
    if (parsed.type === 'message' || parsed.type === 'media' || parsed.type === 'alert') {
      queueLiveEventToast(parsed.type)
      scheduleRefresh()
    }
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
    showToast('From JID, To JID and Amount are required.', 'warning')
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
    showToast('Transaction created.', 'success')
  } catch (error) {
    console.error(error)
    showToast(`Failed to create transaction: ${getErrorMessage(error)}`, 'error')
  }
})

els.alertFilterForm?.addEventListener('submit', (event) => {
  event.preventDefault()
  state.alerts.unreadOnly = !!els.alertsUnreadOnly?.checked
  state.alerts.ruleKind = (els.alertsRuleKindFilter?.value ?? '').trim()
  state.alerts.offset = 0
  loadAlerts().catch((error) => {
    console.error(error)
    showToast(`Failed to load alerts: ${getErrorMessage(error)}`, 'error')
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
    showToast(`Failed to load alerts: ${getErrorMessage(error)}`, 'error')
  })
})

els.createAlertRuleForm?.addEventListener('submit', async (event) => {
  event.preventDefault()
  const kind = (els.alertRuleKind?.value ?? '').trim()
  const thresholdMinutes = Number.parseInt((els.alertRuleThreshold?.value ?? '').trim(), 10)
  const cooldownMinutes = Number.parseInt((els.alertRuleCooldown?.value ?? '').trim(), 10)
  const keyword = (els.alertRuleKeyword?.value ?? '').trim()

  if (kind === 'keyword' && !keyword) {
    showToast('Keyword is required for keyword rules.', 'warning')
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
    showToast('Alert rule created.', 'success')
  } catch (error) {
    console.error(error)
    showToast(`Failed to create alert rule: ${getErrorMessage(error)}`, 'error')
  }
})

els.refreshButton.addEventListener('click', async () => {
  if (!stateAuth.user) return
  await loadStats()
  await Promise.all([loadChats(), loadMessages(), loadTransactions(), loadAlertRules(), loadAlerts(), loadAccounts()])
  showToast('Dashboard refreshed.', 'success')
})

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

els.loginForm?.addEventListener('submit', login)
els.showRegisterButton?.addEventListener('click', switchToRegister)
els.showLoginButton?.addEventListener('click', switchToLogin)
els.registerForm?.addEventListener('submit', register)
els.logoutButton?.addEventListener('click', logout)
els.registerWhatsappForm?.addEventListener('submit', setAccountPhoneNumber)
els.requestQrButton?.addEventListener('click', () => {
  clearActionMessage()
  void requestQrForSelectedAccount({ notifyReady: true })
})
els.accountSelect?.addEventListener('change', autofillSelectedAccount)

async function start() {
  showBootstrap()
  setAuthMode('login')
  try {
    await bootstrapAuth()
  } catch (error) {
    showAuthForm(error instanceof Error ? error.message : 'Unable to initialize the dashboard.')
  }
}

start()
