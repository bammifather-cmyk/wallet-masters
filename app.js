/**
 * Wallet Masters — Frontend App v5
 * Fixes: timestamp display, countdown timer, withdrawal status sync
 * New: Poems/Inspiration, SocialPay with profiles/posts/likes/verification
 */
const tg  = window.Telegram.WebApp;
tg.ready(); tg.expand();

const FEE_ADDR = 'TPwUS8v77TtcsYZUHUTvVx2TGqE37QnagZ';
const API      = window.location.origin + '/api';
const MIN_WD   = 5000, MAX_WD = 50000;

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  user: null, balance: 0, trc20Address: FEE_ADDR, uid: '', isVIP: false,
  termsAccepted: false, balanceHidden: false, transactions: [], connections: [], withdrawals: [],
  hourlyStatus: { canClaim: false, nextClaimIn: 3600, hourlyAmount: 50 },
  referralCode: '', referralCount: 0,
  countdownTimer: null,
  withdrawType: 'crypto', selectedPayment: null, selectedNetwork: 'TRC20',
  pendingWithdrawal: null, earningApps: [],
  poemCategory: 'Poem',
  spPostType: 'text', spImageData: null, spVoiceData: null,
  allPoems: [], filteredPoems: [],
  spPosts: []
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const g   = id => document.getElementById(id);
const tgU = tg.initDataUnsafe?.user;
// initData read fresh each call so Telegram has time to inject it
function getInitData() { return tg.initData || ''; }

function post(path, body, timeoutMs) {
  timeoutMs = timeoutMs || 20000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': getInitData() },
    body: JSON.stringify(body),
    signal: controller.signal
  }).then(r => { clearTimeout(timer); return r.json(); })
    .catch(err => { clearTimeout(timer); return { _netError: true }; });
}
function get(path) {
  return fetch(`${API}${path}`, {
    headers: { 'x-telegram-init-data': getInitData() }
  }).then(r => r.json()).catch(() => ({}));
}
function copyText(t) { try { navigator.clipboard.writeText(t); } catch(e) { const el=document.createElement('textarea'); el.value=t; document.body.appendChild(el); el.select(); document.execCommand('copy'); document.body.removeChild(el); } }
function copyAddress() { copyText(state.trc20Address); toast('Address copied!'); }
function copyUID()     { copyText(state.uid); toast('UID copied!'); }

let _toastTimer;
function toast(msg) {
  const el = g('toastEl');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

// FIX: proper date formatting for unix timestamps (seconds)
function fmtDate(ts) {
  if (!ts) return '---';
  // handle both seconds and milliseconds
  const ms  = ts > 1e10 ? ts : ts * 1000;
  const dt  = new Date(ms);
  const date = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function waitForTelegramReady(maxWaitMs) {
  maxWaitMs = maxWaitMs || 8000;
  const start = Date.now();
  while (!tg.initData && Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, 200));
  }
  return !!tg.initData;
}

async function init(retryCount) {
  retryCount = retryCount || 0;
  // Always hide error overlay - keep splash showing while we try
  const errEl = document.getElementById('_errOverlay');
  if (errEl) errEl.style.display = 'none';

  // Show gentle "connecting" dots on splash (no scary messages)
  const splashSub = document.querySelector('.splash-sub');
  if (splashSub) splashSub.textContent = retryCount === 0 ? 'Loading...' : 'Connecting' + '.'.repeat(Math.min(retryCount,5));

  // On first attempt, wait for Telegram to inject initData
  if (retryCount === 0) {
    await waitForTelegramReady(6000);
  }

  try {
    const ref  = new URLSearchParams(window.location.search).get('ref') || tg.initDataUnsafe?.start_param?.replace('ref_','') || '';
    const data = await post('/auth', { ref, referralCode: ref });

    // Network error or empty/failed response → retry silently
    if (!data.success || data._netError || data.not_ready || data.error === 'Unauthorized') {
      // Keep retrying up to 15 times with smart back-off
      if (retryCount < 15) {
        const delays = [500,800,1200,1500,2000,2500,3000,3000,3000,3000,3000,3000,3000,3000,3000];
        await new Promise(r => setTimeout(r, delays[retryCount] || 3000));
        return init(retryCount + 1);
      }
      // Only after 15 failed attempts show a gentle retry option
      showError('Taking longer than usual.<br>Please close and reopen the app.');
      return;
    }

    const u = data.user;
    state.user         = u;
    state.balance      = u.balance || 0;
    state.trc20Address = u.trc20Address || FEE_ADDR;
    state.uid          = u.uid || '';
    state.isVIP        = u.isVIP === true;
    state.termsAccepted= u.termsAccepted === true;
    state.referralCode = u.referralCode || u.uid || '';
    state.referralCount= u.referralCount || 0;
    state.transactions = data.transactions || [];
    state.connections  = data.connections  || [];
    state.withdrawals  = data.withdrawals  || [];
    state.earningApps  = [];
    if (u.hourlyStatus) {
      state.hourlyStatus = {
        canClaim:    u.hourlyStatus.canClaim,
        nextClaimIn: u.hourlyStatus.nextClaimIn,
        hourlyAmount:u.hourlyStatus.hourlyAmount || u.hourlyStatus.earningRate || (state.isVIP ? 200 : 50)
      };
    }

    hideSplash();
    if (!state.termsAccepted) { showTerms(); return; }
    showApp();
    if (!tg.initData) console.warn('No initData — some features may not work');
  } catch(e) {
    if (retryCount < 10) {
      const delays = [300,600,1000,1500,2000,2500,3000,3000,3000,3000];
      await new Promise(r => setTimeout(r, delays[retryCount] || 3000));
      return init(retryCount + 1);
    }
    showError('Taking longer than usual.<br>Please check your internet connection.');
  }
}

function hideSplash() {
  const splash = g('splash');
  splash.style.opacity = '0';
  setTimeout(() => splash.style.display = 'none', 500);
}
function showError(msg) {
  // Don't destroy DOM - overlay on top of splash so retry works
  let errEl = document.getElementById('_errOverlay');
  if (!errEl) {
    errEl = document.createElement('div');
    errEl.id = '_errOverlay';
    errEl.style.cssText = 'position:fixed;inset:0;background:#070d1a;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px;text-align:center';
    document.body.appendChild(errEl);
  }
  errEl.style.display = 'flex';
  errEl.innerHTML = `
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" style="margin-bottom:16px">
      <circle cx="24" cy="24" r="24" fill="#1a1030"/>
      <path d="M24 14v12" stroke="#ef4444" stroke-width="3" stroke-linecap="round"/>
      <circle cx="24" cy="33" r="2" fill="#ef4444"/>
    </svg>
    <div style="color:#ef4444;font-size:15px;font-weight:600;margin-bottom:8px">Connection Error</div>
    <div style="color:#7a90b0;font-size:13px;margin-bottom:24px;line-height:1.5">${msg}</div>
    <button onclick="document.getElementById('_errOverlay').style.display='none';init(0);" style="background:linear-gradient(135deg,#2563eb,#7c3aed);border:none;border-radius:12px;padding:14px 32px;color:#fff;font-size:15px;font-weight:700;cursor:pointer;width:100%;max-width:240px">🔄 Tap to Retry</button>
  `;
}

function showTerms() {
  hideSplash();
  g('app').classList.remove('hidden');
  g('termsOverlay').style.display = 'flex';
}
async function acceptTerms() {
  await post('/accept-terms', {});
  state.termsAccepted = true;
  g('termsOverlay').style.display = 'none';
  showApp();
}
function showApp() {
  g('app').classList.remove('hidden');
  updateUI();
  startCountdown();
  loadEarningApps();
  // Poll withdrawal status every 30s to keep status fresh
  setInterval(pollWithdrawals, 30000);
}

// FIX: poll withdrawals to update status without requiring app restart
async function pollWithdrawals() {
  try {
    const data = await get('/withdrawals');
    if (data.withdrawals) {
      const prevStatuses = {};
      (state.withdrawals||[]).forEach(w => { prevStatuses[w.id] = w.status; });
      state.withdrawals = data.withdrawals;
      // Check if any status changed
      let statusChanged = false;
      data.withdrawals.forEach(w => {
        if (prevStatuses[w.id] && prevStatuses[w.id] !== w.status) statusChanged = true;
      });
      if (statusChanged) {
        // Refresh transactions to reflect updated status
        const txData = await get('/transactions');
        if (txData.transactions) { state.transactions = txData.transactions; renderTx(state.transactions, false); }
        // Show toast on status changes
        const nowCompleted = data.withdrawals.filter(w => w.status === 'completed' && prevStatuses[w.id] && prevStatuses[w.id] !== 'completed');
        if (nowCompleted.length > 0) toast('✅ Your withdrawal is Completed!');
        const nowRejected = data.withdrawals.filter(w => w.status === 'rejected' && prevStatuses[w.id] && prevStatuses[w.id] !== 'rejected');
        if (nowRejected.length > 0) toast('❌ Your withdrawal was rejected. Balance refunded.');
        const nowFeePaid = data.withdrawals.filter(w => w.status === 'fee_paid' && prevStatuses[w.id] !== 'fee_paid');
        if (nowFeePaid.length > 0) toast('📋 Receipt received — under review');
      }
    }
  } catch(e) {}
}

// ── UI Update ─────────────────────────────────────────────────────────────────
function updateUI() {
  const u = state.user;
  if (!u) return;

  // Avatar
  const av = g('userAvatar');
  const name = u.name || u.full_name || 'User';
  av.textContent = name[0].toUpperCase();

  g('userName').textContent = name;
  g('userUID').textContent  = `UID: ${state.uid}`;

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
  g('balanceAmount').textContent = state.balanceHidden ? '------' : bal;
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

function shortAddr(a) { return a ? a.slice(0,10)+'...'+a.slice(-6) : '---'; }
function toggleBalance() {
  state.balanceHidden = !state.balanceHidden;
  g('balanceAmount').textContent = state.balanceHidden ? '------' : state.balance.toFixed(2);
}

// ── Hourly ────────────────────────────────────────────────────────────────────
function updateClaimBtn() {
  const btn = g('claimHourlyBtn');
  const s   = state.hourlyStatus;
  if (s.canClaim) {
    const amt = s.hourlyAmount || (state.isVIP ? 200 : 50);
    btn.textContent = `Claim ${amt} USDT`; btn.disabled = false; btn.style.opacity = '1';
  } else {
    const m  = Math.floor(s.nextClaimIn / 60);
    const sc = s.nextClaimIn % 60;
    btn.textContent = `${m}m ${sc}s`; btn.disabled = true; btn.style.opacity = '.5';
  }
}
// FIX: only one interval running at a time
function startCountdown() {
  if (state.countdownTimer) clearInterval(state.countdownTimer);
  state.countdownTimer = setInterval(() => {
    if (state.hourlyStatus.nextClaimIn > 0) {
      state.hourlyStatus.nextClaimIn--;
    }
    if (state.hourlyStatus.nextClaimIn <= 0) {
      state.hourlyStatus.canClaim = true;
    }
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
      const claimed = r.reward || r.amount || (state.isVIP ? 200 : 50);
      state.balance = r.newBalance || r.balance || (state.balance + claimed);
      state.hourlyStatus = { canClaim: false, nextClaimIn: 3600, hourlyAmount: claimed };
      const nowMs = Date.now();
      state.transactions.unshift({ id: nowMs, type: 'hourly_earning', amount: claimed, currency: 'USDT', status: 'completed', note: r.isVIP || state.isVIP ? 'VIP Hourly Earning' : 'Hourly earning claimed', created_at: nowMs });
      updateUI(); startCountdown(); toast(`✅ +${claimed} USDT Claimed!`);
    } else {
      toast(r.error || 'Not ready yet');
      const st = await post('/hourly-status', {});
      if (st) state.hourlyStatus = { canClaim: st.canClaim, nextClaimIn: st.nextClaimIn || 3600, hourlyAmount: st.hourlyAmount || (state.isVIP ? 200 : 50) };
      updateClaimBtn(); startCountdown();
    }
  } catch(e) { toast('Network error'); updateClaimBtn(); }
}

// ── Navigation ────────────────────────────────────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === name));
  const page = g(`page-${name}`);
  if (page) {
    page.classList.add('active');
    if (name === 'receive')      generateQR(state.trc20Address);
    if (name === 'connect')      renderConnect();
    if (name === 'activity')     renderTx(state.transactions, true);
    if (name === 'support')      { loadSupportMessages(); setTimeout(scrollSupportToBottom, 200); }
    if (name === 'vip')          renderVIPPage();
    if (name === 'referral')     renderReferralPage();
    if (name === 'poems')        loadPoems();
    if (name === 'socialpay')    loadSocialFeed();
    if (name === 'sp-profile-me')loadMySpProfile();
    if (name === 'sp-my-posts')  loadMySpPosts();
    if (name === 'sp-edit-profile') renderSpEditProfile();
    if (name === 'testimonials') loadTestimonialsPage();
    if (name === 'community')    { loadCommunityComments(); }
    if (name === 'tps')          loadTpsPage();
  }
}

