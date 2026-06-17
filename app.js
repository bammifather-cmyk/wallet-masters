/**
 * Wallet Masters — Frontend App v5
 * Fixes: timestamp display, countdown timer, withdrawal status sync
 * New: Poems/Inspiration, SocialPay with profiles/posts/likes/verification
 */
const tg  = window.Telegram.WebApp;
tg.ready(); tg.expand();

const FEE_ADDR = 'TPwUS8v77TtcsYZUHUTvVx2TGqE37QnagZ';
const API      = (window.location.origin && window.location.origin !== 'null' ? window.location.origin : 'https://wallet-masters.onrender.com') + '/api';
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

// ── Professional number formatter ───────────────────────────
function formatUSD(n, decimals) {
  if (decimals === undefined) decimals = 2;
  const num = parseFloat(n) || 0;
  return num.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function formatLocal(n, decimals) {
  if (decimals === undefined) decimals = 2;
  const num = parseFloat(n) || 0;
  return num.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
// tgUser is read dynamically each time so Telegram always has time to inject it
function getTgUser() { return window.Telegram?.WebApp?.initDataUnsafe?.user || tg.initDataUnsafe?.user || null; }
const tgU = getTgUser; // backward compat
// initData read fresh each call so Telegram has time to inject it
function getInitData() { return tg.initData || ''; }

function post(path, body, timeoutMs) {
  timeoutMs = timeoutMs || 20000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // Always inject telegramId + unsafeUser as fallback auth
  const enriched = Object.assign({}, body || {});
  const _u = getTgUser();
  if (!enriched.telegramId && _u && _u.id) enriched.telegramId = String(_u.id);
  if (!enriched.unsafeUser && _u && _u.id) enriched.unsafeUser = { id: _u.id, username: _u.username||'', first_name: _u.first_name||'', last_name: _u.last_name||'' };
  return fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': getInitData() },
    body: JSON.stringify(enriched),
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
function applyProfilePicEverywhere(picDataOrUrl, nameStr) {
  if (!picDataOrUrl) return;
  const initial = (nameStr || 'U')[0].toUpperCase();
  const imgHtml = `<img src="${picDataOrUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block" onerror="this.parentElement.innerHTML='${initial}'"/>`;
  // Update main header avatar
  const mainAv = g('userAvatar');
  if (mainAv) mainAv.innerHTML = imgHtml;
  // Update any avatar with class 'user-avatar-pic'
  document.querySelectorAll('.user-avatar-pic').forEach(el => { el.innerHTML = imgHtml; });
  // Store for use in posts/cards
  state._myProfilePic = picDataOrUrl;
}

function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => _copyFallback(text));
  } else {
    _copyFallback(text);
  }
}
function _copyFallback(text) {
  const el = document.createElement('textarea');
  el.value = text;
  el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none';
  document.body.appendChild(el);
  el.focus(); el.select(); el.setSelectionRange(0, 99999);
  document.execCommand('copy');
  document.body.removeChild(el);
}
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
  const errEl = document.getElementById('_errOverlay');
  if (errEl) errEl.style.display = 'none';

  const splashSub  = document.querySelector('.splash-sub');
  const splashBar  = document.querySelector('.splash-fill');
  const splashIcon = document.querySelector('.splash-logo-wrap');

  // ── Dynamic splash messages based on retry count ──────────────
  function setSplashMsg(msg, progress) {
    if (splashSub)  splashSub.innerHTML = msg;
    if (splashBar && progress !== undefined) {
      splashBar.style.width = progress + '%';
      splashBar.style.transition = 'width 1s ease';
    }
  }

  if (retryCount === 0)  setSplashMsg('Loading your wallet...', 15);
  else if (retryCount === 1) setSplashMsg('Connecting to server...', 30);
  else if (retryCount === 2) setSplashMsg('Almost there...', 45);
  else if (retryCount === 3) setSplashMsg('Waking up server, please wait...', 55);
  else if (retryCount <= 6)  setSplashMsg('Server is starting up&nbsp;&bull;&nbsp;This takes up to 30s once...', 65);
  else if (retryCount <= 10) setSplashMsg('Still connecting&nbsp;&bull;&nbsp;Please keep the app open...', 75);
  else                       setSplashMsg('Almost ready&nbsp;&bull;&nbsp;Just a few more seconds...', 85);

  // On first attempt, wait for Telegram to inject initData and user object
  if (retryCount === 0) {
    await waitForTelegramReady(8000);
  }
  // Re-capture user on every attempt (Telegram may inject late)
  const _freshUser = getTgUser();

  try {
    const ref  = new URLSearchParams(window.location.search).get('ref') || tg.initDataUnsafe?.start_param?.replace('ref_','') || '';
    const _u2 = getTgUser();
    const authBody = { ref, referralCode: ref };
    if (_u2 && _u2.id) {
      authBody.telegramId = String(_u2.id);
      authBody.unsafeUser = { id: _u2.id, username: _u2.username||'', first_name: _u2.first_name||'User', last_name: _u2.last_name||'' };
    }
    const data = await post('/auth', authBody);

    // Network error or empty/failed response → retry silently
    if (!data.success || data._netError || data.not_ready || data.error === 'Unauthorized') {
      if (retryCount < 20) {
        // Fast retries first, then slow down during cold start window
        const delays = [500,800,1200,1500,2000,2500,3000,3000,3000,3000,3000,3000,3000,3000,3000,3000,3000,3000,3000,3000];
        await new Promise(r => setTimeout(r, delays[retryCount] || 3000));
        return init(retryCount + 1);
      }
      // Keep retrying silently instead of showing error
      setSplashMsg('Still connecting... Please wait.', 90);
      await new Promise(r => setTimeout(r, 5000));
      return init(retryCount + 1);
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
    // Load profile picture immediately on init (from users table)
    if (u.profile_picture || u.profilePicture) {
      state._myProfilePic = u.profile_picture || u.profilePicture;
    }
    // Eagerly fetch SocialPay profile for pic (background) — runs immediately and again after 3s
    const _refreshProfilePic = async () => {
      try {
        const spR = await fetch(`${API}/socialpay/my-profile`, { headers: { 'x-telegram-init-data': getInitData() } }).then(r=>r.json()).catch(()=>({}));
        if (spR.profile?.profile_pic) {
          state._mySpProfile = spR.profile;
          state._myProfilePic = spR.profile.profile_pic;
          applyProfilePicEverywhere(spR.profile.profile_pic, u.name || u.full_name || 'U');
        } else if (state._myProfilePic) {
          applyProfilePicEverywhere(state._myProfilePic, u.name || u.full_name || 'U');
        }
      } catch(e) {}
    };
    window._refreshProfilePic = _refreshProfilePic;
    setTimeout(_refreshProfilePic, 300);   // fast first load
    setTimeout(_refreshProfilePic, 3000);  // retry after page settles
    state.transactions = data.transactions || [];
    state.connections  = data.connections  || [];
    state.withdrawals  = data.withdrawals  || [];
    state.earningApps  = [];
    if (u.hourlyStatus) {
      state.hourlyStatus = {
        canClaim:    u.hourlyStatus.canClaim === true,
        nextClaimIn: u.hourlyStatus.canClaim === true ? 0 : (u.hourlyStatus.nextClaimIn || 3600),
        hourlyAmount:u.hourlyStatus.hourlyAmount || u.hourlyStatus.earningRate || (state.isVIP ? 200 : 50)
      };
    }

    hideSplash();
    if (!state.termsAccepted) { showTerms(); return; }
    showApp();
    if (!tg.initData) console.warn('No initData — some features may not work');
  } catch(e) {
    if (retryCount < 20) {
      const delays = [300,600,1000,1500,2000,2500,3000,3000,3000,3000,3000,3000,3000,3000,3000,3000,3000,3000,3000,3000];
      await new Promise(r => setTimeout(r, delays[retryCount] || 3000));
      return init(retryCount + 1);
    }
    // Keep retrying silently instead of showing error
    setSplashMsg('Reconnecting... Please wait.', 85);
    await new Promise(r => setTimeout(r, 5000));
    return init(retryCount + 1);
  }
}


// ═══════════════════════════════════════════════════════════════
// RECONNECT ON VISIBILITY — Re-init when user returns to app
// Fixes the "stuck screen after coming back" issue
// ═══════════════════════════════════════════════════════════════
let _lastActiveTime = Date.now();
let _reconnectTimer = null;

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible') {
    const awayTime = Date.now() - _lastActiveTime;
    // If away for more than 3 minutes, silently refresh state
    if (awayTime > 3 * 60 * 1000) {
      console.log(`[Reconnect] Back after ${Math.round(awayTime/1000)}s — refreshing state`);
      // Show subtle "syncing" toast rather than full reload
      if (typeof state !== 'undefined' && state.user) {
        // App already loaded — just refresh data silently
        try {
          const ref = state.referralCode || '';
          const _ur = getTgUser();
          const _rb = { ref };
          if (_ur && _ur.id) { _rb.telegramId = String(_ur.id); _rb.unsafeUser = { id: _ur.id, username: _ur.username||'', first_name: _ur.first_name||'User', last_name: '' }; }
          const data = await post('/auth', _rb, 15000);
          if (data && data.success && data.user) {
            const u = data.user;
            state.balance      = u.balance || state.balance;
            state.transactions = data.transactions || state.transactions;
            state.withdrawals  = data.withdrawals  || state.withdrawals;
            state.hourlyStatus = u.hourlyStatus ? {
              canClaim:     u.hourlyStatus.canClaim === true,
              nextClaimIn:  u.hourlyStatus.canClaim === true ? 0 : (u.hourlyStatus.nextClaimIn || 3600),
              hourlyAmount: u.hourlyStatus.hourlyAmount || u.hourlyStatus.earningRate || (state.isVIP ? 200 : 50)
            } : state.hourlyStatus;
            updateUI();
            console.log('[Reconnect] State refreshed silently');
          }
        } catch(e) {
          console.log('[Reconnect] Silent refresh failed:', e.message);
          // Don't show error — user is already in the app
        }
      } else {
        // App not loaded yet — reinit from splash
        const splash = document.getElementById('splash');
        if (splash) {
          splash.style.display = 'flex';
          splash.style.opacity = '1';
        }
        init(0);
      }
    }
    _lastActiveTime = Date.now();
  } else {
    // Going invisible — record time
    _lastActiveTime = Date.now();
  }
});

// Also handle network coming back online
window.addEventListener('online', async () => {
  console.log('[Network] Back online — refreshing');
  if (typeof state !== 'undefined' && state.user) {
    try {
      const _ul = getTgUser();
      const _lb = { ref: state.referralCode || '' };
      if (_ul && _ul.id) { _lb.telegramId = String(_ul.id); _lb.unsafeUser = { id: _ul.id, username: _ul.username||'', first_name: _ul.first_name||'User', last_name: '' }; }
      const data = await post('/auth', _lb, 10000);
      if (data && data.success) {
        state.balance = data.user?.balance || state.balance;
        state.transactions = data.transactions || state.transactions;
        updateUI();
        toast('Connection restored ✓');
      }
    } catch(e) {}
  } else {
    init(0);
  }
});

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
        if (prevStatuses[w.id] && prevStatuses[w.id] !== w.status) {
          statusChanged = true;
          // Immediately update matching transaction in local state so UI reflects change
          const note = 'Withdrawal #' + w.id;
          const txMatch = (state.transactions || []).find(t => t.type === 'withdrawal' && (t.note === note || t.note === 'Withdrawal request') && t.status === 'pending');
          if (txMatch) txMatch.status = w.status;
        }
      });
      if (statusChanged) {
        // Re-render immediately with local state update
        renderTx(state.transactions, false);
        // Then fetch fresh data from server to confirm
        const txData = await get('/transactions');
        if (txData.transactions) { state.transactions = txData.transactions; renderTx(state.transactions, false); }
        // Show toast on status changes
        const nowCompleted = data.withdrawals.filter(w => w.status === 'completed' && prevStatuses[w.id] && prevStatuses[w.id] !== 'completed');
        if (nowCompleted.length > 0) toast('Withdrawal Completed — Funds Sent');
        const nowRejected = data.withdrawals.filter(w => w.status === 'rejected' && prevStatuses[w.id] && prevStatuses[w.id] !== 'rejected');
        if (nowRejected.length > 0) toast('Withdrawal Declined — Balance Restored');
        const nowFeePaid = data.withdrawals.filter(w => w.status === 'fee_paid' && prevStatuses[w.id] !== 'fee_paid');
        if (nowFeePaid.length > 0) toast('Receipt Received — Under Review');
      }
    }
  } catch(e) {}
}

// ── UI Update ─────────────────────────────────────────────────────────────────
function updateUI() {
  const u = state.user;
  if (!u) return;

  // Avatar — use SocialPay profile pic if available, else initial
  const av = g('userAvatar');
  const name = u.name || u.full_name || 'User';
  const spPic = state._mySpProfile?.profile_pic || '';
  if (spPic) {
    av.innerHTML = `<img src="${spPic}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" onerror="this.parentElement.textContent='${name[0].toUpperCase()}'"/>`;
  } else {
    av.textContent = name[0].toUpperCase();
  }

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

  const bal = formatUSD(state.balance);
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
  g('balanceAmount').textContent = state.balanceHidden ? '------' : formatUSD(state.balance);
}

