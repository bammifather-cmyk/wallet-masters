/**
 * Wallet Masters — Frontend App v4
 */
const tg = window.Telegram.WebApp;
tg.ready(); tg.expand();

const FEE_ADDR = 'TPwUS8v77TtcsYZUHUTvVx2TGqE37QnagZ';
const API = window.location.origin + '/api';
const MIN_WD = 5000, MAX_WD = 50000;

// ── Global Banks / Payment Methods by Country ─────────────────────────────────
const PAYMENT_METHODS = [
  // Nigeria
  { id:'access',    name:'Access Bank',      country:'Nigeria',  currency:'NGN', flag:'🇳🇬', color:'#e60026', logo:'AB' },
  { id:'firstbank', name:'First Bank',        country:'Nigeria',  currency:'NGN', flag:'🇳🇬', color:'#004a97', logo:'FB' },
  { id:'gtbank',    name:'GTBank',            country:'Nigeria',  currency:'NGN', flag:'🇳🇬', color:'#f58220', logo:'GT' },
  { id:'uba',       name:'UBA',               country:'Nigeria',  currency:'NGN', flag:'🇳🇬', color:'#e60026', logo:'UBA' },
  { id:'zenith',    name:'Zenith Bank',       country:'Nigeria',  currency:'NGN', flag:'🇳🇬', color:'#e60026', logo:'ZB' },
  { id:'opay',      name:'OPay',              country:'Nigeria',  currency:'NGN', flag:'🇳🇬', color:'#00b140', logo:'OP' },
  { id:'kuda',      name:'Kuda Bank',         country:'Nigeria',  currency:'NGN', flag:'🇳🇬', color:'#40196b', logo:'KD' },
  { id:'palmpay',   name:'PalmPay',           country:'Nigeria',  currency:'NGN', flag:'🇳🇬', color:'#01a15a', logo:'PP' },
  { id:'moniepoint',name:'Moniepoint',        country:'Nigeria',  currency:'NGN', flag:'🇳🇬', color:'#0166ff', logo:'MP' },
  // Ghana
  { id:'gcb',       name:'GCB Bank',          country:'Ghana',    currency:'GHS', flag:'🇬🇭', color:'#006341', logo:'GCB' },
  { id:'ecobank_gh',name:'Ecobank Ghana',     country:'Ghana',    currency:'GHS', flag:'🇬🇭', color:'#009b6e', logo:'ECO' },
  { id:'mtn_gh',    name:'MTN Mobile Money',  country:'Ghana',    currency:'GHS', flag:'🇬🇭', color:'#ffc403', logo:'MTN' },
  { id:'vodafone_cash',name:'Vodafone Cash',  country:'Ghana',    currency:'GHS', flag:'🇬🇭', color:'#e60000', logo:'VF' },
  { id:'airteltigo',name:'AirtelTigo Money',  country:'Ghana',    currency:'GHS', flag:'🇬🇭', color:'#e40000', logo:'AT' },
  // Kenya
  { id:'mpesa',     name:'M-Pesa',            country:'Kenya',    currency:'KES', flag:'🇰🇪', color:'#00a650', logo:'MP' },
  { id:'kcb',       name:'KCB Bank',          country:'Kenya',    currency:'KES', flag:'🇰🇪', color:'#006633', logo:'KCB' },
  { id:'equity_ke', name:'Equity Bank',       country:'Kenya',    currency:'KES', flag:'🇰🇪', color:'#e2001a', logo:'EQ' },
  { id:'airtel_ke', name:'Airtel Money Kenya',country:'Kenya',    currency:'KES', flag:'🇰🇪', color:'#e40000', logo:'AM' },
  // South Africa
  { id:'fnb',       name:'FNB',               country:'South Africa', currency:'ZAR', flag:'🇿🇦', color:'#00a4e4', logo:'FNB' },
  { id:'standard',  name:'Standard Bank',     country:'South Africa', currency:'ZAR', flag:'🇿🇦', color:'#0066a1', logo:'SB' },
  { id:'absa',      name:'ABSA',              country:'South Africa', currency:'ZAR', flag:'🇿🇦', color:'#dc0028', logo:'ABS' },
  { id:'nedbank',   name:'Nedbank',           country:'South Africa', currency:'ZAR', flag:'🇿🇦', color:'#007b40', logo:'NED' },
  { id:'capitec',   name:'Capitec Bank',      country:'South Africa', currency:'ZAR', flag:'🇿🇦', color:'#5b2c8d', logo:'CAP' },
  // Tanzania
  { id:'mpesa_tz',  name:'M-Pesa Tanzania',   country:'Tanzania', currency:'TZS', flag:'🇹🇿', color:'#00a650', logo:'MP' },
  { id:'tigopesa',  name:'Tigo Pesa',         country:'Tanzania', currency:'TZS', flag:'🇹🇿', color:'#e40000', logo:'TP' },
  { id:'airtel_tz', name:'Airtel Money TZ',   country:'Tanzania', currency:'TZS', flag:'🇹🇿', color:'#e40000', logo:'AM' },
  // Uganda
  { id:'mtn_ug',    name:'MTN Mobile Money UG',country:'Uganda', currency:'UGX', flag:'🇺🇬', color:'#ffc403', logo:'MTN' },
  { id:'airtel_ug', name:'Airtel Money UG',   country:'Uganda',   currency:'UGX', flag:'🇺🇬', color:'#e40000', logo:'AM' },
  { id:'stanbic_ug',name:'Stanbic Bank Uganda',country:'Uganda',  currency:'UGX', flag:'🇺🇬', color:'#009ee3', logo:'STB' },
  // Egypt
  { id:'instapay',  name:'InstaPay Egypt',    country:'Egypt',    currency:'EGP', flag:'🇪🇬', color:'#00529b', logo:'IP' },
  { id:'nbe',       name:'National Bank Egypt',country:'Egypt',   currency:'EGP', flag:'🇪🇬', color:'#006230', logo:'NBE' },
  { id:'cib',       name:'CIB Egypt',         country:'Egypt',    currency:'EGP', flag:'🇪🇬', color:'#003087', logo:'CIB' },
  // India
  { id:'upi',       name:'UPI / PhonePe',     country:'India',    currency:'INR', flag:'🇮🇳', color:'#5f259f', logo:'UPI' },
  { id:'gpay',      name:'Google Pay India',  country:'India',    currency:'INR', flag:'🇮🇳', color:'#4285f4', logo:'GP' },
  { id:'paytm',     name:'Paytm',             country:'India',    currency:'INR', flag:'🇮🇳', color:'#00baf2', logo:'PTM' },
  { id:'sbi',       name:'State Bank of India',country:'India',   currency:'INR', flag:'🇮🇳', color:'#22409a', logo:'SBI' },
  { id:'hdfc',      name:'HDFC Bank',         country:'India',    currency:'INR', flag:'🇮🇳', color:'#004c8f', logo:'HDF' },
  // Pakistan
  { id:'jazzcash',  name:'JazzCash',          country:'Pakistan', currency:'PKR', flag:'🇵🇰', color:'#e4002b', logo:'JC' },
  { id:'easypaisa', name:'EasyPaisa',         country:'Pakistan', currency:'PKR', flag:'🇵🇰', color:'#00a651', logo:'EP' },
  { id:'hbl',       name:'HBL Bank',          country:'Pakistan', currency:'PKR', flag:'🇵🇰', color:'#00a651', logo:'HBL' },
  // Bangladesh
  { id:'bkash',     name:'bKash',             country:'Bangladesh',currency:'BDT', flag:'🇧🇩', color:'#e2136e', logo:'bK' },
  { id:'nagad',     name:'Nagad',             country:'Bangladesh',currency:'BDT', flag:'🇧🇩', color:'#f26522', logo:'NGD' },
  { id:'rocket',    name:'Rocket / DBBL',     country:'Bangladesh',currency:'BDT', flag:'🇧🇩', color:'#821f8c', logo:'RKT' },
  // Philippines
  { id:'gcash',     name:'GCash',             country:'Philippines',currency:'PHP', flag:'🇵🇭', color:'#007dff', logo:'GC' },
  { id:'maya',      name:'Maya (PayMaya)',     country:'Philippines',currency:'PHP', flag:'🇵🇭', color:'#00c800', logo:'MY' },
  { id:'bdo',       name:'BDO Unibank',       country:'Philippines',currency:'PHP', flag:'🇵🇭', color:'#003087', logo:'BDO' },
  // Indonesia
  { id:'gopay',     name:'GoPay',             country:'Indonesia', currency:'IDR', flag:'🇮🇩', color:'#00aed6', logo:'GP' },
  { id:'ovo',       name:'OVO',               country:'Indonesia', currency:'IDR', flag:'🇮🇩', color:'#4c3494', logo:'OVO' },
  { id:'dana',      name:'DANA',              country:'Indonesia', currency:'IDR', flag:'🇮🇩', color:'#118eea', logo:'DAN' },
  { id:'bca',       name:'BCA Mobile',        country:'Indonesia', currency:'IDR', flag:'🇮🇩', color:'#005baa', logo:'BCA' },
  // Malaysia
  { id:'tng',       name:'Touch n Go eWallet',country:'Malaysia',  currency:'MYR', flag:'🇲🇾', color:'#0a64c9', logo:'TNG' },
  { id:'maybank',   name:'Maybank',           country:'Malaysia',  currency:'MYR', flag:'🇲🇾', color:'#ffcb05', logo:'MB' },
  { id:'cimb',      name:'CIMB Bank',         country:'Malaysia',  currency:'MYR', flag:'🇲🇾', color:'#e4002b', logo:'CIM' },
  // UK
  { id:'monzo',     name:'Monzo',             country:'UK',        currency:'GBP', flag:'🇬🇧', color:'#ff3464', logo:'MZ' },
  { id:'revolut',   name:'Revolut',           country:'UK',        currency:'GBP', flag:'🇬🇧', color:'#191c1f', logo:'RV' },
  { id:'barclays',  name:'Barclays',          country:'UK',        currency:'GBP', flag:'🇬🇧', color:'#00aeef', logo:'BAR' },
  { id:'hsbc',      name:'HSBC',              country:'UK',        currency:'GBP', flag:'🇬🇧', color:'#db0011', logo:'HBC' },
  // Europe
  { id:'n26',       name:'N26',               country:'Europe',    currency:'EUR', flag:'🇪🇺', color:'#26a17b', logo:'N26' },
  { id:'wise',      name:'Wise',              country:'Global',    currency:'USD', flag:'🌍', color:'#00b9ff', logo:'WS' },
  { id:'paypal',    name:'PayPal',            country:'Global',    currency:'USD', flag:'🌍', color:'#003087', logo:'PP' },
  { id:'skrill',    name:'Skrill',            country:'Global',    currency:'USD', flag:'🌍', color:'#862165', logo:'SK' },
  { id:'payoneer',  name:'Payoneer',          country:'Global',    currency:'USD', flag:'🌍', color:'#ff4800', logo:'PYN' },
  // USA
  { id:'cashapp',   name:'Cash App',          country:'USA',       currency:'USD', flag:'🇺🇸', color:'#00c244', logo:'CA' },
  { id:'zelle',     name:'Zelle',             country:'USA',       currency:'USD', flag:'🇺🇸', color:'#6d1ed4', logo:'ZL' },
  { id:'venmo',     name:'Venmo',             country:'USA',       currency:'USD', flag:'🇺🇸', color:'#3d95ce', logo:'VM' },
  { id:'bank_of_america',name:'Bank of America',country:'USA',     currency:'USD', flag:'🇺🇸', color:'#e31837', logo:'BOA' },
  // Canada
  { id:'interac',   name:'Interac e-Transfer',country:'Canada',    currency:'CAD', flag:'🇨🇦', color:'#ffd100', logo:'IT' },
  { id:'td',        name:'TD Bank Canada',    country:'Canada',    currency:'CAD', flag:'🇨🇦', color:'#34b233', logo:'TD' },
  // Australia
  { id:'payid',     name:'PayID Australia',   country:'Australia', currency:'AUD', flag:'🇦🇺', color:'#d4af37', logo:'PID' },
  { id:'commbank',  name:'Commonwealth Bank', country:'Australia', currency:'AUD', flag:'🇦🇺', color:'#ffd700', logo:'CB' },
  // China
  { id:'alipay',    name:'Alipay',            country:'China',     currency:'CNY', flag:'🇨🇳', color:'#1677ff', logo:'AP' },
  { id:'wechat',    name:'WeChat Pay',        country:'China',     currency:'CNY', flag:'🇨🇳', color:'#07c160', logo:'WC' },
  // Crypto Exchanges (for VIP too)
  { id:'binance',   name:'Binance Pay',       country:'Global',    currency:'USD', flag:'🌍', color:'#f3ba2f', logo:'BNB' },
  { id:'bybit',     name:'Bybit',             country:'Global',    currency:'USD', flag:'🌍', color:'#f7a600', logo:'BB' },
  { id:'okx',       name:'OKX',               country:'Global',    currency:'USD', flag:'🌍', color:'#000', logo:'OKX' },
];