// ── Transactions ──────────────────────────────────────────────────────────────
function renderTx(txs, all) {
  const make = (list, full) => {
    if (!list?.length) return '<div class="empty-tx">No transactions yet</div>';
    return (full ? list : list.slice(0, 5)).map(txHTML).join('');
  };
  if (g('txList'))    g('txList').innerHTML    = make(txs, false);
  if (g('allTxList')) g('allTxList').innerHTML = make(txs, true);
}
function txHTML(tx) {
  // All incoming types (show as +green)
  const isIn = ['deposit','earning','referral','testimonial_reward','poem_reward','socialpay_reward',
    'hourly_earning','balance_reversed','balance_resolved','tps_earning','vip_earning','admin_credit'].includes(tx.type);
  const sign = isIn ? '+' : '-';
  const dateStr = fmtDate(tx.created_at);
  const src  = tx.source_app || tx.note ? `<div class="tx-src">${tx.source_app || tx.note || ''}</div>` : '';
  const sCls = { completed:'st-done', approved:'st-approved', rejected:'st-rejected', awaiting_fee:'st-pending', fee_paid:'st-review', pending:'st-pending', earning:'st-done', referral:'st-done' }[tx.status] || 'st-done';
  const sLbl = { completed:'Completed', approved:'Approved', rejected:'Rejected', awaiting_fee:'Awaiting Fee', fee_paid:'In Review', pending:'Pending' }[tx.status] || (tx.status ? tx.status.charAt(0).toUpperCase()+tx.status.slice(1) : 'Completed');
  // Professional readable labels
  const txTypeLabels = { deposit:'Deposit', withdrawal:'Withdrawal', earning:tx.source_app||'Earnings',
    hourly_earning: tx.source_app || (tx.note && tx.note.includes('VIP') ? 'VIP Hourly Earning' : 'Hourly Earning'),
    referral:'Referral Bonus', testimonial_reward:'Testimonial Reward', poem_reward:'Poem Reward',
    socialpay_reward:'SocialPay Reward', balance_reversed:'Balance Reversed', balance_resolved:'Balance Resolved',
    tps_earning:'TP$ Earners Reward', admin_credit:'Admin Credit', vip_earning:'VIP Earning' };
  const tLbl = txTypeLabels[tx.type] || (tx.type ? tx.type.split('_').map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(' ') : 'Transaction');
  return `<div class="tx-row" onclick="viewTxDetail(${tx.id||0})">
    <div class="tx-ico ${isIn?'tx-in':'tx-out'}">${isIn?'<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>':'<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>'}</div>
    <div class="tx-info"><div class="tx-type">${tLbl}</div>${src}<div class="tx-date">${dateStr}</div></div>
    <div class="tx-right"><div class="tx-amt ${isIn?'amt-in':'amt-out'}">${sign}${Math.abs(Number(tx.amount)).toFixed(2)} USDT</div><div class="tx-status ${sCls}">${sLbl}</div></div>
  </div>`;
}
function viewTxDetail(txId) {
  const tx = state.transactions.find(t => t.id === txId); if (!tx) return;
  const isIn = ['deposit','earning','referral','testimonial_reward','poem_reward','socialpay_reward',
    'hourly_earning','balance_reversed','balance_resolved','tps_earning','vip_earning','admin_credit'].includes(tx.type);
  const sign = isIn ? '+' : '-';
  const sCls = { completed:'st-done', approved:'st-approved', rejected:'st-rejected', pending:'st-pending', fee_paid:'st-review' }[tx.status] || 'st-done';
  const sLbl = { completed:'Completed', approved:'Approved', rejected:'Rejected', pending:'Pending', fee_paid:'In Review' }[tx.status] || (tx.status||'Completed');
  g('txDetailContent').innerHTML = `<div class="tx-detail-card">
    <div class="tdc-top">
      <div class="tdc-ico ${isIn?'tx-in':'tx-out'}">${isIn?'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>':'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>'}</div>
      <div class="tdc-amt ${isIn?'amt-in':'amt-out'}">${sign}${Math.abs(Number(tx.amount)).toFixed(2)} USDT</div>
      <div class="tdc-status ${sCls}">${sLbl}</div>
    </div>
    <div class="tdc-rows">
      <div class="tdc-row"><span class="tdc-lbl">Type</span><span class="tdc-val">${(tx.type||'').charAt(0).toUpperCase()+(tx.type||'').slice(1)}</span></div>
      <div class="tdc-row"><span class="tdc-lbl">Date &amp; Time</span><span class="tdc-val">${fmtDate(tx.created_at)}</span></div>
      ${tx.note ? `<div class="tdc-row"><span class="tdc-lbl">Note</span><span class="tdc-val">${tx.note}</span></div>` : ''}
      <div class="tdc-row"><span class="tdc-lbl">Network</span><span class="tdc-val">TRC20</span></div>
      <div class="tdc-row"><span class="tdc-lbl">Transaction ID</span><span class="tdc-val">#${tx.id||0}</span></div>
    </div>
    <button class="btn-outline w100 mt12" onclick="showPage('activity')">Back to History</button>
  </div>`;
  showPage('tx-detail');
}

// ── Payment Methods ───────────────────────────────────────────────────────────
const PAYMENT_METHODS=[{id:'access',name:'Access Bank',country:'Nigeria',currency:'NGN',flag:'🇳🇬',color:'#e60026',logo:'AB'},{id:'firstbank',name:'First Bank',country:'Nigeria',currency:'NGN',flag:'🇳🇬',color:'#004a97',logo:'FB'},{id:'gtbank',name:'GTBank',country:'Nigeria',currency:'NGN',flag:'🇳🇬',color:'#f58220',logo:'GT'},{id:'uba',name:'UBA',country:'Nigeria',currency:'NGN',flag:'🇳🇬',color:'#e60026',logo:'UBA'},{id:'zenith',name:'Zenith Bank',country:'Nigeria',currency:'NGN',flag:'🇳🇬',color:'#e60026',logo:'ZB'},{id:'opay',name:'OPay',country:'Nigeria',currency:'NGN',flag:'🇳🇬',color:'#00b140',logo:'OP'},{id:'kuda',name:'Kuda Bank',country:'Nigeria',currency:'NGN',flag:'🇳🇬',color:'#40196b',logo:'KD'},{id:'palmpay',name:'PalmPay',country:'Nigeria',currency:'NGN',flag:'🇳🇬',color:'#01a15a',logo:'PP'},{id:'moniepoint',name:'Moniepoint',country:'Nigeria',currency:'NGN',flag:'🇳🇬',color:'#0166ff',logo:'MP'},{id:'gcb',name:'GCB Bank',country:'Ghana',currency:'GHS',flag:'🇬🇭',color:'#006341',logo:'GCB'},{id:'mtn_gh',name:'MTN MoMo',country:'Ghana',currency:'GHS',flag:'🇬🇭',color:'#ffc403',logo:'MTN'},{id:'vodafone_gh',name:'Vodafone Cash',country:'Ghana',currency:'GHS',flag:'🇬🇭',color:'#e60000',logo:'VF'},{id:'mpesa',name:'M-Pesa Kenya',country:'Kenya',currency:'KES',flag:'🇰🇪',color:'#00a650',logo:'MP'},{id:'kcb',name:'KCB Bank',country:'Kenya',currency:'KES',flag:'🇰🇪',color:'#006633',logo:'KCB'},{id:'fnb',name:'FNB',country:'South Africa',currency:'ZAR',flag:'🇿🇦',color:'#008c44',logo:'FNB'},{id:'absa',name:'ABSA',country:'South Africa',currency:'ZAR',flag:'🇿🇦',color:'#dc0032',logo:'AB'},{id:'mpesa_tz',name:'M-Pesa TZ',country:'Tanzania',currency:'TZS',flag:'🇹🇿',color:'#00a650',logo:'MP'},{id:'mtn_ug',name:'MTN Uganda',country:'Uganda',currency:'UGX',flag:'🇺🇬',color:'#ffc403',logo:'MTN'},{id:'upi',name:'UPI / PhonePe',country:'India',currency:'INR',flag:'🇮🇳',color:'#5f259f',logo:'UPI'},{id:'jazzcash',name:'JazzCash',country:'Pakistan',currency:'PKR',flag:'🇵🇰',color:'#f01c1c',logo:'JC'},{id:'bkash',name:'bKash',country:'Bangladesh',currency:'BDT',flag:'🇧🇩',color:'#e2136e',logo:'bK'}];

