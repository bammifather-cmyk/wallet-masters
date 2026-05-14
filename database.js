/**
 * Wallet Masters - Database Layer (lowdb - pure JavaScript)
 * No native compilation needed - works on Railway free tier
 */

const low  = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'wallet_masters.json')
  : path.join(__dirname, 'wallet_masters.json');

const adapter = new FileSync(DB_PATH);
const db = low(adapter);

// ─── Default Schema ────────────────────────────────────────────────────────────
db.defaults({
  users: [],
  transactions: [],
  earning_apps: [],
  uid_connections: [],
  withdrawal_requests: [],
  _counters: { users: 0, transactions: 0, earning_apps: 0, uid_connections: 0, withdrawal_requests: 0 }
}).write();

// ─── Helpers ───────────────────────────────────────────────────────────────────
function nextId(table) {
  const val = db.get(`_counters.${table}`).value() + 1;
  db.set(`_counters.${table}`, val).write();
  return val;
}
function now() { return Math.floor(Date.now() / 1000); }
function generateUID() { return 'WM' + crypto.randomBytes(4).toString('hex').toUpperCase(); }
function generateTRC20Address() {
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let addr = 'T';
  for (let i = 0; i < 33; i++) addr += chars[Math.floor(Math.random() * chars.length)];
  return addr;
}
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
      trc20_address: generateTRC20Address(),
      usdt_balance: 0,
      uid: generateUID(),
      last_hourly_claim: 0,   // timestamp of last hourly earn claim
      connected_apps: [],
      created_at: now(),
      updated_at: now()
    };
    db.get('users').push(user).write();
  } else {
    const updates = { updated_at: now() };
    if (username) updates.telegram_username = username;
    if (fullName) updates.full_name = fullName;
    // add last_hourly_claim field if missing (migration)
    if (user.last_hourly_claim === undefined) updates.last_hourly_claim = 0;
    db.get('users').find({ telegram_id: tid }).assign(updates).write();
    user = db.get('users').find({ telegram_id: tid }).value();
  }
  return user;
}

function getUserByTelegramId(telegramId) {
  return db.get('users').find({ telegram_id: String(telegramId) }).value();
}
function getUserById(id) {
  return db.get('users').find({ id }).value();
}
function updateUserBalance(userId, amount) {
  const user = db.get('users').find({ id: userId }).value();
  if (!user) return;
  const newBal = parseFloat((user.usdt_balance + amount).toFixed(6));
  db.get('users').find({ id: userId }).assign({
    usdt_balance: Math.max(0, newBal),
    updated_at: now()
  }).write();
}

// ─── Hourly Earnings ───────────────────────────────────────────────────────────
const HOURLY_AMOUNT = 50;   // USDT per claim
const HOURLY_INTERVAL = 3600; // seconds (1 hour)

function claimHourlyEarning(telegramId) {
  const user = getUserByTelegramId(telegramId);
  if (!user) return { success: false, error: 'User not found' };

  const currentTime = now();
  const lastClaim = user.last_hourly_claim || 0;
  const elapsed = currentTime - lastClaim;
  const remaining = HOURLY_INTERVAL - elapsed;

  if (elapsed < HOURLY_INTERVAL) {
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    return {
      success: false,
      error: `⏳ Next claim available in ${mins}m ${secs}s`,
      nextClaimIn: remaining
    };
  }

  // Credit the user
  updateUserBalance(user.id, HOURLY_AMOUNT);
  db.get('users').find({ id: user.id }).assign({ last_hourly_claim: currentTime }).write();

  // Record the transaction
  createTransaction({
    user_id: user.id,
    type: 'earning',
    amount: HOURLY_AMOUNT,
    currency: 'USDT',
    network: 'Internal',
    source_app: 'Wallet Masters Hourly Bonus',
    status: 'completed'
  });

  const updatedUser = getUserByTelegramId(telegramId);
  return {
    success: true,
    amount: HOURLY_AMOUNT,
    newBalance: updatedUser.usdt_balance,
    nextClaimIn: HOURLY_INTERVAL
  };
}

function getHourlyStatus(telegramId) {
  const user = getUserByTelegramId(telegramId);
  if (!user) return { canClaim: false, nextClaimIn: 0 };
  const elapsed = now() - (user.last_hourly_claim || 0);
  const remaining = Math.max(0, HOURLY_INTERVAL - elapsed);
  return {
    canClaim: elapsed >= HOURLY_INTERVAL,
    nextClaimIn: remaining,
    lastClaim: user.last_hourly_claim || 0,
    hourlyAmount: HOURLY_AMOUNT
  };
}

// ─── Earning App Operations ─────────────────────────────────────────────────────
function getEarningApps() {
  return db.get('earning_apps').filter({ is_active: 1 }).sortBy('added_at').reverse().value();
}
function getEarningAppByToken(token) {
  return db.get('earning_apps').find({ token }).value();
}
function addEarningApp(name, token, description) {
  const existing = getEarningAppByToken(token);
  if (existing) {
    db.get('earning_apps').find({ token }).assign({ name, description: description || '', is_active: 1 }).write();
    return db.get('earning_apps').find({ token }).value();
  }
  const app = {
    id: nextId('earning_apps'),
    name, token,
    description: description || '',
    logo_url: '',
    is_active: 1,
    added_at: now()
  };
  db.get('earning_apps').push(app).write();
  return app;
}
function getEarningAppById(id) {
  return db.get('earning_apps').find({ id: parseInt(id) }).value();
}