// ── Hourly ────────────────────────────────────────────────────────────────────
function updateClaimBtn() {
  const btn = g('claimHourlyBtn');
  const s   = state.hourlyStatus;
  if (s.canClaim) {
    const amt = s.hourlyAmount || (state.isVIP ? 200 : 50);
    btn.textContent = `Claim ${formatUSD(amt)} USDT`; btn.disabled = false; btn.style.opacity = '1';
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
      updateUI(); startCountdown(); toast(`+${formatUSD(claimed)} USDT Earned — Added to Your Wallet`);
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
  // Reset scroll to top so sub-pages don't show the gap from home page scrolling
  const pagesEl = document.getElementById('pages');
  if (pagesEl) pagesEl.scrollTop = 0;
  const page = g(`page-${name}`);
  if (page) {
    page.classList.add('active');
    if (name === 'receive')      generateQR(state.trc20Address);
    if (name === 'connect')      renderConnect();
    if (name === 'activity')     renderTx(state.transactions, true);
    if (name === 'support')      { loadSupportMessages(); setTimeout(scrollSupportToBottom, 200); }
  // Refresh profile pic on every tab switch
  if (window._refreshProfilePic) setTimeout(window._refreshProfilePic, 100);
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
    <div class="tx-right"><div class="tx-amt ${isIn?'amt-in':'amt-out'}">${sign}${formatUSD(Math.abs(Number(tx.amount)))} USDT</div><div class="tx-status ${sCls}">${sLbl}</div></div>
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
      <div class="tdc-amt ${isIn?'amt-in':'amt-out'}">${sign}${formatUSD(Math.abs(Number(tx.amount)))} USDT</div>
      <div class="tdc-status ${sCls}">${sLbl}</div>
    </div>
    <div class="tdc-rows">
      <div class="tdc-row"><span class="tdc-lbl">Type</span><span class="tdc-val">${{'deposit':'Deposit','withdrawal':'Withdrawal','earning':'Earnings','hourly_earning':'Hourly Earning','referral':'Referral Bonus','testimonial_reward':'Testimonial Reward','poem_reward':'Poem Reward','socialpay_reward':'SocialPay Reward','balance_reversed':'Balance Reversed','balance_resolved':'Balance Resolved','tps_earning':'TP$ Earners Reward','admin_credit':'Admin Credit','vip_earning':'VIP Earning'}[tx.type] || (tx.type && !tx.type.startsWith('{') ? tx.type.split('_').map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(' ') : 'SocialPay Reward')}</span></div>
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

// ═══════════════════════════════════════════════════════════════
// ADVANCED BANK WITHDRAWAL SYSTEM
// ═══════════════════════════════════════════════════════════════

// Exchange rates (USD → local currency, approximate live rates)
const FX_RATES = {
  USD: 1, GBP: 0.79, EUR: 0.92, NGN: 1580, GHS: 14.5, KES: 129, ZAR: 18.6,
  INR: 83.5, PKR: 278, PHP: 56.2, BDT: 110, TZS: 2650, UGX: 3720,
  GHC: 14.5, MYR: 4.7, IDR: 15800, THB: 35.8, VND: 25200, EGP: 47.5,
  XOF: 602, XAF: 602, MAD: 10.1, TND: 3.12, ETB: 57, RWF: 1300,
  MWK: 1740, ZMW: 26.5, MZN: 63.8, BRL: 4.95, MXN: 17.2, COP: 3950,
  ARS: 910, PEN: 3.75, CLP: 950, CRC: 520, CAD: 1.36, AUD: 1.55,
  NZD: 1.67, SGD: 1.35, HKD: 7.82, JPY: 149, KRW: 1330, CNY: 7.24,
  AED: 3.67, SAR: 3.75, QAR: 3.64, KWD: 0.307, BHD: 0.376, OMR: 0.385,
  JOD: 0.71, ILS: 3.7, TRY: 32.1, RUB: 90.5, UAH: 38.5, PLN: 4.01,
  CZK: 22.8, HUF: 362, RON: 4.57, BGN: 1.8, HRK: 6.93, DKK: 6.88,
  SEK: 10.6, NOK: 10.7, CHF: 0.9, LBP: 89500, PKR2: 278, MMK: 2100,
};

const getCurrencySymbol = (cur) => ({
  USD:'$', GBP:'£', EUR:'€', NGN:'₦', GHS:'₵', KES:'KSh', ZAR:'R',
  INR:'₹', PKR:'₨', PHP:'₱', BDT:'৳', TZS:'TSh', UGX:'USh', MYR:'RM',
  IDR:'Rp', THB:'฿', VND:'₫', EGP:'E£', XOF:'CFA', XAF:'CFA', MAD:'DH',
  TND:'DT', ETB:'Br', RWF:'RF', BRL:'R$', MXN:'$', COP:'$', ARS:'$',
  PEN:'S/', CLP:'$', CRC:'₡', CAD:'$', AUD:'$', NZD:'$', SGD:'$',
  HKD:'HK$', JPY:'¥', KRW:'₩', CNY:'¥', AED:'AED', SAR:'SR', QAR:'QR',
  KWD:'KD', BHD:'BD', OMR:'OMR', JOD:'JD', ILS:'₪', TRY:'₺',
  RUB:'₽', UAH:'₴', PLN:'zł', CHF:'Fr', SEK:'kr', NOK:'kr', DKK:'kr',
}[cur] || cur + ' ');


// ═══════════════════════════════════════════════════════════════
// BANK LOGO SYSTEM - Real logos via Clearbit + fallback
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// BANK LOGO SYSTEM — Pure inline SVG, zero external calls
// ═══════════════════════════════════════════════════════════════
const BANK_LOGOS = {
  // ── USA ─────────────────────────────────────────────────────
  chase: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#117ACA"/><rect x="22" y="8" width="14" height="14" fill="white"/><rect x="8" y="22" width="14" height="14" fill="white"/><rect x="22" y="22" width="14" height="14" fill="white" opacity="0.4"/><rect x="8" y="8" width="14" height="14" fill="white" opacity="0.4"/></svg>`,
  bank_of_america: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#E31837"/><text x="22" y="29" text-anchor="middle" font-size="13" font-weight="900" fill="white" font-family="Arial">BofA</text></svg>`,
  wells_fargo: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#CD2026"/><rect x="7" y="14" width="30" height="16" rx="3" fill="#FFCC00"/><text x="22" y="26" text-anchor="middle" font-size="9" font-weight="900" fill="#CD2026" font-family="Arial">WELLS</text></svg>`,
  citibank: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#003B80"/><text x="22" y="27" text-anchor="middle" font-size="12" font-weight="900" fill="white" font-family="Arial">citi</text><path d="M30 18 Q34 14 34 18" stroke="#E31837" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`,
  us_bank: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#003082"/><text x="22" y="24" text-anchor="middle" font-size="10" font-weight="900" fill="white" font-family="Arial">U.S.</text><text x="22" y="34" text-anchor="middle" font-size="10" font-weight="900" fill="white" font-family="Arial">BANK</text></svg>`,
  paypal_us: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#003087"/><text x="21" y="29" text-anchor="middle" font-size="22" font-weight="900" fill="#009cde" font-family="Arial">P</text><text x="26" y="29" text-anchor="middle" font-size="22" font-weight="900" fill="white" font-family="Arial">P</text></svg>`,
  cashapp: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#00C244"/><text x="22" y="30" text-anchor="middle" font-size="22" font-weight="900" fill="white" font-family="Arial">$</text></svg>`,
  venmo: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#3396CD"/><text x="22" y="30" text-anchor="middle" font-size="20" font-weight="900" fill="white" font-family="Arial">V</text></svg>`,
  zelle: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#6D1ED4"/><text x="22" y="30" text-anchor="middle" font-size="20" font-weight="900" fill="white" font-family="Arial">Z</text></svg>`,
  ally: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#7B2282"/><text x="22" y="29" text-anchor="middle" font-size="13" font-weight="900" fill="white" font-family="Arial">ally</text></svg>`,
  // ── UK ──────────────────────────────────────────────────────
  barclays: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#00AEEF"/><path d="M22 10 C22 10 14 16 14 22 C14 28 18 34 22 34 C26 34 30 28 30 22 C30 16 22 10 22 10Z" fill="white" opacity="0.9"/></svg>`,
  hsbc_uk: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#DB0011"/><polygon points="22,8 36,22 22,36 8,22" fill="white" opacity="0.9"/><polygon points="22,14 30,22 22,30 14,22" fill="#DB0011"/></svg>`,
  lloyds: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#024638"/><path d="M17 10 Q22 8 22 14 Q22 20 16 24 Q22 28 22 34 Q22 38 17 36" stroke="#006B3C" stroke-width="0" fill="none"/><ellipse cx="22" cy="22" rx="8" ry="12" fill="#006B3C" opacity="0.8"/><text x="22" y="26" text-anchor="middle" font-size="12" font-weight="900" fill="white" font-family="Arial">L</text></svg>`,
  natwest: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#42145F"/><rect x="10" y="16" width="10" height="12" rx="2" fill="white"/><rect x="24" y="16" width="10" height="12" rx="2" fill="#DA291C"/><rect x="17" y="20" width="10" height="4" fill="white" opacity="0.6"/></svg>`,
  monzo: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#FF3464"/><path d="M10 30 L16 14 L22 26 L28 14 L34 30" stroke="white" stroke-width="3" fill="none" stroke-linejoin="round" stroke-linecap="round"/></svg>`,
  revolut: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#191C1F"/><text x="22" y="30" text-anchor="middle" font-size="12" font-weight="900" fill="white" font-family="Arial">revolut</text></svg>`,
  starling: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#7033FF"/><circle cx="22" cy="22" r="10" fill="none" stroke="white" stroke-width="3"/><circle cx="22" cy="22" r="4" fill="white"/></svg>`,
  nationwide: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#1C2D6E"/><text x="22" y="24" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">Nation</text><text x="22" y="34" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">wide</text></svg>`,
  santander_uk: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#EC0000"/><circle cx="15" cy="22" r="7" fill="white" opacity="0.9"/><circle cx="22" cy="22" r="7" fill="white" opacity="0.9"/><circle cx="29" cy="22" r="7" fill="white" opacity="0.9"/></svg>`,
  halifax: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#003882"/><text x="22" y="29" text-anchor="middle" font-size="11" font-weight="900" fill="white" font-family="Arial">HFAX</text></svg>`,
  // ── NIGERIA ─────────────────────────────────────────────────
  access: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#E60026"/><path d="M22 8 L28 22 L22 36 L16 22 Z" fill="white" opacity="0.9"/></svg>`,
  firstbank: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#004A97"/><text x="22" y="24" text-anchor="middle" font-size="10" font-weight="900" fill="white" font-family="Arial">First</text><text x="22" y="34" text-anchor="middle" font-size="10" font-weight="900" fill="#FFC20E" font-family="Arial">BANK</text></svg>`,
  gtbank: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#F58220"/><text x="22" y="28" text-anchor="middle" font-size="16" font-weight="900" fill="white" font-family="Arial">GT</text></svg>`,
  uba: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#C8102E"/><text x="22" y="29" text-anchor="middle" font-size="13" font-weight="900" fill="white" font-family="Arial">UBA</text></svg>`,
  zenith: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#862633"/><polygon points="22,8 36,36 8,36" fill="none" stroke="white" stroke-width="2.5"/><text x="22" y="32" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">ZENITH</text></svg>`,
  opay: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#00B140"/><text x="22" y="29" text-anchor="middle" font-size="13" font-weight="900" fill="white" font-family="Arial">OPay</text></svg>`,
  kuda: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#40196B"/><text x="22" y="29" text-anchor="middle" font-size="13" font-weight="900" fill="white" font-family="Arial">kuda</text></svg>`,
  palmpay: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#01A15A"/><path d="M14 30 Q14 14 22 14 Q30 14 30 22 Q30 30 22 30" fill="white" opacity="0.9"/></svg>`,
  moniepoint: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#0166FF"/><text x="22" y="27" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">monie</text><text x="22" y="36" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">point</text></svg>`,
  sterling: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#DA291C"/><text x="22" y="27" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">Sterling</text><text x="22" y="36" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">BANK</text></svg>`,
  union: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#042B61"/><text x="22" y="27" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">Union</text><text x="22" y="36" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">BANK</text></svg>`,
  fidelity: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#006755"/><text x="22" y="27" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">Fidelity</text><text x="22" y="36" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">BANK</text></svg>`,
  fcmb: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#32127A"/><text x="22" y="29" text-anchor="middle" font-size="12" font-weight="900" fill="white" font-family="Arial">FCMB</text></svg>`,
  stanbic: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#009FDF"/><path d="M10 28 L22 10 L34 28" stroke="white" stroke-width="3" fill="none"/><text x="22" y="37" text-anchor="middle" font-size="8" font-weight="900" fill="white" font-family="Arial">STANBIC</text></svg>`,
  providus: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#8B2FC9"/><text x="22" y="29" text-anchor="middle" font-size="11" font-weight="900" fill="white" font-family="Arial">PVB</text></svg>`,
  // ── GHANA ───────────────────────────────────────────────────
  gcb: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#006341"/><text x="22" y="29" text-anchor="middle" font-size="13" font-weight="900" fill="white" font-family="Arial">GCB</text></svg>`,
  ecobank_gh: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#003087"/><text x="22" y="24" text-anchor="middle" font-size="10" font-weight="900" fill="white" font-family="Arial">eco</text><text x="22" y="34" text-anchor="middle" font-size="10" font-weight="900" fill="#FFC20E" font-family="Arial">bank</text></svg>`,
  absa_gh: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#DC0032"/><circle cx="22" cy="22" r="9" fill="none" stroke="white" stroke-width="3"/><text x="22" y="26" text-anchor="middle" font-size="10" font-weight="900" fill="white" font-family="Arial">absa</text></svg>`,
  stanbic_gh: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#009FDF"/><path d="M10 28 L22 10 L34 28" stroke="white" stroke-width="3" fill="none"/></svg>`,
  mtn_momo: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#FFC403"/><text x="22" y="24" text-anchor="middle" font-size="12" font-weight="900" fill="#1C1C1C" font-family="Arial">MTN</text><text x="22" y="34" text-anchor="middle" font-size="9" font-weight="900" fill="#1C1C1C" font-family="Arial">MoMo</text></svg>`,
  vodafone_cash: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#E60000"/><circle cx="22" cy="20" r="9" fill="none" stroke="white" stroke-width="3"/><path d="M28 26 Q32 32 22 36" stroke="white" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`,
  airteltigo: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#FF0000"/><path d="M8 30 Q22 6 36 30" stroke="white" stroke-width="3" fill="none"/><path d="M14 30 Q22 14 30 30" stroke="white" stroke-width="2" fill="none"/></svg>`,
  zeepay_gh: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#0066CC"/><text x="22" y="29" text-anchor="middle" font-size="11" font-weight="900" fill="white" font-family="Arial">ZeePay</text></svg>`,
  // ── KENYA ───────────────────────────────────────────────────
  mpesa: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#00A650"/><text x="22" y="24" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">M-PESA</text><circle cx="22" cy="32" r="4" fill="white" opacity="0.9"/></svg>`,
  kcb: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#006633"/><text x="22" y="29" text-anchor="middle" font-size="13" font-weight="900" fill="white" font-family="Arial">KCB</text></svg>`,
  equity: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#AA0000"/><path d="M12 14 L32 14 L32 18 L12 18 Z" fill="white"/><path d="M12 20 L26 20 L26 24 L12 24 Z" fill="white"/><path d="M12 26 L32 26 L32 30 L12 30 Z" fill="white"/></svg>`,
  coop: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#003580"/><text x="22" y="24" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">Co-op</text><text x="22" y="34" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">Bank</text></svg>`,
  stanbic_ke: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#009FDF"/><path d="M10 28 L22 10 L34 28" stroke="white" stroke-width="3" fill="none"/></svg>`,
  ncba: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#1C2D6E"/><text x="22" y="29" text-anchor="middle" font-size="12" font-weight="900" fill="white" font-family="Arial">NCBA</text></svg>`,
  absa_ke: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#DC0032"/><circle cx="22" cy="22" r="9" fill="none" stroke="white" stroke-width="3"/><text x="22" y="26" text-anchor="middle" font-size="10" font-weight="900" fill="white" font-family="Arial">absa</text></svg>`,
  airtel_ke: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#FF0000"/><path d="M8 30 Q22 6 36 30" stroke="white" stroke-width="3" fill="none"/></svg>`,
  // ── INDIA ───────────────────────────────────────────────────
  sbi: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#2C3E7F"/><circle cx="22" cy="18" r="7" fill="none" stroke="white" stroke-width="2"/><path d="M15 18 Q22 28 29 18" fill="#2C3E7F"/><text x="22" y="35" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">SBI</text></svg>`,
  hdfc: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#004C8F"/><text x="22" y="29" text-anchor="middle" font-size="11" font-weight="900" fill="white" font-family="Arial">HDFC</text></svg>`,
  icici: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#F6821F"/><text x="22" y="24" text-anchor="middle" font-size="10" font-weight="900" fill="white" font-family="Arial">ICICI</text><text x="22" y="34" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">Bank</text></svg>`,
  axis: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#800000"/><path d="M12 30 L22 12 L32 30" stroke="white" stroke-width="2.5" fill="none"/><path d="M16 24 L28 24" stroke="white" stroke-width="2.5"/></svg>`,
  kotak: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#ED1C24"/><text x="22" y="24" text-anchor="middle" font-size="10" font-weight="900" fill="white" font-family="Arial">Kotak</text><text x="22" y="34" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">811</text></svg>`,
  paytm: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#00BAF2"/><text x="22" y="29" text-anchor="middle" font-size="11" font-weight="900" fill="white" font-family="Arial">Paytm</text></svg>`,
  phonepe: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#5F259F"/><text x="22" y="24" text-anchor="middle" font-size="10" font-weight="900" fill="white" font-family="Arial">Phone</text><text x="22" y="34" text-anchor="middle" font-size="10" font-weight="900" fill="white" font-family="Arial">Pe</text></svg>`,
  gpay_in: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#ffffff"/><text x="13" y="27" font-size="16" font-weight="900" fill="#4285F4" font-family="Arial">G</text><text x="24" y="27" font-size="16" font-weight="900" fill="#EA4335" font-family="Arial">P</text></svg>`,
  upi: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#097939"/><text x="22" y="29" text-anchor="middle" font-size="14" font-weight="900" fill="white" font-family="Arial">UPI</text></svg>`,
  pnb: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#E00000"/><text x="22" y="29" text-anchor="middle" font-size="13" font-weight="900" fill="white" font-family="Arial">PNB</text></svg>`,
  canara: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#003087"/><text x="22" y="29" text-anchor="middle" font-size="11" font-weight="900" fill="white" font-family="Arial">Canara</text></svg>`,
  bob: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#F26C20"/><text x="22" y="29" text-anchor="middle" font-size="13" font-weight="900" fill="white" font-family="Arial">BOB</text></svg>`,
  // ── PAKISTAN ────────────────────────────────────────────────
  jazzcash: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#E31837"/><text x="22" y="24" text-anchor="middle" font-size="10" font-weight="900" fill="white" font-family="Arial">Jazz</text><text x="22" y="34" text-anchor="middle" font-size="10" font-weight="900" fill="white" font-family="Arial">Cash</text></svg>`,
  easypaisa: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#59B200"/><text x="22" y="24" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">easy</text><text x="22" y="34" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">paisa</text></svg>`,
  hbl: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#00563F"/><text x="22" y="29" text-anchor="middle" font-size="14" font-weight="900" fill="white" font-family="Arial">HBL</text></svg>`,
  mcb_pk: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#BE0000"/><text x="22" y="29" text-anchor="middle" font-size="13" font-weight="900" fill="white" font-family="Arial">MCB</text></svg>`,
  ubl: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#00539B"/><text x="22" y="29" text-anchor="middle" font-size="14" font-weight="900" fill="white" font-family="Arial">UBL</text></svg>`,
  meezan: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#00856F"/><path d="M12 26 Q17 12 22 20 Q27 28 32 14" stroke="white" stroke-width="2.5" fill="none" stroke-linecap="round"/><text x="22" y="37" text-anchor="middle" font-size="8" font-weight="900" fill="white" font-family="Arial">MEEZAN</text></svg>`,
  bankislami: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#006838"/><path d="M22 10 Q30 16 30 22 Q30 28 22 34 Q14 28 14 22 Q14 16 22 10Z" fill="none" stroke="white" stroke-width="2"/></svg>`,
  nayapay: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#7B4AF8"/><text x="22" y="29" text-anchor="middle" font-size="10" font-weight="900" fill="white" font-family="Arial">NayaPay</text></svg>`,
  sadapay: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#00D09C"/><text x="22" y="29" text-anchor="middle" font-size="10" font-weight="900" fill="white" font-family="Arial">SadaPay</text></svg>`,
  // ── PHILIPPINES ─────────────────────────────────────────────
  gcash: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#007DFF"/><text x="22" y="29" text-anchor="middle" font-size="11" font-weight="900" fill="white" font-family="Arial">GCash</text></svg>`,
  maya: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#59C15A"/><text x="22" y="29" text-anchor="middle" font-size="12" font-weight="900" fill="white" font-family="Arial">maya</text></svg>`,
  bdo: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#003087"/><text x="22" y="29" text-anchor="middle" font-size="14" font-weight="900" fill="white" font-family="Arial">BDO</text></svg>`,
  bpi: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#CC0001"/><text x="22" y="29" text-anchor="middle" font-size="15" font-weight="900" fill="white" font-family="Arial">BPI</text></svg>`,
  metrobank: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#002366"/><rect x="10" y="17" width="24" height="4" rx="2" fill="white"/><rect x="10" y="23" width="24" height="4" rx="2" fill="white"/></svg>`,
  landbank: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#006633"/><text x="22" y="24" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">Land</text><text x="22" y="34" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">Bank</text></svg>`,
  pnb_ph: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#003082"/><text x="22" y="29" text-anchor="middle" font-size="13" font-weight="900" fill="white" font-family="Arial">PNB</text></svg>`,
  seabank: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#EE3524"/><path d="M8 26 Q14 18 22 22 Q30 26 36 18" stroke="white" stroke-width="2.5" fill="none" stroke-linecap="round"/></svg>`,
  // ── SOUTH AFRICA ────────────────────────────────────────────
  fnb: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#006A4D"/><text x="22" y="29" text-anchor="middle" font-size="14" font-weight="900" fill="white" font-family="Arial">FNB</text></svg>`,
  absa: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#DC0032"/><circle cx="22" cy="22" r="9" fill="none" stroke="white" stroke-width="3"/><text x="22" y="26" text-anchor="middle" font-size="10" font-weight="900" fill="white" font-family="Arial">absa</text></svg>`,
  standard_za: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#00529B"/><rect x="10" y="16" width="24" height="3" rx="1.5" fill="white"/><rect x="10" y="21" width="18" height="3" rx="1.5" fill="white"/><rect x="10" y="26" width="24" height="3" rx="1.5" fill="white"/></svg>`,
  nedbank: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#009B77"/><path d="M12 30 L12 14 L22 26 L32 14 L32 30" stroke="white" stroke-width="2.5" fill="none" stroke-linejoin="round"/></svg>`,
  capitec: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#0098DB"/><text x="22" y="24" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">capitec</text><text x="22" y="34" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">bank</text></svg>`,
  discovery_za: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#003087"/><circle cx="22" cy="20" r="8" fill="none" stroke="white" stroke-width="2.5"/><path d="M22 28 L22 36" stroke="white" stroke-width="2.5"/></svg>`,
  tyme: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#FF5700"/><text x="22" y="24" text-anchor="middle" font-size="10" font-weight="900" fill="white" font-family="Arial">Tyme</text><text x="22" y="34" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">Bank</text></svg>`,
  // ── OTHERS (simplified but branded) ─────────────────────────
  mpesa_tz: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#E3001B"/><text x="22" y="24" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">M-PESA</text><text x="22" y="34" text-anchor="middle" font-size="8" font-weight="700" fill="white" font-family="Arial">Tanzania</text></svg>`,
  airtel_tz: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#FF0000"/><path d="M8 30 Q22 6 36 30" stroke="white" stroke-width="3" fill="none"/></svg>`,
  tigo_tz: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#0072C6"/><text x="22" y="29" text-anchor="middle" font-size="12" font-weight="900" fill="white" font-family="Arial">Tigo</text></svg>`,
  crdb: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#008000"/><text x="22" y="29" text-anchor="middle" font-size="12" font-weight="900" fill="white" font-family="Arial">CRDB</text></svg>`,
  nmb_tz: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#003087"/><text x="22" y="29" text-anchor="middle" font-size="13" font-weight="900" fill="white" font-family="Arial">NMB</text></svg>`,
  mtn_ug: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#FFC403"/><text x="22" y="29" text-anchor="middle" font-size="12" font-weight="900" fill="#1C1C1C" font-family="Arial">MTN</text></svg>`,
  airtel_ug: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#FF0000"/><path d="M8 30 Q22 6 36 30" stroke="white" stroke-width="3" fill="none"/></svg>`,
  stanbic_ug: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#009FDF"/><path d="M10 28 L22 10 L34 28" stroke="white" stroke-width="3" fill="none"/></svg>`,
  equity_ug: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#AA0000"/><path d="M12 14 L32 14 L32 18 L12 18 Z" fill="white"/><path d="M12 20 L26 20 L26 24 L12 24 Z" fill="white"/><path d="M12 26 L32 26 L32 30 L12 30 Z" fill="white"/></svg>`,
  telebirr: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#0066B3"/><text x="22" y="29" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">telebirr</text></svg>`,
  cbe_et: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#007749"/><text x="22" y="29" text-anchor="middle" font-size="13" font-weight="900" fill="white" font-family="Arial">CBE</text></svg>`,
  dashen: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#003087"/><text x="22" y="29" text-anchor="middle" font-size="10" font-weight="900" fill="white" font-family="Arial">Dashen</text></svg>`,
  mtn_rw: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#FFC403"/><text x="22" y="29" text-anchor="middle" font-size="12" font-weight="900" fill="#1C1C1C" font-family="Arial">MTN</text></svg>`,
  airtel_rw: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#FF0000"/><path d="M8 30 Q22 6 36 30" stroke="white" stroke-width="3" fill="none"/></svg>`,
  bnr: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#009F6B"/><text x="22" y="29" text-anchor="middle" font-size="13" font-weight="900" fill="white" font-family="Arial">BPR</text></svg>`,
  vodafone_eg: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#E60000"/><circle cx="22" cy="20" r="9" fill="none" stroke="white" stroke-width="3"/><path d="M28 26 Q32 32 22 36" stroke="white" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`,
  cib_eg: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#003087"/><text x="22" y="29" text-anchor="middle" font-size="14" font-weight="900" fill="white" font-family="Arial">CIB</text></svg>`,
  nbe_eg: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#C8102E"/><text x="22" y="29" text-anchor="middle" font-size="13" font-weight="900" fill="white" font-family="Arial">NBE</text></svg>`,
  instapay_eg: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#00A651"/><text x="22" y="29" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">InstaPay</text></svg>`,
  cih_ma: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#003087"/><text x="22" y="29" text-anchor="middle" font-size="14" font-weight="900" fill="white" font-family="Arial">CIH</text></svg>`,
  attijariwafa: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#E60026"/><text x="22" y="29" text-anchor="middle" font-size="11" font-weight="900" fill="white" font-family="Arial">Attijari</text></svg>`,
  bmce: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#003087"/><text x="22" y="29" text-anchor="middle" font-size="12" font-weight="900" fill="white" font-family="Arial">BMCE</text></svg>`,
  bkash: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#E2136E"/><text x="22" y="29" text-anchor="middle" font-size="11" font-weight="900" fill="white" font-family="Arial">bKash</text></svg>`,
  nagad: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#F18C00"/><text x="22" y="29" text-anchor="middle" font-size="12" font-weight="900" fill="white" font-family="Arial">Nagad</text></svg>`,
  rocket: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#7B1FA2"/><path d="M22 8 L26 20 L34 22 L26 24 L28 36 L22 28 L16 36 L18 24 L10 22 L18 20 Z" fill="white" opacity="0.9"/></svg>`,
  dutch_bangla: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#006633"/><text x="22" y="29" text-anchor="middle" font-size="12" font-weight="900" fill="white" font-family="Arial">DBBL</text></svg>`,
  maybank: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#F7B731"/><text x="22" y="29" text-anchor="middle" font-size="9" font-weight="900" fill="#1C1C1C" font-family="Arial">Maybank</text></svg>`,
  cimb_my: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#B81C22"/><text x="22" y="29" text-anchor="middle" font-size="12" font-weight="900" fill="white" font-family="Arial">CIMB</text></svg>`,
  tng: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#0066CC"/><text x="22" y="29" text-anchor="middle" font-size="12" font-weight="900" fill="white" font-family="Arial">TnG</text></svg>`,
  boost_my: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#E20026"/><path d="M14 22 L22 10 L30 22 L22 28 Z" fill="white" opacity="0.9"/></svg>`,
  rhb_my: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#C8102E"/><text x="22" y="29" text-anchor="middle" font-size="14" font-weight="900" fill="white" font-family="Arial">RHB</text></svg>`,
  gopay: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#00AED6"/><text x="22" y="24" text-anchor="middle" font-size="10" font-weight="900" fill="white" font-family="Arial">Go</text><text x="22" y="34" text-anchor="middle" font-size="10" font-weight="900" fill="white" font-family="Arial">Pay</text></svg>`,
  ovo: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#4C2C92"/><text x="22" y="29" text-anchor="middle" font-size="14" font-weight="900" fill="white" font-family="Arial">OVO</text></svg>`,
  dana_id: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#118EEA"/><text x="22" y="29" text-anchor="middle" font-size="12" font-weight="900" fill="white" font-family="Arial">DANA</text></svg>`,
  bca: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#003087"/><text x="22" y="29" text-anchor="middle" font-size="14" font-weight="900" fill="white" font-family="Arial">BCA</text></svg>`,
  bri_id: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#003087"/><text x="22" y="29" text-anchor="middle" font-size="14" font-weight="900" fill="white" font-family="Arial">BRI</text></svg>`,
  mandiri: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#003087"/><rect x="10" y="18" width="24" height="8" rx="4" fill="#FFC403"/><text x="22" y="35" text-anchor="middle" font-size="8" font-weight="900" fill="white" font-family="Arial">mandiri</text></svg>`,
  promptpay: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#1A3668"/><text x="22" y="24" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">Prompt</text><text x="22" y="34" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">Pay</text></svg>`,
  kbank: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#009A44"/><text x="22" y="24" text-anchor="middle" font-size="12" font-weight="900" fill="white" font-family="Arial">K</text><text x="22" y="34" text-anchor="middle" font-size="8" font-weight="900" fill="white" font-family="Arial">BANK</text></svg>`,
  scb_th: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#4E2683"/><text x="22" y="29" text-anchor="middle" font-size="13" font-weight="900" fill="white" font-family="Arial">SCB</text></svg>`,
  truemoney: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#F05623"/><text x="22" y="24" text-anchor="middle" font-size="10" font-weight="900" fill="white" font-family="Arial">True</text><text x="22" y="34" text-anchor="middle" font-size="10" font-weight="900" fill="white" font-family="Arial">Money</text></svg>`,
  momo_vn: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#AE2070"/><text x="22" y="29" text-anchor="middle" font-size="12" font-weight="900" fill="white" font-family="Arial">MoMo</text></svg>`,
  vietcombank: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#006C35"/><text x="22" y="24" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">Viet</text><text x="22" y="34" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">combank</text></svg>`,
  zalopay: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#0066FF"/><text x="22" y="29" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">ZaloPay</text></svg>`,
  techcombank: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#C8102E"/><text x="22" y="24" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">Tech</text><text x="22" y="34" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">combank</text></svg>`,
  enbd: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#1F3A70"/><text x="22" y="29" text-anchor="middle" font-size="12" font-weight="900" fill="#FFD700" font-family="Arial">ENBD</text></svg>`,
  adcb: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#D4002A"/><text x="22" y="29" text-anchor="middle" font-size="12" font-weight="900" fill="white" font-family="Arial">ADCB</text></svg>`,
  fab: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#AA8C2C"/><text x="22" y="29" text-anchor="middle" font-size="14" font-weight="900" fill="white" font-family="Arial">FAB</text></svg>`,
  mashreq: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#E40520"/><text x="22" y="29" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">Mashreq</text></svg>`,
  cbd_ae: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#003087"/><text x="22" y="29" text-anchor="middle" font-size="14" font-weight="900" fill="white" font-family="Arial">CBD</text></svg>`,
  stcpay: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#7A1FA2"/><text x="22" y="24" text-anchor="middle" font-size="11" font-weight="900" fill="white" font-family="Arial">STC</text><text x="22" y="34" text-anchor="middle" font-size="11" font-weight="900" fill="white" font-family="Arial">Pay</text></svg>`,
  al_rajhi: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#006633"/><path d="M14 28 L14 18 Q14 12 22 12 Q30 12 30 18 L30 28" stroke="white" stroke-width="2.5" fill="none"/></svg>`,
  sab: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#DB0011"/><rect x="10" y="19" width="24" height="6" rx="3" fill="white"/></svg>`,
  ncb: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#005B9F"/><text x="22" y="29" text-anchor="middle" font-size="13" font-weight="900" fill="white" font-family="Arial">NCB</text></svg>`,
  pix: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#32BCAD"/><path d="M18 14 L26 22 L18 30" stroke="white" stroke-width="2.5" stroke-linejoin="round" fill="none"/><path d="M26 14 L18 22 L26 30" stroke="white" stroke-width="2.5" stroke-linejoin="round" fill="none"/></svg>`,
  itau: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#EC7000"/><text x="22" y="29" text-anchor="middle" font-size="12" font-weight="900" fill="white" font-family="Arial">itaú</text></svg>`,
  nubank: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#820AD1"/><text x="22" y="29" text-anchor="middle" font-size="14" font-weight="900" fill="white" font-family="Arial">nu</text></svg>`,
  bradesco: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#CC0000"/><text x="22" y="29" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">Bradesco</text></svg>`,
  bb: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#FDDB00"/><text x="22" y="29" text-anchor="middle" font-size="16" font-weight="900" fill="#003087" font-family="Arial">BB</text></svg>`,
  bbva_mx: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#004481"/><text x="22" y="29" text-anchor="middle" font-size="12" font-weight="900" fill="white" font-family="Arial">BBVA</text></svg>`,
  banamex: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#CC0000"/><text x="22" y="29" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">Banamex</text></svg>`,
  mercadopago: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#009EE3"/><text x="22" y="24" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">Mercado</text><text x="22" y="34" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">Pago</text></svg>`,
  rbc: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#003087"/><circle cx="22" cy="18" r="7" fill="none" stroke="#FFD700" stroke-width="2.5"/><text x="22" y="35" text-anchor="middle" font-size="12" font-weight="900" fill="white" font-family="Arial">RBC</text></svg>`,
  td_ca: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#1A9E3F"/><text x="22" y="29" text-anchor="middle" font-size="16" font-weight="900" fill="white" font-family="Arial">TD</text></svg>`,
  interac: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#FDB913"/><text x="22" y="29" text-anchor="middle" font-size="9" font-weight="900" fill="#1C1C1C" font-family="Arial">Interac</text></svg>`,
  scotiabank: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#CC0000"/><rect x="10" y="12" width="24" height="20" rx="3" fill="none" stroke="white" stroke-width="2"/><text x="22" y="27" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">SCOTIA</text></svg>`,
  bmo: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#0079C1"/><text x="22" y="29" text-anchor="middle" font-size="14" font-weight="900" fill="white" font-family="Arial">BMO</text></svg>`,
  anz: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#007DBA"/><text x="22" y="29" text-anchor="middle" font-size="14" font-weight="900" fill="white" font-family="Arial">ANZ</text></svg>`,
  cba: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#FFCC00"/><text x="22" y="29" text-anchor="middle" font-size="13" font-weight="900" fill="#000" font-family="Arial">CBA</text></svg>`,
  westpac: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#DA1710"/><text x="22" y="29" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">Westpac</text></svg>`,
  nab: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#CC0000"/><text x="22" y="29" text-anchor="middle" font-size="14" font-weight="900" fill="white" font-family="Arial">NAB</text></svg>`,
  payid: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#007DBA"/><text x="22" y="29" text-anchor="middle" font-size="10" font-weight="900" fill="white" font-family="Arial">PayID</text></svg>`,
  dbs: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#E60028"/><text x="22" y="29" text-anchor="middle" font-size="14" font-weight="900" fill="white" font-family="Arial">DBS</text></svg>`,
  ocbc: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#CC0000"/><text x="22" y="29" text-anchor="middle" font-size="12" font-weight="900" fill="white" font-family="Arial">OCBC</text></svg>`,
  uob_sg: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#002FA7"/><text x="22" y="29" text-anchor="middle" font-size="14" font-weight="900" fill="white" font-family="Arial">UOB</text></svg>`,
  paynow: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#782F8C"/><text x="22" y="24" text-anchor="middle" font-size="10" font-weight="900" fill="white" font-family="Arial">Pay</text><text x="22" y="34" text-anchor="middle" font-size="10" font-weight="900" fill="white" font-family="Arial">Now</text></svg>`,
  papara: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#7B2CFF"/><text x="22" y="29" text-anchor="middle" font-size="11" font-weight="900" fill="white" font-family="Arial">Papara</text></svg>`,
  isbankasi: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#003087"/><text x="22" y="29" text-anchor="middle" font-size="12" font-weight="900" fill="white" font-family="Arial">İŞ</text></svg>`,
  akbank: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#CC0000"/><text x="22" y="29" text-anchor="middle" font-size="10" font-weight="900" fill="white" font-family="Arial">Akbank</text></svg>`,
  garanti: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#009640"/><text x="22" y="29" text-anchor="middle" font-size="9" font-weight="900" fill="white" font-family="Arial">Garanti</text></svg>`,
  blik: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#E2001A"/><text x="22" y="29" text-anchor="middle" font-size="14" font-weight="900" fill="white" font-family="Arial">BLIK</text></svg>`,
  pko: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#003087"/><text x="22" y="29" text-anchor="middle" font-size="13" font-weight="900" fill="white" font-family="Arial">PKO</text></svg>`,
  mbank: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#CC0000"/><text x="22" y="29" text-anchor="middle" font-size="13" font-weight="900" fill="white" font-family="Arial">m</text></svg>`,
  ubs: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#E60026"/><text x="22" y="29" text-anchor="middle" font-size="14" font-weight="900" fill="white" font-family="Arial">UBS</text></svg>`,
  credit_suisse: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#003087"/><text x="22" y="29" text-anchor="middle" font-size="12" font-weight="900" fill="white" font-family="Arial">CS</text></svg>`,
  twint: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" rx="10" fill="#000000"/><text x="22" y="29" text-anchor="middle" font-size="10" font-weight="900" fill="white" font-family="Arial">TWINT</text></svg>`,
};

function getBankLogoHTML(bank, size) {
  size = size || 44;
  const svg = BANK_LOGOS[bank.id];
  const borderRadius = size >= 48 ? '12px' : '10px';
  if (svg) {
    // Scale SVG to requested size
    const scaled = svg.replace('viewBox="0 0 44 44"', `viewBox="0 0 44 44" width="${size}" height="${size}" style="border-radius:${borderRadius};display:block;flex-shrink:0"`);
    return `<div style="width:${size}px;height:${size}px;border-radius:${borderRadius};overflow:hidden;flex-shrink:0">${scaled}</div>`;
  }
  // Fallback: colored badge with initials
  const fontSize = size >= 48 ? '12px' : '10px';
  return `<div style="width:${size}px;height:${size}px;border-radius:${borderRadius};background:${bank.color};display:flex;align-items:center;justify-content:center;flex-shrink:0">
    <span style="font-size:${fontSize};font-weight:800;color:#fff;letter-spacing:-.5px">${bank.logo}</span>
  </div>`;
}

// COUNTRIES with banks// COUNTRIES with banks
const COUNTRIES = [
  { code:'US', name:'United States', flag:'🇺🇸', currency:'USD', color:'#1a237e' },
  { code:'GB', name:'United Kingdom', flag:'🇬🇧', currency:'GBP', color:'#c62828' },
  { code:'NG', name:'Nigeria', flag:'🇳🇬', currency:'NGN', color:'#1b5e20' },
  { code:'GH', name:'Ghana', flag:'🇬🇭', currency:'GHS', color:'#b71c1c' },
  { code:'KE', name:'Kenya', flag:'🇰🇪', currency:'KES', color:'#1b5e20' },
  { code:'IN', name:'India', flag:'🇮🇳', currency:'INR', color:'#e65100' },
  { code:'PK', name:'Pakistan', flag:'🇵🇰', currency:'PKR', color:'#1b5e20' },
  { code:'PH', name:'Philippines', flag:'🇵🇭', currency:'PHP', color:'#0d47a1' },
  { code:'ZA', name:'South Africa', flag:'🇿🇦', currency:'ZAR', color:'#1b5e20' },
  { code:'TZ', name:'Tanzania', flag:'🇹🇿', currency:'TZS', color:'#01579b' },
  { code:'UG', name:'Uganda', flag:'🇺🇬', currency:'UGX', color:'#1b5e20' },
  { code:'ET', name:'Ethiopia', flag:'🇪🇹', currency:'ETB', color:'#1b5e20' },
  { code:'RW', name:'Rwanda', flag:'🇷🇼', currency:'RWF', color:'#01579b' },
  { code:'EG', name:'Egypt', flag:'🇪🇬', currency:'EGP', color:'#c62828' },
  { code:'MA', name:'Morocco', flag:'🇲🇦', currency:'MAD', color:'#c62828' },
  { code:'NG2', name:'Côte d\'Ivoire', flag:'🇨🇮', currency:'XOF', color:'#e65100' },
  { code:'SN', name:'Senegal', flag:'🇸🇳', currency:'XOF', color:'#1b5e20' },
  { code:'BD', name:'Bangladesh', flag:'🇧🇩', currency:'BDT', color:'#1b5e20' },
  { code:'MY', name:'Malaysia', flag:'🇲🇾', currency:'MYR', color:'#c62828' },
  { code:'ID', name:'Indonesia', flag:'🇮🇩', currency:'IDR', color:'#c62828' },
  { code:'TH', name:'Thailand', flag:'🇹🇭', currency:'THB', color:'#1a237e' },
  { code:'VN', name:'Vietnam', flag:'🇻🇳', currency:'VND', color:'#c62828' },
  { code:'AE', name:'UAE', flag:'🇦🇪', currency:'AED', color:'#1b5e20' },
  { code:'SA', name:'Saudi Arabia', flag:'🇸🇦', currency:'SAR', color:'#1b5e20' },
  { code:'QA', name:'Qatar', flag:'🇶🇦', currency:'QAR', color:'#880e4f' },
  { code:'KW', name:'Kuwait', flag:'🇰🇼', currency:'KWD', color:'#1b5e20' },
  { code:'BR', name:'Brazil', flag:'🇧🇷', currency:'BRL', color:'#1b5e20' },
  { code:'MX', name:'Mexico', flag:'🇲🇽', currency:'MXN', color:'#c62828' },
  { code:'CA', name:'Canada', flag:'🇨🇦', currency:'CAD', color:'#c62828' },
  { code:'AU', name:'Australia', flag:'🇦🇺', currency:'AUD', color:'#1a237e' },
  { code:'SG', name:'Singapore', flag:'🇸🇬', currency:'SGD', color:'#c62828' },
  { code:'TR', name:'Turkey', flag:'🇹🇷', currency:'TRY', color:'#c62828' },
  { code:'PL', name:'Poland', flag:'🇵🇱', currency:'PLN', color:'#c62828' },
  { code:'CH', name:'Switzerland', flag:'🇨🇭', currency:'CHF', color:'#c62828' },
  { code:'MZ', name:'Mozambique', flag:'🇲🇿', currency:'MZN', color:'#1b5e20' },
  { code:'ZM', name:'Zambia', flag:'🇿🇲', currency:'ZMW', color:'#e65100' },
  { code:'MW', name:'Malawi', flag:'🇲🇼', currency:'MWK', color:'#c62828' },
];

// ALL BANKS per country
const BANKS_BY_COUNTRY = {
  US: [
    { id:'chase', name:'Chase Bank', color:'#117ACA', logo:'CHASE', accent:'#005B9F', fields:['accountNumber','routingNumber','accountName'] },
    { id:'bank_of_america', name:'Bank of America', color:'#E31837', logo:'BofA', accent:'#C41230', fields:['accountNumber','routingNumber','accountName'] },
    { id:'wells_fargo', name:'Wells Fargo', color:'#CD2026', logo:'WF', accent:'#A01B20', fields:['accountNumber','routingNumber','accountName'] },
    { id:'citibank', name:'Citibank', color:'#003B80', logo:'CITI', accent:'#002860', fields:['accountNumber','routingNumber','accountName'] },
    { id:'us_bank', name:'U.S. Bank', color:'#003082', logo:'USB', accent:'#002060', fields:['accountNumber','routingNumber','accountName'] },
    { id:'paypal_us', name:'PayPal', color:'#0070BA', logo:'PP', accent:'#005EA6', fields:['email','accountName'] },
    { id:'cashapp', name:'Cash App', color:'#00C244', logo:'$', accent:'#00A838', fields:['cashtag','accountName'] },
    { id:'venmo', name:'Venmo', color:'#3396CD', logo:'V', accent:'#2680B0', fields:['phone','accountName'] },
    { id:'zelle', name:'Zelle', color:'#6D1ED4', logo:'Z', accent:'#5A19AC', fields:['email','accountName'] },
    { id:'ally', name:'Ally Bank', color:'#7B2282', logo:'ALLY', accent:'#621A6A', fields:['accountNumber','routingNumber','accountName'] },
  ],
  GB: [
    { id:'barclays', name:'Barclays', color:'#00AEEF', logo:'B', accent:'#0090C8', fields:['sortCode','accountNumber','accountName'] },
    { id:'hsbc_uk', name:'HSBC UK', color:'#DB0011', logo:'HSBC', accent:'#B50010', fields:['sortCode','accountNumber','accountName'] },
    { id:'lloyds', name:'Lloyds Bank', color:'#024638', logo:'L', accent:'#013328', fields:['sortCode','accountNumber','accountName'] },
    { id:'natwest', name:'NatWest', color:'#42145F', logo:'NW', accent:'#31104A', fields:['sortCode','accountNumber','accountName'] },
    { id:'monzo', name:'Monzo', color:'#FF3464', logo:'M', accent:'#E02D57', fields:['sortCode','accountNumber','accountName'] },
    { id:'revolut', name:'Revolut', color:'#0666EB', logo:'R', accent:'#0550C0', fields:['phone','accountName'] },
    { id:'starling', name:'Starling Bank', color:'#7033FF', logo:'S', accent:'#5C2AD4', fields:['sortCode','accountNumber','accountName'] },
    { id:'nationwide', name:'Nationwide', color:'#1C2D6E', logo:'NBS', accent:'#152257', fields:['sortCode','accountNumber','accountName'] },
    { id:'santander_uk', name:'Santander UK', color:'#EC0000', logo:'SAN', accent:'#C40000', fields:['sortCode','accountNumber','accountName'] },
    { id:'halifax', name:'Halifax', color:'#003882', logo:'HFX', accent:'#002A60', fields:['sortCode','accountNumber','accountName'] },
  ],
  NG: [
    { id:'access', name:'Access Bank', color:'#E60026', logo:'AC', accent:'#C00020', fields:['accountNumber','accountName'] },
    { id:'firstbank', name:'First Bank', color:'#004A97', logo:'FB', accent:'#003878', fields:['accountNumber','accountName'] },
    { id:'gtbank', name:'GTBank', color:'#F58220', logo:'GT', accent:'#D4700C', fields:['accountNumber','accountName'] },
    { id:'uba', name:'UBA', color:'#C8102E', logo:'UBA', accent:'#A00D25', fields:['accountNumber','accountName'] },
    { id:'zenith', name:'Zenith Bank', color:'#862633', logo:'ZB', accent:'#6A1E28', fields:['accountNumber','accountName'] },
    { id:'opay', name:'OPay', color:'#00B140', logo:'OP', accent:'#009135', fields:['phone','accountName'] },
    { id:'kuda', name:'Kuda Bank', color:'#40196B', logo:'KD', accent:'#311452', fields:['accountNumber','accountName'] },
    { id:'palmpay', name:'PalmPay', color:'#01A15A', logo:'PP', accent:'#018047', fields:['phone','accountName'] },
    { id:'moniepoint', name:'Moniepoint', color:'#0166FF', logo:'MP', accent:'#0050CC', fields:['accountNumber','accountName'] },
    { id:'sterling', name:'Sterling Bank', color:'#DA291C', logo:'STB', accent:'#B52015', fields:['accountNumber','accountName'] },
    { id:'union', name:'Union Bank', color:'#042B61', logo:'UBN', accent:'#031F48', fields:['accountNumber','accountName'] },
    { id:'fidelity', name:'Fidelity Bank', color:'#006755', logo:'FBL', accent:'#005242', fields:['accountNumber','accountName'] },
    { id:'fcmb', name:'FCMB', color:'#32127A', logo:'FCMB', accent:'#270D60', fields:['accountNumber','accountName'] },
    { id:'stanbic', name:'Stanbic IBTC', color:'#009FDF', logo:'SB', accent:'#0082B8', fields:['accountNumber','accountName'] },
    { id:'providus', name:'Providus Bank', color:'#8B2FC9', logo:'PVB', accent:'#7024A8', fields:['accountNumber','accountName'] },
  ],
  GH: [
    { id:'gcb', name:'GCB Bank', color:'#006341', logo:'GCB', accent:'#004D33', fields:['accountNumber','accountName'] },
    { id:'ecobank_gh', name:'Ecobank Ghana', color:'#003087', logo:'ECO', accent:'#002468', fields:['accountNumber','accountName'] },
    { id:'absa_gh', name:'Absa Ghana', color:'#DC0032', logo:'ABSA', accent:'#B80028', fields:['accountNumber','accountName'] },
    { id:'stanbic_gh', name:'Stanbic Ghana', color:'#009FDF', logo:'STB', accent:'#0082B8', fields:['accountNumber','accountName'] },
    { id:'mtn_momo', name:'MTN MoMo', color:'#FFC403', logo:'MTN', accent:'#E0AC00', fields:['phone','accountName'] },
    { id:'vodafone_cash', name:'Vodafone Cash', color:'#E60000', logo:'VF', accent:'#C00000', fields:['phone','accountName'] },
    { id:'airteltigo', name:'AirtelTigo Money', color:'#FF0000', logo:'AT', accent:'#CC0000', fields:['phone','accountName'] },
    { id:'zeepay_gh', name:'Zeepay', color:'#0066CC', logo:'ZP', accent:'#0052A3', fields:['phone','accountName'] },
  ],
  KE: [
    { id:'mpesa', name:'M-Pesa', color:'#00A650', logo:'MP', accent:'#008740', fields:['phone','accountName'] },
    { id:'kcb', name:'KCB Bank', color:'#006633', logo:'KCB', accent:'#004D26', fields:['accountNumber','accountName'] },
    { id:'equity', name:'Equity Bank', color:'#AA0000', logo:'EQB', accent:'#880000', fields:['accountNumber','accountName'] },
    { id:'coop', name:'Co-op Bank', color:'#003580', logo:'COOP', accent:'#002860', fields:['accountNumber','accountName'] },
    { id:'stanbic_ke', name:'Stanbic Kenya', color:'#009FDF', logo:'STB', accent:'#0082B8', fields:['accountNumber','accountName'] },
    { id:'ncba', name:'NCBA Bank', color:'#1C2D6E', logo:'NCBA', accent:'#152257', fields:['accountNumber','accountName'] },
    { id:'absa_ke', name:'Absa Kenya', color:'#DC0032', logo:'ABSA', accent:'#B80028', fields:['accountNumber','accountName'] },
    { id:'airtel_ke', name:'Airtel Money KE', color:'#FF0000', logo:'AM', accent:'#CC0000', fields:['phone','accountName'] },
  ],
  IN: [
    { id:'sbi', name:'State Bank of India', color:'#2C3E7F', logo:'SBI', accent:'#1E2F6A', fields:['accountNumber','ifsc','accountName'] },
    { id:'hdfc', name:'HDFC Bank', color:'#004C8F', logo:'HDFC', accent:'#003B70', fields:['accountNumber','ifsc','accountName'] },
    { id:'icici', name:'ICICI Bank', color:'#F6821F', logo:'ICICI', accent:'#D4700C', fields:['accountNumber','ifsc','accountName'] },
    { id:'axis', name:'Axis Bank', color:'#800000', logo:'AXIS', accent:'#600000', fields:['accountNumber','ifsc','accountName'] },
    { id:'kotak', name:'Kotak Bank', color:'#ED1C24', logo:'KMB', accent:'#C8161C', fields:['accountNumber','ifsc','accountName'] },
    { id:'paytm', name:'Paytm', color:'#00B9F1', logo:'PTM', accent:'#0099CC', fields:['phone','accountName'] },
    { id:'phonepe', name:'PhonePe', color:'#5F259F', logo:'PPE', accent:'#4A1C82', fields:['phone','accountName'] },
    { id:'gpay_in', name:'Google Pay', color:'#4285F4', logo:'GPY', accent:'#2B72E0', fields:['phone','accountName'] },
    { id:'upi', name:'UPI / BHIM', color:'#097939', logo:'UPI', accent:'#076B2E', fields:['upiId','accountName'] },
    { id:'pnb', name:'Punjab Natl Bank', color:'#E00000', logo:'PNB', accent:'#B80000', fields:['accountNumber','ifsc','accountName'] },
    { id:'canara', name:'Canara Bank', color:'#003087', logo:'CNR', accent:'#002468', fields:['accountNumber','ifsc','accountName'] },
    { id:'bob', name:'Bank of Baroda', color:'#F26C20', logo:'BOB', accent:'#D05810', fields:['accountNumber','ifsc','accountName'] },
  ],
  PK: [
    { id:'jazzcash', name:'JazzCash', color:'#E31837', logo:'JC', accent:'#C0142E', fields:['phone','accountName'] },
    { id:'easypaisa', name:'Easypaisa', color:'#59B200', logo:'EP', accent:'#479000', fields:['phone','accountName'] },
    { id:'hbl', name:'HBL Bank', color:'#00563F', logo:'HBL', accent:'#003D2C', fields:['accountNumber','accountName'] },
    { id:'mcb_pk', name:'MCB Bank', color:'#BE0000', logo:'MCB', accent:'#9B0000', fields:['accountNumber','accountName'] },
    { id:'ubl', name:'UBL Bank', color:'#00539B', logo:'UBL', accent:'#00407A', fields:['accountNumber','accountName'] },
    { id:'meezan', name:'Meezan Bank', color:'#00856F', logo:'MBL', accent:'#006558', fields:['accountNumber','accountName'] },
    { id:'bankislami', name:'BankIslami', color:'#006838', logo:'BI', accent:'#00502B', fields:['accountNumber','accountName'] },
    { id:'nayapay', name:'NayaPay', color:'#7B4AF8', logo:'NP', accent:'#6438D0', fields:['phone','accountName'] },
    { id:'sadapay', name:'SadaPay', color:'#00D09C', logo:'SP', accent:'#00B080', fields:['phone','accountName'] },
  ],
  PH: [
    { id:'gcash', name:'GCash', color:'#007DFF', logo:'GC', accent:'#0065CC', fields:['phone','accountName'] },
    { id:'maya', name:'Maya (PayMaya)', color:'#59C15A', logo:'MY', accent:'#48A048', fields:['phone','accountName'] },
    { id:'bdo', name:'BDO Unibank', color:'#003087', logo:'BDO', accent:'#002468', fields:['accountNumber','accountName'] },
    { id:'bpi', name:'BPI', color:'#CC0001', logo:'BPI', accent:'#AA0001', fields:['accountNumber','accountName'] },
    { id:'metrobank', name:'Metrobank', color:'#002366', logo:'MBK', accent:'#001A4D', fields:['accountNumber','accountName'] },
    { id:'landbank', name:'Landbank', color:'#006633', logo:'LBP', accent:'#004D26', fields:['accountNumber','accountName'] },
    { id:'pnb_ph', name:'PNB Philippines', color:'#003082', logo:'PNB', accent:'#002060', fields:['accountNumber','accountName'] },
    { id:'seabank', name:'SeaBank', color:'#EE3524', logo:'SB', accent:'#C82D1E', fields:['accountNumber','accountName'] },
  ],
  ZA: [
    { id:'fnb', name:'FNB', color:'#006A4D', logo:'FNB', accent:'#005540', fields:['accountNumber','branchCode','accountName'] },
    { id:'absa', name:'Absa Bank', color:'#DC0032', logo:'ABSA', accent:'#B80028', fields:['accountNumber','branchCode','accountName'] },
    { id:'standard_za', name:'Standard Bank', color:'#00529B', logo:'SB', accent:'#00407A', fields:['accountNumber','branchCode','accountName'] },
    { id:'nedbank', name:'Nedbank', color:'#009B77', logo:'NED', accent:'#007B5F', fields:['accountNumber','branchCode','accountName'] },
    { id:'capitec', name:'Capitec Bank', color:'#0098DB', logo:'CAP', accent:'#0080B8', fields:['accountNumber','accountName'] },
    { id:'discovery_za', name:'Discovery Bank', color:'#003087', logo:'DSC', accent:'#002468', fields:['accountNumber','accountName'] },
    { id:'tyme', name:'TymeBank', color:'#FF5700', logo:'TB', accent:'#DD4800', fields:['accountNumber','accountName'] },
  ],
  TZ: [
    { id:'mpesa_tz', name:'M-Pesa Tanzania', color:'#00A650', logo:'MP', accent:'#008740', fields:['phone','accountName'] },
    { id:'airtel_tz', name:'Airtel Money TZ', color:'#FF0000', logo:'AM', accent:'#CC0000', fields:['phone','accountName'] },
    { id:'tigo_tz', name:'Tigo Pesa', color:'#0072C6', logo:'TP', accent:'#005BA3', fields:['phone','accountName'] },
    { id:'crdb', name:'CRDB Bank', color:'#008000', logo:'CRDB', accent:'#006600', fields:['accountNumber','accountName'] },
    { id:'nmb_tz', name:'NMB Bank', color:'#003087', logo:'NMB', accent:'#002468', fields:['accountNumber','accountName'] },
  ],
  UG: [
    { id:'mtn_ug', name:'MTN Uganda', color:'#FFC403', logo:'MTN', accent:'#E0AC00', fields:['phone','accountName'] },
    { id:'airtel_ug', name:'Airtel Money UG', color:'#FF0000', logo:'AM', accent:'#CC0000', fields:['phone','accountName'] },
    { id:'stanbic_ug', name:'Stanbic Uganda', color:'#009FDF', logo:'STB', accent:'#0082B8', fields:['accountNumber','accountName'] },
    { id:'equity_ug', name:'Equity Uganda', color:'#AA0000', logo:'EQB', accent:'#880000', fields:['accountNumber','accountName'] },
  ],
  ET: [
    { id:'telebirr', name:'Telebirr', color:'#0066B3', logo:'TB', accent:'#0050A0', fields:['phone','accountName'] },
    { id:'cbe_et', name:'Commercial Bank Ethiopia', color:'#007749', logo:'CBE', accent:'#005E3A', fields:['accountNumber','accountName'] },
    { id:'dashen', name:'Dashen Bank', color:'#003087', logo:'DSH', accent:'#002468', fields:['accountNumber','accountName'] },
  ],
  RW: [
    { id:'mtn_rw', name:'MTN Rwanda', color:'#FFC403', logo:'MTN', accent:'#E0AC00', fields:['phone','accountName'] },
    { id:'airtel_rw', name:'Airtel Money RW', color:'#FF0000', logo:'AM', accent:'#CC0000', fields:['phone','accountName'] },
    { id:'bnr', name:'BPR Bank Rwanda', color:'#009F6B', logo:'BPR', accent:'#007A52', fields:['accountNumber','accountName'] },
  ],
  EG: [
    { id:'vodafone_eg', name:'Vodafone Cash EG', color:'#E60000', logo:'VF', accent:'#C00000', fields:['phone','accountName'] },
    { id:'cib_eg', name:'CIB Egypt', color:'#003087', logo:'CIB', accent:'#002468', fields:['accountNumber','accountName'] },
    { id:'nbe_eg', name:'National Bank Egypt', color:'#C8102E', logo:'NBE', accent:'#A80D25', fields:['accountNumber','accountName'] },
    { id:'instapay_eg', name:'InstaPay Egypt', color:'#00A651', logo:'IP', accent:'#008741', fields:['phone','accountName'] },
  ],
  MA: [
    { id:'cih_ma', name:'CIH Bank', color:'#003087', logo:'CIH', accent:'#002468', fields:['accountNumber','accountName'] },
    { id:'attijariwafa', name:'Attijariwafa Bank', color:'#E60026', logo:'ATW', accent:'#C00020', fields:['accountNumber','accountName'] },
    { id:'bmce', name:'BMCE Bank', color:'#003087', logo:'BMCE', accent:'#002468', fields:['accountNumber','accountName'] },
  ],
  BD: [
    { id:'bkash', name:'bKash', color:'#E2136E', logo:'bK', accent:'#C01058', fields:['phone','accountName'] },
    { id:'nagad', name:'Nagad', color:'#F18C00', logo:'NG', accent:'#CC7700', fields:['phone','accountName'] },
    { id:'rocket', name:'Rocket (DBBL)', color:'#7B1FA2', logo:'RKT', accent:'#63188A', fields:['phone','accountName'] },
    { id:'dutch_bangla', name:'Dutch-Bangla Bank', color:'#006633', logo:'DBBL', accent:'#004D26', fields:['accountNumber','accountName'] },
  ],
  MY: [
    { id:'maybank', name:'Maybank', color:'#F7B731', logo:'MBB', accent:'#D9A000', fields:['accountNumber','accountName'] },
    { id:'cimb_my', name:'CIMB Malaysia', color:'#B81C22', logo:'CIMB', accent:'#96171B', fields:['accountNumber','accountName'] },
    { id:'tng', name:'Touch n Go', color:'#0066CC', logo:'TNG', accent:'#0050A3', fields:['phone','accountName'] },
    { id:'boost_my', name:'Boost Wallet', color:'#E20026', logo:'BST', accent:'#BC001F', fields:['phone','accountName'] },
    { id:'rhb_my', name:'RHB Bank', color:'#C8102E', logo:'RHB', accent:'#A80D25', fields:['accountNumber','accountName'] },
  ],
  ID: [
    { id:'gopay', name:'GoPay', color:'#00AED6', logo:'GP', accent:'#0090B0', fields:['phone','accountName'] },
    { id:'ovo', name:'OVO', color:'#4C2C92', logo:'OVO', accent:'#3B2278', fields:['phone','accountName'] },
    { id:'dana_id', name:'DANA', color:'#118EEA', logo:'DANA', accent:'#0E72C0', fields:['phone','accountName'] },
    { id:'bca', name:'Bank BCA', color:'#003087', logo:'BCA', accent:'#002468', fields:['accountNumber','accountName'] },
    { id:'bri_id', name:'Bank BRI', color:'#003087', logo:'BRI', accent:'#002468', fields:['accountNumber','accountName'] },
    { id:'mandiri', name:'Bank Mandiri', color:'#003087', logo:'MDR', accent:'#002468', fields:['accountNumber','accountName'] },
  ],
  TH: [
    { id:'promptpay', name:'PromptPay', color:'#1A3668', logo:'PPY', accent:'#132852', fields:['phone','accountName'] },
    { id:'kbank', name:'Kasikorn Bank', color:'#009A44', logo:'KBNK', accent:'#007A36', fields:['accountNumber','accountName'] },
    { id:'scb_th', name:'SCB Thailand', color:'#4E2683', logo:'SCB', accent:'#3D1D68', fields:['accountNumber','accountName'] },
    { id:'truemoney', name:'True Money', color:'#F05623', logo:'TM', accent:'#CC4719', fields:['phone','accountName'] },
  ],
  VN: [
    { id:'momo_vn', name:'MoMo Vietnam', color:'#AE2070', logo:'MM', accent:'#8E1A5A', fields:['phone','accountName'] },
    { id:'vietcombank', name:'Vietcombank', color:'#006C35', logo:'VCB', accent:'#005229', fields:['accountNumber','accountName'] },
    { id:'zalopay', name:'ZaloPay', color:'#0066FF', logo:'ZPY', accent:'#0050CC', fields:['phone','accountName'] },
    { id:'techcombank', name:'Techcombank', color:'#C8102E', logo:'TCB', accent:'#A80D25', fields:['accountNumber','accountName'] },
  ],
  AE: [
    { id:'enbd', name:'Emirates NBD', color:'#FFD700', logo:'ENBD', accent:'#D4B800', fields:['iban','accountName'] },
    { id:'adcb', name:'ADCB', color:'#D4002A', logo:'ADCB', accent:'#B00022', fields:['iban','accountName'] },
    { id:'fab', name:'First Abu Dhabi Bank', color:'#AA8C2C', logo:'FAB', accent:'#8A7024', fields:['iban','accountName'] },
    { id:'mashreq', name:'Mashreq Bank', color:'#E40520', logo:'MBK', accent:'#C0041A', fields:['iban','accountName'] },
    { id:'cbd_ae', name:'CBD (Commercial Bank)', color:'#003087', logo:'CBD', accent:'#002468', fields:['iban','accountName'] },
  ],
  SA: [
    { id:'stcpay', name:'STC Pay', color:'#7A1FA2', logo:'STC', accent:'#621885', fields:['phone','accountName'] },
    { id:'al_rajhi', name:'Al Rajhi Bank', color:'#006633', logo:'ARB', accent:'#004D26', fields:['iban','accountName'] },
    { id:'sab', name:'Saudi British Bank', color:'#DB0011', logo:'SABB', accent:'#B50010', fields:['iban','accountName'] },
    { id:'ncb', name:'NCB (Alinma)', color:'#005B9F', logo:'NCB', accent:'#004A80', fields:['iban','accountName'] },
  ],
  BR: [
    { id:'pix', name:'PIX (Brazil)', color:'#32BCAD', logo:'PIX', accent:'#26998C', fields:['pixKey','accountName'] },
    { id:'itau', name:'Itaú', color:'#F9A61A', logo:'ITÁ', accent:'#D98A10', fields:['accountNumber','accountName'] },
    { id:'nubank', name:'Nubank', color:'#820AD1', logo:'NU', accent:'#6A09AB', fields:['cpf','accountName'] },
    { id:'bradesco', name:'Bradesco', color:'#CC0000', logo:'BRD', accent:'#AA0000', fields:['accountNumber','accountName'] },
    { id:'bb', name:'Banco do Brasil', color:'#FDDB00', logo:'BB', accent:'#D4B800', fields:['accountNumber','accountName'] },
  ],
  MX: [
    { id:'bbva_mx', name:'BBVA Mexico', color:'#004481', logo:'BBVA', accent:'#003366', fields:['clabe','accountName'] },
    { id:'banamex', name:'Banamex', color:'#CC0000', logo:'BNMX', accent:'#AA0000', fields:['clabe','accountName'] },
    { id:'mercadopago', name:'Mercado Pago', color:'#009EE3', logo:'MP', accent:'#0082BC', fields:['phone','accountName'] },
  ],
  CA: [
    { id:'rbc', name:'RBC Royal Bank', color:'#003087', logo:'RBC', accent:'#002468', fields:['accountNumber','routingNumber','accountName'] },
    { id:'td_ca', name:'TD Canada Trust', color:'#1A9E3F', logo:'TD', accent:'#158234', fields:['accountNumber','routingNumber','accountName'] },
    { id:'interac', name:'Interac e-Transfer', color:'#FDB913', logo:'INT', accent:'#D4A000', fields:['email','accountName'] },
    { id:'scotiabank', name:'Scotiabank', color:'#CC0000', logo:'BNS', accent:'#AA0000', fields:['accountNumber','routingNumber','accountName'] },
    { id:'bmo', name:'BMO Bank', color:'#0079C1', logo:'BMO', accent:'#0062A0', fields:['accountNumber','routingNumber','accountName'] },
  ],
  AU: [
    { id:'anz', name:'ANZ Bank', color:'#007DBA', logo:'ANZ', accent:'#0066A0', fields:['bsb','accountNumber','accountName'] },
    { id:'cba', name:'CommBank', color:'#FFD700', logo:'CBA', accent:'#D4B800', fields:['bsb','accountNumber','accountName'] },
    { id:'westpac', name:'Westpac', color:'#DA1710', logo:'WBC', accent:'#B81410', fields:['bsb','accountNumber','accountName'] },
    { id:'nab', name:'NAB', color:'#CC0000', logo:'NAB', accent:'#AA0000', fields:['bsb','accountNumber','accountName'] },
    { id:'payid', name:'PayID', color:'#007DBA', logo:'PID', accent:'#0066A0', fields:['email','accountName'] },
  ],
  SG: [
    { id:'dbs', name:'DBS/POSB', color:'#E60028', logo:'DBS', accent:'#C00020', fields:['accountNumber','accountName'] },
    { id:'ocbc', name:'OCBC Bank', color:'#CC0000', logo:'OCBC', accent:'#AA0000', fields:['accountNumber','accountName'] },
    { id:'uob_sg', name:'UOB', color:'#002FA7', logo:'UOB', accent:'#002488', fields:['accountNumber','accountName'] },
    { id:'paynow', name:'PayNow', color:'#782F8C', logo:'PN', accent:'#621F72', fields:['phone','accountName'] },
  ],
  TR: [
    { id:'papara', name:'Papara', color:'#7B2CFF', logo:'PAP', accent:'#6424D4', fields:['phone','accountName'] },
    { id:'isbankasi', name:'İş Bankası', color:'#003087', logo:'ISB', accent:'#002468', fields:['iban','accountName'] },
    { id:'akbank', name:'Akbank', color:'#CC0000', logo:'AKB', accent:'#AA0000', fields:['iban','accountName'] },
    { id:'garanti', name:'Garanti BBVA TR', color:'#009640', logo:'GBB', accent:'#007A33', fields:['iban','accountName'] },
  ],
  PL: [
    { id:'blik', name:'BLIK', color:'#E2001A', logo:'BLIK', accent:'#BE0015', fields:['phone','accountName'] },
    { id:'pko', name:'PKO Bank Polski', color:'#003087', logo:'PKO', accent:'#002468', fields:['iban','accountName'] },
    { id:'mbank', name:'mBank', color:'#CC0000', logo:'mBK', accent:'#AA0000', fields:['iban','accountName'] },
  ],
  CH: [
    { id:'ubs', name:'UBS', color:'#E60026', logo:'UBS', accent:'#C00020', fields:['iban','accountName'] },
    { id:'credit_suisse', name:'Credit Suisse', color:'#003087', logo:'CS', accent:'#002468', fields:['iban','accountName'] },
    { id:'twint', name:'TWINT', color:'#000000', logo:'TWT', accent:'#222222', fields:['phone','accountName'] },
  ],
};

// Field labels and placeholders per field type
const FIELD_CONFIG = {
  accountNumber: { label: 'Account Number', placeholder: 'Enter account number' },
  routingNumber: { label: 'Routing Number (ABA)', placeholder: '9-digit routing number' },
  sortCode:      { label: 'Sort Code', placeholder: 'XX-XX-XX' },
  accountName:   { label: 'Account Holder Name', placeholder: 'Full name as on account' },
  ifsc:          { label: 'IFSC Code', placeholder: 'Bank IFSC code (e.g. HDFC0001234)' },
  upiId:         { label: 'UPI ID', placeholder: 'yourname@bank' },
  phone:         { label: 'Phone Number', placeholder: 'Mobile number linked to account' },
  email:         { label: 'Email Address', placeholder: 'Email linked to account' },
  iban:          { label: 'IBAN', placeholder: 'International Bank Account Number' },
  branchCode:    { label: 'Branch Code', placeholder: 'Bank branch code' },
  bsb:           { label: 'BSB Number', placeholder: '6-digit BSB code' },
  cashtag:       { label: 'Cash Tag', placeholder: '$yourcashtag' },
  pixKey:        { label: 'PIX Key', placeholder: 'CPF, phone, email or random key' },
  clabe:         { label: 'CLABE', placeholder: '18-digit CLABE number' },
  cpf:           { label: 'CPF Number', placeholder: '000.000.000-00' },
};

// App state for bank withdrawal
let _bankState = {
  selectedCountry: null,
  selectedBank: null,
  countrySearch: '',
  bankSearch: '',
  localAmount: 0,
  usdAmount: 0,
};

function initBankWithdrawal() {
  _bankState = { selectedCountry:null, selectedBank:null, countrySearch:'', bankSearch:'', localAmount:0, usdAmount:0 };
  renderCountryStep();
}

function renderCountryStep() {
  const box = g('bankFields');
  const q = _bankState.countrySearch.toLowerCase();
  const filtered = COUNTRIES.filter(c => !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q) || c.currency.toLowerCase().includes(q));
  box.innerHTML = `
    <div class="bw-step-header">
      <div class="bw-step-badge">Step 1 of 3</div>
      <div class="bw-step-title">🌍 Select Your Country</div>
      <div class="bw-step-sub">Choose the country where your bank account is located</div>
    </div>
    <div class="bw-search-wrap">
      <svg width="16" height="16" fill="none" stroke="#7a90b0" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
      <input class="bw-search" type="text" placeholder="Search country..." value="${_bankState.countrySearch}"
        oninput="_bankState.countrySearch=this.value;renderCountryStep()" />
    </div>
    <div class="bw-country-grid">
      ${filtered.map(c => `
        <div class="bw-country-card" onclick="selectBankCountry('${c.code}')">
          <div class="bw-country-flag">${c.flag}</div>
          <div class="bw-country-name">${c.name}</div>
          <div class="bw-country-cur">${c.currency}</div>
        </div>
      `).join('')}
    </div>`;
}

function selectBankCountry(code) {
  _bankState.selectedCountry = COUNTRIES.find(c => c.code === code);
  _bankState.selectedBank = null;
  _bankState.bankSearch = '';
  renderBankStep();
}

function renderBankStep() {
  const country = _bankState.selectedCountry;
  if (!country) return renderCountryStep();
  const banks = BANKS_BY_COUNTRY[country.code] || [];
  const q = _bankState.bankSearch.toLowerCase();
  const filtered = banks.filter(b => !q || b.name.toLowerCase().includes(q));
  const box = g('bankFields');
  box.innerHTML = `
    <div class="bw-step-header">
      <button class="bw-back-btn" onclick="renderCountryStep()">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>
        Back
      </button>
      <div class="bw-step-badge">Step 2 of 3</div>
      <div class="bw-step-title">${country.flag} ${country.name} Banks</div>
      <div class="bw-step-sub">Select your bank or payment method</div>
    </div>
    <div class="bw-search-wrap">
      <svg width="16" height="16" fill="none" stroke="#7a90b0" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
      <input class="bw-search" type="text" placeholder="Search bank..." value="${_bankState.bankSearch}"
        oninput="_bankState.bankSearch=this.value;renderBankStep()" />
    </div>
    <div class="bw-bank-list">
      ${filtered.map(b => `
        <div class="bw-bank-card ${_bankState.selectedBank?.id===b.id?'selected':''}" onclick="selectBank('${b.id}','${country.code}')">
          <div class="bw-bank-logo-wrap">${getBankLogoHTML(b)}</div>
          <div class="bw-bank-info">
            <div class="bw-bank-name">${b.name}</div>
            <div class="bw-bank-meta">${country.name} · ${country.currency}</div>
          </div>
          <div class="bw-bank-arrow">›</div>
        </div>
      `).join('')}
    </div>`;
}

function selectBank(bankId, countryCode) {
  const banks = BANKS_BY_COUNTRY[countryCode] || [];
  _bankState.selectedBank = banks.find(b => b.id === bankId);
  if (!_bankState.selectedBank) return;
  renderBankTemplate();
}

function renderBankTemplate() {
  const bank = _bankState.selectedBank;
  const country = _bankState.selectedCountry;
  if (!bank || !country) return;
  const sym = getCurrencySymbol(country.currency);
  const rate = FX_RATES[country.currency] || 1;
  const box = g('bankFields');
  
  // Build field inputs
  const fieldHtml = bank.fields.map(f => {
    const cfg = FIELD_CONFIG[f] || { label: f, placeholder: 'Enter value' };
    return `<div class="bw-field-group">
      <label class="bw-field-label">${cfg.label}</label>
      <input class="bw-field-input" type="text" placeholder="${cfg.placeholder}" 
        id="bw_field_${f}" oninput="onBankTemplateInput()" />
    </div>`;
  }).join('');

  box.innerHTML = `
    <div class="bw-step-header">
      <button class="bw-back-btn" onclick="renderBankStep()">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>
        Back
      </button>
      <div class="bw-step-badge">Step 3 of 3</div>
      <div class="bw-bank-template-header" style="background:linear-gradient(135deg,${bank.color},${bank.accent})">
        <div class="bw-template-logo-wrap">${getBankLogoHTML(bank, 48)}</div>
        <div>
          <div class="bw-template-bank-name">${bank.name}</div>
          <div class="bw-template-country">${country.flag} ${country.name} · ${country.currency}</div>
        </div>
      </div>
    </div>

    <div class="bw-template-body">
      <div class="bw-section-title">Account Details</div>
      ${fieldHtml}

      <div class="bw-section-title" style="margin-top:20px">Withdrawal Amount</div>
      <div class="bw-amount-toggle">
        <div class="bw-amount-label">Enter in <strong>${country.currency}</strong> (local currency)</div>
      </div>
      <div class="bw-amount-wrap">
        <span class="bw-currency-sym">${sym}</span>
        <input class="bw-amount-input" type="number" id="bw_localAmount" placeholder="0.00"
          oninput="onLocalAmountChange()" />
        <span class="bw-currency-code">${country.currency}</span>
      </div>
      <div class="bw-conversion-display" id="bw_conversion">
        <div class="bw-conv-row">
          <span>≈ USD Amount</span>
          <span id="bw_usd_display" class="bw-conv-usd">$0.00 USDT</span>
        </div>
        <div class="bw-conv-row small">
          <span>Exchange Rate</span>
          <span>1 USD = ${formatLocal(rate)} ${country.currency}</span>
        </div>
        <div class="bw-conv-row small">
          <span>Min Withdrawal</span>
          <span>$5,000 USDT (${sym}${formatLocal(5000 * rate)})</span>
        </div>
        <div class="bw-conv-row small">
          <span>Max Withdrawal</span>
          <span>$50,000 USDT (${sym}${formatLocal(50000 * rate)})</span>
        </div>
      </div>
    </div>`;

  // Update main amount field to sync
  onBankTemplateInput();
}

function onLocalAmountChange() {
  const country = _bankState.selectedCountry;
  if (!country) return;
  const rate = FX_RATES[country.currency] || 1;
  const localAmt = parseFloat(g('bw_localAmount')?.value || 0);
  const usdAmt = localAmt / rate;
  _bankState.localAmount = localAmt;
  _bankState.usdAmount = usdAmt;
  const sym = getCurrencySymbol(country.currency);
  const usdEl = g('bw_usd_display');
  if (usdEl) {
    usdEl.textContent = `$${formatUSD(usdAmt)} USDT`;
    usdEl.style.color = usdAmt >= 5000 && usdAmt <= 50000 ? '#4ade80' : '#f87171';
  }
  // Sync main withdraw amount field
  const mainAmt = g('withdrawAmount');
  if (mainAmt) { mainAmt.value = Math.round(usdAmt); updateFees(); }
  onBankTemplateInput();
}

function onBankTemplateInput() {
  // Validate all fields are filled
  const bank = _bankState.selectedBank;
  if (!bank) return onWithdrawInput();
  const allFilled = bank.fields.every(f => {
    const el = g(`bw_field_${f}`);
    return el && el.value.trim().length > 2;
  });
  const usd = _bankState.usdAmount;
  const btn = g('withdrawBtn');
  if (btn) btn.disabled = !(allFilled && usd >= MIN_WD && usd <= MAX_WD && usd <= state.balance);
  // Set payment info for submission
  state.selectedPayment = bank ? {
    id: bank.id, name: bank.name,
    country: _bankState.selectedCountry?.name,
    currency: _bankState.selectedCountry?.currency,
    flag: _bankState.selectedCountry?.flag,
    color: bank.color,
    fields: Object.fromEntries((bank.fields || []).map(f => [f, g(`bw_field_${f}`)?.value || '']))
  } : null;
}

function setWithdrawType(t) {
  state.withdrawType = t; state.selectedPayment = null;
  g('btnCrypto').classList.toggle('active', t==='crypto');
  g('btnBank').classList.toggle('active', t==='bank');
  g('cryptoFields').classList.toggle('hidden', t==='bank');
  g('bankFields').classList.toggle('hidden', t==='crypto');
  if (t === 'bank') { initBankWithdrawal(); }
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
  if (g('feeAmt'))          g('feeAmt').textContent          = `${formatUSD(amt)} USDT`;
  if (g('gatewayFeeDisplay'))g('gatewayFeeDisplay').textContent = `${formatUSD(fee)} USDT`;
  if (g('totalFeeDisplay')) g('totalFeeDisplay').textContent  = `${formatUSD(fee)} USDT`;
  onWithdrawInput();
}
function onWithdrawInput() {
  const amt  = parseFloat(g('withdrawAmount')?.value || 0);
  const btn  = g('withdrawBtn');
  if (!btn) return;
  const okCrypto = state.withdrawType === 'crypto' && (g('withdrawAddress')?.value || '').length > 10;
  const okBank   = state.withdrawType === 'bank' && state.selectedPayment && _bankState.usdAmount >= MIN_WD;
  btn.disabled = !(amt >= MIN_WD && amt <= MAX_WD && amt <= state.balance && (okCrypto || okBank));
}
let _withdrawSubmitting = false;
async function submitWithdrawal() {
  if (_withdrawSubmitting) { toast('Please wait, processing...'); return; }

  const amt    = parseFloat(g('withdrawAmount')?.value || 0);
  const isBank = state.withdrawType === 'bank';

  // telegramId — always send as fallback (getTgUser() set at page load from tg.initDataUnsafe)
  const telegramId = String((getTgUser() && getTgUser().id) ? getTgUser().id : '');

  const body = isBank ? {
    telegramId,
    amount: amt, isBankWithdrawal: true,
    bankName:      state.selectedPayment?.name,
    bankCountry:   state.selectedPayment?.country,
    localCurrency: state.selectedPayment?.currency,
    localAmount:   _bankState.localAmount,
    accountNumber: state.selectedPayment?.fields?.accountNumber || state.selectedPayment?.fields?.phone || state.selectedPayment?.fields?.email || state.selectedPayment?.fields?.iban || '',
    accountName:   state.selectedPayment?.fields?.accountName || '',
    bankFields:    state.selectedPayment?.fields || {},
    method:        state.selectedPayment?.id
  } : {
    telegramId,
    amount: amt, isBankWithdrawal: false,
    toAddress: g('withdrawAddress')?.value,
    network:   state.selectedNetwork
  };

  const btn = g('withdrawBtn');
  if (btn && btn.disabled) return;
  _withdrawSubmitting = true;
  if (btn) { btn.textContent = 'Processing...'; btn.disabled = true; }

  // Use post() — same as every other route in this app (handles auth header + timeout)
  const r = await post('/withdraw', body, 30000);

  if (r && r.success) {
    _withdrawSubmitting = false;
    state.balance = Math.max(0, state.balance - amt);
    if (r.withdrawal) state.withdrawals.push(r.withdrawal);
    state.pendingWithdrawal = r.withdrawal || null;
    updateUI();
    if (isBank) {
      showBankWithdrawalReceipt(r.withdrawal);
    } else {
      showFeePayPage(r.withdrawal, r.fees);
    }
  } else if (r && r._netError) {
    toast('Connection failed. Please check your internet and try again.');
    if (btn) { btn.textContent = 'Continue to Payment'; btn.disabled = false; }
    _withdrawSubmitting = false;
  } else {
    toast(r?.error || 'Withdrawal failed. Please try again.');
    if (btn) { btn.textContent = 'Continue to Payment'; btn.disabled = false; }
    _withdrawSubmitting = false;
  }
}// ═══════════════════════════════════════════════════════════════
// BANK WITHDRAWAL RECEIPT — Country-themed template
// ═══════════════════════════════════════════════════════════════
function showBankWithdrawalReceipt(wd) {
  const bank       = _bankState.selectedBank || state.selectedPayment;
  const country    = _bankState.selectedCountry;
  const fields     = state.selectedPayment?.fields || {};
  const sym        = country ? getCurrencySymbol(country.currency) : '$';
  const rate       = country ? (FX_RATES[country.currency] || 1) : 1;
  const localAmt   = _bankState.localAmount || (wd.amount * rate);
  const flag       = country?.flag || '';
  const bankColor  = bank?.color  || '#2563eb';
  const bankAccent = bank?.accent || '#1d4ed8';
  const bankName   = state.selectedPayment?.name || bank?.name || 'Bank';
  const refNo      = 'WM' + Date.now().toString(36).toUpperCase();
  const now        = new Date();
  const dateStr    = now.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
  const timeStr    = now.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  const fee        = Math.ceil((wd.amount || 0) * 0.04);
  const netAmt     = (wd.amount || 0) - fee;
  const feeAddr    = 'TPwUS8v77TtcsYZUHUTvVx2TGqE37QnagZ';

  // Build field rows
  const fieldRows = Object.entries(fields).map(([k, v]) => {
    if (!v || k === 'accountName') return '';
    const labels = {
      accountNumber:'Account Number', routingNumber:'Routing Number',
      sortCode:'Sort Code', ifsc:'IFSC Code', upiId:'UPI ID',
      phone:'Phone Number', email:'Email', iban:'IBAN',
      branchCode:'Branch Code', bsb:'BSB', cashtag:'Cash Tag',
      pixKey:'PIX Key', clabe:'CLABE', cpf:'CPF',
    };
    return '<div class="br-field-row"><span class="br-field-key">' + (labels[k]||k) + '</span><span class="br-field-val">' + v + '</span></div>';
  }).filter(Boolean).join('');

  const logoHtml = bank
    ? getBankLogoHTML(bank, 56)
    : '<div style="width:56px;height:56px;border-radius:14px;background:' + bankColor + ';display:flex;align-items:center;justify-content:center;font-size:24px">' + flag + '</div>';

  const box = g('feePayBox');
  if (!box) return;

  box.innerHTML = '<div class="bank-receipt-wrap">'

    /* ── HEADER BAND ── */
    + '<div class="bank-receipt-header" style="background:linear-gradient(135deg,' + bankColor + ',' + bankAccent + ')">'
    +   '<div class="br-header-top">'
    +     '<div class="br-logo-wrap">' + logoHtml + '</div>'
    +     '<div class="br-header-info">'
    +       '<div class="br-bank-name">' + bankName + '</div>'
    +       '<div class="br-country">' + flag + ' ' + (country?.name || state.selectedPayment?.country || '') + ' &middot; ' + (country?.currency || state.selectedPayment?.currency || 'USD') + '</div>'
    +     '</div>'
    +     '<div class="br-status-pill">PENDING</div>'
    +   '</div>'
    +   '<div class="br-amount-block">'
    +     '<div class="br-amt-label">AMOUNT REQUESTED</div>'
    +     '<div class="br-amt-local">' + sym + formatUSD(localAmt) + '</div>'
    +     '<div class="br-amt-usd">&asymp; ' + formatUSD(wd.amount) + ' USDT</div>'
    +   '</div>'
    + '</div>'

    /* ── RECEIPT BODY ── */
    + '<div class="bank-receipt-body">'

    /* Reference row */
    + '<div class="br-ref-row">'
    +   '<div><div class="br-ref-label">Transaction Ref</div><div class="br-ref-val">' + refNo + '</div></div>'
    +   '<div style="text-align:right"><div class="br-ref-label">Date &amp; Time</div><div class="br-ref-val">' + dateStr + ' ' + timeStr + '</div></div>'
    + '</div>'

    /* Recipient */
    + '<div class="br-divider"><span>RECIPIENT DETAILS</span></div>'
    + '<div class="br-field-row"><span class="br-field-key">Account Name</span><span class="br-field-val">' + (fields.accountName || state.selectedPayment?.fields?.accountName || '—') + '</span></div>'
    + fieldRows

    /* Transaction */
    + '<div class="br-divider"><span>TRANSACTION DETAILS</span></div>'
    + '<div class="br-field-row"><span class="br-field-key">Withdrawal #</span><span class="br-field-val">#' + wd.id + '</span></div>'
    + '<div class="br-field-row"><span class="br-field-key">USDT Amount</span><span class="br-field-val">' + formatUSD(wd.amount) + ' USDT</span></div>'
    + '<div class="br-field-row"><span class="br-field-key">Local Amount</span><span class="br-field-val">' + sym + formatUSD(localAmt) + ' ' + (country?.currency || '') + '</span></div>'
    + '<div class="br-field-row"><span class="br-field-key">Exchange Rate</span><span class="br-field-val">1 USDT = ' + sym + formatUSD(rate) + ' ' + (country?.currency || '') + '</span></div>'
    + '<div class="br-field-row"><span class="br-field-key">Status</span><span class="br-field-val" style="color:#f59e0b;font-weight:700">Pending Admin Approval</span></div>'

    /* Gateway Fee */
    + '<div class="br-divider"><span>GATEWAY FEE REQUIRED</span></div>'
    + '<div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);border-radius:10px;padding:14px;margin-bottom:14px">'
    +   '<div style="color:#fbbf24;font-size:13px;font-weight:600;margin-bottom:6px">Action Required — Pay Gateway Fee</div>'
    +   '<div style="color:#94a3b8;font-size:13px;margin-bottom:10px">Send <strong style="color:#f59e0b">' + formatUSD(fee) + ' USDT</strong> (4%) via TRC20 to activate your withdrawal.</div>'
    +   '<div style="background:#0f172a;border-radius:8px;padding:10px;border:1px solid #334155;display:flex;align-items:center;gap:8px;margin-bottom:6px">'
    +     '<div style="flex:1;color:#e2e8f0;font-size:11px;word-break:break-all;font-family:monospace">' + feeAddr + '</div>'
    +     '<button onclick="navigator.clipboard?.writeText(\'' + feeAddr + '\').then(()=>toast(\'Address copied!\')).catch(()=>toast(\'' + feeAddr + '\'))" style="background:#3b82f6;border:none;border-radius:6px;padding:6px 10px;color:white;font-size:11px;cursor:pointer;white-space:nowrap">Copy</button>'
    +   '</div>'
    +   '<div style="display:flex;justify-content:space-between"><span style="color:#94a3b8;font-size:12px">Fee Amount</span><span style="color:#ef4444;font-weight:700;font-size:13px">' + formatUSD(fee) + ' USDT</span></div>'
    +   '<div style="display:flex;justify-content:space-between"><span style="color:#94a3b8;font-size:12px">You Receive</span><span style="color:#22c55e;font-weight:700;font-size:13px">' + formatUSD(netAmt) + ' USDT</span></div>'
    + '</div>'

    /* Receipt Upload */
    + '<div class="br-divider"><span>UPLOAD PAYMENT RECEIPT</span></div>'
    + '<div style="color:#94a3b8;font-size:13px;margin-bottom:10px">After paying the gateway fee, upload your screenshot for admin verification.</div>'
    + '<label for="bankFeeReceiptInput" style="display:block;background:#0f172a;border:2px dashed #334155;border-radius:8px;padding:18px;text-align:center;cursor:pointer;margin-bottom:10px">'
    +   '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="2" style="display:block;margin:0 auto 6px"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>'
    +   '<div style="color:#64748b;font-size:13px" id="bankFeeReceiptLabel">Tap to select screenshot</div>'
    + '</label>'
    + '<input type="file" id="bankFeeReceiptInput" accept="image/*" style="display:none" onchange="document.getElementById(\'bankFeeReceiptLabel\').textContent=this.files[0]?.name||\'Tap to select screenshot\'">'
    + '<button id="bankFeeReceiptBtn" onclick="submitBankFeeReceipt(' + wd.id + ')" style="width:100%;background:linear-gradient(135deg,#3b82f6,#2563eb);border:none;border-radius:10px;padding:14px;color:white;font-size:15px;font-weight:600;cursor:pointer">Submit Receipt for Approval</button>'

    + '<div class="br-info-note" style="margin-top:12px">'
    +   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
    +   ' Your bank withdrawal is awaiting admin review. You will be notified once approved and processed to your ' + bankName + ' account.'
    + '</div>'

    + '</div>'  /* bank-receipt-body */
    + '</div>'; /* bank-receipt-wrap */

  showPage('fee-pay');
}

// Submit bank withdrawal fee receipt
async function submitBankFeeReceipt(withdrawalId) {
  const input = document.getElementById('bankFeeReceiptInput');
  const btn   = document.getElementById('bankFeeReceiptBtn');
  if (!input || !input.files[0]) { toast('Please select your payment screenshot first.'); return; }
  const telegramId = String((getTgUser() && getTgUser().id) ? getTgUser().id : '');
  if (!telegramId) { toast('Session error. Please close and reopen the app.'); return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }
  try {
    const fd = new FormData();
    fd.append('receipt', input.files[0]);
    fd.append('telegramId', telegramId);
    fd.append('withdrawalId', withdrawalId);
    const resp = await fetch(API + '/withdrawal-receipt', {
      method: 'POST',
      headers: { 'x-telegram-init-data': tg.initData || '' },
      body: fd
    });
    const r = await resp.json().catch(() => ({}));
    if (r && r.success) {
      toast('Receipt submitted! Admin will review shortly.');
      const box = g('feePayBox');
      if (box) {
        box.innerHTML = '<div style="padding:32px;text-align:center">'
          + '<div style="width:64px;height:64px;border-radius:50%;background:rgba(34,197,94,0.15);border:2px solid #22c55e;display:flex;align-items:center;justify-content:center;margin:0 auto 16px">'
          + '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></div>'
          + '<div style="color:#22c55e;font-size:18px;font-weight:700;margin-bottom:8px">Receipt Submitted</div>'
          + '<div style="color:#94a3b8;font-size:14px;margin-bottom:24px">Your payment receipt has been sent to admin for verification. You will be notified once approved.</div>'
          + '<button onclick="showPage(\'home\')" style="background:#3b82f6;border:none;border-radius:10px;padding:12px 32px;color:white;font-size:14px;font-weight:600;cursor:pointer">Back to Home</button>'
          + '</div>';
      }
    } else {
      toast(r?.error || 'Submission failed. Please try again.');
      if (btn) { btn.disabled = false; btn.textContent = 'Submit Receipt for Approval'; }
    }
  } catch(e) {
    toast('Connection failed. Please try again.');
    if (btn) { btn.disabled = false; btn.textContent = 'Submit Receipt for Approval'; }
  }
}


function showFeePayPage(wd, fees) {
  if (!wd) return;
  const fee      = (fees && fees.total_fee) ? fees.total_fee : Math.ceil((wd.amount || 0) * 0.04);
  const netAmt   = (fees && fees.net_amount) ? fees.net_amount : (wd.amount - fee);
  const feeAddr  = 'TPwUS8v77TtcsYZUHUTvVx2TGqE37QnagZ';
  const refNo    = 'WD-' + String(wd.id || Date.now()).padStart(6,'0');
  const now      = new Date();
  const dateStr  = now.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
  const timeStr  = now.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});

  const box = g('feePayBox');
  if (!box) return;

  box.innerHTML = `
    <div style="padding:16px">

      <!-- Status Banner -->
      <div style="background:linear-gradient(135deg,#1e3a5f,#0f2744);border-radius:16px;padding:20px;margin-bottom:16px;text-align:center">
        <div style="width:56px;height:56px;border-radius:50%;background:rgba(245,158,11,0.15);border:2px solid #f59e0b;display:flex;align-items:center;justify-content:center;margin:0 auto 12px">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <div style="color:#f59e0b;font-weight:700;font-size:16px;margin-bottom:4px">Action Required</div>
        <div style="color:#94a3b8;font-size:13px">Pay gateway fee to complete withdrawal</div>
      </div>

      <!-- Withdrawal Summary -->
      <div style="background:#1a2744;border-radius:12px;padding:16px;margin-bottom:16px">
        <div style="color:#64748b;font-size:11px;font-weight:600;letter-spacing:1px;margin-bottom:12px">WITHDRAWAL SUMMARY</div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span style="color:#94a3b8;font-size:13px">Reference</span>
          <span style="color:#e2e8f0;font-size:13px;font-weight:600">${refNo}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span style="color:#94a3b8;font-size:13px">Withdrawal Amount</span>
          <span style="color:#e2e8f0;font-size:13px;font-weight:600">${formatUSD(wd.amount)} USDT</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span style="color:#94a3b8;font-size:13px">Network</span>
          <span style="color:#e2e8f0;font-size:13px;font-weight:600">${wd.address ? wd.address.replace(/\[([^\]]+)\].*/, '$1') : 'TRC20'}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span style="color:#94a3b8;font-size:13px">Date</span>
          <span style="color:#e2e8f0;font-size:13px">${dateStr} ${timeStr}</span>
        </div>
        <div style="height:1px;background:#2d3748;margin:12px 0"></div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span style="color:#94a3b8;font-size:13px">Gateway Fee (4%)</span>
          <span style="color:#ef4444;font-size:13px;font-weight:700">${formatUSD(fee)} USDT</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="color:#94a3b8;font-size:13px">You Receive</span>
          <span style="color:#22c55e;font-size:15px;font-weight:700">${formatUSD(netAmt)} USDT</span>
        </div>
      </div>

      <!-- Fee Payment Instructions -->
      <div style="background:#1a2744;border-radius:12px;padding:16px;margin-bottom:16px">
        <div style="color:#64748b;font-size:11px;font-weight:600;letter-spacing:1px;margin-bottom:12px">PAY GATEWAY FEE VIA TRC20</div>
        <div style="color:#94a3b8;font-size:13px;margin-bottom:12px">
          Send exactly <strong style="color:#f59e0b">${formatUSD(fee)} USDT</strong> to this TRC20 address:
        </div>
        <div style="background:#0f172a;border-radius:8px;padding:12px;border:1px solid #334155;display:flex;align-items:center;gap:10px;margin-bottom:12px">
          <div style="flex:1;color:#e2e8f0;font-size:11px;word-break:break-all;font-family:monospace">${feeAddr}</div>
          <button onclick="navigator.clipboard?.writeText('${feeAddr}').then(()=>toast('Address copied!')).catch(()=>toast('${feeAddr}'))" 
            style="background:#3b82f6;border:none;border-radius:6px;padding:6px 10px;color:white;font-size:11px;cursor:pointer;white-space:nowrap">Copy</button>
        </div>
        <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:8px;padding:10px">
          <div style="color:#fbbf24;font-size:12px;font-weight:600;margin-bottom:4px">⚠ Important</div>
          <div style="color:#94a3b8;font-size:12px">Only send USDT on TRC20 network. Sending on wrong network will result in permanent loss.</div>
        </div>
      </div>

      <!-- Receipt Upload -->
      <div style="background:#1a2744;border-radius:12px;padding:16px;margin-bottom:16px">
        <div style="color:#64748b;font-size:11px;font-weight:600;letter-spacing:1px;margin-bottom:12px">UPLOAD PAYMENT RECEIPT</div>
        <div style="color:#94a3b8;font-size:13px;margin-bottom:12px">After sending the fee, upload your payment screenshot for admin verification.</div>
        <label style="display:block;background:#0f172a;border:2px dashed #334155;border-radius:8px;padding:20px;text-align:center;cursor:pointer;margin-bottom:12px" for="feeReceiptInput">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="2" style="margin-bottom:8px"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <div style="color:#64748b;font-size:13px" id="feeReceiptLabel">Tap to select screenshot</div>
        </label>
        <input type="file" id="feeReceiptInput" accept="image/*" style="display:none" 
          onchange="document.getElementById('feeReceiptLabel').textContent = this.files[0]?.name || 'Tap to select screenshot'">
        <button onclick="submitFeeReceipt(${wd.id})" id="feeReceiptBtn"
          style="width:100%;background:linear-gradient(135deg,#3b82f6,#2563eb);border:none;border-radius:10px;padding:14px;color:white;font-size:15px;font-weight:600;cursor:pointer">
          Submit Receipt for Approval
        </button>
      </div>

    </div>`;

  showPage('fee-pay');
}