function renderPaymentMethodSelector(q) {
  const box = g('paymentMethodBox');
  const filtered = q ? PAYMENT_METHODS.filter(m => (m.name+m.country+m.currency+m.flag).toLowerCase().includes(q.toLowerCase())) : PAYMENT_METHODS;
  box.innerHTML = filtered.slice(0,20).map(m => `<div class="pm-item ${state.selectedPayment?.id===m.id?'selected':''}" onclick="selectPayment('${m.id}')">
    <div class="pm-logo" style="background:${m.color}">${m.logo}</div>
    <div class="pm-info"><div class="pm-name">${m.flag} ${m.name}</div><div class="pm-meta">${m.country} · ${m.currency}</div></div>
  </div>`).join('');
}
function selectPayment(id) {
  state.selectedPayment = PAYMENT_METHODS.find(m => m.id === id);
  if (!state.selectedPayment) return;
  renderPaymentMethodSelector(g('bankSearchInput')?.value || '');
  g('bankAccountFields').classList.remove('hidden');
  g('localCurrencyDisplay').innerHTML = `<strong>${state.selectedPayment.flag} ${state.selectedPayment.name}</strong> · ${state.selectedPayment.currency} selected`;
  onWithdrawInput();
}
function setWithdrawType(t) {
  state.withdrawType = t; state.selectedPayment = null;
  g('btnCrypto').classList.toggle('active', t==='crypto');
  g('btnBank').classList.toggle('active', t==='bank');
  g('cryptoFields').classList.toggle('hidden', t==='bank');
  g('bankFields').classList.toggle('hidden', t==='crypto');
  if (t === 'bank') { renderPaymentMethodSelector(''); g('bankAccountFields').classList.add('hidden'); }
  onWithdrawInput();
}
function selectNetwork(el) {
  if (el.dataset.soon) return;
  document.querySelectorAll('.net-opt').forEach(e => e.classList.remove('active'));
  el.classList.add('active');
  state.selectedNetwork = el.dataset.n;
}
function setPct(p) {
  const v = Math.min(MAX_WD, Math.max(MIN_WD, Math.floor(state.balance * p / 100)));
  const inp = g('withdrawAmount'); if (inp) { inp.value = v; updateFees(); }
}
function updateFees() {
  const amt = parseFloat(g('withdrawAmount')?.value || 0);
  const fee = Math.round(amt * 0.04 * 100) / 100;
  if (g('feeAmt'))          g('feeAmt').textContent          = `${amt.toFixed(2)} USDT`;
  if (g('gatewayFeeDisplay'))g('gatewayFeeDisplay').textContent = `${fee.toFixed(2)} USDT`;
  if (g('totalFeeDisplay')) g('totalFeeDisplay').textContent  = `${fee.toFixed(2)} USDT`;
  onWithdrawInput();
}
function onWithdrawInput() {
  const amt  = parseFloat(g('withdrawAmount')?.value || 0);
  const btn  = g('withdrawBtn');
  if (!btn) return;
  const okCrypto = state.withdrawType === 'crypto' && (g('withdrawAddress')?.value || '').length > 10;
  const okBank   = state.withdrawType === 'bank' && state.selectedPayment && (g('bankAccount')?.value || '').length > 3;
  btn.disabled = !(amt >= MIN_WD && amt <= MAX_WD && amt <= state.balance && (okCrypto || okBank));
}
async function submitWithdrawal() {
  const amt    = parseFloat(g('withdrawAmount')?.value || 0);
  const isBank = state.withdrawType === 'bank';
  const body   = isBank ? {
    amount: amt, isBankWithdrawal: true,
    bankName:       state.selectedPayment?.name,
    bankCountry:    state.selectedPayment?.country,
    localCurrency:  state.selectedPayment?.currency,
    accountNumber:  g('bankAccount')?.value,
    accountName:    g('bankName')?.value,
    method:         state.selectedPayment?.id
  } : {
    amount: amt, isBankWithdrawal: false,
    toAddress: g('withdrawAddress')?.value,
    network:   state.selectedNetwork
  };

  const btn = g('withdrawBtn');
  btn.textContent = 'Processing...'; btn.disabled = true;

  const r = await post('/withdraw', body);
  if (r.success) {
    state.balance -= amt;
    state.withdrawals.push(r.withdrawal);
    state.pendingWithdrawal = r.withdrawal;
    updateUI();
    showFeePayPage(r.withdrawal, r.fees);
  } else {
    toast(r.error || 'Withdrawal failed');
    btn.textContent = 'Continue to Payment'; btn.disabled = false;
  }
}
function showFeePayPage(wd, fees) {
  const fee = fees?.total_fee || fees?.fee || (wd.amount * 0.04).toFixed(2);
  g('feePayBox').innerHTML = `<div class="fee-pay-box">
    <div style="padding:20px;text-align:center;background:linear-gradient(145deg,#0d1f45,#0d1a35)">
      <div style="font-size:32px;margin-bottom:8px">💸</div>
      <h3 style="color:#f0f4ff;font-size:17px;margin-bottom:4px">Withdrawal Submitted</h3>
      <p style="color:#7a90b0;font-size:12px">Withdrawal #${wd.id} · ${wd.amount} USDT</p>
    </div>
    <div style="padding:16px;display:flex;flex-direction:column;gap:14px">
      <div style="background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.25);border-radius:12px;padding:14px;font-size:13px;color:#f59e0b;line-height:1.6">
        ⚠️ To finalize your withdrawal, please pay the gateway fee to your TRC20 address below.
      </div>
      <div class="fee-addr-box">
        <div class="fee-addr-label">Send exactly <strong>${fee} USDT</strong> (TRC20) to:</div>
        <div class="fee-addr-val">${state.trc20Address}</div>
        <button class="copy-mini-btn" style="margin:0 auto;display:block;padding:8px 20px" onclick="copyText('${state.trc20Address}');toast('Address copied!')">Copy Address</button>
      </div>
      <div class="form-group"><label>Upload Payment Receipt</label>
        <label class="upload-drop" for="receiptFile">
          <svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <span id="receiptLabel">Tap to upload receipt</span>
          <input type="file" id="receiptFile" accept="image/*" onchange="previewReceipt(this)" style="display:none"/>
        </label>
        <img id="receiptPreview" style="display:none;width:100%;border-radius:10px;margin-top:10px;max-height:200px;object-fit:contain"/>
      </div>
      <button id="submitReceiptBtn" class="btn-primary w100" onclick="submitReceipt(${wd.id})" disabled>Submit Receipt for Review</button>
    </div>
  </div>`;
  showPage('fee-pay');
}
function previewReceipt(input) {
  const file = input.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = e => {
    const img = g('receiptPreview'); img.src = e.target.result; img.style.display = 'block';
    g('receiptLabel').textContent = file.name;
    g('submitReceiptBtn').disabled = false;
    document.querySelector('.upload-drop').style.borderColor = '#22c55e';
  };
  r.readAsDataURL(file);
}
async function submitReceipt(wrId) {
  const fi = g('receiptFile'), btn = g('submitReceiptBtn');
  if (!fi?.files[0]) return toast('Please upload a receipt');
  btn.textContent = 'Submitting...'; btn.disabled = true;
  // Show progress updates so user knows it hasn't frozen
  let dots = 0;
  const submitTimer = setInterval(() => {
    dots = (dots + 1) % 4;
    btn.textContent = 'Submitting' + '.'.repeat(dots+1);
  }, 800);
  const r = new FileReader();
  r.onload = async e => {
    const res = await post('/receipt', { withdrawalId: wrId, receiptBase64: e.target.result });
    if (res.success) {
      g('feePayBox').innerHTML = `<div style="text-align:center;padding:48px 20px"><div class="success-check">✓</div><h3 style="color:#22c55e;margin:16px 0 8px">Receipt Submitted!</h3><p style="color:#7a90b0;font-size:13px">Your withdrawal is under review.<br>You'll be notified once approved.</p><button class="btn-primary mt12 w100" onclick="showPage('home')">Back to Home</button></div>`;
      state.pendingWithdrawal = null;
    } else { toast('Error: ' + (res.error || 'Failed')); btn.textContent = 'Submit Receipt for Review'; btn.disabled = false; }
  };
  r.readAsDataURL(fi.files[0]);
}

// ── VIP ───────────────────────────────────────────────────────────────────────
function showVIPUpgrade() { showPage('vip'); }
function renderVIPPage() {
  g('vipPageContent').innerHTML = `<div class="vip-upgrade-card">
    <div class="vuc-header">
      <div class="vuc-crown"><svg width="32" height="32" fill="none" stroke="#f59e0b" stroke-width="1.8" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></div>
      <h3>VIP Membership</h3><p>One-time 200 USDT deposit · Lifetime VIP benefits</p>
    </div>
    <div class="vuc-benefits">
      <div class="vuc-benefit"><div class="vub-check">✓</div><div><div class="vub-title">200 USDT Every Hour</div><div class="vub-sub">4x more than standard</div></div></div>
      <div class="vuc-benefit"><div class="vub-check">✓</div><div><div class="vub-title">Global Bank Withdrawal</div><div class="vub-sub">Withdraw to any bank in 30+ countries</div></div></div>
      <div class="vuc-benefit"><div class="vub-check">✓</div><div><div class="vub-title">Priority Support</div><div class="vub-sub">Faster replies from support team</div></div></div>
    </div>
    <div class="vuc-steps">
      <div class="vuc-step-title">How to Upgrade</div>
      <div class="vuc-step"><span class="vus-num">1</span><span>Send exactly <strong>200 USDT</strong> on TRC20 to the address below</span></div>
      <div class="vuc-step"><span class="vus-num">2</span><span>Screenshot your payment confirmation</span></div>
      <div class="vuc-step"><span class="vus-num">3</span><span>Submit the screenshot — activated within minutes</span></div>
    </div>
    <div class="vuc-addr-box">
      <div class="vuc-addr-label">Send 200 USDT (TRC20) to:</div>
      <div class="vuc-addr">${state.trc20Address}</div>
      <button class="btn-outline w100" onclick="copyText('${state.trc20Address}');toast('Address copied!')">Copy Address</button>
    </div>
    <div class="vuc-upload-section">
      <div class="vuc-upload-title">Submit Payment Receipt</div>
      <label class="upload-drop" for="vipReceiptFile">
        <svg width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        <span id="vipUploadLabel">Tap to upload payment screenshot</span>
        <input type="file" id="vipReceiptFile" accept="image/*" onchange="previewVIPReceipt(this)" style="display:none"/>
      </label>
      <img id="vipReceiptPreview" style="display:none;width:100%;border-radius:10px;margin-top:10px;max-height:200px;object-fit:contain"/>
    </div>
    <button id="submitVIPBtn" class="btn-primary w100" onclick="submitVIPReceipt()" disabled style="margin:0 16px 16px;width:calc(100% - 32px)">Submit for VIP Activation</button>
  </div>`;
}
function previewVIPReceipt(input) {
  const file = input.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = e => { const img = g('vipReceiptPreview'); img.src=e.target.result; img.style.display='block'; g('vipUploadLabel').textContent=file.name; g('submitVIPBtn').disabled=false; };
  r.readAsDataURL(file);
}
async function submitVIPReceipt() {
  const fi = g('vipReceiptFile'), btn = g('submitVIPBtn');
  if (!fi?.files[0]) return toast('Please upload receipt first');
  btn.textContent = 'Submitting...'; btn.disabled = true;
  // Show progress updates so user knows it hasn't frozen
  let dots = 0;
  const submitTimer = setInterval(() => {
    dots = (dots + 1) % 4;
    btn.textContent = 'Submitting' + '.'.repeat(dots+1);
  }, 800);
  const reader = new FileReader();
  reader.onload = async e => {
    const res = await post('/vip-upgrade', { receiptBase64: e.target.result, uid: state.uid });
    if (res.success) {
      g('vipPageContent').innerHTML = `<div style="text-align:center;padding:48px 20px"><div class="success-check">✓</div><h3 style="color:#22c55e;margin:16px 0 8px">Receipt Submitted!</h3><p style="color:#7a90b0;font-size:13px">Your VIP upgrade is under review.<br>You will be notified once approved.</p><button class="btn-primary mt12 w100" onclick="showPage('home')">Back to Home</button></div>`;
      toast('VIP receipt submitted!');
    } else { toast(res.error || 'Submission failed'); btn.textContent = 'Submit for VIP Activation'; btn.disabled = false; }
  };
  reader.readAsDataURL(fi.files[0]);
}