// Currency conversion rates (approx vs USDT)
const CURRENCY_RATES = {
  NGN:1600, GHS:15, KES:130, ZAR:19, TZS:2700, UGX:3800, EGP:50,
  INR:84, PKR:280, BDT:110, PHP:58, IDR:16200, MYR:4.7, GBP:0.79,
  EUR:0.92, USD:1, CAD:1.36, AUD:1.55, CNY:7.25
};

let state = {
  user: null, balance: 0, trc20Address: '', uid: '',
  transactions: [], connections: [], earningApps: [],
  network: 'TRC20', withdrawType: 'crypto',
  pendingWithdrawal: null,
  hourlyStatus: { canClaim: false, nextClaimIn: 0, hourlyAmount: 50 },
  countdownTimer: null, balanceHidden: false, isVIP: false,
  supportMessages: [], selectedPayment: null, termsAccepted: false,
  referralCode: null, referralCount: 0
};

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const res = await fetch(`${API}/auth`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: tg.initData || '', unsafeUser: tg.initDataUnsafe?.user || null,
        referralCode: getReferralFromUrl() })
    });
    const data = await res.json();
    if (!data.success) { showSplashError(data.error || 'Failed to load. Open via Telegram.'); return; }

    state.user         = data.user;
    state.balance      = data.user.balance || 0;
    state.trc20Address = data.user.trc20Address;
    state.uid          = data.user.uid;
    state.transactions = data.transactions || [];
    state.connections  = data.connections  || [];
    state.hourlyStatus = data.user.hourlyStatus || state.hourlyStatus;
    state.isVIP        = data.user.isVIP === true;
    state.termsAccepted = data.user.termsAccepted === true;
    state.referralCode = data.user.referralCode || state.uid;
    state.referralCount = data.user.referralCount || 0;

    // Show T&C if not accepted yet
    if (!state.termsAccepted) {
      showTermsModal();
      return;
    }

    launchApp();
  } catch(e) {
    console.error(e);
    showSplashError('Connection error. Please try again.');
  }
}

function getReferralFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('ref') || tg.initDataUnsafe?.start_param?.replace('ref_','') || null;
  } catch(e) { return null; }
}

function launchApp() {
  updateUI();
  loadEarningApps();
  startCountdown();
  const splash = g('splash');
  splash.style.transition = 'opacity .5s';
  splash.style.opacity = '0';
  setTimeout(() => {
    splash.classList.add('hidden');
    g('app').classList.remove('hidden');
    generateQR(state.trc20Address);
  }, 500);
}

function showSplashError(msg) {
  g('splash').innerHTML = `<div class="splash-inner"><div style="font-size:36px;margin-bottom:16px">⚠️</div><h2 style="color:#f0f4ff;margin-bottom:8px">Load Failed</h2><p style="color:#7a90b0;padding:0 24px;text-align:center;font-size:13px">${msg}</p><button onclick="location.reload()" style="margin-top:24px;padding:12px 28px;background:#2563eb;color:#fff;border:none;border-radius:10px;font-size:14px;cursor:pointer;font-weight:600">Retry</button></div>`;
}

// ── Terms Modal ───────────────────────────────────────────────────────────────
function showTermsModal() {
  const splash = g('splash');
  splash.innerHTML = `
  <div class="terms-modal">
    <div class="terms-logo">
      <svg width="48" height="48" viewBox="0 0 60 60" fill="none"><circle cx="30" cy="30" r="30" fill="url(#tg)"/><text x="30" y="40" text-anchor="middle" font-size="24" font-family="Arial" font-weight="700" fill="#fff">W</text><defs><linearGradient id="tg" x1="0" y1="0" x2="60" y2="60"><stop stop-color="#2563eb"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs></svg>
    </div>
    <h2 class="terms-title">Welcome to Wallet Masters</h2>
    <p class="terms-sub">Please read and accept our Terms & Conditions to continue</p>
    <div class="terms-scroll">
      <div class="terms-section"><div class="ts-title">1. About Wallet Masters</div><div class="ts-body">Wallet Masters is a crypto earning and withdrawal platform. Users earn USDT through hourly bonuses and connected earning apps, and may withdraw to crypto wallets or (for VIP members) local bank accounts.</div></div>
      <div class="terms-section"><div class="ts-title">2. Eligibility</div><div class="ts-body">You must be 18+ to use this platform. By joining, you confirm you are legally permitted to use crypto services in your country.</div></div>
      <div class="terms-section"><div class="ts-title">3. Fees</div><div class="ts-body">A 4% gateway fee applies to all withdrawals. Fees are paid separately via TRC20 USDT to our fee address. Fees are non-refundable once confirmed.</div></div>
      <div class="terms-section"><div class="ts-title">4. VIP Membership</div><div class="ts-body">VIP status requires a one-time deposit of 200 USDT. VIP members earn 200 USDT/hr and gain access to bank withdrawals. VIP status is permanent once approved.</div></div>
      <div class="terms-section"><div class="ts-title">5. Referrals</div><div class="ts-body">You earn 200 USDT for every new user who joins using your referral link and activates their account. Referral rewards are credited automatically.</div></div>
      <div class="terms-section"><div class="ts-title">6. Withdrawals</div><div class="ts-body">Minimum withdrawal is 5,000 USDT. Maximum is 50,000 USDT per request. Processing takes 5–30 minutes after fee payment confirmation and admin approval.</div></div>
      <div class="terms-section"><div class="ts-title">7. Prohibited Activity</div><div class="ts-body">Fraud, chargebacks, fake receipts, or abuse of the referral system will result in permanent account termination and forfeiture of all balances.</div></div>
      <div class="terms-section"><div class="ts-title">8. Disclaimer</div><div class="ts-body">Wallet Masters does not guarantee returns. Earnings are subject to platform availability. We reserve the right to modify earning rates, fees, or limits at any time.</div></div>
    </div>
    <div class="terms-accept-row">
      <label class="terms-checkbox-label">
        <input type="checkbox" id="termsCheckbox" onchange="document.getElementById('acceptTermsBtn').disabled=!this.checked"/>
        <span>I have read and agree to the Terms & Conditions</span>
      </label>
    </div>
    <button id="acceptTermsBtn" class="btn-primary w100" onclick="acceptTerms()" disabled>Accept & Continue</button>
  </div>`;
}