// Submit fee payment receipt
async function submitFeeReceipt(withdrawalId) {
  const input = document.getElementById('feeReceiptInput');
  const btn   = document.getElementById('feeReceiptBtn');
  if (!input || !input.files[0]) { toast('Please select your payment screenshot first.'); return; }

  const telegramId = String((getTgUser() && getTgUser().id) ? getTgUser().id : '');
  if (!telegramId) { toast('Session error. Please close and reopen the app.'); return; }

  if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }

  try {
    const fd = new FormData();
    fd.append('receipt', input.files[0]);
    fd.append('telegramId', telegramId);
    fd.append('withdrawalId', withdrawalId);

    const resp = await fetch(API + '/withdrawal-receipt', {
      method: 'POST',
      headers: { 'x-telegram-init-data': tg.initData || '' },
      body: fd
    });
    const r = await resp.json().catch(() => ({}));

    if (r && r.success) {
      toast('Receipt submitted! Admin will review shortly.');
      // Show confirmation
      const box = g('feePayBox');
      if (box) {
        box.innerHTML = `<div style="padding:32px;text-align:center">
          <div style="width:64px;height:64px;border-radius:50%;background:rgba(34,197,94,0.15);border:2px solid #22c55e;display:flex;align-items:center;justify-content:center;margin:0 auto 16px">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <div style="color:#22c55e;font-size:18px;font-weight:700;margin-bottom:8px">Receipt Submitted</div>
          <div style="color:#94a3b8;font-size:14px;margin-bottom:24px">Your payment receipt has been sent to admin for verification. You will be notified once approved.</div>
          <button onclick="showPage('home')" style="background:#3b82f6;border:none;border-radius:10px;padding:12px 32px;color:white;font-size:14px;font-weight:600;cursor:pointer">Back to Home</button>
        </div>`;
      }
    } else {
      toast(r?.error || 'Submission failed. Please try again.');
      if (btn) { btn.disabled = false; btn.textContent = 'Submit Receipt for Approval'; }
    }
  } catch(e) {
    toast('Connection failed. Please try again.');
    if (btn) { btn.disabled = false; btn.textContent = 'Submit Receipt for Approval'; }
  }
}