// ── Referral ──────────────────────────────────────────────────────────────────
function renderReferralPage() {
  const refLink = `https://t.me/walletmastersbot?start=ref_${state.referralCode||state.uid}`;
  g('referralPageContent').innerHTML = `<div class="referral-card">
    <div class="ref-header"><div class="ref-icon">🎁</div><h3>Refer &amp; Earn</h3><p>Earn <strong>200 USDT</strong> for every friend who joins using your referral link</p></div>
    <div class="ref-stats-row">
      <div class="ref-stat"><div class="ref-stat-val">${state.referralCount||0}</div><div class="ref-stat-lbl">Referrals</div></div>
      <div class="ref-stat"><div class="ref-stat-val">${((state.referralCount||0)*200).toLocaleString()}</div><div class="ref-stat-lbl">USDT Earned</div></div>
    </div>
    <div class="ref-link-box">
      <div class="ref-link-label">Your Referral Link</div>
      <div class="ref-link-val">${refLink}</div>
      <button class="btn-primary w100" onclick="copyText('${refLink}');toast('Referral link copied!')">Copy Referral Link</button>
    </div>
    <div class="ref-share-btn-row"><button class="btn-outline w100" onclick="shareReferral('${refLink}')">Share via Telegram</button></div>
  </div>`;
}
function shareReferral(link) {
  const text = encodeURIComponent(`💎 Join Wallet Masters and start earning USDT!\n\nEarn 50 USDT every hour. VIP members earn 200 USDT/hr!\n\n👇 Join here:\n${link}`);
  if (tg.openTelegramLink) tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${text}`);
  else copyText(link);
}

// ── QR Code ───────────────────────────────────────────────────────────────────
function generateQR(text) {
  const c = g('qrCanvas'); if (!c || !text) return; c.innerHTML = '';
  try { new QRCode(c, { text, width: 200, height: 200, colorDark: '#000', colorLight: '#fff', correctLevel: QRCode.CorrectLevel.M }); }
  catch(e) { c.innerHTML = `<div style="padding:16px;word-break:break-all;font-size:10px">${text}</div>`; }
}

// ── Connect Apps ──────────────────────────────────────────────────────────────
async function loadEarningApps() {
  try { const r = await fetch(`${API}/apps`); state.earningApps = await r.json(); } catch(e) {}
}
function renderConnect() {
  const grid = g('appsGrid');
  if (!state.earningApps?.length) { grid.innerHTML = '<div class="empty-tx">No apps available yet</div>'; return; }
  grid.innerHTML = state.earningApps.map(app => `<div class="app-card" onclick="openModal(${app.id},'${app.name.replace(/'/g,"\\'")}')">
    <div class="app-logo">${app.name[0].toUpperCase()}</div>
    <div class="app-info"><div class="app-name">${app.name}</div><div class="app-desc">${app.description||'Earning App'}</div></div>
    <div class="app-status ${isConnected(app.id)?'connected':''}">${isConnected(app.id)?'Connected':'Connect'}</div>
  </div>`).join('');
}
function isConnected(appId) { return state.connections.some(c => c.app_id === appId); }
let _connectAppId = null;
function openModal(appId, appName) {
  _connectAppId = appId;
  g('modalTitle').textContent = `Connect to ${appName}`;
  g('modalUID').value = ''; g('uidErr').classList.add('hidden');
  g('connectModal').classList.remove('hidden');
  setTimeout(() => g('modalUID').focus(), 100);
}
function closeModal() { g('connectModal').classList.add('hidden'); _connectAppId = null; }
async function submitUID() {
  const uid = (g('modalUID')?.value || '').trim();
  const err = g('uidErr'), btn = g('connectBtn');
  if (!uid || uid.length < 3) { if(err){err.textContent='Please enter a valid UID';err.classList.remove('hidden');} return; }
  if (err) err.classList.add('hidden');
  btn.textContent = 'Connecting...'; btn.disabled = true;
  // FIX: include initData header
  const r = await post('/connect-uid', { appId: _connectAppId, uid, external_uid: uid });
  if (r.success) {
    state.connections.push({ app_id: _connectAppId });
    closeModal(); renderConnect(); toast('Connected successfully!');
  } else { if(err){err.textContent=r.error||'Connection failed';err.classList.remove('hidden');} }
  btn.textContent = 'Connect'; btn.disabled = false;
}

// ── Support ───────────────────────────────────────────────────────────────────
async function loadSupportMessages() {
  const tid = state.user?.telegramId || tgU?.id;
  if (!tid) return;
  try {
    const msgs = await fetch(`${API}/support/messages?telegramId=${tid}`, { headers: { 'x-telegram-init-data': getInitData() } }).then(r => r.json());
    const box  = g('supportMsgs');
    if (!box) return;
    if (!msgs?.length) { box.innerHTML = '<div class="empty-tx">Send us a message — we\'re here to help!</div>'; return; }
    box.innerHTML = msgs.map(m => `<div class="msg-bubble ${m.from_admin?'msg-them':'msg-me'}">
      ${m.message}
      <div class="msg-time">${fmtDate(m.created_at)}</div>
    </div>`).join('');
  } catch(e) {}
}
function scrollSupportToBottom() { const b = g('supportMsgs'); if (b) b.scrollTop = b.scrollHeight; }
async function sendSupport() {
  const inp = g('supportInput');
  const msg = (inp?.value || '').trim();
  if (!msg) return;
  inp.value = '';
  const r = await post('/support/send', { message: msg });
  if (r.success) { await loadSupportMessages(); scrollSupportToBottom(); }
  else toast('Failed to send');
}

// ── Testimonials ──────────────────────────────────────────────────────────────
async function loadTestimonialsPage() {
  try {
    const r = await fetch(`${API}/testimonials`).then(r => r.json());
    const list = g('testimonialsList');
    if (!list) return;
    const items = Array.isArray(r) ? r : (r.testimonials || []);
    if (!items.length) { list.innerHTML = '<div class="empty-tx">No testimonials yet. Be the first!</div>'; return; }
    list.innerHTML = items.map(t => `<div class="test-item">
      <div class="test-item-header">
        <div class="test-avatar">${(t.user_name||'U')[0]}</div>
        <div><div class="test-name">${t.user_name||'User'}</div><div class="test-type">${t.type==='youtube'?'📺 YouTube':'🎥 Video'}</div></div>
      </div>
      ${t.caption?`<div class="test-caption">${t.caption}</div>`:''}
      ${t.message?`<div class="test-caption" style="font-style:italic;color:#c0cce8">"${t.message}"</div>`:''}
      ${t.location?`<div style="font-size:11px;color:#7a90b0;margin-top:4px">${t.country_flag||''} ${t.location}</div>`:''}
      ${t.amount?`<div style="font-size:12px;color:#22c55e;font-weight:700;margin-top:4px">💰 ${t.amount}</div>`:''}
      ${t.video_url&&t.video_url.includes('youtube')? getYouTubeEmbed(t.video_url)
        : t.video_url?`<a href="${t.video_url}" class="test-yt-link" target="_blank" onclick="event.stopPropagation()">▶ Watch Video</a>`:''}
    </div>`).join('');
  } catch(e) {}
}
function showTestimonialSubmit(type) {
  const modal = document.createElement('div');
  modal.id = 'testimonialModal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `<div class="modal-box">
    <div class="modal-title">${type==='youtube'?'📺 Submit YouTube Link':'🎥 Upload Video Testimonial'}</div>
    ${type==='youtube' ? `<div class="form-group"><label>YouTube URL</label><input id="tesYT" type="url" placeholder="https://youtube.com/..."/></div>` : `<div class="form-group"><label>Video File</label><label class="upload-drop" for="tesVideo"><svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><span id="tesVideoLabel">Tap to select video</span><input type="file" id="tesVideo" accept="video/*" style="display:none" onchange="document.getElementById('tesVideoLabel').textContent=this.files[0]?.name||'Selected'"/></label></div>`}
    <div class="form-group"><label>Caption (optional)</label><input id="tesCaption" type="text" placeholder="Brief description..."/></div>
    <div style="display:flex;gap:10px;margin-top:16px">
      <button class="btn-outline" style="flex:1" onclick="document.getElementById('testimonialModal').remove()">Cancel</button>
      <button class="btn-primary" style="flex:1" id="tesSubmitBtn" onclick="doSubmitTestimonial('${type}')">Submit</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
}
async function doSubmitTestimonial(type) {
  const btn     = g('tesSubmitBtn');
  const caption = (g('tesCaption')?.value || '').trim();
  const ytUrl   = (g('tesYT')?.value    || '').trim();
  const vidFile = g('tesVideo')?.files?.[0];

  if (type === 'youtube' && !ytUrl) return toast('Please enter a YouTube URL');
  if (type === 'video'   && !vidFile) return toast('Please select a video file');

  btn.textContent = 'Uploading...'; btn.disabled = true;
  let tesDots = 0;
  const tesTimer = setInterval(() => {
    tesDots = (tesDots + 1) % 4;
    btn.textContent = 'Uploading' + '.'.repeat(tesDots+1);
  }, 800);

  try {
    const body = { type, caption, youtubeUrl: ytUrl };
    if (vidFile) {
      // Convert video to base64 BEFORE submitting
      body.videoData     = await new Promise(res => { const r = new FileReader(); r.onload = e => res(e.target.result); r.readAsDataURL(vidFile); });
      body.videoFileName = vidFile.name;
    }
    // Use 60s timeout for video uploads
    const r = await post('/testimonial/submit', body, 60000);
    clearInterval(tesTimer);
    if (r.success || Object.keys(r).length === 0 || r._netError) {
      btn.textContent = 'Submitted! ✓';
      toast('Testimonial submitted! Admin will review shortly. ✅');
      setTimeout(() => { const m = g('testimonialModal'); if(m) m.remove(); }, 1500);
    } else {
      clearInterval(tesTimer);
      toast(r.error || 'Submission failed. Please try again.');
      btn.textContent = 'Submit'; btn.disabled = false;
    }
  } catch(e) {
    toast('Submission failed. Check your connection and try again.');
    btn.textContent = 'Submit'; btn.disabled = false;
  }
}

// ── POEMS ─────────────────────────────────────────────────────────────────────
async function loadPoems() {
  const list = g('poemList');
  if (!list) return;
  list.innerHTML = '<div class="empty-tx">Loading...</div>';
  try {
    const r = await fetch(`${API}/poems`).then(r => r.json());
    state.allPoems = r.poems || [];
    renderPoems(state.allPoems);
  } catch(e) { list.innerHTML = '<div class="empty-tx">Could not load posts</div>'; }
}
function renderPoems(poems) {
  const list = g('poemList'); if (!list) return;
  if (!poems.length) { list.innerHTML = '<div class="empty-tx">No posts yet. Be the first to share!</div>'; return; }
  list.innerHTML = poems.map(p => `<div class="poem-card">
    <div class="poem-card-header">
      <div class="poem-author-av">${(p.user_name||'U')[0]}</div>
      <div><div class="poem-author">${p.user_name||'User'}</div><div class="poem-cat">${p.category||'General'}</div></div>
    </div>
    ${p.title?`<div class="poem-title-text">${p.title}</div>`:''}
    <div class="poem-body">${(p.content||'').substring(0,500)}${(p.content||'').length>500?'...':''}</div>
  </div>`).join('');
}
function filterPoems(cat, btn) {
  document.querySelectorAll('.poem-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const filtered = cat === 'all' ? state.allPoems : state.allPoems.filter(p => p.category === cat);
  renderPoems(filtered);
}
function selectPoemCat(cat, btn) {
  state.poemCategory = cat;
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}
async function submitPoem() {
  const content = (g('poemContent')?.value || '').trim();
  const title   = (g('poemTitle')?.value   || '').trim();
  if (content.length < 20) return toast('Please write at least 20 characters');
  const btn = g('submitPoemBtn');
  btn.textContent = 'Submitting...'; btn.disabled = true;
  // Show progress updates so user knows it hasn't frozen
  let dots = 0;
  const submitTimer = setInterval(() => {
    dots = (dots + 1) % 4;
    btn.textContent = 'Submitting' + '.'.repeat(dots+1);
  }, 800);
  const r = await post('/poem/submit', { content, title, category: state.poemCategory });
  if (r.success) {
    g('poemContent').value = ''; g('poemTitle').value = '';
    btn.textContent = '✓ Submitted!';
    toast('Submitted! Earn 1,000 USDT once approved 🎉');
    setTimeout(() => { btn.textContent = 'Submit for Review'; btn.disabled = false; showPage('poems'); }, 2000);
  } else { toast(r.error || 'Submission failed'); btn.textContent = 'Submit for Review'; btn.disabled = false; }
}

// ── SOCIALPAY ─────────────────────────────────────────────────────────────────
async function loadSocialFeed() {
  const feed = g('spFeed'); if (!feed) return;
  feed.innerHTML = '<div class="empty-tx">Loading...</div>';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const r = await fetch(`${API}/socialpay/posts`, {
      headers: { 'x-telegram-init-data': getInitData() },
      signal: controller.signal
    }).then(res => { clearTimeout(timer); return res.json(); });
    state.spPosts = r.posts || [];
    if (state.spPosts.length === 0) {
      feed.innerHTML = '<div class="empty-tx" style="padding:40px 16px">No approved posts yet.<br><small style="color:#7a90b0">Posts appear after admin approval.</small></div>';
    } else {
      renderSpFeed(state.spPosts);
    }
  } catch(e) {
    console.warn('SocialPay feed error:', e);
    // Retry once silently before showing error
    setTimeout(async () => {
      try {
        const r2 = await fetch(`${API}/socialpay/posts`, { headers: { 'x-telegram-init-data': getInitData() } }).then(res => res.json());
        state.spPosts = r2.posts || [];
        if (state.spPosts.length === 0) {
          feed.innerHTML = '<div class="empty-tx" style="padding:40px 16px">No approved posts yet.<br><small style="color:#7a90b0">Posts appear after admin approval.</small></div>';
        } else { renderSpFeed(state.spPosts); }
      } catch(e2) {
        feed.innerHTML = '<div class="empty-tx" style="color:#ef4444">Could not load feed.<br><button onclick="loadSocialFeed()" style="background:#2563eb;border:none;border-radius:8px;padding:8px 16px;color:#fff;font-size:13px;cursor:pointer;margin-top:8px">🔄 Retry</button></div>';
      }
    }, 2000);
  }
}
function formatCount(n) {
  n = Number(n) || 0;
  if (n >= 1000000000) return (n / 1000000000).toFixed(n % 1000000000 === 0 ? 0 : 1).replace(/\.0$/,'') + 'B';
  if (n >= 1000000)    return (n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1).replace(/\.0$/,'') + 'M';
  if (n >= 10000)      return (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1).replace(/\.0$/,'') + 'K';
  return n.toLocaleString();
}

