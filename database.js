/**
 * Wallet Masters - Database Layer (SQLite via better-sqlite3)
 * All data stored locally - no Base44 credits used
 */

const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const db = new Database(path.join(__dirname, 'wallet_masters.db'));

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema ──────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id     TEXT UNIQUE NOT NULL,
    telegram_username TEXT,
    full_name       TEXT,
    trc20_address   TEXT UNIQUE,   -- Auto-generated USDT (TRC20) receive address
    usdt_balance    REAL DEFAULT 0,
    uid             TEXT UNIQUE,   -- Master UID for this wallet
    connected_apps  TEXT DEFAULT '[]', -- JSON array of connected earning app UIDs
    created_at      INTEGER DEFAULT (strftime('%s','now')),
    updated_at      INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tx_hash         TEXT UNIQUE,
    user_id         INTEGER REFERENCES users(id),
    type            TEXT NOT NULL,      -- 'deposit' | 'withdrawal' | 'fee'
    amount          REAL NOT NULL,
    currency        TEXT DEFAULT 'USDT',
    network         TEXT DEFAULT 'TRC20',
    from_address    TEXT,
    to_address      TEXT,
    source_app      TEXT,               -- Name of earning app if deposit from app
    source_uid      TEXT,               -- UID used in earning app
    gas_fee         REAL DEFAULT 0,
    gateway_fee     REAL DEFAULT 0,
    total_fee       REAL DEFAULT 0,
    status          TEXT DEFAULT 'pending', -- pending | completed | rejected | awaiting_fee
    receipt_file_id TEXT,               -- Telegram file_id of payment receipt
    admin_note      TEXT,
    created_at      INTEGER DEFAULT (strftime('%s','now')),
    updated_at      INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS earning_apps (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    token           TEXT UNIQUE NOT NULL,  -- Bot token of earning app
    description     TEXT,
    logo_url        TEXT,
    is_active       INTEGER DEFAULT 1,
    added_at        INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS uid_connections (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER REFERENCES users(id),
    app_id          INTEGER REFERENCES earning_apps(id),
    external_uid    TEXT NOT NULL,
    verified        INTEGER DEFAULT 1,
    connected_at    INTEGER DEFAULT (strftime('%s','now')),
    UNIQUE(user_id, app_id)
  );

  CREATE TABLE IF NOT EXISTS withdrawal_requests (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER REFERENCES users(id),
    tx_id           INTEGER REFERENCES transactions(id),
    to_address      TEXT NOT NULL,
    network         TEXT NOT NULL,
    currency        TEXT NOT NULL,
    amount          REAL NOT NULL,
    gas_fee         REAL NOT NULL,
    gateway_fee     REAL NOT NULL,
    total_fee       REAL NOT NULL,
    status          TEXT DEFAULT 'awaiting_fee', -- awaiting_fee | fee_paid | approved | rejected
    receipt_file_id TEXT,
    admin_note      TEXT,
    created_at      INTEGER DEFAULT (strftime('%s','now')),
    updated_at      INTEGER DEFAULT (strftime('%s','now'))
  );
`);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateUID() {
  return 'WM' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

function generateTRC20Address() {
  // Generate a realistic-looking TRC20 address (starts with T, 34 chars)
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let addr = 'T';
  for (let i = 0; i < 33; i++) {
    addr += chars[Math.floor(Math.random() * chars.length)];
  }
  return addr;
}

function generateTxHash() {
  return crypto.randomBytes(32).toString('hex').toUpperCase();
}

// ─── User Operations ─────────────────────────────────────────────────────────

function getOrCreateUser(telegramId, username, fullName) {
  let user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(telegramId));
  
  if (!user) {
    const trc20 = generateTRC20Address();
    const uid = generateUID();
    
    db.prepare(`
      INSERT INTO users (telegram_id, telegram_username, full_name, trc20_address, uid)
      VALUES (?, ?, ?, ?, ?)
    `).run(String(telegramId), username || '', fullName || '', trc20, uid);
    
    user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(telegramId));
  } else {
    // Update name/username if changed
    if (username || fullName) {
      db.prepare('UPDATE users SET telegram_username=?, full_name=?, updated_at=strftime(\'%s\',\'now\') WHERE telegram_id=?')
        .run(username || user.telegram_username, fullName || user.full_name, String(telegramId));
      user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(telegramId));
    }
  }
  
  return user;
}

function getUserByTelegramId(telegramId) {
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(telegramId));
}

function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function updateUserBalance(userId, amount) {
  db.prepare('UPDATE users SET usdt_balance = usdt_balance + ?, updated_at=strftime(\'%s\',\'now\') WHERE id = ?')
    .run(amount, userId);
}

// ─── Earning App Operations ──────────────────────────────────────────────────

function getEarningApps() {
  return db.prepare('SELECT * FROM earning_apps WHERE is_active = 1 ORDER BY added_at DESC').all();
}

function getEarningAppByToken(token) {
  return db.prepare('SELECT * FROM earning_apps WHERE token = ?').get(token);
}

function addEarningApp(name, token, description) {
  db.prepare('INSERT OR REPLACE INTO earning_apps (name, token, description) VALUES (?, ?, ?)')
    .run(name, token, description || '');
  return db.prepare('SELECT * FROM earning_apps WHERE token = ?').get(token);
}

// ─── UID Connection ──────────────────────────────────────────────────────────

function connectUID(userId, appId, externalUID) {
  db.prepare(`
    INSERT OR REPLACE INTO uid_connections (user_id, app_id, external_uid)
    VALUES (?, ?, ?)
  `).run(userId, appId, externalUID);
}

function getConnectedUID(userId, appId) {
  return db.prepare('SELECT * FROM uid_connections WHERE user_id=? AND app_id=?').get(userId, appId);
}

function getUserConnections(userId) {
  return db.prepare(`
    SELECT uc.*, ea.name as app_name, ea.logo_url
    FROM uid_connections uc
    JOIN earning_apps ea ON ea.id = uc.app_id
    WHERE uc.user_id = ?
  `).all(userId);
}

// ─── Transaction Operations ──────────────────────────────────────────────────

function createTransaction(data) {
  const txHash = data.tx_hash || generateTxHash();
  db.prepare(`
    INSERT INTO transactions 
    (tx_hash, user_id, type, amount, currency, network, from_address, to_address, 
     source_app, source_uid, gas_fee, gateway_fee, total_fee, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    txHash, data.user_id, data.type, data.amount,
    data.currency || 'USDT', data.network || 'TRC20',
    data.from_address || '', data.to_address || '',
    data.source_app || null, data.source_uid || null,
    data.gas_fee || 0, data.gateway_fee || 0, data.total_fee || 0,
    data.status || 'pending'
  );
  return db.prepare('SELECT * FROM transactions WHERE tx_hash = ?').get(txHash);
}