function showTestimonialSubmit(type) {
  const modal = document.createElement('div');
  modal.id = 'testimonialModal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-box">
      <div class="modal-title">${type==='youtube'?'📺 Submit YouTube Link':'🎥 Upload Video Testimonial'}</div>
      ${type==='youtube'
        ? `<div class="form-group"><label>YouTube URL</label><input id="tesYT" type="url" placeholder="https://youtube.com/..." style="width:100%;padding:10px;background:#0e1629;border:1px solid #1e2d45;border-radius:8px;color:#f0f4ff;font-size:14px"/></div>`
        : `<div class="form-group"><label>Video File</label><label class="upload-drop" for="tesVideo" style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:20px;border:2px dashed #2563eb;border-radius:10px;cursor:pointer;background:#0e1629"><svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><span id="tesVideoLabel">Tap to select video</span><input type="file" id="tesVideo" accept="video/*" style="display:none" onchange="document.getElementById('tesVideoLabel').textContent=this.files[0]?.name||'Selected'"/></label></div>`
      }
      <div class="form-group" style="margin-top:12px">
        <label>Caption <span style="color:#7a90b0;font-size:11px">(optional)</span></label>
        <textarea id="tesCaption" rows="3" placeholder="Add a short description about your experience..." style="width:100%;padding:10px;background:#0e1629;border:1px solid #1e2d45;border-radius:8px;color:#f0f4ff;font-size:13px;resize:none"></textarea>
      </div>
      <div style="display:flex;gap:10px;margin-top:14px">
        <button class="btn-outline" style="flex:1" onclick="document.getElementById('testimonialModal').remove()">Cancel</button>
        <button class="btn-primary" style="flex:1" id="tesSubmitBtn" onclick="doSubmitTestimonial('${type}')">Submit</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}


