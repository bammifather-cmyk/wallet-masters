/**
 * Wallet Masters - Database Layer (lowdb)
 * All users share the same TRC20 deposit address but have unique UIDs
 */

const low      = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path     = require('path');
const crypto   = require('crypto');

const DB_PATH = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'wallet_masters.json')
  : path.join(__dirname, 'wallet_masters.json');

const adapter = new FileSync(DB_PATH);
const db = low(adapter);

// ─── Shared deposit address for all users ─────────────────────────────────────
const SHARED_TRC20_ADDRESS = 'TPwUS8v77TtcsYZUHUTvVx2TGqE37QnagZ';

// ─── Default Schema ────────────────────────────────────────────────────────────
db.defaults({
  users: [],
  transactions: [],
  earning_apps: [],
  uid_connections: [],
  withdrawal_requests: [],
  support_messages: [],
  _counters: { users: 0, transactions: 0, earning_apps: 0, uid_connections: 0, withdrawal_requests: 0, support_messages: 0 }
}).write();

// ─── Helpers ───────────────────────────────────────────────────────────────────
function nextId(table) {
  const val = db.get(`_counters.${table}`).value() + 1;
  db.set(`_counters.${table}`, val).write();
  return val;
}
function now() { return Math.floor(Date.now() / 1000); }
function generateUID() { return 'WM' + crypto.randomBytes(5).toString('hex').toUpperCase(); }
function generateTxHash() { return crypto.randomBytes(32).toString('hex').toUpperCase(); }

// ─── User Operations ───────────────────────────────────────────────────────────
function getOrCreateUser(telegramId, username, fullName) {
  const tid = String(telegramId);
  let user = db.get('users').find({ telegram_id: tid }).value();

  if (!user) {
    user = {
      id: nextId('users'),
      telegram_id: tid,
      telegram_username: username || '',
      full_name: fullName || '',
      trc20_address: SHARED_TRC20_ADDRESS,   // all users share this deposit address
      usdt_balance: 0,
      uid: generateUID(),
      is_vip: false,
      vip_activated_at: null,
      last_hourly_claim: 0,
      last_vip_claim: 0,
      connected_apps: [],
      terms_accepted: false,
      referral_code: generateUID(),
      referred_by: null,
      referral_count: 0,
      created_at: now(),
      updated_at: now()
    };
    db.get('users').push(user).write();
  } else {
    const updates = { updated_at: now(), trc20_address: SHARED_TRC20_ADDRESS };
    if (username) updates.telegram_username = username;
    if (fullName) updates.full_name = fullName;
    if (user.last_hourly_claim === undefined) updates.last_hourly_claim = 0;
    if (user.last_vip_claim === undefined) updates.last_vip_claim = 0;
    if (user.is_vip === undefined) updates.is_vip = false;
    if (user.terms_accepted === undefined) updates.terms_accepted = false;
    if (!user.referral_code) updates.referral_code = user.uid;
    if (user.referral_count === undefined) updates.referral_count = 0;
    db.get('users').find({ telegram_id: tid }).assign(updates).write();
    user = db.get('users').find({ telegram_id: tid }).value();
  }
  return user;
}

function getUserByTelegramId(telegramId) {
  return db.get('users').find({ telegram_id: String(telegramId) }).value();
}
function getUserById(id) { return db.get('users').find({ id }).value(); }

function updateUserBalance(userId, amount) {
  const user = db.get('users').find({ id: userId }).value();
  if (!user) return;
  const newBal = Math.max(0, parseFloat((user.usdt_balance + amount).toFixed(6)));
  db.get('users').find({ id: userId }).assign({ usdt_balance: newBal, updated_at: now() }).write();
}

function upgradeToVIP(userId) {
  db.get('users').find({ id: userId }).assign({
    is_vip: true,
    vip_activated_at: now(),
    updated_at: now()
  }).write();
}

// ─── Hourly Earnings ───────────────────────────────────────────────────────────
const HOURLY_AMOUNT_NORMAL = 50;
const HOURLY_AMOUNT_VIP    = 200;
const HOURLY_INTERVAL      = 3600;