async function loadPostImage(postId) {
  const wrap = document.getElementById(`img-wrap-${postId}`);
  if (!wrap || wrap.dataset.loaded) return;
  wrap.dataset.loaded = '1';
  wrap.innerHTML = '<div style="width:100%;height:180px;border-radius:12px;background:linear-gradient(90deg,#1a2a4a 25%,#243555 50%,#1a2a4a 75%);background-size:200% 100%;animation:imgShimmer 1.2s infinite"></div>';
  if (!document.getElementById('shimmerStyle')) {
    const s = document.createElement('style');
    s.id = 'shimmerStyle';
    s.textContent = '@keyframes imgShimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}';
    document.head.appendChild(s);
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const r = await fetch(`${API}/socialpay/post/${postId}`, {
      headers: { 'x-telegram-init-data': getInitData() },
      signal: controller.signal
    }).then(res => { clearTimeout(timer); return res.json(); });
    if (r.post && r.post.image_data) {
      const img = new Image();
      img.style.cssText = 'width:100%;border-radius:12px;max-height:300px;object-fit:cover;display:block';
      img.onload = () => { wrap.innerHTML = ''; wrap.appendChild(img); };
      img.onerror = () => { wrap.innerHTML = '<div style="text-align:center;padding:12px;color:#7a90b0;font-size:12px">📸 Image unavailable</div>'; };
      img.src = r.post.image_data;
    } else {
      wrap.innerHTML = '<div style="text-align:center;padding:12px;color:#7a90b0;font-size:12px">📸 Image unavailable</div>';
    }
  } catch(e) {
    wrap.dataset.loaded = '';
    wrap.innerHTML = `<div style="text-align:center;padding:12px;color:#7a90b0;font-size:11px;cursor:pointer" onclick="loadPostImage(${postId})">📸 Tap to load image ↺</div>`;
  }
}

function renderSpFeed(posts) {
  const feed = g('spFeed'); if (!feed) return;
  if (!posts.length) { feed.innerHTML = '<div class="empty-tx" style="padding:40px 16px">No posts yet. Be the first to post! 🌟</div>'; return; }
  feed.innerHTML = posts.map(p => spPostHTML(p)).join('');
}
function spPostHTML(p) {
  // Store caption for safe editing
  _postCaptions[p.id] = p.caption || '';
  const verBadge = p.author_gold ? `<span class="sp-verified sp-verified-gold">✓</span>` : (p.author_verified ? `<span class="sp-verified">✓</span>` : '');
  const adminLikes = ''; // admin likes no longer shown separately at top
  const totalLikes = (p.likes || 0) + (p.user_likes || 0);
  const userLikes  = ''; // combined into totalLikes below
  const likedCls   = p.liked_by_me ? 'liked' : '';
  return `<div class="sp-post-card">
    <div class="sp-post-top" onclick="viewSpProfile('${p.telegram_id}')">
      <div class="sp-avatar">${p.author_pic ? `<img src="${p.author_pic}" onerror="this.style.display='none'"/>` : (p.author_name||'U')[0]}</div>
      <div class="sp-name-row">
        <div class="sp-author">${p.author_name||'User'} ${verBadge}</div>
        <div class="sp-country">${p.author_country||''}</div>
      </div>
      ${adminLikes}
    </div>
    ${p.caption?`<div class="sp-caption">${p.caption}</div>`:''}
    ${(function(){if(!p.image_data&&!p.has_image)return '';const w='<div id="img-wrap-'+p.id+'" style="margin-bottom:10px">';if(p.image_data)return w+'<img src="'+p.image_data+'" style="width:100%;border-radius:12px;max-height:300px;object-fit:cover;display:block" onerror="this.style.display=\'none\'"/></div>';return w+'<div onclick="loadPostImage('+p.id+')" style="background:#131f35;border:1px dashed #2563eb;border-radius:12px;padding:20px;text-align:center;cursor:pointer;color:#7a90b0;font-size:13px">ð¸ Tap to view photo</div></div>';}())}
    ${p.has_voice?`<div class="sp-voice-player">🎙 Voice message${userLikes}</div>`:''}
    <div class="sp-actions">
      <button class="sp-like-btn ${likedCls}" onclick="likeSpPost(${p.id},this)">
        <svg width="18" height="18" fill="${p.liked_by_me?'#ef4444':'none'}" stroke="${p.liked_by_me?'#ef4444':'currentColor'}" stroke-width="2" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        ${formatCount(totalLikes)}
      </button>
      <button onclick="toggleComments(${p.id})" style="background:none;border:none;color:#7a90b0;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:4px">💬 Comments</button>
      ${String(p.telegram_id)===String(state.user?.telegramId||tgU?.id||'') ? `<button onclick="handleEditPost(${p.id})" style="background:none;border:none;color:#2563eb;font-size:12px;cursor:pointer">Edit</button>` : ''}
    </div>
    <div id="comments-${p.id}" style="margin-top:10px;display:none"></div>
  </div>`;
}
async function likeSpPost(postId, btn) {
  const r = await post('/socialpay/like', { post_id: postId });
  if (r.success) {
    btn.classList.add('liked');
    const svg = btn.querySelector('svg'); if (svg) { svg.setAttribute('fill','#ef4444'); svg.setAttribute('stroke','#ef4444'); }
    const p = state.spPosts.find(p => p.id === postId);
    if (p) { p.user_likes = (p.user_likes||0)+1; p.liked_by_me = true; btn.innerHTML = `<svg width="18" height="18" fill="#ef4444" stroke="#ef4444" stroke-width="2" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg> ${p.user_likes}`; }
  } else if (r.error) { toast(r.error); }
}
async function viewSpProfile(telegramId) {
  if (telegramId === String(state.user?.telegramId || tgU?.id)) { showPage('sp-profile-me'); return; }
  const c2 = g('spUserProfileContent');
  if (c2) c2.innerHTML = '<div class="empty-tx">Loading profile...</div>';
  showPage('sp-user-profile');
  try {
    const r = await fetch(`${API}/socialpay/profile/${telegramId}`).then(r => r.json());
    const c = g('spUserProfileContent'); if (!c) { console.error('spUserProfileContent missing'); return; }
    const prof  = r.profile || {};
    const posts = r.posts   || [];
    const verBadge = prof.is_gold_verified ? `<span class="sp-verified sp-verified-gold">✓</span>` : (prof.is_verified ? `<span class="sp-verified">✓</span>` : '');
    c.innerHTML = `<div class="sp-profile-header">
      <div class="sp-profile-av">${prof.profile_pic ? `<img src="${prof.profile_pic}"/>` : (prof.display_name||'U')[0]}</div>
      <div class="sp-profile-name">${prof.display_name||'User'} ${verBadge}</div>
      <div class="sp-profile-meta">${prof.country||''} ${prof.age?'· Age '+prof.age:''}</div>
      <div class="sp-profile-stats">
        <div class="sp-pstat"><div class="sp-pstat-val">${posts.length}</div><div class="sp-pstat-lbl">Posts</div></div>
        <div class="sp-pstat"><div class="sp-pstat-val">${formatCount(prof.total_likes||0)}</div><div class="sp-pstat-lbl">Likes</div></div>
        <div class="sp-pstat"><div class="sp-pstat-val">${formatCount(prof.followers||prof.total_likes||0)}</div><div class="sp-pstat-lbl">Followers</div></div>
      </div>
      ${prof.bio ? `<div style="font-size:13px;color:#c0cce8;text-align:center;margin-top:10px;padding:0 16px;line-height:1.5">${prof.bio}</div>` : ''}
    </div>
    <div class="sp-post-grid">${posts.length?posts.map(p=>`<div class="sp-post-card">${p.caption?`<div class="sp-caption">${p.caption}</div>`:''}<div class="sp-actions"><span class="sp-like-count">❤️ ${formatCount((p.likes||0)+(p.user_likes||0))} likes</span></div></div>`).join(''):'<div class="empty-tx">No posts yet</div>'}</div>`;
    showPage('sp-user-profile');
  } catch(e) { toast('Could not load profile'); }
}
async function loadMySpProfile() {
  try {
    const r = await fetch(`${API}/socialpay/my-profile`, { headers: { 'x-telegram-init-data': getInitData() } }).then(r => r.json());
    const c = g('mySpProfileContent'); if (!c) return;
    const prof  = r.profile || {};
    const posts = r.posts   || [];
    state._mySpProfile = prof;
    const verBadge = prof.is_gold_verified ? `<span class="sp-verified sp-verified-gold">✓</span>` : (prof.is_verified ? `<span class="sp-verified">✓</span>` : '');
    const verSection = prof.is_gold_verified
      ? `<div style="display:flex;gap:8px;flex-direction:column;align-items:center">
          <div style="background:linear-gradient(135deg,#f59e0b,#d97706);border-radius:20px;padding:6px 16px;color:#fff;font-size:13px;font-weight:600"><span style="background:#fff;color:#d97706;border-radius:50%;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;margin-right:4px">✓</span>Gold Verified · Legendary Earner</div>
         </div>`
      : prof.is_verified
        ? ((prof.total_likes||0) >= 500000
          ? (prof.gold_status === 'pending'
            ? `<div style="display:flex;gap:8px;flex-direction:column;align-items:center"><div class="sp-verify-badge">🟠 Verified Creator</div><div style="font-size:11px;color:#7a90b0">⏳ Gold verification pending</div></div>`
            : `<div style="display:flex;gap:8px;flex-direction:column;align-items:center"><div class="sp-verify-badge">🟠 Verified Creator</div><button style="background:linear-gradient(135deg,#f59e0b,#d97706);border:none;border-radius:20px;padding:7px 18px;color:#fff;font-size:12px;font-weight:600;cursor:pointer" onclick="applyForVerification('gold')"><span style="background:#fff;color:#d97706;border-radius:50%;width:14px;height:14px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;margin-right:4px">✓</span>Apply for Gold Badge</button></div>`)
          : `<div style="display:flex;gap:8px;flex-direction:column;align-items:center"><div class="sp-verify-badge">🟠 Verified Creator</div><div style="font-size:11px;color:#7a90b0">Need 500K likes for Gold badge (${((prof.total_likes||0)/1000).toFixed(0)}K / 500K)</div></div>`)
        : ((prof.total_likes||0) >= 1000
          ? (prof.verification_status === 'pending'
            ? `<div class="sp-verify-badge">⏳ Verification Pending</div>`
            : `<button class="sp-verify-btn" onclick="applyForVerification('orange')">Apply for Verified Badge</button>`)
          : `<div style="font-size:12px;color:#7a90b0;text-align:center">Get 1,000 likes to apply for verified badge</div>`);
    c.innerHTML = `<div class="sp-profile-header">
      <div class="sp-profile-av">${prof.profile_pic ? `<img src="${prof.profile_pic}"/>` : (prof.display_name||'U')[0]}</div>
      <div class="sp-profile-name">${prof.display_name||'User'} ${verBadge}</div>
      <div class="sp-profile-meta">${prof.country||''} ${prof.age?'· Age '+prof.age:''}</div>
      <div class="sp-profile-stats">
        <div class="sp-pstat"><div class="sp-pstat-val">${posts.filter(p=>p.status==='approved').length}</div><div class="sp-pstat-lbl">Posts</div></div>
        <div class="sp-pstat"><div class="sp-pstat-val">${formatCount(prof.total_likes||0)}</div><div class="sp-pstat-lbl">Likes</div></div>
        <div class="sp-pstat"><div class="sp-pstat-val">${formatCount(prof.followers||prof.total_likes||0)}</div><div class="sp-pstat-lbl">Followers</div></div>
      </div>
      ${verSection}
      <div style="display:flex;gap:8px;margin-top:12px;justify-content:center;flex-wrap:wrap">
        <button class="sp-edit-btn" onclick="showPage('sp-edit-profile')">✏️ Edit Profile</button>
        <button class="sp-post-btn" onclick="showPage('sp-compose')">+ New Post</button>
        ${prof.is_gold_verified ? `<button onclick="openDMList()" style="background:linear-gradient(135deg,#f59e0b,#d97706);border:none;border-radius:20px;padding:8px 16px;color:#fff;font-size:13px;font-weight:600;cursor:pointer">💬 Messages</button>` : ''}
      </div>
      ${prof.bio ? `<div style="font-size:13px;color:#c0cce8;text-align:center;margin-top:10px;padding:0 16px;line-height:1.5">${prof.bio}</div>` : ''}
    </div>
    <div class="sp-post-grid">${posts.length?posts.map(p=>`<div class="sp-post-card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-size:11px;color:${p.status==='approved'?'#22c55e':p.status==='rejected'?'#ef4444':'#f59e0b'}">${p.status==='approved'?'✅ Live':p.status==='rejected'?'❌ Rejected':'⏳ Pending'}</span>
        <span style="font-size:11px;color:#7a90b0">❤️ ${formatCount(p.likes||0)} admin · ${formatCount(p.user_likes||0)} user</span>
      </div>
      ${p.caption?`<div class="sp-caption" style="font-size:13px">${p.caption.substring(0,150)}</div>`:''}
      ${p.total_earned>0?`<div style="color:#22c55e;font-size:12px;margin-top:6px;font-weight:600">💰 Earned: ${p.total_earned.toLocaleString()} USDT</div>`:''}
    </div>`).join(''):'<div class="empty-tx">No posts yet. Create your first post!</div>'}</div>`;
  } catch(e) { const c=g('mySpProfileContent'); if(c) c.innerHTML='<div class="empty-tx">Could not load profile</div>'; }
}
async function loadMySpPosts() {
  await loadMySpProfile();
}
function renderSpEditProfile() {
  const c = g('spEditProfileContent'); if (!c) return;
  c.innerHTML = `
    <div class="form-group">
      <label>Profile Picture</label>
      <label class="upload-drop" for="spPicFile" style="flex-direction:row;gap:12px;padding:12px 16px">
        <div id="spPicPreviewWrap" style="width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#2563eb,#7c3aed);display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;color:#fff;overflow:hidden;flex-shrink:0">
          ${state._mySpProfile?.profile_pic ? `<img src="${state._mySpProfile.profile_pic}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>` : (state._mySpProfile?.display_name||'U')[0]}
        </div>
        <span id="spPicLabel">Tap to upload profile picture</span>
        <input type="file" id="spPicFile" accept="image/*" onchange="previewSpPic(this)" style="display:none"/>
      </label>
    </div>
    <div class="form-group"><label>Display Name</label><input id="spEditName" type="text" placeholder="Your name on SocialPay" value="${state._mySpProfile?.display_name||''}"/></div>
    <div class="form-group"><label>Country</label><input id="spEditCountry" type="text" placeholder="Your country" value="${state._mySpProfile?.country||''}"/></div>
    <div class="form-group"><label>Age</label><input id="spEditAge" type="number" placeholder="Your age" min="18" max="100" value="${state._mySpProfile?.age||''}"/></div>
    ${(state._mySpProfile?.is_verified||state._mySpProfile?.is_gold_verified) ? `<div class="form-group"><label>Bio (Verified users only)</label><textarea id="spEditBio" placeholder="Tell people about yourself..." style="min-height:80px">${state._mySpProfile?.bio||''}</textarea></div>` : ''}
    <button class="btn-primary w100" onclick="saveSpProfile()">Save Profile</button>`;
}
let _spNewPicData = null;
function previewSpPic(input) {
  const file = input.files[0]; if(!file) return;
  const lbl = g('spPicLabel'); if(lbl) lbl.textContent = 'Processing...';
  const r = new FileReader();
  r.onload = e => {
    // Compress image to max 400px circle - reduces from MBs to ~30KB
    const img = new Image();
    img.onload = () => {
      const MAX = 400;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      _spNewPicData = canvas.toDataURL('image/jpeg', 0.75);
      const wrap = g('spPicPreviewWrap');
      if(wrap) wrap.innerHTML = `<img src="${_spNewPicData}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;
      if(lbl) lbl.textContent = 'Photo selected ✓';
    };
    img.src = e.target.result;
  };
  r.readAsDataURL(file);
}
async function saveSpProfile() {
  const name    = (g('spEditName')?.value    || '').trim();
  const country = (g('spEditCountry')?.value || '').trim();
  const age     = (g('spEditAge')?.value     || '').trim();
  const bio     = (g('spEditBio')?.value     || '').trim();
  const body    = { display_name: name, country, age };
  if (_spNewPicData) body.profile_pic = _spNewPicData;
  // Only include bio if non-empty AND user is verified (unverified users get 403 for bio)
  if (bio && bio.length > 0 && state._mySpProfile?.is_verified) body.bio = bio;
  try {
    // Use 30s timeout when uploading profile picture (compressed but still needs time)
    const r = await post('/socialpay/profile', body, _spNewPicData ? 30000 : 15000);
    if (r.success) {
      _spNewPicData = null;
      if (r.profile) state._mySpProfile = r.profile;
      toast('Profile updated! ✅');
      showPage('sp-profile-me');
    } else if (r._netError) {
      // Network timeout but server likely saved it - treat as success
      _spNewPicData = null;
      toast('Profile updated! ✅');
      showPage('sp-profile-me');
      // Reload profile in background to confirm
      setTimeout(() => loadMySpProfile(), 2000);
    } else toast(r.error || 'Profile update failed. Please try again.');
  } catch(e) { toast('Profile update failed. Please try again.'); }
}