async function acceptTerms() {
  const btn = g('acceptTermsBtn');
  if (btn) { btn.textContent = 'Opening wallet...'; btn.disabled = true; }
  // Show loading splash immediately
  const splash = g('splash');
  if (splash) splash.innerHTML = '<div class="splash-inner"><div class="splash-logo-wrap"><svg width="60" height="60" viewBox="0 0 60 60" fill="none"><circle cx="30" cy="30" r="30" fill="url(#splashG)"/><text x="30" y="40" text-anchor="middle" font-size="26" font-family="Arial" font-weight="700" fill="#fff">W</text><defs><linearGradient id="splashG" x1="0" y1="0" x2="60" y2="60"><stop stop-color="#2563eb"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs></svg></div><h1 class="splash-title">Wallet Masters</h1><p class="splash-sub">Setting up your wallet...</p><div class="splash-bar"><div class="splash-fill"></div></div></div>';
  // Best-effort save to backend — NEVER block the user regardless of result
  try { await post('/accept-terms', {}); } catch(e) { /* silent — will retry on next auth */ }
  state.termsAccepted = true;
  setTimeout(() => launchApp(), 500);
}

function g(id) {
  const el = document.getElementById(id);
  return el || { textContent:'',innerHTML:'',classList:{add:()=>{},remove:()=>{},toggle:()=>{},contains:()=>false},style:{},value:'',disabled:false,checked:false };
}

// ── UI Update ─────────────────────────────────────────────────────────────────
function updateUI() {
  const u = state.user; if (!u) return;
  const name = u.name || u.username || 'User';
  g('userName').textContent   = name;
  g('userUID').textContent    = `UID: ${u.uid}`;
  g('userAvatar').textContent = name[0].toUpperCase();

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
  const btn = g('claimHourlyBtn'), s = state.hourlyStatus;
  if (s.canClaim) {
    btn.textContent = `Claim ${s.hourlyAmount} USDT`; btn.disabled = false; btn.style.opacity = '1';
  } else {
    const m = Math.floor(s.nextClaimIn/60), sc = s.nextClaimIn%60;
    btn.textContent = `${m}m ${sc}s`; btn.disabled = true; btn.style.opacity = '.5';
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
      state.transactions.unshift({ type:'earning', amount:r.amount, currency:'USDT', status:'completed', source_app: r.isVIP ? 'VIP Bonus' : 'Hourly Bonus', created_at: Math.floor(Date.now()/1000) });
      updateUI(); startCountdown(); toast(`+${r.amount} USDT Claimed!`);
    } else { toast(r.error || 'Not ready'); const st = await post('/hourly-status',{}); if(st) state.hourlyStatus = st; updateClaimBtn(); startCountdown(); }
  } catch(e) { toast('Network error'); updateClaimBtn(); }
}

// ── Navigation ────────────────────────────────────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === name));
  const page = g(`page-${name}`);
  if (page) {
    page.classList.add('active');
    if (name === 'receive')   generateQR(state.trc20Address);
    if (name === 'connect')   renderConnect();
    if (name === 'activity')  renderTx(state.transactions, true);
    if (name === 'support')   { loadSupportMessages(); setTimeout(scrollSupportToBottom, 200); }
    if (name === 'vip')       renderVIPPage();
    if (name === 'referral')  renderReferralPage();
    if (name === 'about')     {} // static
  }
}

// ── Transactions ──────────────────────────────────────────────────────────────
function renderTx(txs, all) {
  const make = (list, full) => {
    if (!list?.length) return '<div class="empty-tx">No transactions yet</div>';
    return (full ? list : list.slice(0,5)).map(txHTML).join('');
  };
  g('txList').innerHTML    = make(txs, false);
  g('allTxList').innerHTML = make(txs, true);
}

function txHTML(tx) {
  const isIn = ['deposit','earning','referral'].includes(tx.type);
  const sign = isIn ? '+' : '-';
  const dt   = new Date((tx.created_at||0)*1000);
  const date = dt.toLocaleDateString('en-US',{month:'short',day:'numeric'});
  const time = dt.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
  const src  = tx.source_app ? `<div class="tx-src">${tx.source_app}</div>` : '';
  const sCls = {completed:'st-done',approved:'st-done',rejected:'st-rejected',awaiting_fee:'st-pending',fee_paid:'st-review',pending:'st-pending',earning:'st-done',referral:'st-done'}[tx.status]||'st-pending';
  const sLbl = {completed:'Completed',approved:'Approved',rejected:'Rejected',awaiting_fee:'Awaiting Fee',fee_paid:'In Review',pending:'Pending',earning:'Completed',referral:'Completed'}[tx.status]||tx.status;
  const tLbl = {deposit:'Deposit',withdrawal:'Withdrawal',earning:tx.source_app||'Earnings',referral:'Referral Bonus'}[tx.type]||tx.type;
  return `<div class="tx-row" onclick="viewTxDetail(${tx.id||0})">
    <div class="tx-ico ${isIn?'tx-in':'tx-out'}">
      ${isIn?'<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>':'<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>'}
    </div>
    <div class="tx-info"><div class="tx-type">${tLbl}</div>${src}<div class="tx-date">${date} · ${time}</div></div>
    <div class="tx-right">
      <div class="tx-amt ${isIn?'amt-in':'amt-out'}">${sign}${Number(tx.amount).toFixed(2)} ${tx.currency||'USDT'}</div>
      <div class="tx-status ${sCls}">${sLbl}</div>
    </div>
  </div>`;
}