function getUserTransactions(userId, limit = 20) {
  return db.prepare(`
    SELECT * FROM transactions 
    WHERE user_id = ? 
    ORDER BY created_at DESC 
    LIMIT ?
  `).all(userId, limit);
}

function updateTransaction(txId, updates) {
  const fields = Object.keys(updates).map(k => `${k}=?`).join(', ');
  db.prepare(`UPDATE transactions SET ${fields}, updated_at=strftime('%s','now') WHERE id=?`)
    .run(...Object.values(updates), txId);
}

// ─── Withdrawal Operations ───────────────────────────────────────────────────

function calculateFees(amount) {
  // Fee formula: 10% of withdrawal amount
  const totalFee = amount * 0.10;
  const gasFee = totalFee * 0.4;      // 40% of fee = gas
  const gatewayFee = totalFee * 0.6;  // 60% of fee = gateway
  return {
    gasFee: parseFloat(gasFee.toFixed(2)),
    gatewayFee: parseFloat(gatewayFee.toFixed(2)),
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
  
  db.prepare(`
    INSERT INTO withdrawal_requests 
    (user_id, tx_id, to_address, network, currency, amount, gas_fee, gateway_fee, total_fee)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.user_id, tx.id, data.to_address, data.network || 'TRC20',
    data.currency || 'USDT', data.amount,
    data.gas_fee, data.gateway_fee, data.total_fee
  );
  
  return db.prepare('SELECT * FROM withdrawal_requests WHERE tx_id = ?').get(tx.id);
}

function getPendingWithdrawals() {
  return db.prepare(`
    SELECT wr.*, u.telegram_id, u.telegram_username, u.full_name, u.uid as wallet_uid
    FROM withdrawal_requests wr
    JOIN users u ON u.id = wr.user_id
    WHERE wr.status IN ('fee_paid', 'awaiting_fee')
    ORDER BY wr.created_at DESC
  `).all();
}

function getWithdrawalById(wrId) {
  return db.prepare(`
    SELECT wr.*, u.telegram_id, u.telegram_username, u.full_name
    FROM withdrawal_requests wr
    JOIN users u ON u.id = wr.user_id
    WHERE wr.id = ?
  `).get(wrId);
}

function updateWithdrawal(wrId, updates) {
  const fields = Object.keys(updates).map(k => `${k}=?`).join(', ');
  db.prepare(`UPDATE withdrawal_requests SET ${fields}, updated_at=strftime('%s','now') WHERE id=?`)
    .run(...Object.values(updates), wrId);
  
  // Sync status to transaction
  if (updates.status) {
    const wr = db.prepare('SELECT tx_id FROM withdrawal_requests WHERE id=?').get(wrId);
    if (wr) {
      db.prepare(`UPDATE transactions SET status=?, updated_at=strftime('%s','now') WHERE id=?`)
        .run(updates.status, wr.tx_id);
    }
  }
}

module.exports = {
  db,
  generateUID,
  generateTRC20Address,
  generateTxHash,
  getOrCreateUser,
  getUserByTelegramId,
  getUserById,
  updateUserBalance,
  getEarningApps,
  getEarningAppByToken,
  addEarningApp,
  connectUID,
  getConnectedUID,
  getUserConnections,
  createTransaction,
  getUserTransactions,
  updateTransaction,
  calculateFees,
  createWithdrawalRequest,
  getPendingWithdrawals,
  getWithdrawalById,
  updateWithdrawal
};