function claimHourlyEarning(telegramId) {
  const user = getUserByTelegramId(telegramId);
  if (!user) return { success: false, error: 'User not found' };

  const isVIP    = user.is_vip === true;
  const amount   = isVIP ? HOURLY_AMOUNT_VIP : HOURLY_AMOUNT_NORMAL;
  const lastClaim = isVIP ? (user.last_vip_claim || 0) : (user.last_hourly_claim || 0);
  const elapsed  = now() - lastClaim;
  const remaining = HOURLY_INTERVAL - elapsed;

  if (elapsed < HOURLY_INTERVAL) {
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    return { success: false, error: `Next claim in ${mins}m ${secs}s`, nextClaimIn: remaining };
  }

  updateUserBalance(user.id, amount);
  const claimField = isVIP ? 'last_vip_claim' : 'last_hourly_claim';
  db.get('users').find({ id: user.id }).assign({ [claimField]: now() }).write();

  createTransaction({
    user_id: user.id,
    type: 'earning',
    amount,
    currency: 'USDT',
    network: 'Internal',
    source_app: isVIP ? 'VIP Hourly Bonus' : 'Hourly Bonus',
    status: 'completed'
  });

  const updated = getUserByTelegramId(telegramId);
  return { success: true, amount, newBalance: updated.usdt_balance, nextClaimIn: HOURLY_INTERVAL, isVIP };
}

function getHourlyStatus(telegramId) {
  const user = getUserByTelegramId(telegramId);
  if (!user) return { canClaim: false, nextClaimIn: 0 };
  const isVIP    = user.is_vip === true;
  const amount   = isVIP ? HOURLY_AMOUNT_VIP : HOURLY_AMOUNT_NORMAL;
  const lastClaim = isVIP ? (user.last_vip_claim || 0) : (user.last_hourly_claim || 0);
  const elapsed  = now() - lastClaim;
  const remaining = Math.max(0, HOURLY_INTERVAL - elapsed);
  return { canClaim: elapsed >= HOURLY_INTERVAL, nextClaimIn: remaining, hourlyAmount: amount, isVIP };
}

// ─── Earning App Operations ─────────────────────────────────────────────────────
function getEarningApps() {
  return db.get('earning_apps').filter({ is_active: 1 }).sortBy('added_at').reverse().value();
}
function getEarningAppByToken(token) { return db.get('earning_apps').find({ token }).value(); }
function addEarningApp(name, token, description) {
  const existing = getEarningAppByToken(token);
  if (existing) {
    db.get('earning_apps').find({ token }).assign({ name, description: description || '', is_active: 1 }).write();
    return db.get('earning_apps').find({ token }).value();
  }
  const app = { id: nextId('earning_apps'), name, token, description: description || '', logo_url: '', is_active: 1, added_at: now() };
  db.get('earning_apps').push(app).write();
  return app;
}
function getEarningAppById(id) { return db.get('earning_apps').find({ id: parseInt(id) }).value(); }

// ─── UID Connection ─────────────────────────────────────────────────────────────
function connectUID(userId, appId, externalUID) {
  const existing = db.get('uid_connections').find({ user_id: userId, app_id: appId }).value();
  if (existing) {
    db.get('uid_connections').find({ user_id: userId, app_id: appId }).assign({ external_uid: externalUID, connected_at: now() }).write();
  } else {
    db.get('uid_connections').push({ id: nextId('uid_connections'), user_id: userId, app_id: appId, external_uid: externalUID, verified: 1, connected_at: now() }).write();
  }
}
function getConnectedUID(userId, appId) { return db.get('uid_connections').find({ user_id: userId, app_id: parseInt(appId) }).value(); }
function getUserConnections(userId) {
  const conns = db.get('uid_connections').filter({ user_id: userId }).value();
  return conns.map(uc => { const app = getEarningAppById(uc.app_id); return { ...uc, app_name: app ? app.name : 'Unknown', logo_url: app ? app.logo_url : '' }; });
}
function findUserByExternalUID(appId, externalUID) {
  const conn = db.get('uid_connections').find({ app_id: parseInt(appId), external_uid: externalUID }).value();
  return conn ? getUserById(conn.user_id) : null;
}