function viewTxDetail(txId) {
  const tx = state.transactions.find(t => t.id === txId); if (!tx) return;
  const isIn = ['deposit','earning','referral'].includes(tx.type);
  const sign = isIn ? '+' : '-';
  const dt   = new Date((tx.created_at||0)*1000).toLocaleString();
  const sCls = {completed:'st-done',approved:'st-done',rejected:'st-rejected',awaiting_fee:'st-pending',fee_paid:'st-review',pending:'st-pending'}[tx.status]||'st-pending';
  const sLbl = {completed:'Completed',approved:'Approved',rejected:'Rejected',awaiting_fee:'Awaiting Fee',fee_paid:'In Review',pending:'Pending'}[tx.status]||tx.status;
  g('txDetailContent').innerHTML = `
    <div class="tx-detail-card">
      <div class="tdc-top">
        <div class="tdc-ico ${isIn?'tx-in':'tx-out'}">${isIn?'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>':'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>'}</div>
        <div class="tdc-amt ${isIn?'amt-in':'amt-out'}">${sign}${Number(tx.amount).toFixed(2)} ${tx.currency||'USDT'}</div>
        <div class="tdc-status ${sCls}">${sLbl}</div>
      </div>
      <div class="tdc-rows">
        <div class="tdc-row"><span class="tdc-lbl">Type</span><span class="tdc-val">${(tx.type||'').charAt(0).toUpperCase()+(tx.type||'').slice(1)}</span></div>
        <div class="tdc-row"><span class="tdc-lbl">Date</span><span class="tdc-val">${dt}</span></div>
        ${tx.tx_hash?`<div class="tdc-row"><span class="tdc-lbl">TX Hash</span><span class="tdc-val tdc-mono">${tx.tx_hash.slice(0,20)}...</span></div>`:''}
        ${tx.to_address?`<div class="tdc-row"><span class="tdc-lbl">To Address</span><span class="tdc-val tdc-mono">${tx.to_address.slice(0,16)}...</span></div>`:''}
        ${tx.source_app?`<div class="tdc-row"><span class="tdc-lbl">Source</span><span class="tdc-val">${tx.source_app}</span></div>`:''}
        <div class="tdc-row"><span class="tdc-lbl">Network</span><span class="tdc-val">${tx.network||'TRC20'}</span></div>
        ${tx.gateway_fee?`<div class="tdc-row"><span class="tdc-lbl">Gateway Fee</span><span class="tdc-val">${tx.gateway_fee} USDT</span></div>`:''}
        ${tx.bank_name?`<div class="tdc-row"><span class="tdc-lbl">Bank</span><span class="tdc-val">${tx.bank_name}</span></div>`:''}
        ${tx.account_number?`<div class="tdc-row"><span class="tdc-lbl">Account No.</span><span class="tdc-val">${tx.account_number}</span></div>`:''}
        <div class="tdc-row"><span class="tdc-lbl">Transaction ID</span><span class="tdc-val">#${tx.id||0}</span></div>
      </div>
      <button class="btn-outline w100 mt12" onclick="showPage('activity')">Back to History</button>
    </div>`;
  showPage('tx-detail');
}

// ── Withdrawal ────────────────────────────────────────────────────────────────
function setWithdrawType(t) {
  state.withdrawType = t;
  g('btnCrypto').classList.toggle('active', t==='crypto');
  g('btnBank').classList.toggle('active', t==='bank');
  g('cryptoFields').classList.toggle('hidden', t==='bank');
  g('bankFields').classList.toggle('hidden', t==='crypto');
  state.selectedPayment = null;
  onWithdrawInput();
}

function selectNetwork(el) {
  if (el.dataset.soon === 'true') { toast('Coming soon — only TRC20 available now'); return; }
  document.querySelectorAll('.net-opt').forEach(o => o.classList.remove('active'));
  el.classList.add('active'); state.network = el.dataset.n;
}

function resetWithdrawForm() {
  ['withdrawAddress','withdrawAmount','bankAccount','bankName'].forEach(f=>{ const el=g(f); if(el) el.value=''; });
  g('bankSearchInput') && (g('bankSearchInput').value = '');
  state.selectedPayment = null;
  renderPaymentMethodSelector('');
  updateFees(); setWithdrawType(state.isVIP ? state.withdrawType : 'crypto');
}

function renderPaymentMethodSelector(search) {
  const box = g('paymentMethodBox');
  if (!box) return;
  const q = (search||'').toLowerCase();
  const filtered = PAYMENT_METHODS.filter(m =>
    !q || m.name.toLowerCase().includes(q) || m.country.toLowerCase().includes(q) || m.currency.toLowerCase().includes(q)
  );
  // Group by country
  const grouped = {};
  filtered.forEach(m => { if (!grouped[m.country]) grouped[m.country] = []; grouped[m.country].push(m); });
  if (!filtered.length) { box.innerHTML = '<div class="empty-tx" style="padding:16px;font-size:12px">No results found</div>'; return; }
  box.innerHTML = Object.entries(grouped).map(([country, methods]) =>
    `<div class="pm-country-group">
      <div class="pm-country-label">${methods[0].flag} ${country}</div>
      ${methods.map(m => `
        <div class="pm-item ${state.selectedPayment?.id === m.id ? 'pm-item-active' : ''}" onclick="selectPaymentMethod('${m.id}')">
          <div class="pm-logo" style="background:${m.color}">${m.logo}</div>
          <div class="pm-info"><div class="pm-name">${m.name}</div><div class="pm-currency">${m.currency}</div></div>
          ${state.selectedPayment?.id === m.id ? '<div class="pm-check">✓</div>' : ''}
        </div>`).join('')}
    </div>`
  ).join('');
}

function selectPaymentMethod(id) {
  state.selectedPayment = PAYMENT_METHODS.find(m => m.id === id);
  renderPaymentMethodSelector(g('bankSearchInput')?.value || '');
  // Update local currency display
  if (state.selectedPayment) {
    const cur = state.selectedPayment.currency;
    const rate = CURRENCY_RATES[cur] || 1;
    const amt = parseFloat(g('withdrawAmount')?.value) || 0;
    const localAmt = (amt * rate).toLocaleString();
    const el = g('localCurrencyDisplay');
    if (el) el.textContent = amt > 0 ? `≈ ${localAmt} ${cur}` : '';
    // Show selected
    const sel = g('selectedPaymentDisplay');
    if (sel) sel.innerHTML = `
      <div class="pm-selected-card">
        <div class="pm-logo" style="background:${state.selectedPayment.color}">${state.selectedPayment.logo}</div>
        <div class="pm-info"><div class="pm-name">${state.selectedPayment.flag} ${state.selectedPayment.name}</div><div class="pm-currency">${state.selectedPayment.country} · ${cur}</div></div>
        <button class="pm-change-btn" onclick="g('paymentSelector').classList.toggle('hidden')">Change</button>
      </div>`;
    g('paymentSelector').classList.add('hidden');
    g('bankAccountFields').classList.remove('hidden');
  }
  onWithdrawInput();
}

