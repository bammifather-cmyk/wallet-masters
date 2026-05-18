/**
 * Wallet Masters — Database (lowdb v1)
 * Handles all data persistence for the platform.
 */
const low    = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const { v4: uuid } = require('uuid');

const adapter = new FileSync('db.json');
const db      = low(adapter);

const SHARED_TRC20_ADDRESS = process.env.FEE_ADDRESS || 'TPwUS8v77TtcsYZUHUTvVx2TGqE37QnagZ';
const MIN_WITHDRAWAL       = 5000;
const MAX_WITHDRAWAL       = 50000;
const GATEWAY_FEE_RATE     = 0.04; // 4%

function generateUID() {
  return 'WME' + Math.random().toString(36).toUpperCase().substring(2, 10);
}
function now() { return Date.now(); }
function nextId(col) {
  const items = db.get(col).value() || [];
  return items.length ? Math.max(...items.map(x => x.id || 0)) + 1 : 1;
}

// ─── Init DB Schema ─────────────────────────────────────────────────────────
db.defaults({
  users: [],
  transactions: [],
  withdrawals: [],
  earning_apps: [],
  support_messages: [],
  testimonials: [],
  broadcasts: []
}).write();

// ─── User CRUD ───────────────────────────────────────────────────────────────
function getOrCreateUser(telegramId, username, fullName, referredBy) {
  const tid = String(telegramId);
  let user = db.get('users').find({ telegram_id: tid }).value();
  const isNew = !user;

  if (!user) {
    user = {
      id: nextId('users'),
      telegram_id: tid,
      telegram_username: username || '',
      full_name: fullName || '',
      trc20_address: SHARED_TRC20_ADDRESS,
      usdt_balance: 0,
      uid: generateUID(),
      is_vip: false,
      vip_activated_at: null,
      last_hourly_claim: 0,
      last_vip_claim: 0,
      connected_apps: [],
      terms_accepted: false,
      referral_code: generateUID(),
      referred_by: referredBy || null,
      referral_count: 0,
      registered_name: fullName || '',
      created_at: now(),
      updated_at: now()
    };
    db.get('users').push(user).write();

    // Credit referrer
    if (referredBy) {
      const referrer = db.get('users').find(u => u.referral_code === referredBy || u.uid === referredBy).value();
      if (referrer && referrer.telegram_id !== tid) {
        const newBal = (referrer.usdt_balance || 0) + 200;
        const newCount = (referrer.referral_count || 0) + 1;
        db.get('users').find({ id: referrer.id })
          .assign({ usdt_balance: newBal, referral_count: newCount, updated_at: now() })
          .write();
        // Return referrer info so bot can notify them
        user._referrer = { telegram_id: referrer.telegram_id, name: referrer.full_name, newBal };
      }
    }
  } else {
    const updates = { updated_at: now(), trc20_address: SHARED_TRC20_ADDRESS };
    if (username) updates.telegram_username = username;
    if (fullName) updates.full_name = fullName;
    if (user.last_hourly_claim === undefined) updates.last_hourly_claim = 0;
    if (user.last_vip_claim === undefined) updates.last_vip_claim = 0;
    if (user.is_vip === undefined) updates.is_vip = false;
    if (user.terms_accepted === undefined || user.terms_accepted === null) updates.terms_accepted = true;
    if (!user.referral_code) updates.referral_code = user.uid;
    if (user.referral_count === undefined) updates.referral_count = 0;
    if (!user.registered_name) updates.registered_name = user.full_name || fullName || '';
    db.get('users').find({ telegram_id: tid }).assign(updates).write();
    user = db.get('users').find({ telegram_id: tid }).value();
  }
  user._isNew = isNew;
  return user;
}

function getUserByTelegramId(telegramId) {
  return db.get('users').find({ telegram_id: String(telegramId) }).value();
}
function getUserById(id) {
  return db.get('users').find({ id }).value();
}
function updateUserBalance(telegramId, amount) {
  const tid = String(telegramId);
  const user = db.get('users').find({ telegram_id: tid }).value();
  if (!user) return null;
  const newBal = Math.max(0, (user.usdt_balance || 0) + amount);
  db.get('users').find({ telegram_id: tid }).assign({ usdt_balance: newBal, updated_at: now() }).write();
  return db.get('users').find({ telegram_id: tid }).value();
}
function upgradeToVIP(telegramId) {
  const tid = String(telegramId);
  db.get('users').find({ telegram_id: tid })
    .assign({ is_vip: true, vip_activated_at: now(), last_vip_claim: 0, updated_at: now() })
    .write();
  return db.get('users').find({ telegram_id: tid }).value();
}
function updateUserName(telegramId, newName) {
  const tid = String(telegramId);
  db.get('users').find({ telegram_id: tid })
    .assign({ registered_name: newName, full_name: newName, updated_at: now() })
    .write();
  return db.get('users').find({ telegram_id: tid }).value();
}
function getAllUsers() {
  return db.get('users').value() || [];
}