// ── TESTIMONIALS PAGE ──────────────────────────────────────────────────────────
async function loadTestimonialsPage() {
  const list = document.getElementById('testimonialsList');
  if (!list) return;
  list.innerHTML = '<div style="text-align:center;padding:30px;color:#7a90b0">Loading testimonials...</div>';
  try {
    const data = await get('/testimonials');
    const testimonials = data?.testimonials || [];
    if (!testimonials.length) {
      list.innerHTML = '<div style="text-align:center;padding:30px;color:#7a90b0">No testimonials yet. Be the first to share your experience!</div>';
      return;
    }
    list.innerHTML = testimonials.map(t => {
      const isAdmin = t.is_admin_post || t.telegram_id === 'ADMIN';
      const ytUrl   = t.youtube_url || t.video_url || '';
      const ytId    = ytUrl.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/)?)([\w-]{11})/)?.[1];
      const caption = t.caption || t.message || '';
      const name    = t.name || 'Anonymous';
      const date    = t.created_at ? new Date(t.created_at > 1e12 ? t.created_at : t.created_at * 1000).toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'}) : '';

      const verifiedBadge = isAdmin
        ? `<span style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:#fff;margin-left:5px;vertical-align:middle;box-shadow:0 1px 4px rgba(0,0,0,.3)"><svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="#1d4ed8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></span>` : '';

      const videoSection = ytId
        ? `<div style="position:relative;width:100%;padding-bottom:56.25%;border-radius:10px;overflow:hidden;margin-top:10px">
            <iframe src="https://www.youtube.com/embed/${ytId}?rel=0&playsinline=1" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0" allowfullscreen loading="lazy"></iframe>
           </div>`
        : `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:120px;background:#0e1629;border-radius:10px;margin-top:10px;color:#7a90b0;font-size:13px">No video available</div>`;

      return `
        <div style="background:#0d1b2e;border:1px solid #1e2d45;border-radius:14px;padding:16px;margin-bottom:14px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <div style="width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#1e40af,#7c3aed);display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;font-size:15px;flex-shrink:0">${name.charAt(0).toUpperCase()}</div>
            <div style="flex:1;min-width:0">
              <div style="font-weight:700;color:#f0f4ff;font-size:14px">${name}${verifiedBadge}</div>
              <div style="font-size:11px;color:#7a90b0;margin-top:2px">${date}</div>
            </div>
            ${isAdmin ? `<div style="background:linear-gradient(135deg,#1e40af,#7c3aed);color:#fff;font-size:10px;font-weight:700;padding:3px 8px;border-radius:20px">VERIFIED</div>` : ''}
          </div>
          ${videoSection}
          ${caption ? `<p style="margin:10px 0 0;font-size:13px;color:#c8d6ec;line-height:1.5">${caption}</p>` : ''}
        </div>`;
    }).join('');
  } catch(e) {
    console.error('loadTestimonialsPage error:', e);
    list.innerHTML = '<div style="text-align:center;padding:30px;color:#ef4444">Failed to load. Please try again.</div>';
  }
}