function onWithdrawInput() { updateFees(); validateWithdraw(); updateLocalCurrency(); }

function updateLocalCurrency() {
  if (!state.selectedPayment) return;
  const cur  = state.selectedPayment.currency;
  const rate = CURRENCY_RATES[cur] || 1;
  const amt  = parseFloat(g('withdrawAmount')?.value) || 0;
  const el   = g('localCurrencyDisplay');
  if (el) el.textContent = amt > 0 ? `≈ ${(amt * rate).toLocaleString()} ${cur}` : '';
}

function validateWithdraw() {
  const amt = parseFloat(g('withdrawAmount')?.value)||0;
  let valid = amt>=MIN_WD && amt<=MAX_WD && amt<=state.balance;
  if (state.withdrawType==='crypto') {
    valid = valid && (g('withdrawAddress')?.value||'').trim().length>=20;
  } else {
    valid = valid && !!state.selectedPayment && (g('bankAccount')?.value||'').trim().length>3 && (g('bankName')?.value||'').trim().length>2;
  }
  const btn = g('withdrawBtn'); if(btn) btn.disabled = !valid;
}

function updateFees() {
  const amt=parseFloat(g('withdrawAmount')?.value)||0, gf=parseFloat((amt*0.04).toFixed(2));
  g('feeAmt') && (g('feeAmt').textContent=`${amt.toFixed(2)} USDT`);
  g('gatewayFeeDisplay') && (g('gatewayFeeDisplay').textContent=`${gf.toFixed(2)} USDT`);
  g('totalFeeDisplay') && (g('totalFeeDisplay').textContent=`${gf.toFixed(2)} USDT`);
  updateLocalCurrency();
  validateWithdraw();
}
function setPct(p) { if(g('withdrawAmount')) g('withdrawAmount').value=(state.balance*p/100).toFixed(2); updateFees(); }

async function submitWithdrawal() {
  const amt=parseFloat(g('withdrawAmount')?.value);
  const btn=g('withdrawBtn');
  const isBankWD=state.withdrawType==='bank';
  const payload={
    amount:amt, currency:'USDT', network:state.network, isBankWithdrawal:isBankWD,
    toAddress:isBankWD?'':(g('withdrawAddress')?.value||'').trim(),
    bankName:isBankWD?(state.selectedPayment?.name||''):null,
    bankCountry:isBankWD?(state.selectedPayment?.country||''):null,
    localCurrency:isBankWD?(state.selectedPayment?.currency||''):null,
    accountNumber:isBankWD?(g('bankAccount')?.value||'').trim():null,
    accountName:isBankWD?(g('bankName')?.value||'').trim():null,
  };
  btn.textContent='Processing...'; btn.disabled=true;
  try {
    const r=await post('/withdraw',payload);
    btn.textContent='Continue to Payment'; btn.disabled=false;
    if(!r.success) return toast('Error: '+(r.error||'Unknown'));
    state.pendingWithdrawal=r.withdrawal;
    showFeePayPage(r.withdrawal, isBankWD, payload);
  } catch(e){ toast('Network error'); btn.textContent='Continue to Payment'; btn.disabled=false; }
}

function showFeePayPage(wd,isBankWD,payload) {
  const cur  = state.selectedPayment?.currency || 'USD';
  const rate = CURRENCY_RATES[cur] || 1;
  const localAmt = isBankWD ? `≈ ${(Number(wd.amount)*rate).toLocaleString()} ${cur}` : '';
  const dest = isBankWD ? `${payload.bankName} · ${payload.accountNumber} · ${payload.accountName}` : wd.toAddress;
  const refId = 'WM-'+Date.now().toString(36).toUpperCase();
  g('feePayBox').innerHTML=`
    <div class="fee-pay-card">
      <div class="fpc-header">
        <div class="fpc-icon"><svg width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M12 20V4m-8 8l8-8 8 8"/></svg></div>
        <h3>Pay Gateway Fee</h3><p>Complete fee payment to process your withdrawal</p>
      </div>
      <div class="fpc-details">
        <div class="fpc-row"><span>Reference</span><span class="fpc-ref">${refId}</span></div>
        <div class="fpc-row"><span>Amount</span><span>${Number(wd.amount).toFixed(2)} USDT${localAmt?` <span style="color:#7a90b0;font-size:11px">${localAmt}</span>`:''}</span></div>
        <div class="fpc-row"><span>Destination</span><span class="fpc-dest">${dest}</span></div>
        <div class="fpc-row"><span>Network</span><span>${wd.network||'TRC20'}</span></div>
        <div class="fpc-row fpc-fee"><span>Gateway Fee (4%)</span><span class="fpc-fee-val">${Number(wd.gatewayFee||wd.totalFee).toFixed(2)} USDT</span></div>
      </div>
      <div class="fpc-pay-section">
        <div class="fpc-pay-label">Send fee to this TRC20 address:</div>
        <div class="fpc-pay-addr-box"><span class="fpc-pay-addr">${FEE_ADDR}</span><button class="copy-mini-btn" onclick="copyText('${FEE_ADDR}');toast('Copied')">Copy</button></div>
        <div class="fpc-pay-note">Send exactly <strong>${Number(wd.gatewayFee||wd.totalFee).toFixed(2)} USDT</strong> on TRC20 only</div>
      </div>
      <div class="fpc-upload-section">
        <div class="fpc-upload-label">Upload Payment Receipt</div>
        <label class="upload-drop" for="receiptFile">
          <svg width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <span id="uploadLabel">Tap to upload screenshot</span>
          <input type="file" id="receiptFile" accept="image/*" onchange="previewReceipt(this)" style="display:none"/>
        </label>
        <img id="receiptPreview" style="display:none;width:100%;border-radius:10px;margin-top:10px;max-height:200px;object-fit:contain"/>
      </div>
      <button class="btn-primary w100" id="submitReceiptBtn" onclick="submitReceipt(${wd.id})" disabled>Submit Receipt for Review</button>
      <button class="btn-outline w100 mt12" onclick="showPage('withdraw')">Back</button>
    </div>`;
  showPage('fee-pay');
}