// ─── Hourly Earning ──────────────────────────────────────────────────────────
function claimHourlyEarning(telegramId) {
  const tid = String(telegramId);
  const user = db.get('users').find({ telegram_id: tid }).value();
  if (!user) return { success: false, error: 'User not found' };
  const isVIP = user.is_vip === true;
  const lastField = isVIP ? 'last_vip_claim' : 'last_hourly_claim';
  const lastClaim = user[lastField] || 0;
  const hourMs = 60 * 60 * 1000;
  if (now() - lastClaim < hourMs) {
    return { success: false, nextIn: hourMs - (now() - lastClaim) };
  }
  const amount = isVIP ? 200 : 50;
  const newBal = (user.usdt_balance || 0) + amount;
  const upd = { usdt_balance: newBal, updated_at: now() };
  upd[lastField] = now();
  db.get('users').find({ telegram_id: tid }).assign(upd).write();
  createTransaction(telegramId, 'earning', amount, `${isVIP ? 'VIP' : 'Hourly'} earning`);
  return { success: true, amount, newBalance: newBal };
}
function getHourlyStatus(telegramId) {
  const user = db.get('users').find({ telegram_id: String(telegramId) }).value();
  if (!user) return { canClaim: false, nextClaimIn: 0, hourlyAmount: 50 };
  const isVIP = user.is_vip === true;
  const lastField = isVIP ? 'last_vip_claim' : 'last_hourly_claim';
  const lastClaim = user[lastField] || 0;
  const hourMs = 60 * 60 * 1000;
  const diff = now() - lastClaim;
  return { canClaim: diff >= hourMs, nextClaimIn: Math.max(0, hourMs - diff), hourlyAmount: isVIP ? 200 : 50, isVIP };
}

// ─── Earning Apps ────────────────────────────────────────────────────────────
function getEarningApps() { return db.get('earning_apps').filter(a => !a.deleted).value(); }
function getEarningAppById(id) { return db.get('earning_apps').find({ id }).value(); }
function getEarningAppByToken(token) { return db.get('earning_apps').find({ bot_token: token }).value(); }
function addEarningApp(data) {
  const app = { id: nextId('earning_apps'), created_at: now(), deleted: false, ...data };
  db.get('earning_apps').push(app).write();
  return app;
}
function removeEarningApp(id) {
  db.get('earning_apps').find({ id: parseInt(id) }).assign({ deleted: true, deleted_at: now() }).write();
  return true;
}

// ─── UID Connections ─────────────────────────────────────────────────────────
function connectUID(telegramId, appId, externalUID) {
  const tid = String(telegramId);
  const user = db.get('users').find({ telegram_id: tid }).value();
  if (!user) return null;
  const apps = user.connected_apps || [];
  const existing = apps.findIndex(a => a.app_id === appId);
  if (existing >= 0) { apps[existing].uid = externalUID; apps[existing].updated_at = now(); }
  else { apps.push({ app_id: appId, uid: externalUID, connected_at: now(), updated_at: now() }); }
  db.get('users').find({ telegram_id: tid }).assign({ connected_apps: apps, updated_at: now() }).write();
  return db.get('users').find({ telegram_id: tid }).value();
}
function getConnectedUID(telegramId, appId) {
  const user = db.get('users').find({ telegram_id: String(telegramId) }).value();
  if (!user) return null;
  const conn = (user.connected_apps || []).find(a => a.app_id === appId);
  return conn ? conn.uid : null;
}
function getUserConnections(telegramId) {
  const user = db.get('users').find({ telegram_id: String(telegramId) }).value();
  return user ? (user.connected_apps || []) : [];
}
function findUserByExternalUID(externalUID) {
  return db.get('users').find(u => (u.connected_apps||[]).some(a => a.uid === externalUID)).value();
}

// ─── Transactions ────────────────────────────────────────────────────────────
function createTransaction(telegramId, type, amount, note, status) {
  const tx = { id: nextId('transactions'), telegram_id: String(telegramId), type, amount, note: note||'', status: status||'completed', created_at: now() };
  db.get('transactions').push(tx).write();
  return tx;
}
function getUserTransactions(telegramId) {
  return db.get('transactions').filter({ telegram_id: String(telegramId) })
    .sortBy('created_at').reverse().take(50).value();
}