// ─── UID Connection ─────────────────────────────────────────────────────────────
function connectUID(userId, appId, externalUID) {
  const existing = db.get('uid_connections').find({ user_id: userId, app_id: appId }).value();
  if (existing) {
    db.get('uid_connections').find({ user_id: userId, app_id: appId }).assign({
      external_uid: externalUID, connected_at: now()
    }).write();
  } else {
    db.get('uid_connections').push({
      id: nextId('uid_connections'),
      user_id: userId, app_id: appId,
      external_uid: externalUID, verified: 1, connected_at: now()
    }).write();
  }
}
function getConnectedUID(userId, appId) {
  return db.get('uid_connections').find({ user_id: userId, app_id: parseInt(appId) }).value();
}
function getUserConnections(userId) {
  const conns = db.get('uid_connections').filter({ user_id: userId }).value();
  return conns.map(uc => {
    const app = getEarningAppById(uc.app_id);
    return { ...uc, app_name: app ? app.name : 'Unknown', logo_url: app ? app.logo_url : '' };
  });
}
function findUserByExternalUID(appId, externalUID) {
  const conn = db.get('uid_connections').find({ app_id: parseInt(appId), external_uid: externalUID }).value();
  if (!conn) return null;
  return getUserById(conn.user_id);
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
    receipt_file_id: null,
    admin_note: null,
    created_at: now(),
    updated_at: now()
  };
  db.get('transactions').push(tx).write();
  return tx;
}
function getUserTransactions(userId, limit = 20) {
  return db.get('transactions')
    .filter({ user_id: userId })
    .sortBy('created_at').reverse()
    .take(limit).value();
}
function updateTransaction(txId, updates) {
  db.get('transactions').find({ id: txId }).assign({ ...updates, updated_at: now() }).write();
}
function getTransactionById(txId) {
  return db.get('transactions').find({ id: txId }).value();
}

// ─── Withdrawal Operations ──────────────────────────────────────────────────────
function calculateFees(amount) {
  const totalFee = amount * 0.10;
  return {
    gasFee: parseFloat((totalFee * 0.4).toFixed(2)),
    gatewayFee: parseFloat((totalFee * 0.6).toFixed(2)),
    totalFee: parseFloat(totalFee.toFixed(2))
  };
}
function createWithdrawalRequest(data) {
  const tx = createTransaction({
    user_id: data.user_id,
    type: 'withdrawal',
    amount: data.amount,
    currency: data.currency || 'USDT',
    network: data.network || 'TRC20',
    to_address: data.to_address,
    gas_fee: data.gas_fee,
    gateway_fee: data.gateway_fee,
    total_fee: data.total_fee,
    status: 'awaiting_fee'
  });
  const wr = {
    id: nextId('withdrawal_requests'),
    user_id: data.user_id,
    tx_id: tx.id,
    to_address: data.to_address,
    network: data.network || 'TRC20',
    currency: data.currency || 'USDT',
    amount: data.amount,
    gas_fee: data.gas_fee,
    gateway_fee: data.gateway_fee,
    total_fee: data.total_fee,
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
    return {
      ...wr,
      telegram_id: user ? user.telegram_id : '',
      telegram_username: user ? user.telegram_username : '',
      full_name: user ? user.full_name : '',
      wallet_uid: user ? user.uid : ''
    };
  });
}
function getWithdrawalById(wrId) {
  const wr = db.get('withdrawal_requests').find({ id: parseInt(wrId) }).value();
  if (!wr) return null;
  const user = getUserById(wr.user_id);
  return {
    ...wr,
    telegram_id: user ? user.telegram_id : '',
    telegram_username: user ? user.telegram_username : '',
    full_name: user ? user.full_name : '',
    wallet_uid: user ? user.uid : ''
  };
}
function updateWithdrawal(wrId, updates) {
  db.get('withdrawal_requests').find({ id: parseInt(wrId) }).assign({ ...updates, updated_at: now() }).write();
  const wr = db.get('withdrawal_requests').find({ id: parseInt(wrId) }).value();
  if (wr && wr.tx_id) updateTransaction(wr.tx_id, { status: updates.status || wr.status });
}
function getUserWithdrawals(userId) {
  return db.get('withdrawal_requests').filter({ user_id: userId }).sortBy('created_at').reverse().value();
}

// ─── Stats ──────────────────────────────────────────────────────────────────────
function getStats() {
  const users = db.get('users').value();
  const transactions = db.get('transactions').value();
  const pendingWr = db.get('withdrawal_requests')
    .filter(wr => ['fee_paid', 'awaiting_fee'].includes(wr.status)).value();
  const totalBal = users.reduce((s, u) => s + (u.usdt_balance || 0), 0);
  return {
    totalUsers: users.length,
    totalTransactions: transactions.length,
    pendingWithdrawals: pendingWr.length,
    totalBalance: parseFloat(totalBal.toFixed(2))
  };
}

module.exports = {
  db,
  getOrCreateUser, getUserByTelegramId, getUserById, updateUserBalance,
  claimHourlyEarning, getHourlyStatus,
  getEarningApps, getEarningAppByToken, getEarningAppById, addEarningApp,
  connectUID, getConnectedUID, getUserConnections, findUserByExternalUID,
  createTransaction, getUserTransactions, updateTransaction, getTransactionById,
  calculateFees, createWithdrawalRequest, getPendingWithdrawals,
  getWithdrawalById, updateWithdrawal, getUserWithdrawals,
  getStats, now
};