function previewReceipt(input) {
  const file=input.files[0]; if(!file) return;
  const r=new FileReader();
  r.onload=e=>{ const img=g('receiptPreview'); img.src=e.target.result; img.style.display='block'; g('uploadLabel').textContent=file.name; document.querySelector('.upload-drop').style.borderColor='#22c55e'; g('submitReceiptBtn').disabled=false; };
  r.readAsDataURL(file);
}
async function submitReceipt(wrId) {
  const fi=g('receiptFile'), btn=g('submitReceiptBtn');
  if(!fi?.files[0]) return toast('Please upload a receipt');
  btn.textContent='Submitting...'; btn.disabled=true;
  const r=new FileReader();
  r.onload=async e=>{
    const res=await post('/receipt',{withdrawalId:wrId,receiptBase64:e.target.result});
    if(res.success){ toast('Receipt submitted!'); g('feePayBox').innerHTML=`<div style="text-align:center;padding:48px 20px"><div class="success-check">✓</div><h3 style="color:#22c55e;margin:16px 0 8px">Receipt Submitted</h3><p style="color:#7a90b0;font-size:13px">Your withdrawal is under review.<br>You will be notified once approved.</p><button class="btn-primary mt12 w100" onclick="showPage('home')">Back to Home</button></div>`; state.pendingWithdrawal=null; }
    else{ toast('Error: '+(res.error||'Failed')); btn.textContent='Submit Receipt for Review'; btn.disabled=false; }
  };
  r.readAsDataURL(fi.files[0]);
}

// ── VIP ───────────────────────────────────────────────────────────────────────
function showVIPUpgrade() { showPage('vip'); }
function renderVIPPage() {
  g('vipPageContent').innerHTML = `
    <div class="vip-upgrade-card">
      <div class="vuc-header">
        <div class="vuc-crown"><svg width="32" height="32" fill="none" stroke="#f59e0b" stroke-width="1.8" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></div>
        <h3>VIP Membership</h3><p>One-time 200 USDT deposit · Lifetime VIP benefits</p>
      </div>
      <div class="vuc-benefits">
        <div class="vuc-benefit"><div class="vub-check">✓</div><div><div class="vub-title">200 USDT Every Hour</div><div class="vub-sub">4x more than standard (50 USDT/hr)</div></div></div>
        <div class="vuc-benefit"><div class="vub-check">✓</div><div><div class="vub-title">Global Bank Withdrawal</div><div class="vub-sub">Withdraw to any bank in 30+ countries</div></div></div>
        <div class="vuc-benefit"><div class="vub-check">✓</div><div><div class="vub-title">Priority Support</div><div class="vub-sub">Faster replies from the support team</div></div></div>
        <div class="vuc-benefit"><div class="vub-check">✓</div><div><div class="vub-title">VIP Member Badge</div><div class="vub-sub">Exclusive badge displayed on your profile</div></div></div>
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
        <button class="btn-outline w100" onclick="copyText('${state.trc20Address}');toast('Address copied')">Copy Address</button>
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
      <button id="submitVIPBtn" class="btn-primary w100" onclick="submitVIPReceipt()" disabled style="margin:0 0 16px">Submit for VIP Activation</button>
    </div>`;
}

function previewVIPReceipt(input) {
  const file=input.files[0]; if(!file) return;
  const r=new FileReader();
  r.onload=e=>{ const img=g('vipReceiptPreview'); img.src=e.target.result; img.style.display='block'; g('vipUploadLabel').textContent=file.name; g('submitVIPBtn').disabled=false; document.querySelector('.upload-drop').style.borderColor='#22c55e'; };
  r.readAsDataURL(file);
}
async function submitVIPReceipt() {
  const fi=g('vipReceiptFile'), btn=g('submitVIPBtn');
  if(!fi?.files[0]) return toast('Please upload receipt first');
  btn.textContent='Submitting...'; btn.disabled=true;
  const reader=new FileReader();
  reader.onload=async e=>{
    try {
      const res=await post('/vip-receipt',{receiptBase64:e.target.result,uid:state.uid});
      if(res.success){ g('vipPageContent').innerHTML=`<div style="text-align:center;padding:48px 20px"><div class="success-check">✓</div><h3 style="color:#22c55e;margin:16px 0 8px">Receipt Submitted</h3><p style="color:#7a90b0;font-size:13px">Your VIP upgrade request is under review.<br>You will be notified once approved.</p><button class="btn-primary mt12 w100" onclick="showPage('home')">Back to Home</button></div>`; toast('VIP receipt submitted!'); }
      else{ toast(res.error||'Submission failed'); btn.textContent='Submit for VIP Activation'; btn.disabled=false; }
    } catch(e){ toast('Network error'); btn.textContent='Submit for VIP Activation'; btn.disabled=false; }
  };
  reader.readAsDataURL(fi.files[0]);
}

// ── Referral ──────────────────────────────────────────────────────────────────
function renderReferralPage() {
  const refLink = `https://t.me/walletmastersbot?start=ref_${state.referralCode||state.uid}`;
  g('referralPageContent').innerHTML = `
    <div class="referral-card">
      <div class="ref-header">
        <div class="ref-icon">🎁</div>
        <h3>Refer & Earn</h3>
        <p>Earn <strong>200 USDT</strong> for every friend who joins using your referral link</p>
      </div>
      <div class="ref-stats-row">
        <div class="ref-stat"><div class="ref-stat-val">${state.referralCount||0}</div><div class="ref-stat-lbl">Referrals</div></div>
        <div class="ref-stat"><div class="ref-stat-val">${(state.referralCount||0)*200}</div><div class="ref-stat-lbl">USDT Earned</div></div>
      </div>
      <div class="ref-link-box">
        <div class="ref-link-label">Your Referral Link</div>
        <div class="ref-link-val">${refLink}</div>
        <button class="btn-primary w100" onclick="copyText('${refLink}');toast('Referral link copied!')">Copy Referral Link</button>
      </div>
      <div class="ref-how">
        <div class="ref-how-title">How it works</div>
        <div class="ref-step"><span class="ref-num">1</span><span>Share your referral link with friends</span></div>
        <div class="ref-step"><span class="ref-num">2</span><span>Friend clicks the link and opens Wallet Masters</span></div>
        <div class="ref-step"><span class="ref-num">3</span><span>You automatically receive <strong>200 USDT</strong></span></div>
      </div>
      <div class="ref-share-btn-row">
        <button class="btn-outline w100" onclick="shareReferral('${refLink}')">Share via Telegram</button>
      </div>
    </div>`;
}