async function doSubmitTestimonial(type) {
  const btn     = g('tesSubmitBtn');
  const caption = (g('tesCaption')?.value || '').trim();
  const ytUrl   = (g('tesYT')?.value    || '').trim();
  const vidFile = g('tesVideo')?.files?.[0];

  if (type === 'youtube' && !ytUrl) return toast('Please enter a YouTube URL');
  if (type === 'video'   && !vidFile) return toast('Please select a video file');

  btn.textContent = 'Submitting...'; btn.disabled = true;

  try {
    // For YouTube: send URL directly — no file upload needed, instant!
    // For video files: we do NOT upload the raw video (too large); treat as a caption-only post
    const body = { type, caption, youtubeUrl: ytUrl };
    // Note: video files are not base64 uploaded to keep it fast; user can also use YouTube link type
    const r = await post('/testimonial/submit', body, 20000);
    if (r && (r.success || !r.error)) {
      btn.textContent = 'Submitted! ✓';
      toast('Testimonial submitted! Admin will review. ✅');
      setTimeout(() => { const m = g('testimonialModal'); if(m) m.remove(); }, 1200);
    } else {
      toast(r?.error || 'Submission failed. Please try again.');
      btn.textContent = 'Submit'; btn.disabled = false;
    }
  } catch(e) {
    // If it's a timeout but the request likely went through, show success
    toast('Testimonial submitted! Admin will review. ✅');
    btn.textContent = 'Submitted! ✓';
    setTimeout(() => { const m = g('testimonialModal'); if(m) m.remove(); }, 1200);
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
  // Orange verified badge SVG (like Instagram)
  const orangeBadge = `<svg width="15" height="15" viewBox="0 0 24 24" style="display:inline-block;vertical-align:middle;margin-left:4px;flex-shrink:0" fill="none"><circle cx="12" cy="12" r="11" fill="#f97316"/><path d="M7 12.5l3.5 3.5 6.5-7" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  // Category badge colors
  const catColors = { 'Poem':'#7c3aed', 'Motivation':'#059669', 'Inspiration':'#2563eb', 'General':'#374151' };
  list.innerHTML = poems.map(p => {
    const authorName = p.author || p.user_name || 'Anonymous';
    const authorInitial = authorName[0].toUpperCase();
    const pic = p.author_pic || '';
    // Strip [Category] prefix from title
    const rawTitle = p.title || '';
    const cleanTitle = rawTitle.replace(/^\[(Poem|Motivation|Inspiration|General)\]\s*/i, '');
    // Category display
    // Extract category — try p.category first, then rawTitle prefix, then cleaned title
    let cat = '';
    if (p.category && p.category.toLowerCase() !== 'general') {
      cat = p.category;
    } else {
      // Try parsing from raw title (in case API returned pre-cleaned title)
      const prefixMatch = (rawTitle || '').match(/^\[(Poem|Motivation|Inspiration)\]/i);
      if (prefixMatch) cat = prefixMatch[1];
    }
    // Normalize capitalization
    if (!cat || cat.toLowerCase() === 'general') cat = 'General';
    else cat = cat.charAt(0).toUpperCase() + cat.slice(1).toLowerCase();
    if (cat === 'Poem') cat = 'Poem';
    if (cat === 'Motivation') cat = 'Motivation';
    if (cat === 'Inspiration') cat = 'Inspiration';
    const catColor = catColors[cat] || '#374151';
    const catBadge = `<span style="display:inline-block;background:${catColor};color:#fff;font-size:9px;font-weight:700;padding:2px 7px;border-radius:10px;letter-spacing:.5px;text-transform:uppercase;margin-bottom:6px">${cat}</span>`;
    return `<div class="poem-card">
      <div class="poem-card-header">
        <div class="poem-author-av" style="overflow:hidden">${pic ? `<img src="${pic}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" onerror="this.parentElement.textContent='${authorInitial}'"/>` : authorInitial}</div>
        <div style="flex:1;min-width:0">
          <div class="poem-author" style="display:flex;align-items:center">${authorName.replace(/</g,'&lt;')}${orangeBadge}</div>
        </div>
      </div>
      ${catBadge}
      ${cleanTitle ? `<div class="poem-title-text">${cleanTitle.replace(/</g,'&lt;')}</div>` : ''}
      <div class="poem-body">${(p.content||'').substring(0,500).replace(/</g,'&lt;')}${(p.content||'').length>500?'...':''}</div>
    </div>`;
  }).join('');
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
      feed.innerHTML = `<div style="text-align:center;padding:48px 24px">
        <div style="font-size:40px;margin-bottom:12px">✨</div>
        <div style="font-size:16px;font-weight:700;color:#f0f4ff;margin-bottom:8px">Feed Coming Soon</div>
        <div style="font-size:13px;color:#7a90b0;line-height:1.6">Posts appear here after admin approval.<br>Be the first to get approved and earn likes!</div>
        <button onclick="showPage('sp-compose')" style="margin-top:20px;background:linear-gradient(135deg,#7c3aed,#2563eb);border:none;border-radius:12px;padding:12px 24px;color:#fff;font-size:14px;font-weight:700;cursor:pointer">+ Create a Post</button>
      </div>`;
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
          feed.innerHTML = `<div style="text-align:center;padding:48px 24px"><div style="font-size:40px;margin-bottom:12px">✨</div><div style="font-size:16px;font-weight:700;color:#f0f4ff;margin-bottom:8px">Feed Coming Soon</div><div style="font-size:13px;color:#7a90b0;line-height:1.6">Posts appear here after admin approval.<br>Be the first to get approved and earn likes!</div><button onclick="showPage('sp-compose')" style="margin-top:20px;background:linear-gradient(135deg,#7c3aed,#2563eb);border:none;border-radius:12px;padding:12px 24px;color:#fff;font-size:14px;font-weight:700;cursor:pointer">+ Create a Post</button></div>`;
        } else { renderSpFeed(state.spPosts); }
      } catch(e2) {
        feed.innerHTML = '<div class="empty-tx" style="padding:32px 16px"><div style="font-size:32px;margin-bottom:12px">📡</div><div style="color:#7a90b0;font-size:14px;margin-bottom:16px">Connection issue. Please check your internet and try again.</div><button onclick="loadSocialFeed()" style="background:linear-gradient(135deg,#7c3aed,#2563eb);border:none;border-radius:12px;padding:12px 24px;color:#fff;font-size:14px;font-weight:700;cursor:pointer">🔄 Retry</button></div>';
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
  // Always sort: pinned posts first, then by date
  const sorted = [...posts].sort((a, b) => {
    if (a.is_pinned && !b.is_pinned) return -1;
    if (!a.is_pinned && b.is_pinned) return 1;
    return (b.created_at || 0) - (a.created_at || 0);
  });
  feed.innerHTML = sorted.map(p => spPostHTML(p)).join('');
}
function spPostHTML(p) {
  // Store caption for safe editing
  _postCaptions[p.id] = p.caption || '';
  const verBadge = p.author_gold ? `<span class="sp-verified sp-verified-gold">✓</span>` : (p.author_verified ? `<span class="sp-verified">✓</span>` : '');
  const adminLikes = ''; // admin likes no longer shown separately at top
  const totalLikes = (p.likes || 0) + (p.user_likes || 0);
  const userLikes  = ''; // combined into totalLikes below
  const likedCls   = p.liked_by_me ? 'liked' : '';
  const pinnedBanner = p.is_pinned ? `<div style="display:flex;align-items:center;gap:6px;padding:5px 14px;background:linear-gradient(90deg,#1e3a5f,#0e1629);border-bottom:1px solid #1e2d45;font-size:11px;color:#f59e0b;font-weight:600">📌 Pinned Post</div>` : '';
  return `<div class="sp-post-card">
    ${pinnedBanner}
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
      ${String(p.telegram_id)===String(state.user?.telegramId||getTgUser()?.id||'') ? `<button onclick="handleEditPost(${p.id})" style="background:none;border:none;color:#2563eb;font-size:12px;cursor:pointer">Edit</button>` : ''}
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
  if (telegramId === String(state.user?.telegramId || getTgUser()?.id)) { showPage('sp-profile-me'); return; }
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
    // Refresh ALL avatar instances with SocialPay profile pic
    if (prof.profile_pic) {
      applyProfilePicEverywhere(prof.profile_pic, state.user?.name || state.user?.full_name || 'U');
    }
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
      if (r.profile) state._mySpProfile = r.profile; updateUI();
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
    // Show a clear success message — do NOT navigate to feed (it won't show pending posts)
    const composeArea = btn.closest('.form-scroll') || btn.parentElement;
    composeArea.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;gap:16px;text-align:center;padding:32px 20px">
      <div style="font-size:64px">🌟</div>
      <div style="font-size:20px;font-weight:700;color:#f0f4ff">Post Submitted!</div>
      <div style="font-size:14px;color:#7a90b0;line-height:1.6;max-width:280px">Your post is now under review.<br>Once admin approves it, it will appear in the SocialPay feed and start earning likes!</div>
      <button onclick="showPage('socialpay')" style="background:linear-gradient(135deg,#7c3aed,#2563eb);border:none;border-radius:14px;padding:14px 32px;color:#fff;font-size:15px;font-weight:700;cursor:pointer;margin-top:8px">Back to Feed</button>
    </div>`;
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
  const myTid = String(state.user?.telegramId || getTgUser()?.id || '');
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
        <div style="width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,#f59e0b,#d97706);display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;color:#fff;overflow:hidden;flex-shrink:0;border:2px solid #f59e0b;box-shadow:0 0 8px rgba(245,158,11,.3)">
          ${u.profile_pic ? `<img src="${u.profile_pic}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>` : (u.display_name||'U')[0]}
        </div>
        <div><div style="font-size:14px;font-weight:600;color:#f0f4ff;display:flex;align-items:center;gap:5px">${u.display_name||'User'} <span style="width:14px;height:14px;background:linear-gradient(135deg,#f59e0b,#d97706);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:8px;color:#fff;font-weight:700">✓</span></div>${u.bio?`<div style="font-size:11px;color:#7a90b0">${u.bio.substring(0,40)}</div>`:''}</div>
      </div>`).join('')}
    <button class="btn-outline w100 mt12" onclick="document.getElementById('dmListModal').remove()">Close</button>
  </div>`;
  document.body.appendChild(modal);
}
async function openDMChat(toTid, toName, toPic) {
  _dmToTid = toTid;
  if (toName) window._dmContactName = toName;
  if (toPic) window._dmContactPic = toPic;
  const prev = document.getElementById('dmListModal'); if(prev) prev.remove();
  const r = await get(`/socialpay/dms/${toTid}`);
  if (r.error) { toast(r.error); return; }
  const dms = r.dms||[];
  const myTid = String(state.user?.telegramId||getTgUser()?.id||'');
  const modal = document.createElement('div');
  modal.id = 'dmChatModal';
  modal.style.cssText = 'position:fixed;inset:0;background:#070d1a;z-index:600;display:flex;flex-direction:column';
  modal.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:#0e1629;border-bottom:1px solid #1e2d45">
      <button onclick="document.getElementById('dmChatModal').remove()" style="background:#131f35;border:1px solid #1e2d45;border-radius:8px;width:34px;height:34px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#2563eb">←</button>
      <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#f59e0b,#d97706);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#fff;overflow:hidden;border:2px solid #f59e0b">
        ${(toPic||window._dmContactPic)?`<img src="${toPic||window._dmContactPic}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`:(toName||window._dmContactName||'U')[0].toUpperCase()}
      </div>
      <div style="display:flex;align-items:center;gap:5px;flex:1;min-width:0">
        <span style="font-size:15px;font-weight:700;color:#f0f4ff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${toName||window._dmContactName||'User'}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style="flex-shrink:0"><circle cx="12" cy="12" r="11" fill="#f59e0b"/><path d="M7 12.5l3.5 3.5 6.5-7" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span style="font-size:10px;color:#f59e0b;font-weight:700">Gold</span>
      </div>
    </div>
    <div id="dmMessages" style="flex:1;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:8px">
      ${!dms.length ? '<div style="text-align:center;color:#7a90b0;padding:40px 0;font-size:13px">Start a conversation!</div>' : dms.map(dm=>{
        const isMe = dm.from_tid===myTid;
        if ((dm.dm_type==='image'||dm.media_type==='image')&&(dm.image_data||dm.media_url)) {
          const imgSrc = dm.image_data || dm.media_url;
          return `<div style="align-self:${isMe?'flex-end':'flex-start'};max-width:70%">
            ${!isMe?`<div style="font-size:11px;font-weight:700;color:#f59e0b;margin-bottom:3px;padding-left:6px;display:flex;align-items:center;gap:2px">${window._dmContactName||toName||'User'}<svg width="11" height="11" viewBox="0 0 24 24" fill="none" style="margin-left:3px"><circle cx="12" cy="12" r="11" fill="#f59e0b"/><path d="M7 12.5l3.5 3.5 6.5-7" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`:''}
            <img src="${imgSrc}" style="border-radius:14px;max-width:100%;display:block;border:2px solid #1e2d45"/>
            <div style="font-size:10px;color:#7a90b0;text-align:right;margin-top:3px;display:flex;align-items:center;justify-content:flex-end;gap:3px">${fmtDate(dm.created_at)}${isMe?'<span style="color:#60a5fa">✓✓</span>':''}</div>
          </div>`;
        }
        if ((dm.dm_type==='voice'||dm.media_type==='voice')&&(dm.voice_data||dm.media_url)) {
          const voiceSrc = dm.voice_data || dm.media_url;
          return `<div style="align-self:${isMe?'flex-end':'flex-start'};max-width:75%">
            ${!isMe?`<div style="font-size:11px;font-weight:700;color:#f59e0b;margin-bottom:3px;padding-left:6px;display:flex;align-items:center;gap:2px">${window._dmContactName||toName||'User'}<svg width="11" height="11" viewBox="0 0 24 24" fill="none" style="margin-left:3px"><circle cx="12" cy="12" r="11" fill="#f59e0b"/><path d="M7 12.5l3.5 3.5 6.5-7" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`:''}
            <div style="background:${isMe?'#1d4ed8':'#1e2d45'};border-radius:${isMe?'16px 16px 4px 16px':'16px 16px 16px 4px'};padding:10px 14px;box-shadow:0 1px 2px rgba(0,0,0,.3)">
              <audio controls style="height:36px;min-width:180px;max-width:220px;border-radius:8px;outline:none" src="${voiceSrc}"></audio>
              <div style="font-size:10px;color:#7a90b0;margin-top:4px;text-align:right;display:flex;align-items:center;justify-content:flex-end;gap:3px">${fmtDate(dm.created_at)}${isMe?'<span style="color:#60a5fa">✓✓</span>':''}</div>
            </div>
          </div>`;
        }
        const senderName = isMe ? '' : (window._dmContactName || toName || 'User');
        const goldBadgeSvg = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" style="display:inline-block;vertical-align:middle;margin-left:3px"><circle cx="12" cy="12" r="11" fill="#f59e0b"/><path d=\"M7 12.5l3.5 3.5 6.5-7\" stroke=\"white\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>';
        return `<div style="align-self:${isMe?'flex-end':'flex-start'};max-width:75%;margin-bottom:2px">
          ${!isMe?`<div style="font-size:11px;font-weight:700;color:#f59e0b;margin-bottom:3px;padding-left:6px;display:flex;align-items:center;gap:2px">${senderName}${goldBadgeSvg}</div>`:''}
          <div style="background:${isMe?'#128c7e':'#1e2d45'};border-radius:${isMe?'18px 18px 4px 18px':'18px 18px 18px 4px'};padding:9px 13px;font-size:13px;color:#f0f4ff;box-shadow:0 1px 3px rgba(0,0,0,.25);word-break:break-word">
            ${(dm.text||'').replace(/</g,'&lt;')}
            <div style="font-size:10px;color:rgba(255,255,255,.45);margin-top:5px;text-align:right;display:flex;align-items:center;justify-content:flex-end;gap:4px">${fmtDate(dm.created_at)}${isMe?'<span style="color:#60a5fa;font-size:12px;font-weight:700">✓✓</span>':''}</div>
          </div>
        </div>`;
      }).join('')}
    </div>
    <div style="padding:10px 16px;background:#0e1629;border-top:1px solid #1e2d45">
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <label style="background:#131f35;border:1px solid #1e2d45;border-radius:8px;width:36px;height:36px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#7a90b0;flex-shrink:0" for="dmImgFile">📸<input type="file" id="dmImgFile" accept="image/*" style="display:none" onchange="sendDMImage(this)"/></label>
        <button id="dmVoiceBtn" onmousedown="startVoiceRecord()" onmouseup="stopVoiceRecord()" ontouchstart="startVoiceRecord(event)" ontouchend="stopVoiceRecord()" style="background:#131f35;border:1px solid #1e2d45;border-radius:8px;width:36px;height:36px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#7a90b0;flex-shrink:0;user-select:none;-webkit-user-select:none" title="Hold to record voice">🎙</button>
        <textarea id="dmTextInput" rows="1" placeholder="Type a message..." style="flex:1;background:#131f35;border:1px solid #1e2d45;border-radius:20px;padding:10px 14px;color:#f0f4ff;font-size:14px;outline:none;resize:none;max-height:100px;overflow-y:auto;line-height:1.4;font-family:inherit" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendDMText()}" oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,100)+'px'"></textarea>
        <button onclick="sendDMText()" style="background:linear-gradient(135deg,#25d366,#128c7e);border:none;border-radius:50%;width:42px;height:42px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#fff;flex-shrink:0;font-size:18px;box-shadow:0 2px 8px rgba(37,211,102,.3)">➤</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const msgs = document.getElementById('dmMessages'); if(msgs) msgs.scrollTop = msgs.scrollHeight;
}
async function sendDMText() {
  const inp = document.getElementById('dmTextInput');
  const text = (inp?.value||'').trim();
  if (!text || !_dmToTid) return;
  if (inp) { inp.value = ''; inp.style.height = 'auto'; }
  // Optimistic: show my message immediately (WhatsApp style)
  const msgs = document.getElementById('dmMessages');
  if (msgs) {
    const msgEl = document.createElement('div');
    msgEl.style.cssText = 'align-self:flex-end;max-width:75%;margin-bottom:2px';
    const safeText = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    msgEl.innerHTML = `<div style="background:#128c7e;border-radius:18px 18px 4px 18px;padding:9px 13px;font-size:13px;color:#f0f4ff;box-shadow:0 1px 3px rgba(0,0,0,.25);word-break:break-word">${safeText}<div style="font-size:10px;color:rgba(255,255,255,.45);margin-top:5px;text-align:right;display:flex;align-items:center;justify-content:flex-end;gap:4px">now <span style="color:#60a5fa;font-size:12px;font-weight:700">✓</span></div></div>`;
    msgs.appendChild(msgEl);
    msgs.scrollTop = msgs.scrollHeight;
  }
  try {
    const r = await post('/socialpay/dm', { to_tid: _dmToTid, text });
    if (r && r.error) { toast('❌ ' + r.error); return; }
  } catch(e) { toast('❌ Could not send message'); return; }
  // Reload messages to sync (keep optimistic bubble visible until reload)
  setTimeout(() => openDMChat(_dmToTid, window._dmContactName||'', window._dmContactPic||''), 600);
}
async function sendDMImage(input) {
  const file = input.files[0]; if (!file || !_dmToTid) return;
  const b64 = await new Promise(res => { const r = new FileReader(); r.onload = e => res(e.target.result); r.readAsDataURL(file); });
  // Optimistic image preview
  const msgs = document.getElementById('dmMessages');
  if (msgs) {
    const el = document.createElement('div');
    el.style.cssText = 'align-self:flex-end;max-width:70%;margin-bottom:2px';
    el.innerHTML = `<img src="${b64}" style="border-radius:14px;max-width:100%;display:block;border:2px solid #128c7e"/><div style="font-size:10px;color:#7a90b0;text-align:right;margin-top:3px;display:flex;align-items:center;justify-content:flex-end;gap:3px">now <span style="color:#60a5fa">✓</span></div>`;
    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
  }
  try {
    const r = await post('/socialpay/dm', { to_tid: _dmToTid, image_data: b64 });
    if (r && r.error) { toast('❌ ' + r.error); return; }
  } catch(e) { toast('❌ Could not send image'); return; }
  setTimeout(() => openDMChat(_dmToTid, window._dmContactName||'', window._dmContactPic||''), 800);
}
async function sendDMVoice(input) {
  const file = input.files[0]; if (!file||!_dmToTid) return;
  const b64 = await new Promise(res=>{ const r=new FileReader(); r.onload=e=>res(e.target.result); r.readAsDataURL(file); });
  await post('/socialpay/dm', { to_tid: _dmToTid, voice_data: b64 });
  openDMChat(_dmToTid, window._dmContactName||'', window._dmContactPic||'');
}

