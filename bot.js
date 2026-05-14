/**
 * Wallet Masters — Telegram Bot + Express Backend
 * Node.js + node-telegram-bot-api + Express + lowdb
 * Admin Chat ID: 5995434559
 * Fee Address: TPwUS8v77TtcsYZUHUTvVx2TGqE37QnagZ
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express     = require('express');
const cors        = require('cors');
const path        = require('path');
const crypto      = require('crypto');

const {
  getOrCreateUser, getUserByTelegramId, getUserById, updateUserBalance,
  claimHourlyEarning, getHourlyStatus,
  getEarningApps, getEarningAppById, addEarningApp,
  connectUID, getConnectedUID, getUserConnections,
  findUserByExternalUID,
  getUserTransactions, calculateFees,
  createWithdrawalRequest, getPendingWithdrawals,
  getWithdrawalById, updateWithdrawal, updateUserBalance: _ub,
  createTransaction, getStats, now
} = require('./database');

const BOT_TOKEN     = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '5995434559';
const BOT_USERNAME  = process.env.BOT_USERNAME  || 'walletmastersbot';
const FEE_ADDRESS   = process.env.FEE_ADDRESS   || 'TPwUS8v77TtcsYZUHUTvVx2TGqE37QnagZ';
const PORT          = parseInt(process.env.PORT) || 3000;

if (!BOT_TOKEN) { console.error('❌ BOT_TOKEN missing'); process.exit(1); }

// ─── Express App ───────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '.')));

let MINI_APP_URL = process.env.MINI_APP_URL || '';

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'Wallet Masters', ts: new Date().toISOString() });
});

app.listen(PORT, '0.0.0.0', () => {
  const host = process.env.RENDER_EXTERNAL_URL || process.env.RAILWAY_STATIC_URL || '';
  if (!MINI_APP_URL && host) {
    MINI_APP_URL = host.startsWith('http') ? host : `https://${host}`;
  }
  console.log(`🚀 Wallet Masters running on port ${PORT}`);
  console.log(`🌐 Mini App URL: ${MINI_APP_URL || 'Set MINI_APP_URL env var'}`);
});

// ─── Telegram Bot ──────────────────────────────────────────────────────────────
let bot;
try {
  bot = new TelegramBot(BOT_TOKEN, { polling: true });
  console.log('🤖 Bot started');
} catch (err) {
  console.error('❌ Bot failed:', err.message);
}

// ─── Keyboards ─────────────────────────────────────────────────────────────────
function mainMenu(hasUrl) {
  const buttons = [
    [{ text: '📋 My Transactions' }, { text: '🔗 Connect Earning App' }],
    [{ text: '🆔 My UID & Address' }, { text: '💰 Claim Hourly Bonus' }],
    [{ text: '📞 Support' }]
  ];
  if (hasUrl && MINI_APP_URL) {
    buttons.unshift([{ text: '💎 Open Wallet Masters', web_app: { url: MINI_APP_URL } }]);
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

// ─── /start ────────────────────────────────────────────────────────────────────
bot.onText(/\/start/, async (msg) => {
  const { id, username, first_name, last_name } = msg.from;
  const fullName = [first_name, last_name].filter(Boolean).join(' ');
  const user = getOrCreateUser(id, username, fullName);
  const isAdmin = String(id) === String(ADMIN_CHAT_ID);

  if (isAdmin) {
    return bot.sendMessage(id, `
👑 *Welcome Admin!*

You have full control over Wallet Masters.
Use the menu below to manage withdrawals, add earning apps, and view stats.
    `.trim(), { parse_mode: 'Markdown', ...adminMenu });
  }

  return bot.sendMessage(id, `
💎 *Welcome to Wallet Masters!*

Hello ${fullName || username || 'there'}! Your crypto wallet is ready.

🆔 *Your UID:* \`${user.uid}\`
📬 *TRC20 Address:* \`${user.trc20_address}\`
💰 *Balance:* ${user.usdt_balance.toFixed(2)} USDT

🎁 *Earn 50 USDT every hour* by claiming your hourly bonus!

Tap *💎 Open Wallet Masters* to access your full wallet.
  `.trim(), { parse_mode: 'Markdown', ...mainMenu(true) });
});

// ─── Claim Hourly Bonus ─────────────────────────────────────────────────────────
bot.onText(/💰 Claim Hourly Bonus/, async (msg) => {
  const user = getOrCreateUser(msg.from.id, msg.from.username, [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' '));
  const result = claimHourlyEarning(msg.from.id);

  if (result.success) {
    return bot.sendMessage(msg.from.id, `
🎉 *Hourly Bonus Claimed!*

✅ *+${result.amount} USDT* added to your wallet!
💰 *New Balance:* ${result.newBalance.toFixed(2)} USDT

⏰ Next claim available in *1 hour*.
You can also claim directly from the wallet app!
    `.trim(), { parse_mode: 'Markdown', ...mainMenu(true) });
  } else {
    return bot.sendMessage(msg.from.id, `
⏳ *Not Ready Yet*

${result.error}

Keep earning and come back soon! 💎
    `.trim(), { parse_mode: 'Markdown', ...mainMenu(true) });
  }
});

// ─── My Transactions ────────────────────────────────────────────────────────────
bot.onText(/📋 My Transactions/, async (msg) => {
  const user = getUserByTelegramId(msg.from.id);
  if (!user) return bot.sendMessage(msg.from.id, 'Send /start first.');
  const txs = getUserTransactions(user.id, 5);

  if (!txs.length) {
    return bot.sendMessage(msg.from.id, '📭 No transactions yet. Open your wallet to get started!', mainMenu(true));
  }

  const list = txs.map(tx => {
    const date = new Date(tx.created_at * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const icon = tx.type === 'deposit' || tx.type === 'earning' ? '⬇️' : '⬆️';
    const sign = tx.type === 'deposit' || tx.type === 'earning' ? '+' : '-';
    return `${icon} *${sign}${tx.amount} ${tx.currency}* — ${tx.status.toUpperCase()}\n   📅 ${date}${tx.source_app ? `\n   From: ${tx.source_app}` : ''}`;
  }).join('\n\n');

  return bot.sendMessage(msg.from.id, `
📋 *Recent Transactions*

${list}

_Open the wallet app for full history._
  `.trim(), { parse_mode: 'Markdown', ...mainMenu(true) });
});

// ─── My UID & Address ───────────────────────────────────────────────────────────
bot.onText(/🆔 My UID & Address/, async (msg) => {
  const user = getUserByTelegramId(msg.from.id);
  if (!user) return bot.sendMessage(msg.from.id, 'Send /start first.');
  return bot.sendMessage(msg.from.id, `
🆔 *Your Wallet Info*

*UID:* \`${user.uid}\`
*TRC20 Address:* \`${user.trc20_address}\`
*Balance:* ${user.usdt_balance.toFixed(2)} USDT

Use your UID to connect to Earning Apps.
Use your TRC20 address to receive USDT.
  `.trim(), { parse_mode: 'Markdown', ...mainMenu(true) });
});

// ─── Connect Earning App ─────────────────────────────────────────────────────────
bot.onText(/🔗 Connect Earning App/, async (msg) => {
  const apps = getEarningApps();
  if (!apps.length) {
    return bot.sendMessage(msg.from.id, '📭 No earning apps listed yet. Check back soon!', mainMenu(true));
  }
  const keyboard = apps.map(a => [{ text: a.name, callback_data: `connect_app_${a.id}` }]);
  return bot.sendMessage(msg.from.id, '🔗 *Select an Earning App to connect:*', {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard }
  });
});

// ─── Support ────────────────────────────────────────────────────────────────────
bot.onText(/📞 Support/, (msg) => {
  bot.sendMessage(msg.from.id, `
📞 *Wallet Masters Support*

For help with your wallet, withdrawals or earning apps:
💬 Contact admin: @${BOT_USERNAME}

⏱ Response time: Within 24 hours
  `.trim(), { parse_mode: 'Markdown', ...mainMenu(true) });
});

// ─── Admin: Pending Withdrawals ──────────────────────────────────────────────────
bot.onText(/📋 Pending Withdrawals/, async (msg) => {
  if (String(msg.from.id) !== String(ADMIN_CHAT_ID)) return;
  const pending = getPendingWithdrawals();
  if (!pending.length) {
    return bot.sendMessage(msg.from.id, '✅ No pending withdrawals right now.', adminMenu);
  }
  for (const wr of pending.slice(0, 10)) {
    await sendWithdrawalToAdmin(wr);
  }
});

// ─── Admin: List Earning Apps ─────────────────────────────────────────────────────
bot.onText(/📱 List Earning Apps/, async (msg) => {
  if (String(msg.from.id) !== String(ADMIN_CHAT_ID)) return;
  const apps = getEarningApps();
  if (!apps.length) return bot.sendMessage(msg.from.id, '📭 No apps added yet.', adminMenu);
  const list = apps.map((a, i) => `${i + 1}. *${a.name}*\n   ID: ${a.id} | ${a.description || 'No description'}`).join('\n\n');
  bot.sendMessage(msg.from.id, `📱 *Earning Apps (${apps.length})*\n\n${list}`, { parse_mode: 'Markdown', ...adminMenu });
});

// ─── Admin: Fee Address ───────────────────────────────────────────────────────────
bot.onText(/💰 Fee Address/, (msg) => {
  if (String(msg.from.id) !== String(ADMIN_CHAT_ID)) return;
  bot.sendMessage(msg.from.id, `
💰 *Fee Collection Address*

\`${FEE_ADDRESS}\`

Network: TRC20 (USDT)
Fee split: 40% Gas / 60% Gateway
  `.trim(), { parse_mode: 'Markdown', ...adminMenu });
});

// ─── Admin: User Stats ────────────────────────────────────────────────────────────
bot.onText(/👥 User Stats/, (msg) => {
  if (String(msg.from.id) !== String(ADMIN_CHAT_ID)) return;
  const stats = getStats();
  bot.sendMessage(msg.from.id, `
📊 *Wallet Masters Stats*

👥 Total Users: *${stats.totalUsers}*
💳 Total Transactions: *${stats.totalTransactions}*
⏳ Pending Withdrawals: *${stats.pendingWithdrawals}*
💰 Total Balance (all users): *${stats.totalBalance} USDT*
  `.trim(), { parse_mode: 'Markdown', ...adminMenu });
});

// ─── Admin: Add Earning App Flow ───────────────────────────────────────────────────
const pendingActions = {};

bot.onText(/➕ Add Earning App/, (msg) => {
  if (String(msg.from.id) !== String(ADMIN_CHAT_ID)) return;
  pendingActions[msg.from.id] = { step: 'add_app_name' };
  bot.sendMessage(msg.from.id, '➕ Enter the *name* of the new Earning App:', { parse_mode: 'Markdown' });
});

// ─── General Message Handler ───────────────────────────────────────────────────────
bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;

  const uid = msg.from.id;
  const text = msg.text.trim();
  const action = pendingActions[uid];

  // ── Photo receipt upload ──
  if (msg.photo) {
    const photoAction = pendingActions[uid];
    if (photoAction && photoAction.step === 'upload_receipt') {
      const wrId = photoAction.wrId;
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      const wr = getWithdrawalById(wrId);
      if (!wr) return bot.sendMessage(uid, '❌ Withdrawal request not found.', mainMenu(true));

      updateWithdrawal(wrId, { status: 'fee_paid', receipt_file_id: fileId });
      delete pendingActions[uid];

      await bot.sendMessage(uid, `
✅ *Receipt Submitted!*

Your fee payment receipt has been received.
Request #${wrId} is now under admin review.

You will be notified once your withdrawal is approved. 💎
      `.trim(), { parse_mode: 'Markdown', ...mainMenu(true) });

      // Notify admin with photo
      const user = getUserByTelegramId(uid);
      const caption = `
📤 *Fee Receipt — Withdrawal #${wrId}*

👤 *User:* ${wr.full_name} (@${wr.telegram_username || 'N/A'})
🆔 *UID:* ${wr.wallet_uid}

💰 *Amount:* ${wr.amount} USDT
📬 *To:* \`${wr.to_address}\`
🌐 *Network:* ${wr.network}
⛽ *Gas:* ${wr.gas_fee} USDT
🏦 *Gateway:* ${wr.gateway_fee} USDT
💸 *Total Fee:* ${wr.total_fee} USDT
      `.trim();

      await bot.sendPhoto(ADMIN_CHAT_ID, fileId, {
        caption,
        parse_mode: 'Markdown',
        ...approveRejectKeyboard(wrId)
      });
      return;
    }
  }

  if (!action) return;

  // ── Add Earning App: Name ──
  if (action.step === 'add_app_name') {
    pendingActions[uid] = { step: 'add_app_token', name: text };
    return bot.sendMessage(uid, `✅ Name: *${text}*\n\nNow enter the bot *token* for this app:`, { parse_mode: 'Markdown' });
  }

  // ── Add Earning App: Token ──
  if (action.step === 'add_app_token') {
    pendingActions[uid] = { step: 'add_app_desc', name: action.name, token: text };
    return bot.sendMessage(uid, `✅ Token saved.\n\nEnter a short *description* (or send "-" to skip):`, { parse_mode: 'Markdown' });
  }

  // ── Add Earning App: Description ──
  if (action.step === 'add_app_desc') {
    const desc = text === '-' ? '' : text;
    const app = addEarningApp(action.name, action.token, desc);
    delete pendingActions[uid];
    return bot.sendMessage(uid, `
✅ *Earning App Added!*

📱 *Name:* ${app.name}
🆔 *App ID:* ${app.id}
${app.description ? `📝 *Desc:* ${app.description}` : ''}

Users can now connect this app using their UID.
    `.trim(), { parse_mode: 'Markdown', ...adminMenu });
  }

  // ── Connect App: Enter UID ──
  if (action.step === 'enter_uid') {
    const appId = action.appId;
    const app = getEarningAppById(appId);
    const user = getUserByTelegramId(uid);

    if (!user || !app) {
      delete pendingActions[uid];
      return bot.sendMessage(uid, '❌ Error. Please try again.', mainMenu(true));
    }

    // Basic UID validation
    if (text.length < 3) {
      return bot.sendMessage(uid, '⚠️ UID seems too short. Please enter a valid UID:');
    }

    connectUID(user.id, appId, text);
    delete pendingActions[uid];

    return bot.sendMessage(uid, `
✅ *Connected Successfully!*

📱 *App:* ${app.name}
🆔 *Your UID:* \`${text}\`

Your wallet is now linked. Earnings from ${app.name} will appear in your Wallet Masters balance automatically.
    `.trim(), { parse_mode: 'Markdown', ...mainMenu(true) });
  }

  // ── Withdrawal: address step ──
  if (action.step === 'withdraw_address') {
    if (text.length < 25) {
      return bot.sendMessage(uid, '⚠️ That doesn\'t look like a valid TRC20 address. Please enter a valid 34-character TRC20 address:');
    }
    pendingActions[uid] = { step: 'withdraw_amount', toAddress: text };
    const user = getUserByTelegramId(uid);
    return bot.sendMessage(uid, `
✅ Address confirmed.

💰 Your balance: *${user.usdt_balance.toFixed(2)} USDT*

Enter the *amount* to withdraw (minimum 1 USDT):
    `.trim(), { parse_mode: 'Markdown' });
  }

  // ── Withdrawal: amount step ──
  if (action.step === 'withdraw_amount') {
    const amt = parseFloat(text);
    const user = getUserByTelegramId(uid);
    if (!user) return;
    if (isNaN(amt) || amt < 1) return bot.sendMessage(uid, '⚠️ Please enter a valid amount (minimum 1 USDT):');
    if (amt > user.usdt_balance) return bot.sendMessage(uid, `⚠️ Insufficient balance. You have *${user.usdt_balance.toFixed(2)} USDT*. Enter a smaller amount:`, { parse_mode: 'Markdown' });

    const fees = calculateFees(amt);
    const wr = createWithdrawalRequest({
      user_id: user.id,
      to_address: action.toAddress,
      network: 'TRC20',
      currency: 'USDT',
      amount: amt,
      gas_fee: fees.gasFee,
      gateway_fee: fees.gatewayFee,
      total_fee: fees.totalFee
    });

    pendingActions[uid] = { step: 'upload_receipt', wrId: wr.id };

    return bot.sendMessage(uid, `
📤 *Withdrawal Summary*

💰 *Amount:* ${amt.toFixed(2)} USDT
📬 *To:* \`${action.toAddress}\`
🌐 *Network:* TRC20

━━━━━━━━━━━━━━━━━━━━
⛽ *Gas Fee (40%):* ${fees.gasFee} USDT
🏦 *Gateway Fee (60%):* ${fees.gatewayFee} USDT
💸 *Total Fee:* ${fees.totalFee} USDT
━━━━━━━━━━━━━━━━━━━━

📤 *Pay the fee to this address:*
\`${FEE_ADDRESS}\`
Network: TRC20

After paying, *upload your payment receipt screenshot* here.

🔢 Request ID: #${wr.id}
    `.trim(), { parse_mode: 'Markdown' });
  }
});

// ─── Callback Query Handler ────────────────────────────────────────────────────
bot.on('callback_query', async (query) => {
  const { data, from, message } = query;
  const uid = from.id;

  // ── Connect App ──
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

${existing ? `⚠️ Currently linked UID: \`${existing.external_uid}\`. Entering a new one will replace it.\n\n` : ''}Enter your *UID* from *${app.name}*:
    `.trim(), { parse_mode: 'Markdown' });
  }

  // ── Admin: Approve Withdrawal ──
  if (data.startsWith('approve_') && String(uid) === String(ADMIN_CHAT_ID)) {
    const wrId = parseInt(data.replace('approve_', ''));
    const wr = getWithdrawalById(wrId);
    if (!wr) return bot.answerCallbackQuery(query.id, { text: '❌ Request not found.' });
    if (wr.status === 'approved') return bot.answerCallbackQuery(query.id, { text: '✅ Already approved.' });

    updateWithdrawal(wrId, { status: 'approved' });
    updateUserBalance(wr.user_id, -wr.amount);

    await bot.answerCallbackQuery(query.id, { text: '✅ Withdrawal Approved!' });

    // Update admin message
    try {
      if (message.photo) {
        await bot.editMessageCaption(`✅ APPROVED — Withdrawal #${wrId}\n\nUser: ${wr.full_name}\nAmount: ${wr.amount} USDT`, {
          chat_id: message.chat.id, message_id: message.message_id, parse_mode: 'Markdown'
        });
      } else {
        await bot.editMessageText(`✅ *APPROVED* — Withdrawal #${wrId}\n\nUser: ${wr.full_name}\nAmount: ${wr.amount} USDT → \`${wr.to_address}\``, {
          chat_id: message.chat.id, message_id: message.message_id, parse_mode: 'Markdown'
        });
      }
    } catch (e) {}

    // Notify user
    await bot.sendMessage(wr.telegram_id, `
✅ *Withdrawal Approved!*

🎉 Your withdrawal of *${wr.amount} USDT* has been approved!

📬 *Destination:* \`${wr.to_address}\`
🌐 *Network:* TRC20
⏱ *ETA:* 5–30 minutes

Thank you for using Wallet Masters! 💎
    `.trim(), { parse_mode: 'Markdown' });
    return;
  }

  // ── Admin: Reject Withdrawal ──
  if (data.startsWith('reject_') && String(uid) === String(ADMIN_CHAT_ID)) {
    const wrId = parseInt(data.replace('reject_', ''));
    const wr = getWithdrawalById(wrId);
    if (!wr) return bot.answerCallbackQuery(query.id, { text: '❌ Request not found.' });
    if (wr.status === 'rejected') return bot.answerCallbackQuery(query.id, { text: 'Already rejected.' });

    updateWithdrawal(wrId, { status: 'rejected' });

    await bot.answerCallbackQuery(query.id, { text: '❌ Withdrawal Rejected.' });

    try {
      if (message.photo) {
        await bot.editMessageCaption(`❌ REJECTED — Withdrawal #${wrId}`, {
          chat_id: message.chat.id, message_id: message.message_id
        });
      } else {
        await bot.editMessageText(`❌ *REJECTED* — Withdrawal #${wrId}\n\nUser: ${wr.full_name}`, {
          chat_id: message.chat.id, message_id: message.message_id, parse_mode: 'Markdown'
        });
      }
    } catch (e) {}

    await bot.sendMessage(wr.telegram_id, `
❌ *Withdrawal Rejected*

Your withdrawal request #${wrId} has been rejected.

Possible reasons:
• Invalid or unclear fee payment screenshot
• Incorrect fee amount sent
• Duplicate submission

Please try again or contact support.
    `.trim(), { parse_mode: 'Markdown' });
    return;
  }

  bot.answerCallbackQuery(query.id);
});

// ─── Helper: Send withdrawal card to admin ─────────────────────────────────────
async function sendWithdrawalToAdmin(wr) {
  const text = `
📤 *Withdrawal Request #${wr.id}*

👤 *User:* ${wr.full_name || 'Unknown'} (@${wr.telegram_username || 'N/A'})
🆔 *Wallet UID:* ${wr.wallet_uid}
📅 *Date:* ${new Date(wr.created_at * 1000).toLocaleString()}
📊 *Status:* ${wr.status.toUpperCase()}

━━━━━━━━━━━━━━━━━━━━
💰 *Amount:* ${wr.amount} USDT
📬 *To:* \`${wr.to_address}\`
🌐 *Network:* ${wr.network}
⛽ *Gas Fee:* ${wr.gas_fee} USDT
🏦 *Gateway Fee:* ${wr.gateway_fee} USDT
💸 *Total Fee:* ${wr.total_fee} USDT
━━━━━━━━━━━━━━━━━━━━
  `.trim();

  await bot.sendMessage(ADMIN_CHAT_ID, text, {
    parse_mode: 'Markdown',
    ...approveRejectKeyboard(wr.id)
  });
}

// ─── REST API: Auth ────────────────────────────────────────────────────────────
app.post('/api/auth', (req, res) => {
  try {
    const { initData } = req.body;

    let telegramId = null;
    let username = '';
    let fullName = '';

    if (initData) {
      try {
        const params = new URLSearchParams(initData);
        const userStr = params.get('user');
        if (userStr) {
          const u = JSON.parse(userStr);
          telegramId = u.id;
          username = u.username || '';
          fullName = [u.first_name, u.last_name].filter(Boolean).join(' ');
        }
      } catch (e) {
        console.log('initData parse error:', e.message);
      }
    }

    if (!telegramId) {
      return res.status(401).json({ error: 'No Telegram identity. Please open this app through the Telegram bot.' });
    }

    const user = getOrCreateUser(telegramId, username, fullName);
    const txs = getUserTransactions(user.id, 30);
    const connections = getUserConnections(user.id);
    const hourlyStatus = getHourlyStatus(telegramId);

    return res.json({
      success: true,
      user: {
        telegramId: user.telegram_id,
        name: user.full_name || user.telegram_username || 'User',
        username: user.telegram_username,
        uid: user.uid,
        trc20Address: user.trc20_address,
        balance: user.usdt_balance,
        hourlyStatus
      },
      transactions: txs,
      connections
    });
  } catch (err) {
    console.error('Auth error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// ─── REST API: Claim Hourly Earning ───────────────────────────────────────────
app.post('/api/claim-hourly', (req, res) => {
  try {
    const { initData } = req.body;
    let telegramId = null;

    if (initData) {
      try {
        const params = new URLSearchParams(initData);
        const userStr = params.get('user');
        if (userStr) telegramId = JSON.parse(userStr).id;
      } catch (e) {}
    }

    if (!telegramId) return res.status(401).json({ error: 'Unauthorized' });

    const result = claimHourlyEarning(telegramId);
    return res.json(result);
  } catch (err) {
    console.error('Claim hourly error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ─── REST API: Hourly Status ──────────────────────────────────────────────────
app.post('/api/hourly-status', (req, res) => {
  try {
    const { initData } = req.body;
    let telegramId = null;
    if (initData) {
      try {
        const params = new URLSearchParams(initData);
        const u = params.get('user');
        if (u) telegramId = JSON.parse(u).id;
      } catch (e) {}
    }
    if (!telegramId) return res.status(401).json({ error: 'Unauthorized' });
    return res.json(getHourlyStatus(telegramId));
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// ─── REST API: Withdraw ───────────────────────────────────────────────────────
app.post('/api/withdraw', async (req, res) => {
  try {
    const { initData, toAddress, amount, currency, network } = req.body;

    let telegramId = null;
    if (initData) {
      try {
        const params = new URLSearchParams(initData);
        const u = params.get('user');
        if (u) telegramId = JSON.parse(u).id;
      } catch (e) {}
    }

    if (!telegramId) return res.status(401).json({ error: 'Unauthorized' });

    const user = getUserByTelegramId(telegramId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const withdrawAmt = parseFloat(amount);
    if (isNaN(withdrawAmt) || withdrawAmt <= 0) return res.status(400).json({ error: 'Invalid amount' });
    if (withdrawAmt > user.usdt_balance) return res.status(400).json({ error: 'Insufficient balance' });
    if (withdrawAmt < 1) return res.status(400).json({ error: 'Minimum withdrawal is 1 USDT' });

    const fees = calculateFees(withdrawAmt);
    const wr = createWithdrawalRequest({
      user_id: user.id,
      to_address: toAddress,
      network: network || 'TRC20',
      currency: currency || 'USDT',
      amount: withdrawAmt,
      gas_fee: fees.gasFee,
      gateway_fee: fees.gatewayFee,
      total_fee: fees.totalFee
    });

    return res.json({
      success: true,
      withdrawal: {
        id: wr.id,
        amount: withdrawAmt,
        toAddress,
        network: network || 'TRC20',
        currency: currency || 'USDT',
        gasFee: fees.gasFee,
        gatewayFee: fees.gatewayFee,
        totalFee: fees.totalFee,
        feeAddress: FEE_ADDRESS,
        status: 'awaiting_fee'
      }
    });
  } catch (err) {
    console.error('Withdraw error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ─── REST API: Upload Receipt (base64 from web) ───────────────────────────────
app.post('/api/receipt', async (req, res) => {
  try {
    const { initData, withdrawalId, receiptBase64 } = req.body;

    let telegramId = null;
    let fullName = '', username = '';
    if (initData) {
      try {
        const params = new URLSearchParams(initData);
        const u = params.get('user');
        if (u) {
          const ud = JSON.parse(u);
          telegramId = ud.id;
          username = ud.username || '';
          fullName = [ud.first_name, ud.last_name].filter(Boolean).join(' ');
        }
      } catch (e) {}
    }

    if (!telegramId) return res.status(401).json({ error: 'Unauthorized' });

    const wr = getWithdrawalById(parseInt(withdrawalId));
    if (!wr) return res.status(404).json({ error: 'Withdrawal not found' });
    if (wr.status !== 'awaiting_fee') return res.status(400).json({ error: 'Receipt already submitted for this request' });

    updateWithdrawal(parseInt(withdrawalId), { status: 'fee_paid', receipt_file_id: 'web_upload' });

    // Send notification to admin
    const caption = `
📤 *Fee Receipt — Withdrawal #${withdrawalId}*

👤 *User:* ${fullName || 'Unknown'} (@${username || 'N/A'})
🆔 *UID:* ${wr.wallet_uid}

💰 *Amount:* ${wr.amount} USDT
📬 *To:* \`${wr.to_address}\`
🌐 *Network:* ${wr.network}
⛽ *Gas:* ${wr.gas_fee} USDT
🏦 *Gateway:* ${wr.gateway_fee} USDT
💸 *Total Fee:* ${wr.total_fee} USDT
    `.trim();

    if (receiptBase64) {
      // Send base64 image to admin
      const imgBuffer = Buffer.from(receiptBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      await bot.sendPhoto(ADMIN_CHAT_ID, imgBuffer, {
        caption,
        parse_mode: 'Markdown',
        ...approveRejectKeyboard(parseInt(withdrawalId))
      });
    } else {
      await bot.sendMessage(ADMIN_CHAT_ID, caption + '\n\n_(No image attached)_', {
        parse_mode: 'Markdown',
        ...approveRejectKeyboard(parseInt(withdrawalId))
      });
    }

    return res.json({ success: true, message: 'Receipt submitted. Awaiting admin review.' });
  } catch (err) {
    console.error('Receipt error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// ─── REST API: Deposit from Earning App ───────────────────────────────────────
app.post('/api/deposit', async (req, res) => {
  try {
    const { app_token, external_uid, amount, currency, tx_ref } = req.body;

    if (!app_token || !external_uid || !amount) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    const { getEarningAppByToken } = require('./database');
    const app = getEarningAppByToken(app_token);
    if (!app) return res.status(403).json({ success: false, error: 'Invalid app token' });

    const user = findUserByExternalUID(app.id, external_uid);
    if (!user) return res.status(404).json({ success: false, error: 'UID not connected to any wallet' });

    const depositAmt = parseFloat(amount);
    if (isNaN(depositAmt) || depositAmt <= 0) return res.status(400).json({ success: false, error: 'Invalid amount' });

    updateUserBalance(user.id, depositAmt);
    const tx = createTransaction({
      user_id: user.id,
      type: 'deposit',
      amount: depositAmt,
      currency: currency || 'USDT',
      network: 'Internal',
      source_app: app.name,
      source_uid: external_uid,
      tx_hash: tx_ref || undefined,
      status: 'completed'
    });

    // Notify user
    await bot.sendMessage(user.telegram_id, `
💰 *New Deposit Received!*

+*${depositAmt} ${currency || 'USDT'}* from *${app.name}*
🆔 Source UID: \`${external_uid}\`
🔢 TX Ref: \`${tx.tx_hash.slice(0, 16)}...\`

Open your wallet to view your updated balance! 💎
    `.trim(), { parse_mode: 'Markdown' });

    return res.json({ success: true, tx_id: tx.id, new_balance: (user.usdt_balance + depositAmt).toFixed(2) });
  } catch (err) {
    console.error('Deposit error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

// ─── REST API: Get Earning Apps ───────────────────────────────────────────────
app.get('/api/apps', (req, res) => {
  res.json(getEarningApps());
});

// ─── REST API: Connect UID ────────────────────────────────────────────────────
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
  return res.json({ success: true, message: `UID ${external_uid} connected to ${app.name}` });
});

// ─── Error Handling ───────────────────────────────────────────────────────────
if (bot) bot.on('polling_error', (err) => console.error('Polling error:', err.message));
process.on('uncaughtException',  (err) => console.error('Uncaught Exception:', err));
process.on('unhandledRejection', (err) => console.error('Unhandled Rejection:', err));