// ─── Transaction Operations ─────────────────────────────────────────────────────
function createTransaction(data) {
  const tx = {
    id: nextId('transactions'),
    tx_hash: data.tx_hash || generateTxHash(),
    user_id: data.user_id,
    type: data.type,
    amount: data.amount,
    currency: data.currency || 'USDT',
    network: data.network || 'TRC20',
    from_address: data.from_address || '',
    to_address: data.to_address || '',
    source_app: data.source_app || null,
    source_uid: data.source_uid || null,
    gas_fee: data.gas_fee || 0,
    gateway_fee: data.gateway_fee || 0,
    total_fee: data.total_fee || 0,
    status: data.status || 'pending',
    bank_name: data.bank_name || null,
    account_number: data.account_number || null,
    account_name: data.account_name || null,
    payment_method: data.payment_method || null,
    receipt_file_id: null,
    admin_note: null,
    created_at: now(),
    updated_at: now()
  };
  db.get('transactions').push(tx).write();
  return tx;
}
function getUserTransactions(userId, limit = 50) {
  return db.get('transactions').filter({ user_id: userId }).sortBy('created_at').reverse().take(limit).value();
}
function getTransactionById(txId) { return db.get('transactions').find({ id: parseInt(txId) }).value(); }
function updateTransaction(txId, updates) {
  db.get('transactions').find({ id: txId }).assign({ ...updates, updated_at: now() }).write();
}

// ─── Withdrawal Operations ──────────────────────────────────────────────────────
const MIN_WITHDRAWAL = 5000;
const MAX_WITHDRAWAL = 50000;
const GATEWAY_FEE_RATE = 0.04;  // 4% gateway fee only

function calculateFees(amount) {
  const gatewayFee = parseFloat((amount * GATEWAY_FEE_RATE).toFixed(2));
  return { gasFee: 0, gatewayFee, totalFee: gatewayFee };
}

function createWithdrawalRequest(data) {
  const tx = createTransaction({
    user_id: data.user_id,
    type: 'withdrawal',
    amount: data.amount,
    currency: data.currency || 'USDT',
    network: data.network || 'TRC20',
    to_address: data.to_address || '',
    gas_fee: 0,
    gateway_fee: data.gateway_fee,
    total_fee: data.gateway_fee,
    bank_name: data.bank_name || null,
    account_number: data.account_number || null,
    account_name: data.account_name || null,
    payment_method: data.payment_method || null,
    status: 'awaiting_fee'
  });

  const wr = {
    id: nextId('withdrawal_requests'),
    user_id: data.user_id,
    tx_id: tx.id,
    to_address: data.to_address || '',
    network: data.network || 'TRC20',
    currency: data.currency || 'USDT',
    amount: data.amount,
    gateway_fee: data.gateway_fee,
    total_fee: data.gateway_fee,
    is_bank_withdrawal: data.is_bank_withdrawal || false,
    bank_name: data.bank_name || null,
    account_number: data.account_number || null,
    account_name: data.account_name || null,
    payment_method: data.payment_method || null,
    status: 'awaiting_fee',
    receipt_file_id: null,
    admin_note: null,
    created_at: now(),
    updated_at: now()
  };
  db.get('withdrawal_requests').push(wr).write();
  return wr;
}

function getPendingWithdrawals() {
  const wrs = db.get('withdrawal_requests')
    .filter(wr => ['fee_paid', 'awaiting_fee', 'pending'].includes(wr.status))
    .sortBy('created_at').reverse().value();
  return wrs.map(wr => {
    const user = getUserById(wr.user_id);
    return { ...wr, telegram_id: user?.telegram_id || '', telegram_username: user?.telegram_username || '', full_name: user?.full_name || '', wallet_uid: user?.uid || '' };
  });
}