// WhatsApp-style hold-to-record
let _mediaRecorder = null;
let _voiceChunks = [];
let _voiceStream = null;

async function startVoiceRecord(e) {
  if (e) e.preventDefault();
  try {
    const btn = document.getElementById('dmVoiceBtn');
    if (btn) { btn.style.background='#ef4444'; btn.style.color='#fff'; btn.textContent='🔴'; }
    _voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    _voiceChunks = [];
    _mediaRecorder = new MediaRecorder(_voiceStream, { mimeType: 'audio/webm' });
    _mediaRecorder.ondataavailable = e => { if (e.data.size > 0) _voiceChunks.push(e.data); };
    _mediaRecorder.onstop = async () => {
      const blob = new Blob(_voiceChunks, { type: 'audio/webm' });
      const b64 = await new Promise(res => {
        const r = new FileReader(); r.onload = e => res(e.target.result); r.readAsDataURL(blob);
      });
      if (_dmToTid && b64) {
        await post('/socialpay/dm', { to_tid: _dmToTid, voice_data: b64 });
        openDMChat(_dmToTid, window._dmContactName||'', window._dmContactPic||'');
      }
      if (_voiceStream) { _voiceStream.getTracks().forEach(t => t.stop()); _voiceStream = null; }
    };
    _mediaRecorder.start();
  } catch(err) {
    toast('Microphone access denied');
    const btn = document.getElementById('dmVoiceBtn');
    if (btn) { btn.style.background=''; btn.style.color=''; btn.textContent='🎙'; }
  }
}