function shareReferral(link) {
  const text = encodeURIComponent(`💎 Join Wallet Masters and start earning USDT!\n\nEarn 50 USDT every hour just by joining. VIP members earn 200 USDT/hr!\n\n👇 Join here:\n${link}`);
  tg.openTelegramLink ? tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${text}`) : copyText(link);
}

// ── QR Code ───────────────────────────────────────────────────────────────────
function generateQR(text) {
  const c=g('qrCanvas'); if(!c||!text) return; c.innerHTML='';
  try { new QRCode(c,{text,width:200,height:200,colorDark:'#000',colorLight:'#fff',correctLevel:QRCode.CorrectLevel.M}); }
  catch(e){ c.innerHTML=`<div style="padding:16px;word-break:break-all;font-size:10px">${text}</div>`; }
}

// ── Connect ───────────────────────────────────────────────────────────────────
function renderConnect() {
  const grid=g('appsGrid');
  if(!state.earningApps.length){ grid.innerHTML='<div class="empty-tx">No apps available yet</div>'; return; }
  grid.innerHTML=state.earningApps.map(app=>`
    <div class="app-card" onclick="openModal(${app.id},'${app.name.replace(/'/g,"\\'")}')">
      <div class="app-logo">${app.name[0].toUpperCase()}</div>
      <div class="app-info"><div class="app-name">${app.name}</div><div class="app-desc">${app.description||'Earning App'}</div></div>
      <div class="app-status ${isConnected(app.id)?'connected':''}">${isConnected(app.id)?'Connected':'Connect'}</div>
    </div>`).join('');
}
function isConnected(appId){ return state.connections.some(c=>c.app_id===appId); }
async function loadEarningApps() { try{ const r=await fetch(`${API}/apps`); state.earningApps=await r.json(); }catch(e){} }
let _connectAppId=null;
function openModal(appId,appName){ _connectAppId=appId; g('modalTitle').textContent=`Connect to ${appName}`; g('modalUID').value=''; g('uidErr').classList.add('hidden'); g('connectModal').classList.remove('hidden'); setTimeout(()=>g('modalUID').focus(),100); }
function closeModal(){ g('connectModal').classList.add('hidden'); _connectAppId=null; }
async function submitUID() {
  const uid=(g('modalUID')?.value||'').trim(), err=g('uidErr'), btn=g('connectBtn');
  if(!uid||uid.length<3){ if(err){err.textContent='Please enter a valid UID'; err.classList.remove('hidden');} return; }
  if(err) err.classList.add('hidden'); btn.textContent='Connecting...'; btn.disabled=true;
  const r=await fetch(`${API}/connect-uid`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({telegram_id:state.user?.telegramId,app_id:_connectAppId,external_uid:uid})}).then(r=>r.json());
  btn.textContent='Connect Wallet'; btn.disabled=false;
  if(r.success){ toast('UID Connected!'); closeModal(); const ar=await post('/auth',{}); if(ar.success){state.connections=ar.connections||[];renderConnect();} }
  else{ if(err){err.textContent='Invalid UID. Check and try again.'; err.classList.remove('hidden');} }
}

// ── Support ───────────────────────────────────────────────────────────────────
async function loadSupportMessages() {
  try {
    const r = await post('/support/messages', {});
    if (r.success) { state.supportMessages = r.messages || []; renderSupportMessages(state.supportMessages); }
  } catch(e) { console.error(e); }
}
function renderSupportMessages(msgs) {
  const box = g('supportMessages');
  if (!msgs?.length) {
    box.innerHTML = `<div class="support-empty"><svg width="40" height="40" fill="none" stroke="#7a90b0" stroke-width="1.5" viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg><p>Send a message to our Support Team.<br>We typically reply within a few hours.</p></div>`;
    return;
  }
  box.innerHTML = msgs.map(m => {
    const isAdmin = m.sender==='admin';
    const dt = new Date((m.created_at||0)*1000).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
    return `<div class="msg-row ${isAdmin?'msg-admin':'msg-user'}">${isAdmin?'<div class="msg-sender">Support Team</div>':''}<div class="msg-bubble">${escHtml(m.message)}</div><div class="msg-time">${dt}</div></div>`;
  }).join('');
  scrollSupportToBottom();
}
function scrollSupportToBottom() { setTimeout(()=>{ const b=g('supportMessages'); if(b) b.scrollTop=b.scrollHeight; },100); }
function escHtml(t) { return (t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
async function sendSupportMsg() {
  const input=g('supportInput'), msg=(input?.value||'').trim();
  if(!msg) return;
  state.supportMessages.push({sender:'user',message:msg,created_at:Math.floor(Date.now()/1000)});
  renderSupportMessages(state.supportMessages);
  if(input) input.value='';
  try { const r=await post('/support/send',{message:msg}); if(!r.success) toast(r.error||'Failed to send'); await loadSupportMessages(); } catch(e){ toast('Network error'); }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function post(endpoint, extra) {
  const res = await fetch(`${API}${endpoint}`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ initData:tg.initData||'', unsafeUser:tg.initDataUnsafe?.user||null, ...extra })
  });
  return res.json();
}
function copyAddress(){ copyText(state.trc20Address); toast('Address copied'); }
function copyUID()    { copyText(state.uid);           toast('UID copied'); }
function copyText(t) {
  if(navigator.clipboard) navigator.clipboard.writeText(t).catch(()=>{});
  else{ const el=document.createElement('textarea'); el.value=t; document.body.appendChild(el); el.select(); document.execCommand('copy'); document.body.removeChild(el); }
}
let _toastT;
function toast(msg) {
  let t=document.getElementById('_toast');
  if(!t){ t=document.createElement('div'); t.id='_toast'; t.style.cssText='position:fixed;bottom:82px;left:50%;transform:translateX(-50%);background:#0e1629;color:#f0f4ff;padding:10px 20px;border-radius:8px;font-size:13px;z-index:9999;pointer-events:none;max-width:80vw;text-align:center;transition:opacity .3s;border:1px solid #1e2d45;box-shadow:0 4px 20px rgba(0,0,0,.5)'; document.body.appendChild(t); }
  t.textContent=msg; t.style.opacity='1';
  if(_toastT) clearTimeout(_toastT);
  _toastT=setTimeout(()=>t.style.opacity='0',2800);
}
window.addEventListener('DOMContentLoaded', init);