function getWithdrawalById(wrId) {
  const wr = db.get('withdrawal_requests').find({ id: parseInt(wrId) }).value();
  if (!wr) return null;
  const user = getUserById(wr.user_id);
  return { ...wr, telegram_id: user?.telegram_id || '', telegram_username: user?.telegram_username || '', full_name: user?.full_name || '', wallet_uid: user?.uid || '' };
}

function updateWithdrawal(wrId, updates) {
  db.get('withdrawal_requests').find({ id: parseInt(wrId) }).assign({ ...updates, updated_at: now() }).write();
  const wr = db.get('withdrawal_requests').find({ id: parseInt(wrId) }).value();
  if (wr && wr.tx_id) updateTransaction(wr.tx_id, { status: updates.status || wr.status });
}

function getUserWithdrawals(userId) {
  return db.get('withdrawal_requests').filter({ user_id: userId }).sortBy('created_at').reverse().value();
}

// ─── Support Messages ──────────────────────────────────────────────────────────
function createSupportMessage(data) {
  const msg = {
    id: nextId('support_messages'),
    user_id: data.user_id,
    telegram_id: data.telegram_id,
    sender: data.sender,       // 'user' | 'admin'
    sender_name: data.sender_name || '',
    message: data.message,
    is_read: false,
    created_at: now()
  };
  db.get('support_messages').push(msg).write();
  return msg;
}

function getSupportMessages(userId, limit = 50) {
  return db.get('support_messages').filter({ user_id: userId }).sortBy('created_at').value().slice(-limit);
}

function getAllSupportThreads() {
  const msgs = db.get('support_messages').value();
  const threads = {};
  for (const m of msgs) {
    if (!threads[m.user_id]) {
      const user = getUserById(m.user_id);
      threads[m.user_id] = {
        user_id: m.user_id,
        telegram_id: m.telegram_id,
        full_name: user?.full_name || '',
        uid: user?.uid || '',
        last_message: m.message,
        last_time: m.created_at,
        unread: 0
      };
    } else if (m.created_at > threads[m.user_id].last_time) {
      threads[m.user_id].last_message = m.message;
      threads[m.user_id].last_time = m.created_at;
    }
    if (!m.is_read && m.sender === 'user') threads[m.user_id].unread++;
  }
  return Object.values(threads).sort((a, b) => b.last_time - a.last_time);
}

function markSupportRead(userId) {
  db.get('support_messages').filter({ user_id: userId }).each(m => { m.is_read = true; }).write();
}

// ─── Stats ──────────────────────────────────────────────────────────────────────
function getStats() {
  const users = db.get('users').value();
  const transactions = db.get('transactions').value();
  const pendingWr = db.get('withdrawal_requests').filter(wr => ['fee_paid', 'awaiting_fee'].includes(wr.status)).value();
  const vipCount = users.filter(u => u.is_vip).length;
  const totalBal = users.reduce((s, u) => s + (u.usdt_balance || 0), 0);
  return { totalUsers: users.length, vipUsers: vipCount, totalTransactions: transactions.length, pendingWithdrawals: pendingWr.length, totalBalance: parseFloat(totalBal.toFixed(2)) };
}

module.exports = {
  db, SHARED_TRC20_ADDRESS, MIN_WITHDRAWAL, MAX_WITHDRAWAL, GATEWAY_FEE_RATE,
  getOrCreateUser, getUserByTelegramId, getUserById, updateUserBalance, upgradeToVIP,
  claimHourlyEarning, getHourlyStatus,
  getEarningApps, getEarningAppByToken, getEarningAppById, addEarningApp,
  connectUID, getConnectedUID, getUserConnections, findUserByExternalUID,
  createTransaction, getUserTransactions, getTransactionById, updateTransaction,
  calculateFees, createWithdrawalRequest, getPendingWithdrawals,
  getWithdrawalById, updateWithdrawal, getUserWithdrawals,
  createSupportMessage, getSupportMessages, getAllSupportThreads, markSupportRead,
  getStats, now
};