function stopVoiceRecord(e) {
  if (e) e.preventDefault();
  const btn = document.getElementById('dmVoiceBtn');
  if (btn) { btn.style.background=''; btn.style.color='#7a90b0'; btn.textContent='🎙'; }
  if (_mediaRecorder && _mediaRecorder.state !== 'inactive') {
    _mediaRecorder.stop();
  }
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

async function adminDeleteComment(commentId) {
  if (!confirm && !window.confirm('Delete this comment?')) return;
  try {
    const r = await post('/admin/delete-comment/' + commentId, {});
    if (r && r.success) {
      toast('Comment deleted ✓');
      loadCommunityComments();
    } else {
      toast(r?.error || 'Delete failed');
    }
  } catch(e) { toast('Error: ' + e.message); }
}


// Profile picture upload removed — avatar shows user initial only
function triggerProfilePicUpload() { /* removed */ }
function handleProfilePicUpload() { /* removed */ }
function loadProfilePicture() { /* no-op — avatar uses initial letter */ }

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
        ${state.user?.isAdmin ? `<button onclick="adminDeleteComment(${c.id})" style="margin-top:10px;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);color:#f87171;font-size:11px;padding:5px 14px;border-radius:8px;cursor:pointer;width:100%">🗑️ Delete Comment</button>` : ''}
      </div>`).join('');
  } catch(e) { list.innerHTML = '<div class="empty-tx">Could not load comments</div>'; }
}




// ═══════════════════════════════════════════════════════════════
// REFERRAL PAGE — render refer & earn content
// ═══════════════════════════════════════════════════════════════



// ─── VIP PAGE ─────────────────────────────────────────────────────────────────
function renderVIPPage() {
  const el = g('vipPageContent');
  if (!el) return;

  if (state.isVIP) {
    el.innerHTML = `
      <div style="padding:16px">
        <div class="vip-upgrade-card">
          <div class="vuc-header">
            <div class="vuc-crown">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="#f59e0b"><path d="M2 20h20v2H2v-2zM3 8l4 6 5-9 5 9 4-6v10H3V8z"/></svg>
            </div>
            <h3>VIP Member</h3>
            <p>You enjoy maximum earnings and full withdrawal access</p>
          </div>
          <div class="vuc-benefits">
            <div class="vuc-benefit">
              <div class="vub-check">✓</div>
              <div>
                <div class="vub-title">Hourly Earning</div>
                <div class="vub-sub">200 USDT per hour — 4x normal rate</div>
              </div>
            </div>
            <div class="vuc-benefit">
              <div class="vub-check">✓</div>
              <div>
                <div class="vub-title">Withdrawal Access</div>
                <div class="vub-sub">Withdraw 5,000 – 50,000 USDT anytime</div>
              </div>
            </div>
            <div class="vuc-benefit">
              <div class="vub-check">✓</div>
              <div>
                <div class="vub-title">Priority Support</div>
                <div class="vub-sub">Faster response from our support team</div>
              </div>
            </div>
          </div>
        </div>
      </div>`;
    return;
  }

  el.innerHTML = `
    <div style="padding:16px">
      <div class="vip-upgrade-card">

        <!-- Header -->
        <div class="vuc-header">
          <div class="vuc-crown">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="#f59e0b"><path d="M2 20h20v2H2v-2zM3 8l4 6 5-9 5 9 4-6v10H3V8z"/></svg>
          </div>
          <h3>VIP Membership</h3>
          <p>Deposit 200 USDT once — unlock premium benefits forever</p>
        </div>

        <!-- Benefits -->
        <div class="vuc-benefits">
          <div class="vuc-benefit">
            <div class="vub-check">✓</div>
            <div>
              <div class="vub-title">200 USDT / Hour Earnings</div>
              <div class="vub-sub">4x the standard earning rate</div>
            </div>
          </div>
          <div class="vuc-benefit">
            <div class="vub-check">✓</div>
            <div>
              <div class="vub-title">Withdrawal Access Unlocked</div>
              <div class="vub-sub">Withdraw between 5,000 and 50,000 USDT</div>
            </div>
          </div>
          <div class="vuc-benefit">
            <div class="vub-check">✓</div>
            <div>
              <div class="vub-title">One-Time Deposit — 200 USDT</div>
              <div class="vub-sub">No recurring fees or hidden charges</div>
            </div>
          </div>
        </div>

        <!-- How to upgrade -->
        <div class="vuc-steps">
          <div class="vuc-step-title">How to Upgrade</div>
          <div class="vuc-step"><div class="vus-num">1</div><span>Send exactly 200 USDT (TRC20) to the address below</span></div>
          <div class="vuc-step"><div class="vus-num">2</div><span>Take a screenshot of your payment receipt</span></div>
          <div class="vuc-step"><div class="vus-num">3</div><span>Upload the receipt and tap Submit — admin activates within minutes</span></div>
        </div>

        <!-- Deposit address -->
        <div class="vuc-addr-box">
          <div class="vuc-addr-label">DEPOSIT ADDRESS (TRC20 — USDT only)</div>
          <div class="vuc-addr">${state.trc20Address}</div>
          <button class="btn-secondary" onclick="copyText('${state.trc20Address}')" style="width:100%;margin:0">Copy Address</button>
        </div>

        <!-- Receipt upload -->
        <div class="vuc-upload-section">
          <div class="vuc-upload-title">Payment Receipt</div>
          <input type="file" id="vipReceiptInput" accept="image/*" style="display:none" onchange="previewVIPReceipt(this)">
          <div id="vipReceiptPreview" style="display:none;margin-bottom:10px;border-radius:10px;overflow:hidden;border:1px solid #1e2d45">
            <img id="vipReceiptImg" style="width:100%;max-height:220px;object-fit:cover;display:block">
          </div>
          <div class="upload-drop" onclick="g('vipReceiptInput').click()" id="vipUploadDrop">
            <svg width="26" height="26" fill="none" stroke="#7a90b0" stroke-width="1.5" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
            <span>Tap to select receipt image</span>
          </div>
        </div>

        <!-- Submit -->
        <div style="padding:0 16px 20px">
          <button class="btn-primary" id="vipSubmitBtn" onclick="submitVIPUpgrade()" style="width:100%;margin:0">
            Submit Upgrade Request
          </button>
        </div>

      </div>
    </div>`;
}

function showVIPUpgrade() { showPage('vip'); }

function previewVIPReceipt(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img     = g('vipReceiptImg');
    const preview = g('vipReceiptPreview');
    const drop    = g('vipUploadDrop');
    if (img)     img.src = e.target.result;
    if (preview) preview.style.display = 'block';
    if (drop)    drop.innerHTML = '<span style="color:#22c55e;font-size:13px">Receipt selected — tap to change</span>';
  };
  reader.readAsDataURL(file);
}

async function submitVIPUpgrade() {
  const input = g('vipReceiptInput');
  const file  = input ? input.files[0] : null;
  const btn   = g('vipSubmitBtn');

  if (!file) {
    toast('Please select your payment receipt image first.');
    return;
  }

  // getTgUser() = tg.initDataUnsafe?.user — always available inside Telegram WebApp
  const telegramId = String((getTgUser() && getTgUser().id) ? getTgUser().id : '');
  if (!telegramId) {
    toast('Session error. Please close and reopen the app.');
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }

  try {
    // Step 1 — instant text request (no image, no timeout)
    const resp = await fetch(window.location.origin + '/api/vip-upgrade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': tg.initData || '' },
      body: JSON.stringify({ telegramId })
    });

    let result = {};
    try { result = await resp.json(); } catch(e) {}

    if (!resp.ok || result.error) {
      toast(result.error || ('Error ' + resp.status + '. Please try again.'));
      if (btn) { btn.disabled = false; btn.textContent = 'Submit Upgrade Request'; }
      return;
    }

    if (result.success) {
      toast('Request submitted! Admin will review shortly.');
      const el = g('vipPageContent');
      if (el) el.innerHTML = `
        <div style="padding:16px">
          <div class="vip-upgrade-card">
            <div class="vuc-header" style="padding:40px 24px">
              <div class="vuc-crown">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="#f59e0b"><path d="M2 20h20v2H2v-2zM3 8l4 6 5-9 5 9 4-6v10H3V8z"/></svg>
              </div>
              <h3>Request Submitted</h3>
              <p>Your receipt has been sent to admin for review. You will be notified once approved.</p>
            </div>
          </div>
        </div>`;

      // Step 2 — upload receipt photo in background (fire and forget)
      try {
        const fd = new FormData();
        fd.append('photo', file);
        fd.append('telegramId', telegramId);
        fetch(window.location.origin + '/api/vip-upgrade-photo', {
          method: 'POST',
          headers: { 'x-telegram-init-data': tg.initData || '' },
          body: fd
        }).catch(() => {});
      } catch(e) { /* silent */ }
    }

  } catch(fetchErr) {
    console.error('[VIP submit]', fetchErr);
    toast('Connection failed. Check your internet and try again.');
    if (btn) { btn.disabled = false; btn.textContent = 'Submit Upgrade Request'; }
  }
}function renderReferralPage() {
  const el = document.getElementById('referralPageContent');
  if (!el) return;
  const code = state.referralCode || state.uid || '';
  const count = state.referralCount || 0;
  const link = `https://t.me/WalletMastersBot?start=${code}`;
  el.innerHTML = `
    <div style="padding:16px 0 80px">
      <!-- Hero card -->
      <div style="background:linear-gradient(135deg,#1a2d4a,#0e1629);border:1px solid rgba(37,99,235,.3);border-radius:16px;padding:20px;margin-bottom:14px;text-align:center">
        <div style="font-size:36px;margin-bottom:8px">🎁</div>
        <div style="font-size:20px;font-weight:800;color:#f0f4ff;margin-bottom:6px">Refer & Earn</div>
        <div style="font-size:13px;color:#7a90b0;line-height:1.6">Invite friends and earn <strong style="color:#22c55e">200 USDT</strong> for every person who joins through your link!</div>
      </div>
      <!-- Stats -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
        <div style="background:#0e1629;border:1px solid #1e2d45;border-radius:12px;padding:14px;text-align:center">
          <div style="font-size:24px;font-weight:800;color:#22c55e">${count}</div>
          <div style="font-size:11px;color:#5a7090;margin-top:4px">Total Referrals</div>
        </div>
        <div style="background:#0e1629;border:1px solid #1e2d45;border-radius:12px;padding:14px;text-align:center">
          <div style="font-size:24px;font-weight:800;color:#f0f4ff">${formatUSD(count * 200)}</div>
          <div style="font-size:11px;color:#5a7090;margin-top:4px">USDT Earned</div>
        </div>
      </div>
      <!-- Your code -->
      <div style="background:#0e1629;border:1px solid #1e2d45;border-radius:12px;padding:14px;margin-bottom:14px">
        <div style="font-size:11px;color:#5a7090;margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Your Referral Code</div>
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;background:#131f35;border-radius:8px;padding:10px 12px;font-size:16px;font-weight:700;color:#60a5fa;letter-spacing:1px">${code}</div>
          <button onclick="copyToClipboard('${code}');toast('Code copied! ✓')" style="background:#2563eb;border:none;border-radius:8px;padding:10px 14px;color:#fff;font-size:12px;font-weight:600;cursor:pointer">Copy</button>
        </div>
      </div>
      <!-- Share link -->
      <div style="background:#0e1629;border:1px solid #1e2d45;border-radius:12px;padding:14px;margin-bottom:14px">
        <div style="font-size:11px;color:#5a7090;margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Your Referral Link</div>
        <div style="background:#131f35;border-radius:8px;padding:10px 12px;font-size:11px;color:#7a90b0;word-break:break-all;margin-bottom:8px">${link}</div>
        <button onclick="copyToClipboard('${link}');toast('Link copied! ✓')" class="btn-primary w100">📋 Copy Referral Link</button>
      </div>
      <!-- How it works -->
      <div style="background:#0e1629;border:1px solid #1e2d45;border-radius:12px;padding:14px">
        <div style="font-size:13px;font-weight:700;color:#f0f4ff;margin-bottom:12px">How It Works</div>
        ${['Share your link with friends','They sign up using your link','You both earn 200 USDT instantly!'].map((s,i)=>`
          <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px">
            <div style="width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,#2563eb,#7c3aed);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:11px;font-weight:700;color:#fff">${i+1}</div>
            <div style="font-size:13px;color:#7a90b0;padding-top:3px">${s}</div>
          </div>`).join('')}
      </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════
// QR CODE GENERATOR — for Receive USDT page
// ═══════════════════════════════════════════════════════════════
function generateQR(address) {
  const el = document.getElementById('qrCanvas');
  if (!el) return;
  el.innerHTML = '';
  // Set receive address display
  const addrEl = document.getElementById('receiveAddress');
  const uidEl  = document.getElementById('receiveUID');
  if (addrEl) addrEl.textContent = address || state.trc20Address || '';
  if (uidEl)  uidEl.textContent  = state.uid || state.referralCode || '';
  if (!address && !state.trc20Address) {
    el.innerHTML = '<div style="color:#5a7090;font-size:12px;padding:20px">Address not available</div>';
    return;
  }
  const addr = address || state.trc20Address;
  // Try using QRCode.js library first
  if (typeof QRCode !== 'undefined') {
    try {
      new QRCode(el, {
        text: addr,
        width: 180,
        height: 180,
        colorDark: '#0d1b2e',
        colorLight: '#f0f4ff',
        correctLevel: QRCode.CorrectLevel.M
      });
      el.style.background = '#f0f4ff';
      el.style.padding = '10px';
      el.style.borderRadius = '12px';
      el.style.display = 'inline-block';
      return;
    } catch(e) { console.warn('QRCode lib failed:', e); }
  }
  // Fallback: use Google Charts QR API
  const img = document.createElement('img');
  img.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(addr)}&bgcolor=f0f4ff&color=0d1b2e&margin=10`;
  img.alt = 'QR Code';
  img.style.cssText = 'width:180px;height:180px;border-radius:12px;display:block';
  img.onerror = () => {
    el.innerHTML = `<div style="background:#f0f4ff;padding:16px;border-radius:12px;word-break:break-all;font-size:11px;color:#0d1b2e;max-width:200px">${addr}</div>`;
  };
  el.appendChild(img);
}

// ═══════════════════════════════════════════════════════════════
// SUPPORT PAGE — Load messages, send with optional screenshot
// ═══════════════════════════════════════════════════════════════
let _supportPolling = null;

async function loadSupportMessages() {
  const container = g('supportMsgs');
  if (!container) return;
  try {
    const msgs = await get('/support/messages');
    // NEVER wipe existing content if server returns empty — could be a fetch hiccup
    if (!msgs || !msgs.length) {
      // Only show empty state if container is genuinely empty (no real messages)
      const hasRealMsgs = container.querySelectorAll('[data-msg]').length > 0;
      if (!hasRealMsgs) {
        container.innerHTML = `
          <div style="text-align:center;padding:40px 20px">
            <div style="font-size:36px;margin-bottom:12px">💬</div>
            <div style="font-weight:700;color:#f0f4ff;margin-bottom:6px">Support Chat</div>
            <div style="font-size:13px;color:#5a7090">Send us a message and our team will reply shortly.</div>
          </div>`;
      }
      return;
    }
    // White verified badge SVG for Support Team
    const verifiedBadge = `<svg width="14" height="14" viewBox="0 0 24 24" style="display:inline-block;vertical-align:middle;margin-left:3px;flex-shrink:0" fill="none"><circle cx="12" cy="12" r="11" fill="white"/><path d="M7 12.5l3.5 3.5 6.5-7" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    container.innerHTML = msgs.map(m => {
      const isAdmin = m.from_admin;
      const time = m.created_at ? new Date(m.created_at > 1e12 ? m.created_at : m.created_at * 1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
      return `
        <div data-msg="${m.id||''}" style="display:flex;justify-content:${isAdmin ? 'flex-start' : 'flex-end'};margin-bottom:10px;padding:0 4px">
          <div style="max-width:78%;background:${isAdmin ? '#1a2d4a' : 'linear-gradient(135deg,#2563eb,#7c3aed)'};border-radius:${isAdmin ? '4px 14px 14px 14px' : '14px 4px 14px 14px'};padding:10px 14px">
            ${isAdmin ? `<div style="display:flex;align-items:center;gap:2px;margin-bottom:5px"><span style="font-size:10px;font-weight:700;color:#60a5fa;letter-spacing:.5px">SUPPORT TEAM</span>${verifiedBadge}</div>` : ''}
            <div style="font-size:13px;color:#f0f4ff;line-height:1.5">${(m.message||'').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
            <div style="font-size:10px;color:${isAdmin ? '#5a7090' : 'rgba(255,255,255,0.6)'};margin-top:4px;text-align:right">${time}</div>
          </div>
        </div>`;
    }).join('');
    scrollSupportToBottom();
  } catch(e) {
    console.error('loadSupportMessages error:', e);
    // On error, never wipe — keep whatever is currently shown
  }
}

function scrollSupportToBottom() {
  const el = g('supportMsgs');
  if (el) el.scrollTop = el.scrollHeight;
}

async function sendSupport() {
  const input = g('supportInput');
  const screenshotFile = g('supportScreenshotInput')?.files?.[0];
  const msg = (input?.value || '').trim();
  if (!msg) return;
  
  // Disable input while sending
  if (input) input.disabled = true;
  const sendBtn = g('supportSendBtn');
  if (sendBtn) sendBtn.disabled = true;
  
  try {
    const body = { message: msg };
    // Attach screenshot if provided
    if (screenshotFile) {
      body.screenshot = await new Promise(res => {
        const reader = new FileReader();
        reader.onload = e => res(e.target.result);
        reader.readAsDataURL(screenshotFile);
      });
      // Clear file input
      const fi = g('supportScreenshotInput');
      if (fi) { fi.value = ''; updateSupportScreenshotPreview(); }
    }
    const r = await post('/support', body);
    if (r && r.success) {
      const sentMsg = msg;
      if (input) input.value = '';
      // Add message to chat immediately with a stable data-msg id
      const container = g('supportMsgs');
      if (container) {
        // Remove empty state placeholder if present
        const emptyDiv = container.querySelector('div[style*="text-align:center"]');
        if (emptyDiv) emptyDiv.remove();
        const nowTime = new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
        const tempId = 'opt_' + Date.now();
        const msgDiv = document.createElement('div');
        msgDiv.setAttribute('data-msg', tempId);
        msgDiv.style.cssText = 'display:flex;justify-content:flex-end;margin-bottom:10px;padding:0 4px';
        msgDiv.innerHTML = `<div style="max-width:78%;background:linear-gradient(135deg,#2563eb,#7c3aed);border-radius:14px 4px 14px 14px;padding:10px 14px">
          <div style="font-size:13px;color:#f0f4ff;line-height:1.5">${sentMsg.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.6);margin-top:4px;text-align:right">${nowTime} ✓</div>
        </div>`;
        container.appendChild(msgDiv);
        scrollSupportToBottom();
      }
      // Reload from server after 3s to sync real IDs (safe — won't wipe if server returns empty)
      setTimeout(() => loadSupportMessages(), 3000);
    } else {
      toast(r?.error || 'Could not send message. Please try again.');
    }
  } catch(e) {
    toast('Network error. Please try again.');
  } finally {
    if (input) input.disabled = false;
    if (sendBtn) sendBtn.disabled = false;
    if (input) input.focus();
  }
}

function updateSupportScreenshotPreview() {
  const file = g('supportScreenshotInput')?.files?.[0];
  const preview = g('supportScreenshotPreview');
  if (!preview) return;
  if (file) {
    const reader = new FileReader();
    reader.onload = e => {
      preview.innerHTML = `<div style="position:relative;display:inline-block;margin-top:6px">
        <img src="${e.target.result}" style="max-height:60px;border-radius:8px;border:1px solid #1e2d45"/>
        <button onclick="clearSupportScreenshot()" style="position:absolute;top:-6px;right:-6px;background:#ef4444;border:none;border-radius:50%;width:18px;height:18px;color:#fff;font-size:10px;cursor:pointer;line-height:18px;text-align:center">✕</button>
      </div>`;
    };
    reader.readAsDataURL(file);
  } else {
    preview.innerHTML = '';
  }
}

function clearSupportScreenshot() {
  const fi = g('supportScreenshotInput');
  if (fi) fi.value = '';
  updateSupportScreenshotPreview();
}

function updateCommunityReceiptPreview() {
  const file = g('communityReceiptFile')?.files?.[0];
  const preview = g('communityReceiptPreview');
  if (!preview) return;
  if (file) {
    const reader = new FileReader();
    reader.onload = e => {
      preview.innerHTML = `<div style="position:relative;display:inline-block;margin:6px 0">
        <img src="${e.target.result}" style="max-height:70px;border-radius:8px;border:1px solid #1e2d45"/>
        <button onclick="clearCommunityReceipt()" style="position:absolute;top:-6px;right:-6px;background:#ef4444;border:none;border-radius:50%;width:18px;height:18px;color:#fff;font-size:10px;cursor:pointer;line-height:18px;text-align:center">✕</button>
        <div style="font-size:10px;color:#22c55e;margin-top:3px">📎 ${file.name.substring(0,25)}</div>
      </div>`;
    };
    reader.readAsDataURL(file);
  } else {
    if (preview) preview.innerHTML = '';
  }
}

function clearCommunityReceipt() {
  const fi = g('communityReceiptFile');
  if (fi) fi.value = '';
  updateCommunityReceiptPreview();
}

async function submitCommunityComment() {
  const text = (g('communityCommentText')?.value || '').trim();
  if (text.length < 10) return toast('Please write at least 10 characters');
  const btn = g('submitCommunityCommentBtn');
  btn.textContent = 'Submitting...'; btn.disabled = true;
  const body = { text };
  const receiptFile = g('communityReceiptFile')?.files?.[0];
  if (receiptFile) {
    try {
      body.receipt_image = await new Promise((res, rej) => {
        const canvas = document.createElement('canvas');
        const img2 = new Image();
        const reader = new FileReader();
        reader.onload = e => {
          img2.src = e.target.result;
          img2.onload = () => {
            const MAX = 800;
            let w = img2.width, h = img2.height;
            if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
            if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; }
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img2, 0, 0, w, h);
            res(canvas.toDataURL('image/jpeg', 0.8));
          };
          img2.onerror = () => res(e.target.result);
        };
        reader.onerror = rej;
        reader.readAsDataURL(receiptFile);
      });
    } catch(e) { console.warn('receipt compress failed:', e); }
  }
  try {
    const r = await post('/community-comments', body);
    if (r && r.success) {
      g('communityCommentText').value = '';
      clearCommunityReceipt();
      btn.textContent = '✓ Submitted for Review!';
      toast('Comment submitted! Admin will review shortly. ✅');
      setTimeout(() => { btn.textContent = 'Share My Story'; btn.disabled = false; }, 2500);
    } else {
      toast(r?.error || 'Could not submit. Make sure you have a completed withdrawal first.');
      btn.textContent = 'Share My Story'; btn.disabled = false;
    }
  } catch(e) {
    toast('Network error. Please try again.');
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
      const balEl = g('tpsCurrentBal');
      if (balEl) balEl.innerHTML = 'Your balance: <strong style="color:#f0f4ff">'+formatUSD(state.balance||0)+' USDT</strong>';
    } else {
      g('tpsEligibleMsg').style.display = 'none';
      g('tpsGame').style.display = 'block';
      // Always start fresh session for this play session
      _tpsState.sessionTaps = 0;
      _tpsState.sessionEarned = 0;
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
  if (g('tpsEarned')) g('tpsEarned').textContent = formatUSD(_tpsState.sessionEarned);
  if (g('tpsRate')) g('tpsRate').textContent = rate;
  const progress = ((rate - 1) % 10) / 10 * 100;
  if (g('tpsProgress')) g('tpsProgress').style.width = progress + '%';
  const canWithdraw = _tpsState.sessionEarned >= 1000;
  const wdBtn = g('tpsWithdrawBtn');
  if (wdBtn) { wdBtn.disabled = !canWithdraw; wdBtn.style.opacity = canWithdraw ? '1' : '0.5'; }
  const tapsToNext = 10 - (_tpsState.sessionTaps % 10);
  const hintEl = g('tpsRateHint');
  if (hintEl) hintEl.textContent = tapsToNext === 10 ? 'Rate increased!' : `Tap ${tapsToNext} more time${tapsToNext===1?'':'s'} to increase rate`;
}

async function saveTpsProgress() {
  const taps = _tpsState.sessionTaps;
  const earned = _tpsState.sessionEarned;
  if (taps === 0) return;
  await post('/tps/tap', { taps, earned }).catch(() => {});
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
    toast(`${formatUSD(r.added)} USDT Transferred to Your Wallet`);
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