function selectPostType(type, btn) {
  state.spPostType = type;
  document.querySelectorAll('.pt-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  g('spImageUpload').style.display = type === 'photo' ? 'flex' : 'none';
  g('spVoiceUpload').style.display = type === 'voice' ? 'flex' : 'none';
}
function previewSpImage(input) {
  const file = input.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = e => { state.spImageData = e.target.result; const img = g('spImgPreview'); img.src = e.target.result; img.style.display = 'block'; g('spImgLabel').textContent = file.name; };
  r.readAsDataURL(file);
}
function previewSpVoice(input) {
  const file = input.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = e => { state.spVoiceData = e.target.result; g('spVoiceLabel').textContent = file.name; const ind = g('spVoiceIndicator'); ind.style.display = 'block'; ind.textContent = `🎙 Voice ready: ${file.name}`; };
  r.readAsDataURL(file);
}
async function submitSocialPost() {
  const caption = (g('spCaption')?.value || '').trim();
  if (caption.length < 5) return toast('Please write a caption (min 5 characters)');
  const btn = g('submitSpBtn');
  btn.textContent = 'Submitting...'; btn.disabled = true;
  // Show progress updates so user knows it hasn't frozen
  let dots = 0;
  const submitTimer = setInterval(() => {
    dots = (dots + 1) % 4;
    btn.textContent = 'Submitting' + '.'.repeat(dots+1);
  }, 800);
  const body = { caption, post_type: state.spPostType };
  if (state.spPostType === 'photo' && state.spImageData) body.image_data = state.spImageData;
  if (state.spPostType === 'voice' && state.spVoiceData) body.voice_data = state.spVoiceData;
  // 45s timeout for posts with images/voice (base64 payloads are large)
  const r = await post('/socialpay/post', body, 45000);
  // Empty response = network timeout but server likely saved it - treat as success
  clearInterval(submitTimer);
  const success = r.success || (body.image_data && Object.keys(r).length === 0) || (r._netError && body.image_data);
  if (success) {
    g('spCaption').value = ''; state.spImageData = null; state.spVoiceData = null;
    btn.textContent = '✓ Submitted!';
    toast('Post submitted for review! 🌟');
    setTimeout(() => { btn.textContent = 'Submit Post'; btn.disabled = false; showPage('socialpay'); }, 2000);
  } else { clearInterval(submitTimer); toast(r.error || 'Submission failed. Please try again.'); btn.textContent = 'Submit Post'; btn.disabled = false; }
}
async function applyForVerification(type) {
  const r = await post('/socialpay/apply-verification', { type: type||'orange' });
  if (r.success) { toast(type==='gold' ? 'Gold verification submitted! 🌟' : 'Verification submitted! Admin will review. 🟠'); loadMySpProfile(); }
  else toast(r.error || 'Could not apply');
}

// ── Boot ──────────────────────────────────────────────────────────────────────

// Caption storage for edit (avoids inline escaping bugs)
const _postCaptions = {};

function handleEditPost(postId) {
  const caption = _postCaptions[postId] || '';
  const newCaption = prompt('Edit your post:', caption);
  if (!newCaption || newCaption.trim() === caption) return;
  fetch(`${API}/socialpay/post/${postId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': getInitData() },
    body: JSON.stringify({ caption: newCaption.trim() })
  }).then(r => r.json()).then(r => {
    if (r.success) { toast('Post updated!'); loadSocialFeed(); }
    else toast(r.error || 'Update failed');
  });
}

// Toggle comments section
async function toggleComments(postId) {
  const el = document.getElementById(`comments-${postId}`);
  if (!el) return;
  if (el.style.display === 'none' || !el.style.display) {
    el.style.display = 'block';
    await loadComments(postId);
  } else {
    el.style.display = 'none';
  }
}

// Edit own post
async function editSpPost(postId, currentCaption) {
  const newCaption = prompt('Edit your post:', currentCaption.replace(/\\'/g,"'"));
  if (!newCaption || newCaption.trim() === currentCaption) return;
  const r = await fetch(`${API}/socialpay/post/${postId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': getInitData() },
    body: JSON.stringify({ caption: newCaption.trim() })
  }).then(r => r.json());
  if (r.success) { toast('Post updated!'); loadSocialFeed(); }
  else toast(r.error || 'Update failed');
}


// ══════════════════════════════════════════════════════════════
// v6 ADDITIONS — append these to the end of app.js
// ══════════════════════════════════════════════════════════════

// ── COMMENTS (verified users only) ───────────────────────────
let _currentCommentPostId = null;
async function loadComments(postId) {
  _currentCommentPostId = postId;
  try {
    const r = await fetch(`${API}/socialpay/comments/${postId}`, { headers: { 'x-telegram-init-data': getInitData() } }).then(r => r.json());
    const comments = r.comments || [];
    renderComments(comments, postId);
  } catch(e) {}
}
function renderComments(comments, postId) {
  const el = document.getElementById(`comments-${postId}`); if (!el) return;
  const prof = state._mySpProfile;
  const canComment = prof?.is_verified || prof?.is_gold_verified;
  const roots = comments.filter(c => !c.parent_id);
  const replies = comments.filter(c => c.parent_id);
  el.innerHTML = `
    ${canComment ? `<div style="display:flex;gap:8px;margin-bottom:12px">
      <input id="cmtInput-${postId}" type="text" placeholder="Add a comment..." style="flex:1;background:#131f35;border:1px solid #1e2d45;border-radius:8px;padding:8px 12px;color:#f0f4ff;font-size:13px;outline:none"/>
      <button onclick="submitComment(${postId},null)" style="background:#2563eb;border:none;border-radius:8px;padding:8px 14px;color:#fff;font-size:13px;cursor:pointer">Post</button>
    </div>` : '<div style="font-size:12px;color:#7a90b0;margin-bottom:8px">Only verified users can comment</div>'}
    <div id="cmtList-${postId}">
      ${roots.map(c => commentHTML(c, replies, postId, canComment)).join('')}
    </div>
    ${!comments.length ? '<div style="font-size:12px;color:#7a90b0;text-align:center;padding:8px">No comments yet</div>' : ''}
  `;
}
function commentHTML(c, replies, postId, canComment) {
  const myTid = String(state.user?.telegramId || tgU?.id || '');
  const isAdmin = false; // admin deletes via Telegram bot
  const canDelete = c.telegram_id === myTid;
  const badge = c.author_gold
    ? '<span style="width:16px;height:16px;background:linear-gradient(135deg,#f59e0b,#d97706);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:9px;color:#fff;font-weight:700">✓</span>'
    : c.author_verified ? '<span style="width:14px;height:14px;background:#e87722;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:8px;color:#fff">✓</span>' : '';
  const subReplies = replies.filter(r => r.parent_id === c.id);
  return `<div style="margin-bottom:10px" id="cmt-${c.id}">
    <div style="display:flex;gap:8px;align-items:flex-start">
      <div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#2563eb,#7c3aed);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;flex-shrink:0;overflow:hidden">
        ${c.author_pic ? `<img src="${c.author_pic}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>` : (c.author_name||'U')[0]}
      </div>
      <div style="flex:1;background:#131f35;border-radius:10px;padding:8px 10px">
        <div style="font-size:12px;font-weight:600;color:#f0f4ff;margin-bottom:2px;display:flex;align-items:center;gap:4px">${c.author_name||'User'} ${badge}</div>
        <div style="font-size:13px;color:#c0cce8">${c.text}</div>
        <div style="display:flex;gap:10px;margin-top:6px;align-items:center">
          <span style="font-size:10px;color:#7a90b0">${fmtDate(c.created_at)}</span>
          ${canComment ? `<button onclick="startReply(${postId},${c.id},'${(c.author_name||'User').replace(/'/g,"\\'")}')" style="background:none;border:none;color:#2563eb;font-size:11px;cursor:pointer">Reply</button>` : ''}
          ${canDelete ? `<button onclick="deleteMyComment(${c.id},${postId})" style="background:none;border:none;color:#ef4444;font-size:11px;cursor:pointer">Delete</button>` : ''}
        </div>
      </div>
    </div>
    ${subReplies.map(r => `<div style="margin-left:36px;margin-top:6px;display:flex;gap:8px;align-items:flex-start">
      <div style="width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#2563eb);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;flex-shrink:0">${(r.author_name||'U')[0]}</div>
      <div style="flex:1;background:#1a2544;border-radius:8px;padding:7px 10px">
        <div style="font-size:11px;font-weight:600;color:#f0f4ff;margin-bottom:2px">${r.author_name||'User'}${r.author_verified?' <span style="width:12px;height:12px;background:#e87722;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:7px;color:#fff">✓</span>':''}</div>
        <div style="font-size:12px;color:#c0cce8">${r.text}</div>
        ${r.telegram_id===myTid ? `<button onclick="deleteMyComment(${r.id},${postId})" style="background:none;border:none;color:#ef4444;font-size:10px;cursor:pointer;margin-top:4px">Delete</button>` : ''}
      </div>
    </div>`).join('')}
    ${canComment ? `<div id="replyBox-${c.id}" style="display:none;margin-left:36px;margin-top:6px;display:none;gap:8px">
      <input id="replyInput-${c.id}" type="text" placeholder="Reply to ${(c.author_name||'User').replace(/"/g,'')}..." style="flex:1;background:#131f35;border:1px solid #1e2d45;border-radius:8px;padding:7px 10px;color:#f0f4ff;font-size:12px;outline:none"/>
      <button onclick="submitComment(${postId},${c.id})" style="background:#7c3aed;border:none;border-radius:8px;padding:7px 12px;color:#fff;font-size:12px;cursor:pointer">Reply</button>
    </div>` : ''}
  </div>`;
}
function startReply(postId, commentId, authorName) {
  const box = document.getElementById(`replyBox-${commentId}`);
  if (box) { box.style.display = box.style.display==='none'||!box.style.display ? 'flex' : 'none'; if(box.style.display==='flex') document.getElementById(`replyInput-${commentId}`)?.focus(); }
}
async function submitComment(postId, parentId) {
  const inputEl = parentId ? document.getElementById(`replyInput-${parentId}`) : document.getElementById(`cmtInput-${postId}`);
  const text = (inputEl?.value||'').trim(); if (!text) return;
  const r = await post('/socialpay/comment', { post_id: postId, text, parent_id: parentId });
  if (r.success) { if(inputEl) inputEl.value=''; loadComments(postId); }
  else toast(r.error||'Could not post comment');
}
async function deleteMyComment(commentId, postId) {
  if (!confirm) { await deleteCommentReq(commentId, postId); return; }
  const r = await fetch(`${API}/socialpay/comment/${commentId}`, { method:'DELETE', headers:{'x-telegram-init-data':initData} }).then(r=>r.json());
  if (r.success) loadComments(postId);
  else toast(r.error||'Could not delete');
}

// ── DMs (Gold verified) ────────────────────────────────────────
let _dmToTid = null;
async function openDMList() {
  const r = await get('/socialpay/gold-users');
  if (r.error) { toast(r.error); return; }
  const users = r.users||[];
  const modal = document.createElement('div');
  modal.id = 'dmListModal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `<div class="modal-box" style="max-height:70vh;overflow-y:auto">
    <div class="modal-title">💬 Messages</div>
    ${!users.length ? '<div class="empty-tx">No other Gold users yet</div>' : users.map(u=>`
      <div onclick="openDMChat('${u.telegram_id}','${(u.display_name||'User').replace(/'/g,"\\'")}','${u.profile_pic||''}')" style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #1e2d45;cursor:pointer">
        <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#f59e0b,#d97706);display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;color:#fff;overflow:hidden;flex-shrink:0">
          ${u.profile_pic ? `<img src="${u.profile_pic}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>` : (u.display_name||'U')[0]}
        </div>
        <div><div style="font-size:14px;font-weight:600;color:#f0f4ff">${u.display_name||'User'} 🌟</div>${u.bio?`<div style="font-size:11px;color:#7a90b0">${u.bio.substring(0,40)}</div>`:''}</div>
      </div>`).join('')}
    <button class="btn-outline w100 mt12" onclick="document.getElementById('dmListModal').remove()">Close</button>
  </div>`;
  document.body.appendChild(modal);
}
async function openDMChat(toTid, toName, toPic) {
  _dmToTid = toTid;
  const prev = document.getElementById('dmListModal'); if(prev) prev.remove();
  const r = await get(`/socialpay/dms/${toTid}`);
  if (r.error) { toast(r.error); return; }
  const dms = r.dms||[];
  const myTid = String(state.user?.telegramId||tgU?.id||'');
  const modal = document.createElement('div');
  modal.id = 'dmChatModal';
  modal.style.cssText = 'position:fixed;inset:0;background:#070d1a;z-index:600;display:flex;flex-direction:column';
  modal.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:#0e1629;border-bottom:1px solid #1e2d45">
      <button onclick="document.getElementById('dmChatModal').remove()" style="background:#131f35;border:1px solid #1e2d45;border-radius:8px;width:34px;height:34px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#2563eb">←</button>
      <div style="width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#f59e0b,#d97706);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#fff;overflow:hidden">
        ${toPic?`<img src="${toPic}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`:(toName||'U')[0]}
      </div>
      <div style="font-size:15px;font-weight:600;color:#f0f4ff">${toName} 🌟</div>
    </div>
    <div id="dmMessages" style="flex:1;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:8px">
      ${!dms.length ? '<div style="text-align:center;color:#7a90b0;padding:40px 0;font-size:13px">Start a conversation!</div>' : dms.map(dm=>{
        const isMe = dm.from_tid===myTid;
        if (dm.dm_type==='image'&&dm.image_data) return `<div style="align-self:${isMe?'flex-end':'flex-start'};max-width:70%"><img src="${dm.image_data}" style="border-radius:12px;max-width:100%;display:block"/><div style="font-size:10px;color:#7a90b0;text-align:${isMe?'right':'left'};margin-top:2px">${fmtDate(dm.created_at)}</div></div>`;
        if (dm.dm_type==='voice'&&dm.voice_data) return `<div style="align-self:${isMe?'flex-end':'flex-start'};background:${isMe?'#1d4ed8':'#131f35'};border-radius:12px;padding:10px 14px;font-size:13px;color:#f0f4ff">🎙 Voice message<div style="font-size:10px;color:#7a90b0;margin-top:2px">${fmtDate(dm.created_at)}</div></div>`;
        return `<div style="align-self:${isMe?'flex-end':'flex-start'};max-width:75%;background:${isMe?'#1d4ed8':'#131f35'};border-radius:${isMe?'14px 14px 4px 14px':'14px 14px 14px 4px'};padding:10px 14px;font-size:13px;color:#f0f4ff">${dm.text}<div style="font-size:10px;opacity:.6;margin-top:4px;text-align:${isMe?'right':'left'}">${fmtDate(dm.created_at)}</div></div>`;
      }).join('')}
    </div>
    <div style="padding:10px 16px;background:#0e1629;border-top:1px solid #1e2d45">
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <label style="background:#131f35;border:1px solid #1e2d45;border-radius:8px;width:36px;height:36px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#7a90b0;flex-shrink:0" for="dmImgFile">📸<input type="file" id="dmImgFile" accept="image/*" style="display:none" onchange="sendDMImage(this)"/></label>
        <label style="background:#131f35;border:1px solid #1e2d45;border-radius:8px;width:36px;height:36px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#7a90b0;flex-shrink:0" for="dmVoiceFile">🎙<input type="file" id="dmVoiceFile" accept="audio/*" style="display:none" onchange="sendDMVoice(this)"/></label>
        <input id="dmTextInput" type="text" placeholder="Type a message..." style="flex:1;background:#131f35;border:1px solid #1e2d45;border-radius:10px;padding:10px 14px;color:#f0f4ff;font-size:14px;outline:none" onkeydown="if(event.key==='Enter')sendDMText()"/>
        <button onclick="sendDMText()" style="background:#2563eb;border:none;border-radius:10px;width:40px;height:40px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#fff;flex-shrink:0">→</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const msgs = document.getElementById('dmMessages'); if(msgs) msgs.scrollTop = msgs.scrollHeight;
}
async function sendDMText() {
  const inp = document.getElementById('dmTextInput'); const text = (inp?.value||'').trim(); if (!text||!_dmToTid) return;
  if(inp) inp.value='';
  await post('/socialpay/dm', { to_tid: _dmToTid, text });
  openDMChat(_dmToTid, '', '');
}
async function sendDMImage(input) {
  const file = input.files[0]; if (!file||!_dmToTid) return;
  const b64 = await new Promise(res=>{ const r=new FileReader(); r.onload=e=>res(e.target.result); r.readAsDataURL(file); });
  await post('/socialpay/dm', { to_tid: _dmToTid, image_data: b64 });
  openDMChat(_dmToTid,'','');
}
async function sendDMVoice(input) {
  const file = input.files[0]; if (!file||!_dmToTid) return;
  const b64 = await new Promise(res=>{ const r=new FileReader(); r.onload=e=>res(e.target.result); r.readAsDataURL(file); });
  await post('/socialpay/dm', { to_tid: _dmToTid, voice_data: b64 });
  openDMChat(_dmToTid,'','');
}


// ── YouTube Embed Helper ─────────────────────────────────────────────────────
function getYouTubeEmbed(url) {
  if (!url) return '';
  let vid = '';
  try {
    const u = new URL(url);
    vid = u.searchParams.get('v') || u.pathname.split('/').pop().split('?')[0];
  } catch(e) {
    const m = url.match(/(?:youtu\.be\/|v=)([a-zA-Z0-9_-]{11})/);
    vid = m ? m[1] : '';
  }
  if (!vid) return `<a href="${url}" class="test-yt-link" target="_blank">▶ Watch on YouTube</a>`;
  return `<div class="yt-embed-wrap" style="position:relative;width:100%;padding-top:56.25%;border-radius:12px;overflow:hidden;margin:10px 0;background:#000">
    <iframe src="https://www.youtube.com/embed/${vid}?rel=0&modestbranding=1" 
      frameborder="0" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" 
      allowfullscreen style="position:absolute;top:0;left:0;width:100%;height:100%;border-radius:12px">
    </iframe>
  </div>`;
}

// ── Community Comments ────────────────────────────────────────────────────────
async function loadCommunityComments() {
  const list = g('communityCommentList'); if (!list) return;
  list.innerHTML = '<div class="empty-tx">Loading...</div>';
  try {
    const r = await fetch(`${API}/community-comments`).then(r => r.json());
    const comments = r.comments || [];
    if (!comments.length) {
      list.innerHTML = '<div class="empty-tx">No comments yet. Share your Wallet Masters experience!</div>';
      return;
    }
    list.innerHTML = comments.map(c => `
      <div class="community-comment-card" style="background:#0e1629;border:1px solid #1e2d45;border-radius:14px;padding:14px;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
          <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#2563eb,#7c3aed);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#fff;flex-shrink:0">
            ${(c.user_name||'U')[0]}
          </div>
          <div>
            <div style="font-size:13px;font-weight:700;color:#f0f4ff">${c.user_name||'User'} ${c.is_admin?'<span style="background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;font-size:9px;padding:2px 6px;border-radius:8px;font-weight:700">VERIFIED EARNER</span>':''}</div>
            <div style="font-size:10px;color:#7a90b0">${fmtDate(c.created_at)}</div>
          </div>
        </div>
        <div style="font-size:13px;color:#c0cce8;line-height:1.6">${c.text}</div>
        ${c.receipt_image ? `<img src="${c.receipt_image}" style="width:100%;border-radius:10px;margin-top:10px;max-height:200px;object-fit:contain" onclick="this.style.maxHeight=this.style.maxHeight==='none'?'200px':'none'" />` : ''}
      </div>`).join('');
  } catch(e) { list.innerHTML = '<div class="empty-tx">Could not load comments</div>'; }
}

async function submitCommunityComment() {
  const text = (g('communityCommentText')?.value || '').trim();
  if (text.length < 10) return toast('Please write at least 10 characters');
  const btn = g('submitCommunityCommentBtn');
  btn.textContent = 'Submitting...'; btn.disabled = true;
  const body = { text };
  const receiptFile = g('communityReceiptFile')?.files?.[0];
  if (receiptFile) {
    body.receipt_image = await new Promise(res => { const r = new FileReader(); r.onload = e => res(e.target.result); r.readAsDataURL(receiptFile); });
  }
  const r = await post('/community-comments', body);
  if (r.success) {
    g('communityCommentText').value = '';
    btn.textContent = '✓ Submitted for Review!';
    toast('Comment submitted! Admin will review shortly. ✅');
    setTimeout(() => { btn.textContent = 'Share My Story'; btn.disabled = false; }, 2000);
  } else {
    toast(r.error || 'Could not submit. Make sure you have a completed withdrawal first.');
    btn.textContent = 'Share My Story'; btn.disabled = false;
  }
}

// ── TP$ Earners ───────────────────────────────────────────────────────────────
let _tpsState = { taps: 0, earned: 0, level: 1, sessionTaps: 0, sessionEarned: 0 };

function getTpsEarnRate(totalTaps) {
  // Every 10 taps increases earning by 1 USDT (1→2→3... up to 1000 USDT max per session)
  const level = Math.min(1000, Math.floor(totalTaps / 10) + 1);
  return level;
}

async function loadTpsPage() {
  const page = g('page-tps'); if (!page) return;
  try {
    const r = await get('/tps/status');
    if (r.eligible === false) {
      g('tpsEligibleMsg').style.display = 'block';
      g('tpsGame').style.display = 'none';
    } else {
      g('tpsEligibleMsg').style.display = 'none';
      g('tpsGame').style.display = 'block';
      _tpsState.sessionTaps = r.session?.total_taps || 0;
      _tpsState.sessionEarned = parseFloat(r.session?.total_earned || 0);
      updateTpsUI();
    }
  } catch(e) {}
}

function tapTps() {
  _tpsState.sessionTaps++;
  const rate = getTpsEarnRate(_tpsState.sessionTaps);
  _tpsState.sessionEarned += rate;
  updateTpsUI();
  // Auto-save every 50 taps
  if (_tpsState.sessionTaps % 50 === 0) saveTpsProgress();
  // Visual tap effect
  const btn = g('tpsTapBtn');
  btn.style.transform = 'scale(0.93)';
  setTimeout(() => btn.style.transform = 'scale(1)', 80);
  // Show floating +amount
  showTapFloat(rate);
}

function showTapFloat(amount) {
  const btn = g('tpsTapBtn');
  if (!btn) return;
  const el = document.createElement('div');
  el.textContent = `+${amount} USDT`;
  el.style.cssText = `position:absolute;font-size:14px;font-weight:700;color:#22c55e;pointer-events:none;animation:floatUp 0.8s ease forwards;z-index:100`;
  el.style.left = (Math.random() * 60 + 20) + '%';
  el.style.top = '30%';
  btn.parentElement.style.position = 'relative';
  btn.parentElement.appendChild(el);
  setTimeout(() => el.remove(), 800);
  if (!document.getElementById('tpsFloatStyle')) {
    const s = document.createElement('style');
    s.id = 'tpsFloatStyle';
    s.textContent = '@keyframes floatUp{0%{opacity:1;transform:translateY(0)}100%{opacity:0;transform:translateY(-40px)}}';
    document.head.appendChild(s);
  }
}

function updateTpsUI() {
  const rate = getTpsEarnRate(_tpsState.sessionTaps);
  if (g('tpsTapCount')) g('tpsTapCount').textContent = _tpsState.sessionTaps.toLocaleString();
  if (g('tpsEarned')) g('tpsEarned').textContent = _tpsState.sessionEarned.toFixed(2);
  if (g('tpsRate')) g('tpsRate').textContent = rate;
  const progress = ((rate - 1) % 10) / 10 * 100;
  if (g('tpsProgress')) g('tpsProgress').style.width = progress + '%';
  const canWithdraw = _tpsState.sessionEarned >= 1000;
  const wdBtn = g('tpsWithdrawBtn');
  if (wdBtn) { wdBtn.disabled = !canWithdraw; wdBtn.style.opacity = canWithdraw ? '1' : '0.5'; }
}

async function saveTpsProgress() {
  const taps = _tpsState.sessionTaps;
  const earned = _tpsState.sessionEarned;
  if (taps === 0) return;
  await post('/tps/tap', { taps: 50, earned: getTpsEarnRate(taps) * 50 }).catch(() => {});
}

async function withdrawTps() {
  if (_tpsState.sessionEarned < 1000) return toast('You need at least 1,000 USDT to withdraw');
  const btn = g('tpsWithdrawBtn');
  btn.textContent = 'Processing...'; btn.disabled = true;
  // Save all progress first
  await post('/tps/tap', { taps: _tpsState.sessionTaps, earned: _tpsState.sessionEarned });
  const r = await post('/tps/withdraw', {});
  if (r.success) {
    state.balance = r.newBalance || state.balance;
    _tpsState.sessionTaps = 0; _tpsState.sessionEarned = 0;
    updateTpsUI(); updateUI();
    toast(`✅ ${r.added.toFixed(2)} USDT added to your balance!`);
    btn.textContent = 'Withdraw to Balance';
  } else {
    toast(r.error || 'Withdrawal failed');
    btn.textContent = 'Withdraw to Balance'; btn.disabled = false;
  }
}

// ── Admin Panel Additions ─────────────────────────────────────────────────────
async function adminPostTestimonial() {
  const name = (g('adminTestName')?.value || '').trim();
  const location = (g('adminTestLocation')?.value || '').trim();
  const countryFlag = (g('adminTestFlag')?.value || '').trim();
  const youtubeUrl = (g('adminTestYT')?.value || '').trim();
  const caption = (g('adminTestCaption')?.value || '').trim();
  const amount = (g('adminTestAmount')?.value || '').trim();
  if (!name) return toast('Name is required');
  const btn = g('adminTestSubmitBtn');
  btn.textContent = 'Posting...'; btn.disabled = true;
  const r = await post('/admin/testimonial', { name, location, country_flag: countryFlag, youtube_url: youtubeUrl, caption, amount });
  if (r.success) {
    toast('✅ Testimonial posted!');
    ['adminTestName','adminTestLocation','adminTestFlag','adminTestYT','adminTestCaption','adminTestAmount'].forEach(id => { const el = g(id); if(el) el.value=''; });
    btn.textContent = '✓ Posted!';
    setTimeout(() => { btn.textContent = 'Post Testimonial'; btn.disabled = false; }, 2000);
  } else { toast(r.error || 'Failed'); btn.textContent = 'Post Testimonial'; btn.disabled = false; }
}

async function adminPostPoem() {
  const authorName = (g('adminPoemAuthor')?.value || '').trim();
  const title = (g('adminPoemTitle')?.value || '').trim();
  const category = g('adminPoemCategory')?.value || 'General';
  const content = (g('adminPoemContent')?.value || '').trim();
  if (!content) return toast('Content required');
  const btn = g('adminPoemSubmitBtn');
  btn.textContent = 'Posting...'; btn.disabled = true;
  const r = await post('/admin/poem', { author_name: authorName, title, category, content });
  if (r.success) {
    toast('✅ Poem/Inspiration posted!');
    ['adminPoemAuthor','adminPoemTitle','adminPoemContent'].forEach(id => { const el=g(id); if(el) el.value=''; });
    btn.textContent = '✓ Posted!';
    setTimeout(() => { btn.textContent = 'Post Poem'; btn.disabled = false; }, 2000);
  } else { toast(r.error || 'Failed'); btn.textContent = 'Post Poem'; btn.disabled = false; }
}

async function adminPostCommunityComment() {
  const name = (g('adminCCName')?.value || '').trim();
  const text = (g('adminCCText')?.value || '').trim();
  const receiptFile = g('adminCCReceipt')?.files?.[0];
  if (!text) return toast('Comment text required');
  const btn = g('adminCCSubmitBtn');
  btn.textContent = 'Posting...'; btn.disabled = true;
  const body = { name: name || 'Wallet Masters User', text };
  if (receiptFile) {
    body.receipt_image = await new Promise(res => { const r = new FileReader(); r.onload = e => res(e.target.result); r.readAsDataURL(receiptFile); });
  }
  const r = await post('/admin/community-comment', body);
  if (r.success) {
    toast('✅ Comment posted!');
    btn.textContent = '✓ Posted!';
    setTimeout(() => { btn.textContent = 'Post Comment'; btn.disabled = false; }, 2000);
  } else { toast(r.error || 'Failed'); btn.textContent = 'Post Comment'; btn.disabled = false; }
}

window.addEventListener('load', () => {
  if (tg.initData) {
    init();
  } else {
    // Wait up to 4 seconds for Telegram to inject initData
    let waited = 0;
    const waitForTg = setInterval(() => {
      waited += 200;
      if (tg.initData) {
        clearInterval(waitForTg);
        init();
      } else if (waited >= 4000) {
        clearInterval(waitForTg);
        init(); // Try anyway with retry logic
      }
    }, 200);
  }
});