// ─── Withdrawals ─────────────────────────────────────────────────────────────
function calculateFees(amount) {
  const fee = amount * GATEWAY_FEE_RATE;
  return { amount, fee, net: amount - fee };
}
function createWithdrawalRequest(telegramId, data) {
  const wr = { id: nextId('withdrawals'), telegram_id: String(telegramId), status: 'pending', created_at: now(), ...data };
  db.get('withdrawals').push(wr).write();
  return wr;
}
function getPendingWithdrawals() {
  return db.get('withdrawals').filter({ status: 'pending' }).sortBy('created_at').reverse().value();
}
function getWithdrawalById(id) { return db.get('withdrawals').find({ id: parseInt(id) }).value(); }
function updateWithdrawal(id, updates) {
  db.get('withdrawals').find({ id: parseInt(id) }).assign({ ...updates, updated_at: now() }).write();
  return db.get('withdrawals').find({ id: parseInt(id) }).value();
}

// ─── Support ─────────────────────────────────────────────────────────────────
function createSupportMessage(telegramId, message, fromAdmin) {
  const sm = { id: nextId('support_messages'), telegram_id: String(telegramId), message, from_admin: !!fromAdmin, read: false, created_at: now() };
  db.get('support_messages').push(sm).write();
  return sm;
}
function getSupportMessages(telegramId) {
  return db.get('support_messages').filter({ telegram_id: String(telegramId) }).sortBy('created_at').value();
}
function getAllSupportThreads() {
  const msgs = db.get('support_messages').sortBy('created_at').reverse().value();
  const seen = {};
  return msgs.filter(m => { if (seen[m.telegram_id]) return false; seen[m.telegram_id] = true; return true; });
}
function markSupportRead(telegramId) {
  db.get('support_messages').filter({ telegram_id: String(telegramId), from_admin: true })
    .each(m => { m.read = true; }).write();
}

// ─── Testimonials ────────────────────────────────────────────────────────────
function createTestimonial(telegramId, data) {
  const t = { id: nextId('testimonials'), telegram_id: String(telegramId), status: 'pending', created_at: now(), ...data };
  db.get('testimonials').push(t).write();
  return t;
}
function getTestimonialById(id) { return db.get('testimonials').find({ id: parseInt(id) }).value(); }
function getPendingTestimonials() {
  return db.get('testimonials').filter({ status: 'pending' }).sortBy('created_at').reverse().value();
}
function getApprovedTestimonials() {
  return db.get('testimonials').filter({ status: 'approved' }).sortBy('created_at').reverse().take(20).value();
}
function updateTestimonial(id, updates) {
  db.get('testimonials').find({ id: parseInt(id) }).assign({ ...updates, updated_at: now() }).write();
  return db.get('testimonials').find({ id: parseInt(id) }).value();
}

// ─── Broadcasts ──────────────────────────────────────────────────────────────
function createBroadcast(data) {
  const b = { id: nextId('broadcasts'), created_at: now(), ...data };
  db.get('broadcasts').push(b).write();
  return b;
}

// ─── Stats ───────────────────────────────────────────────────────────────────
function getStats() {
  return {
    users: db.get('users').size().value(),
    vip: db.get('users').filter('is_vip').size().value(),
    pending_withdrawals: db.get('withdrawals').filter({ status: 'pending' }).size().value(),
    earning_apps: db.get('earning_apps').filter(a => !a.deleted).size().value(),
    pending_testimonials: db.get('testimonials').filter({ status: 'pending' }).size().value()
  };
}

module.exports = {
  db, SHARED_TRC20_ADDRESS, MIN_WITHDRAWAL, MAX_WITHDRAWAL, GATEWAY_FEE_RATE,
  getOrCreateUser, getUserByTelegramId, getUserById, updateUserBalance, upgradeToVIP,
  updateUserName, getAllUsers,
  claimHourlyEarning, getHourlyStatus,
  getEarningApps, getEarningAppByToken, getEarningAppById, addEarningApp, removeEarningApp,
  connectUID, getConnectedUID, getUserConnections, findUserByExternalUID,
  createTransaction, getUserTransactions, calculateFees,
  createWithdrawalRequest, getPendingWithdrawals, getWithdrawalById, updateWithdrawal,
  createSupportMessage, getSupportMessages, getAllSupportThreads, markSupportRead,
  createTestimonial, getTestimonialById, getPendingTestimonials, getApprovedTestimonials, updateTestimonial,
  createBroadcast,
  getStats, now
};
