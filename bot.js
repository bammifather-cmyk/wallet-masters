/**
 * Wallet Masters — Backend (Node.js + Express + Telegram Bot)
 * Admin: 5995434559 | Fee: TPwUS8v77TtcsYZUHUTvVx2TGqE37QnagZ
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express     = require('express');
const cors        = require('cors');
const path        = require('path');
const crypto      = require('crypto');

const {
  getOrCreateUser, getUserByTelegramId, getUserById, updateUserBalance, upgradeToVIP,
  claimHourlyEarning, getHourlyStatus,
  getEarningApps, getEarningAppById, addEarningApp,
  connectUID, getConnectedUID, getUserConnections, findUserByExternalUID,
  getUserTransactions, getTransactionById, calculateFees,
  createWithdrawalRequest, getPendingWithdrawals,
  getWithdrawalById, updateWithdrawal,
  createTransaction, getStats, now,
  createSupportMessage, getSupportMessages, getAllSupportThreads, markSupportRead,
  SHARED_TRC20_ADDRESS, MIN_WITHDRAWAL, MAX_WITHDRAWAL, db
} = require('./database');

const BOT_TOKEN     = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '5995434559';
const FEE_ADDRESS   = SHARED_TRC20_ADDRESS;
const PORT          = parseInt(process.env.PORT) || 3000;
const MINI_APP_URL  = process.env.MINI_APP_URL || 'https://web-production-a3b658.up.railway.app';

if (!BOT_TOKEN) { console.error('BOT_TOKEN missing'); process.exit(1); }

// ─── Express ───────────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '.')));

app.get('/health', (_, res) => res.json({ status: 'ok', service: 'Wallet Masters' }));
app.listen(PORT, '0.0.0.0', () => console.log(`Wallet Masters on port ${PORT} | URL: ${MINI_APP_URL}`));

// ─── Bot ───────────────────────────────────────────────────────────────────────
let bot;
try { bot = new TelegramBot(BOT_TOKEN, { polling: true }); console.log('Bot started'); }
catch (err) { console.error('Bot failed:', err.message); }

// ─── Auto-set menu button on startup ──────────────────────────────────────────
// Set global default menu button on startup
setTimeout(async () => {
  try {
    await bot.setChatMenuButton({ menu_button: { type: 'web_app', text: 'Open Wallet Masters', web_app: { url: MINI_APP_URL } } });
    console.log('Global menu button set:', MINI_APP_URL);
  } catch (e) { console.log('Menu button err:', e.message); }
}, 3000);

// ─── Keyboards ─────────────────────────────────────────────────────────────────
function mainMenu() {
  // Use remove_keyboard so the left-side menu button (web_app) stays visible
  return {
    reply_markup: { remove_keyboard: true }
  };
}

function mainKeyboard() {
  // Full keyboard for when we want to show options
  return {
    reply_markup: {
      keyboard: [
        [{ text: 'My Transactions' }, { text: 'My UID & Address' }],
        [{ text: 'Claim Hourly Bonus' }, { text: 'Connect Earning App' }],
        [{ text: 'Support' }]
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };
}

function openWalletBtn() {
  return {
    reply_markup: {
      inline_keyboard: [[
        { text: 'Open Wallet Masters', web_app: { url: MINI_APP_URL } }
      ]]
    }
  };
}

const adminMenu = {
  reply_markup: {
    keyboard: [
      [{ text: 'Pending Withdrawals' }, { text: 'Add Earning App' }],
      [{ text: 'List Earning Apps' },   { text: 'Support Threads' }],
      [{ text: 'User Stats' },          { text: 'Fee Address' }]
    ],
    resize_keyboard: true
  }
};

function approveRejectKeyboard(wrId) {
  return { reply_markup: { inline_keyboard: [[{ text: 'APPROVE', callback_data: `approve_${wrId}` }, { text: 'REJECT', callback_data: `reject_${wrId}` }]] } };
}

// ─── /start ────────────────────────────────────────────────────────────────────
bot.onText(/\/start/, async (msg) => {
  const { id, username, first_name, last_name } = msg.from;
  const fullName = [first_name, last_name].filter(Boolean).join(' ');
  const user = getOrCreateUser(id, username, fullName);
  const isAdmin = String(id) === String(ADMIN_CHAT_ID);

  // Set menu button for this specific user (ensures it always shows)
  try {
    await bot.setChatMenuButton({
      chat_id: id,
      menu_button: { type: 'web_app', text: 'Open Wallet Masters', web_app: { url: MINI_APP_URL } }
    });
  } catch(e) { console.log('Menu btn err:', e.message); }

  if (isAdmin) {
    return bot.sendMessage(id, `⚙️ Admin Panel — Wallet Masters\n\n🆔 UID: ${user.uid}\n\nUse the menu below to manage the platform.`, adminMenu);
  }

  // First remove keyboard so menu button shows, then send inline open button
  await bot.sendMessage(id, '💎 Wallet Masters', { reply_markup: { remove_keyboard: true } });
  return bot.sendMessage(id, `👋 Welcome back, ${fullName || 'User'}!\n\n🆔 UID: ${user.uid}\n💰 Balance: ${user.usdt_balance.toFixed(2)} USDT${user.is_vip ? '\n👑 Status: VIP Member' : ''}\n\nTap the button below to open your wallet 👇`, openWalletBtn());
});

// ─── Claim Hourly ──────────────────────────────────────────────────────────────
bot.onText(/Claim Hourly Bonus/, async (msg) => {
  const user = getOrCreateUser(msg.from.id, msg.from.username, [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' '));
  const result = claimHourlyEarning(msg.from.id);
  if (result.success) {
    return bot.sendMessage(msg.from.id, `✅ Hourly Bonus Claimed!\n\n💰 +${result.amount} USDT credited to your wallet!\n📊 New Balance: ${result.newBalance.toFixed(2)} USDT\n${result.isVIP ? '👑 VIP Bonus' : '⏱ Standard Bonus'}\n\n⏰ Next claim available in 1 hour.`, mainMenu());
  }
  return bot.sendMessage(msg.from.id, `⏳ Not Ready Yet\n\n${result.error}`, mainMenu());
});

// ─── My Transactions ───────────────────────────────────────────────────────────
bot.onText(/My Transactions/, async (msg) => {
  const user = getUserByTelegramId(msg.from.id);
  if (!user) return bot.sendMessage(msg.from.id, 'Send /start first.');
  const txs = getUserTransactions(user.id, 5);
  if (!txs.length) return bot.sendMessage(msg.from.id, '📭 No transactions yet.', mainMenu());
  const list = txs.map(tx => {
    const date = new Date(tx.created_at * 1000).toLocaleDateString();
    const sign = ['deposit','earning'].includes(tx.type) ? '+' : '-';
    return `${sign}${tx.amount} ${tx.currency} | ${tx.status.toUpperCase()} | ${date}`;
  }).join('\n');
  return bot.sendMessage(msg.from.id, `📋 Recent Transactions\n\n${list}`, mainMenu());
});

// ─── My UID ────────────────────────────────────────────────────────────────────
bot.onText(/My UID & Address/, async (msg) => {
  const user = getUserByTelegramId(msg.from.id);
  if (!user) return bot.sendMessage(msg.from.id, 'Send /start first.');
  return bot.sendMessage(msg.from.id, `💎 Your Wallet Info\n\n🆔 UID: ${user.uid}\n📬 Deposit Address:\n${user.trc20_address}\n💰 Balance: ${user.usdt_balance.toFixed(2)} USDT\n👑 VIP: ${user.is_vip ? 'Yes ✅' : 'No'}`, mainMenu());
});

// ─── Connect Earning App ────────────────────────────────────────────────────────
bot.onText(/Connect Earning App/, async (msg) => {
  const apps = getEarningApps();
  if (!apps.length) return bot.sendMessage(msg.from.id, '📭 No earning apps listed yet. Check back soon!', mainMenu());
  const keyboard = apps.map(a => [{ text: a.name, callback_data: `connect_app_${a.id}` }]);
  return bot.sendMessage(msg.from.id, '🔗 Select an Earning App to connect your UID:', { reply_markup: { inline_keyboard: keyboard } });
});

// ─── Support ───────────────────────────────────────────────────────────────────
bot.onText(/^Support$/, async (msg) => {
  const user = getUserByTelegramId(msg.from.id);
  if (!user) return bot.sendMessage(msg.from.id, 'Send /start first.');
  pendingActions[msg.from.id] = { step: 'support_message' };
  return bot.sendMessage(msg.from.id, '💬 Support Team\n\nType your message below and we will reply as soon as possible:', mainMenu());
});

// ─── Admin: Pending Withdrawals ─────────────────────────────────────────────────
bot.onText(/Pending Withdrawals/, async (msg) => {
  if (String(msg.from.id) !== String(ADMIN_CHAT_ID)) return;
  const pending = getPendingWithdrawals();
  if (!pending.length) return bot.sendMessage(msg.from.id, '✅ No pending withdrawals at the moment.', adminMenu);
  for (const wr of pending.slice(0, 10)) await sendWithdrawalToAdmin(wr);
});

// ─── Admin: List Earning Apps ───────────────────────────────────────────────────
bot.onText(/List Earning Apps/, async (msg) => {
  if (String(msg.from.id) !== String(ADMIN_CHAT_ID)) return;
  const apps = getEarningApps();
  if (!apps.length) return bot.sendMessage(msg.from.id, '📭 No earning apps added yet.', adminMenu);
  const list = apps.map((a, i) => `${i+1}. ${a.name} | ID: ${a.id}`).join('\n');
  bot.sendMessage(msg.from.id, `📱 Earning Apps (${apps.length})\n\n${list}`, adminMenu);
});

// ─── Admin: Fee Address ─────────────────────────────────────────────────────────
bot.onText(/Fee Address/, (msg) => {
  if (String(msg.from.id) !== String(ADMIN_CHAT_ID)) return;
  bot.sendMessage(msg.from.id, `💳 Fee Collection Address\n\n${FEE_ADDRESS}\n\n🌐 Network: TRC20\n💰 Fee: 4% gateway on all withdrawals`, adminMenu);
});

// ─── Admin: User Stats ──────────────────────────────────────────────────────────
bot.onText(/User Stats/, (msg) => {
  if (String(msg.from.id) !== String(ADMIN_CHAT_ID)) return;
  const s = getStats();
  bot.sendMessage(msg.from.id, `📊 Platform Stats\n\n👥 Total Users: ${s.totalUsers}\n👑 VIP Members: ${s.vipUsers}\n📋 Transactions: ${s.totalTransactions}\n⏳ Pending Withdrawals: ${s.pendingWithdrawals}\n💰 Total Balance: ${s.totalBalance} USDT`, adminMenu);
});

// ─── Admin: Support Threads ────────────────────────────────────────────────────
bot.onText(/Support Threads/, async (msg) => {
  if (String(msg.from.id) !== String(ADMIN_CHAT_ID)) return;
  const threads = getAllSupportThreads();
  if (!threads.length) return bot.sendMessage(msg.from.id, 'No support messages yet.', adminMenu);
  for (const t of threads.slice(0, 10)) {
    const unread = t.unread > 0 ? ` [${t.unread} unread]` : '';
    await bot.sendMessage(msg.from.id, `${t.full_name || 'User'} | UID: ${t.uid}${unread}\nLast: ${t.last_message.slice(0, 80)}`, {
      reply_markup: { inline_keyboard: [[{ text: 'Reply', callback_data: `reply_support_${t.user_id}` }]] }
    });
  }
});

// ─── Admin: Add Earning App Flow ────────────────────────────────────────────────
const pendingActions = {};
bot.onText(/Add Earning App/, (msg) => {
  if (String(msg.from.id) !== String(ADMIN_CHAT_ID)) return;
  pendingActions[msg.from.id] = { step: 'add_app_name' };
  bot.sendMessage(msg.from.id, 'Enter the name of the new Earning App:');
});

// ─── General Message Handler ────────────────────────────────────────────────────
bot.on('message', async (msg) => {
  if (!msg.text && !msg.photo) return;
  const uid = msg.from.id;
  const text = msg.text?.trim() || '';
  const action = pendingActions[uid];

  // Photo receipt
  if (msg.photo && action?.step === 'upload_receipt') {
    const wrId = action.wrId;
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const wr = getWithdrawalById(wrId);
    if (!wr) return bot.sendMessage(uid, 'Withdrawal not found.', mainMenu());
    updateWithdrawal(wrId, { status: 'fee_paid', receipt_file_id: fileId });
    delete pendingActions[uid];
    await bot.sendMessage(uid, `📤 Receipt Submitted!\n\nRequest #${wrId} is under review.\n\n✅ You will be notified once it is approved.`, mainMenu());
    const user = getUserByTelegramId(uid);
    const caption = buildReceiptCaption(wr, user);
    await bot.sendPhoto(ADMIN_CHAT_ID, fileId, { caption, parse_mode: 'Markdown', ...approveRejectKeyboard(wrId) });
    return;
  }

  if (!text || text.startsWith('/')) return;

  // ── Support message from user ──
  if (action?.step === 'support_message') {
    const user = getUserByTelegramId(uid);
    if (!user) { delete pendingActions[uid]; return; }
    createSupportMessage({ user_id: user.id, telegram_id: String(uid), sender: 'user', sender_name: user.full_name || user.telegram_username || 'User', message: text });
    delete pendingActions[uid];
    await bot.sendMessage(uid, '✅ Message sent to Support Team!\n\nWe will reply to you as soon as possible.', mainMenu());
    // Notify admin
    await bot.sendMessage(ADMIN_CHAT_ID, `💬 New Support Message\n\n👤 From: ${user.full_name || 'User'} (@${user.telegram_username || 'N/A'})\n🆔 UID: ${user.uid}\n\n"${text}"`, {
      reply_markup: { inline_keyboard: [[{ text: 'Reply', callback_data: `reply_support_${user.id}` }]] }
    });
    return;
  }

  // ── Admin replies to support ──
  if (action?.step === 'admin_support_reply') {
    const targetUserId = action.targetUserId;
    const targetUser = getUserById(targetUserId);
    if (!targetUser) { delete pendingActions[uid]; return; }
    createSupportMessage({ user_id: targetUserId, telegram_id: targetUser.telegram_id, sender: 'admin', sender_name: 'Support Team', message: text });
    delete pendingActions[uid];
    await bot.sendMessage(uid, '✅ Reply sent to user.', adminMenu);
    await bot.sendMessage(targetUser.telegram_id, `💬 Support Team\n\n${text}\n\n— Wallet Masters Support`, {
      reply_markup: { inline_keyboard: [[{ text: 'Reply', callback_data: `user_reply_support` }]] }
    });
    return;
  }

  // ── User replies to support ──
  if (action?.step === 'user_reply_support') {
    const user = getUserByTelegramId(uid);
    if (!user) { delete pendingActions[uid]; return; }
    createSupportMessage({ user_id: user.id, telegram_id: String(uid), sender: 'user', sender_name: user.full_name || 'User', message: text });
    delete pendingActions[uid];
    await bot.sendMessage(uid, '✅ Reply sent to Support Team!', mainMenu());
    await bot.sendMessage(ADMIN_CHAT_ID, `💬 User Reply\n\n👤 From: ${user.full_name || 'User'}\n🆔 UID: ${user.uid}\n\n"${text}"`, {
      reply_markup: { inline_keyboard: [[{ text: 'Reply', callback_data: `reply_support_${user.id}` }]] }
    });
    return;
  }

  if (!action) return;

  // ── Add App: name ──
  if (action.step === 'add_app_name') {
    pendingActions[uid] = { step: 'add_app_token', name: text };
    return bot.sendMessage(uid, `Name: ${text}\n\nEnter the bot token:`);
  }
  // ── Add App: token ──
  if (action.step === 'add_app_token') {
    pendingActions[uid] = { step: 'add_app_desc', name: action.name, token: text };
    return bot.sendMessage(uid, 'Enter a short description (or send - to skip):');
  }
  // ── Add App: desc ──
  if (action.step === 'add_app_desc') {
    const app = addEarningApp(action.name, action.token, text === '-' ? '' : text);
    delete pendingActions[uid];
    return bot.sendMessage(uid, `✅ Earning App Added!\n\n📱 Name: ${app.name}\n🆔 ID: ${app.id}\n\nUsers can now connect via their UID.`, adminMenu);
  }

  // ── Connect App: UID entry ──
  if (action.step === 'enter_uid') {
    const appId = action.appId;
    const app = getEarningAppById(appId);
    const user = getUserByTelegramId(uid);
    if (!user || !app) { delete pendingActions[uid]; return bot.sendMessage(uid, 'Error. Please try again.', mainMenu()); }
    if (text.length < 3) return bot.sendMessage(uid, 'UID too short. Enter a valid UID:');
    connectUID(user.id, appId, text);
    delete pendingActions[uid];
    return bot.sendMessage(uid, `✅ Connected Successfully!\n\n📱 App: ${app.name}\n🆔 UID: ${text}\n\n💰 Earnings from this app will appear in your wallet automatically.`, mainMenu());
  }

  // ── Withdrawal: address ──
  if (action.step === 'withdraw_address') {
    if (text.length < 20) return bot.sendMessage(uid, 'Invalid address. Enter a valid TRC20 address:');
    pendingActions[uid] = { step: 'withdraw_amount', toAddress: text };
    const user = getUserByTelegramId(uid);
    return bot.sendMessage(uid, `Address confirmed.\n\nBalance: ${user?.usdt_balance.toFixed(2)} USDT\nMin: ${MIN_WITHDRAWAL} USDT | Max: ${MAX_WITHDRAWAL} USDT\n\nEnter withdrawal amount:`);
  }
  // ── Withdrawal: amount ──
  if (action.step === 'withdraw_amount') {
    const amt = parseFloat(text);
    const user = getUserByTelegramId(uid);
    if (!user) return;
    if (isNaN(amt) || amt < MIN_WITHDRAWAL) return bot.sendMessage(uid, `Minimum withdrawal is ${MIN_WITHDRAWAL} USDT:`);
    if (amt > MAX_WITHDRAWAL) return bot.sendMessage(uid, `Maximum withdrawal is ${MAX_WITHDRAWAL} USDT:`);
    if (amt > user.usdt_balance) return bot.sendMessage(uid, `Insufficient balance (${user.usdt_balance.toFixed(2)} USDT). Enter a smaller amount:`);
    const fees = calculateFees(amt);
    const wr = createWithdrawalRequest({ user_id: user.id, to_address: action.toAddress, amount: amt, gateway_fee: fees.gatewayFee });
    pendingActions[uid] = { step: 'upload_receipt', wrId: wr.id };
    return bot.sendMessage(uid, `Withdrawal Summary\n\nAmount: ${amt} USDT\nTo: ${action.toAddress}\nNetwork: TRC20\n\nGateway Fee (4%): ${fees.gatewayFee} USDT\n\nPay fee to: ${FEE_ADDRESS} (TRC20)\n\nRequest ID: #${wr.id}\n\nUpload your fee payment screenshot to proceed.`);
  }
});

// ─── Callback Query ─────────────────────────────────────────────────────────────
bot.on('callback_query', async (query) => {
  const { data, from, message } = query;
  const uid = from.id;

  if (data.startsWith('connect_app_')) {
    const appId = parseInt(data.replace('connect_app_', ''));
    const app = getEarningAppById(appId);
    if (!app) return bot.answerCallbackQuery(query.id, { text: 'App not found.' });
    const user = getUserByTelegramId(uid);
    const existing = getConnectedUID(user?.id, appId);
    pendingActions[uid] = { step: 'enter_uid', appId };
    await bot.answerCallbackQuery(query.id);
    return bot.sendMessage(uid, `Connect to ${app.name}\n\n${existing ? `Current UID: ${existing.external_uid}\n\n` : ''}Enter your UID from ${app.name}:`);
  }

  // Admin: approve
  if (data.startsWith('approve_') && String(uid) === String(ADMIN_CHAT_ID)) {
    const wrId = parseInt(data.replace('approve_', ''));
    const wr = getWithdrawalById(wrId);
    if (!wr) return bot.answerCallbackQuery(query.id, { text: 'Not found.' });
    if (wr.status === 'approved') return bot.answerCallbackQuery(query.id, { text: 'Already approved.' });
    updateWithdrawal(wrId, { status: 'approved' });
    updateUserBalance(wr.user_id, -wr.amount);
    await bot.answerCallbackQuery(query.id, { text: 'Approved!' });
    try {
      if (message.photo) await bot.editMessageCaption(`APPROVED — #${wrId} | ${wr.amount} USDT`, { chat_id: message.chat.id, message_id: message.message_id });
      else await bot.editMessageText(`APPROVED — #${wrId} | ${wr.amount} USDT to ${wr.to_address}`, { chat_id: message.chat.id, message_id: message.message_id });
    } catch(e) {}
    await bot.sendMessage(wr.telegram_id, `✅ Withdrawal Approved!\n\n💰 Your withdrawal of ${wr.amount} USDT has been approved.\n\n📬 Destination: ${wr.to_address || wr.bank_name}\n🌐 Network: ${wr.network}\n⏱ Estimated: 5–30 minutes\n\n💎 Thank you for using Wallet Masters!`);
    return;
  }

  // Admin: reject
  if (data.startsWith('reject_') && String(uid) === String(ADMIN_CHAT_ID)) {
    const wrId = parseInt(data.replace('reject_', ''));
    const wr = getWithdrawalById(wrId);
    if (!wr) return bot.answerCallbackQuery(query.id, { text: 'Not found.' });
    if (wr.status === 'rejected') return bot.answerCallbackQuery(query.id, { text: 'Already rejected.' });
    updateWithdrawal(wrId, { status: 'rejected' });
    await bot.answerCallbackQuery(query.id, { text: 'Rejected.' });
    try {
      if (message.photo) await bot.editMessageCaption(`REJECTED — #${wrId}`, { chat_id: message.chat.id, message_id: message.message_id });
      else await bot.editMessageText(`REJECTED — #${wrId}`, { chat_id: message.chat.id, message_id: message.message_id });
    } catch(e) {}
    await bot.sendMessage(wr.telegram_id, `❌ Withdrawal Rejected\n\nRequest #${wrId} has been rejected.\n\n⚠️ Reasons: Invalid receipt, wrong amount, or duplicate submission.\n\nContact our Support Team if you believe this is an error.`);
    return;
  }

  // Admin: reply support
  if (data.startsWith('reply_support_') && String(uid) === String(ADMIN_CHAT_ID)) {
    const targetUserId = parseInt(data.replace('reply_support_', ''));
    const targetUser = getUserById(targetUserId);
    if (!targetUser) return bot.answerCallbackQuery(query.id, { text: 'User not found.' });
    markSupportRead(targetUserId);
    pendingActions[uid] = { step: 'admin_support_reply', targetUserId };
    await bot.answerCallbackQuery(query.id);
    return bot.sendMessage(uid, `Replying to: ${targetUser.full_name || 'User'} (UID: ${targetUser.uid})\n\nType your reply:`, adminMenu);
  }

  // User: reply to support
  if (data === 'user_reply_support') {
    pendingActions[uid] = { step: 'user_reply_support' };
    await bot.answerCallbackQuery(query.id);
    return bot.sendMessage(uid, 'Type your reply to Support Team:');
  }

  // VIP approve
  if (data.startsWith('vip_approve_') && String(uid) === String(ADMIN_CHAT_ID)) {
    const targetUserId = parseInt(data.replace('vip_approve_', ''));
    const targetUser = getUserById(targetUserId);
    if (!targetUser) return bot.answerCallbackQuery(query.id, { text: 'User not found.' });
    upgradeToVIP(targetUser.id);
    await bot.answerCallbackQuery(query.id, { text: 'VIP Approved!' });
    try { await bot.editMessageCaption(`VIP APPROVED — ${targetUser.full_name || 'User'} | UID: ${targetUser.uid}`, { chat_id: message.chat.id, message_id: message.message_id }); } catch(e) {}
    await bot.sendMessage(targetUser.telegram_id, `💎 VIP Activated!\n\n🎉 Congratulations ${targetUser.full_name || ''}! Your VIP membership has been approved.\n\n✨ You now earn 200 USDT every hour and have access to bank withdrawals.\n\nOpen your wallet to start enjoying VIP benefits! 🚀`);
    return;
  }

  // VIP reject
  if (data.startsWith('vip_reject_') && String(uid) === String(ADMIN_CHAT_ID)) {
    const targetUserId = parseInt(data.replace('vip_reject_', ''));
    const targetUser = getUserById(targetUserId);
    if (!targetUser) return bot.answerCallbackQuery(query.id, { text: 'User not found.' });
    await bot.answerCallbackQuery(query.id, { text: 'VIP Rejected.' });
    try { await bot.editMessageCaption(`VIP REJECTED — ${targetUser.full_name || 'User'}`, { chat_id: message.chat.id, message_id: message.message_id }); } catch(e) {}
    await bot.sendMessage(targetUser.telegram_id, `❌ VIP Request Rejected\n\nYour VIP upgrade request was not approved.\n\n⚠️ Reason: Payment not confirmed or incorrect amount.\nPlease ensure you sent exactly 200 USDT on TRC20 and try again.\n\n💬 Contact our Support Team if you believe this is an error.`);
    return;
  }

  bot.answerCallbackQuery(query.id);
});

// ─── Admin: send withdrawal card ───────────────────────────────────────────────
function buildReceiptCaption(wr, user) {
  const isBankWD = wr.is_bank_withdrawal;
  return `Fee Receipt — Withdrawal #${wr.id}\n\nUser: ${wr.full_name || (user?.full_name)} (@${wr.telegram_username || (user?.telegram_username) || 'N/A'})\nUID: ${wr.wallet_uid || (user?.uid)}\n\nAmount: ${wr.amount} USDT\nTo: ${isBankWD ? `${wr.bank_name} | ${wr.account_number} | ${wr.account_name}` : wr.to_address}\nNetwork: ${wr.network}\nGateway Fee (4%): ${wr.gateway_fee} USDT\nVIP Bank Withdrawal: ${isBankWD ? 'Yes' : 'No'}`;
}

async function sendWithdrawalToAdmin(wr) {
  const isBankWD = wr.is_bank_withdrawal;
  const dest = isBankWD ? `${wr.bank_name} | ${wr.account_number} | ${wr.account_name}` : wr.to_address;
  const text = `Withdrawal Request #${wr.id}\n\nUser: ${wr.full_name} (@${wr.telegram_username || 'N/A'})\nUID: ${wr.wallet_uid}\nDate: ${new Date(wr.created_at*1000).toLocaleString()}\nStatus: ${wr.status.toUpperCase()}\n\nAmount: ${wr.amount} USDT\nTo: ${dest}\nNetwork: ${wr.network}\nGateway Fee (4%): ${wr.gateway_fee} USDT\nVIP Bank: ${isBankWD ? 'Yes' : 'No'}`;
  await bot.sendMessage(ADMIN_CHAT_ID, text, approveRejectKeyboard(wr.id));
}

// ─── REST API ──────────────────────────────────────────────────────────────────

function parseTelegramUser(body) {
  let telegramId = null, username = '', fullName = '';
  const { initData, unsafeUser } = body;
  if (initData) {
    try {
      const params = new URLSearchParams(initData);
      const u = params.get('user');
      if (u) {
        const ud = JSON.parse(u);
        telegramId = ud.id; username = ud.username || '';
        fullName = [ud.first_name, ud.last_name].filter(Boolean).join(' ');
      }
    } catch(e) {}
  }
  if (!telegramId && unsafeUser?.id) {
    telegramId = unsafeUser.id; username = unsafeUser.username || '';
    fullName = [unsafeUser.first_name, unsafeUser.last_name].filter(Boolean).join(' ');
  }
  return { telegramId, username, fullName };
}

// Auth
app.post('/api/auth', (req, res) => {
  try {
    const { telegramId, username, fullName } = parseTelegramUser(req.body);
    if (!telegramId) return res.status(401).json({ error: 'No Telegram identity. Open via Telegram bot.' });
    const user = getOrCreateUser(telegramId, username, fullName);
    const txs = getUserTransactions(user.id, 50);
    const connections = getUserConnections(user.id);
    const hourlyStatus = getHourlyStatus(telegramId);
    return res.json({
      success: true,
      user: {
        telegramId: user.telegram_id, name: user.full_name || user.telegram_username || 'User',
        username: user.telegram_username, uid: user.uid,
        trc20Address: user.trc20_address, balance: user.usdt_balance,
        isVIP: user.is_vip === true,
      termsAccepted: user.terms_accepted === true, hourlyStatus
      },
      transactions: txs, connections
    });
  } catch(err) { console.error('Auth error:', err); return res.status(500).json({ error: 'Server error' }); }
});


// Accept Terms & Conditions
app.post('/api/accept-terms', (req, res) => {
  try {
    const { telegramId } = parseTelegramUser(req.body);
    if (!telegramId) return res.status(401).json({ error: 'Unauthorized' });
    const user = getUserByTelegramId(telegramId);
    if (user) {
      db.get('users').find({ id: user.id }).assign({ terms_accepted: true }).write();
    } else {
      const u = getOrCreateUser(telegramId, null, null);
      db.get('users').find({ id: u.id }).assign({ terms_accepted: true }).write();
    }
    return res.json({ success: true });
  } catch(err) {
    console.error('accept-terms error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Claim Hourly
app.post('/api/claim-hourly', (req, res) => {
  try {
    const { telegramId } = parseTelegramUser(req.body);
    if (!telegramId) return res.status(401).json({ error: 'Unauthorized' });
    return res.json(claimHourlyEarning(telegramId));
  } catch(err) { return res.status(500).json({ error: 'Server error' }); }
});

// Hourly Status
app.post('/api/hourly-status', (req, res) => {
  try {
    const { telegramId } = parseTelegramUser(req.body);
    if (!telegramId) return res.status(401).json({ error: 'Unauthorized' });
    return res.json(getHourlyStatus(telegramId));
  } catch(err) { return res.status(500).json({ error: 'Server error' }); }
});

// Withdraw
app.post('/api/withdraw', async (req, res) => {
  try {
    const { telegramId } = parseTelegramUser(req.body);
    if (!telegramId) return res.status(401).json({ error: 'Unauthorized' });
    const { toAddress, amount, currency, network, isBankWithdrawal, bankName, accountNumber, accountName, paymentMethod } = req.body;
    const user = getUserByTelegramId(telegramId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const withdrawAmt = parseFloat(amount);
    if (isNaN(withdrawAmt) || withdrawAmt < MIN_WITHDRAWAL) return res.status(400).json({ error: `Minimum withdrawal is ${MIN_WITHDRAWAL} USDT` });
    if (withdrawAmt > MAX_WITHDRAWAL) return res.status(400).json({ error: `Maximum withdrawal is ${MAX_WITHDRAWAL} USDT` });
    if (withdrawAmt > user.usdt_balance) return res.status(400).json({ error: 'Insufficient balance' });
    if (isBankWithdrawal && !user.is_vip) return res.status(403).json({ error: 'Bank withdrawal is for VIP members only' });
    const fees = calculateFees(withdrawAmt);
    const wr = createWithdrawalRequest({
      user_id: user.id, to_address: toAddress || '', amount: withdrawAmt,
      currency: currency || 'USDT', network: network || 'TRC20',
      gateway_fee: fees.gatewayFee,
      is_bank_withdrawal: isBankWithdrawal || false,
      bank_name: bankName || null, account_number: accountNumber || null,
      account_name: accountName || null, payment_method: paymentMethod || null
    });
    return res.json({
      success: true,
      withdrawal: {
        id: wr.id, amount: withdrawAmt, toAddress, network: network || 'TRC20',
        currency: currency || 'USDT', gatewayFee: fees.gatewayFee,
        totalFee: fees.gatewayFee, feeAddress: FEE_ADDRESS, status: 'awaiting_fee'
      }
    });
  } catch(err) { console.error('Withdraw error:', err); return res.status(500).json({ error: 'Server error' }); }
});

// Submit Receipt
app.post('/api/receipt', async (req, res) => {
  try {
    const { telegramId, username, fullName } = parseTelegramUser(req.body);
    if (!telegramId) return res.status(401).json({ error: 'Unauthorized' });
    const { withdrawalId, receiptBase64 } = req.body;
    const wr = getWithdrawalById(parseInt(withdrawalId));
    if (!wr) return res.status(404).json({ error: 'Withdrawal not found' });
    if (wr.status !== 'awaiting_fee') return res.status(400).json({ error: 'Receipt already submitted' });
    updateWithdrawal(parseInt(withdrawalId), { status: 'fee_paid', receipt_file_id: 'web_upload' });
    const caption = buildReceiptCaption(wr, { full_name: fullName, telegram_username: username, uid: wr.wallet_uid });
    if (receiptBase64) {
      const imgBuf = Buffer.from(receiptBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      await bot.sendPhoto(ADMIN_CHAT_ID, imgBuf, { caption, ...approveRejectKeyboard(parseInt(withdrawalId)) });
    } else {
      await bot.sendMessage(ADMIN_CHAT_ID, caption, approveRejectKeyboard(parseInt(withdrawalId)));
    }
    return res.json({ success: true, message: 'Receipt submitted. Awaiting admin review.' });
  } catch(err) { console.error('Receipt error:', err); return res.status(500).json({ error: 'Server error: ' + err.message }); }
});

// Check VIP (deposit detection)
app.post('/api/check-vip', async (req, res) => {
  try {
    const { telegramId } = parseTelegramUser(req.body);
    if (!telegramId) return res.status(401).json({ error: 'Unauthorized' });
    const user = getUserByTelegramId(telegramId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.is_vip) return res.json({ success: true, isVIP: true, message: 'Already VIP' });
    // Check if user has received >= 200 USDT in deposits
    const txs = getUserTransactions(user.id, 100);
    const totalDeposited = txs.filter(t => t.type === 'deposit').reduce((s, t) => s + t.amount, 0);
    if (totalDeposited >= 200) {
      upgradeToVIP(user.id);
      await bot.sendMessage(user.telegram_id, `💎 VIP Activated!\n\n🎉 Congratulations! You have been upgraded to VIP Member.\n\n✨ VIP Benefits:\n👑 Earn 200 USDT every hour\n🏦 Bank withdrawal access\n💬 Priority support\n\n🚀 Your upgraded earnings start right now!`);
      return res.json({ success: true, isVIP: true, message: 'Upgraded to VIP!' });
    }
    return res.json({ success: false, isVIP: false, totalDeposited, needed: 200 - totalDeposited });
  } catch(err) { return res.status(500).json({ error: 'Server error' }); }
});

// Deposit (from Earning App)
app.post('/api/deposit', async (req, res) => {
  try {
    const { app_token, external_uid, amount, currency, tx_ref } = req.body;
    if (!app_token || !external_uid || !amount) return res.status(400).json({ success: false, error: 'Missing fields' });
    const { getEarningAppByToken } = require('./database');
    const appData = getEarningAppByToken(app_token);
    if (!appData) return res.status(403).json({ success: false, error: 'Invalid app token' });
    const user = findUserByExternalUID(appData.id, external_uid);
    if (!user) return res.status(404).json({ success: false, error: 'UID not connected' });
    const depositAmt = parseFloat(amount);
    if (isNaN(depositAmt) || depositAmt <= 0) return res.status(400).json({ success: false, error: 'Invalid amount' });
    updateUserBalance(user.id, depositAmt);
    const tx = createTransaction({ user_id: user.id, type: 'deposit', amount: depositAmt, currency: currency || 'USDT', network: 'Internal', source_app: appData.name, source_uid: external_uid, tx_hash: tx_ref, status: 'completed' });
    // Check VIP upgrade
    const allTxs = getUserTransactions(user.id, 100);
    const totalDeposited = allTxs.filter(t => t.type === 'deposit').reduce((s, t) => s + t.amount, 0);
    if (!user.is_vip && totalDeposited >= 200) {
      upgradeToVIP(user.id);
      await bot.sendMessage(user.telegram_id, `💎 VIP Activated!\n\n👑 You've been upgraded to VIP Member after depositing 200+ USDT!\n\n🎉 Benefits unlocked:\n• Earn 200 USDT every hour\n• Bank & payment withdrawal\n• Priority support\n\nOpen your wallet to enjoy your VIP benefits!`);
    }
    await bot.sendMessage(user.telegram_id, `💰 New Deposit!\n\n+${depositAmt} ${currency || 'USDT'} received from ${appData.name}\n🆔 UID: ${external_uid}\n🔗 Ref: ${tx.tx_hash.slice(0,16)}...`);
    return res.json({ success: true, tx_id: tx.id });
  } catch(err) { console.error('Deposit error:', err); return res.status(500).json({ success: false, error: 'Server error' }); }
});

// Get Earning Apps
app.get('/api/apps', (_, res) => res.json(getEarningApps()));

// Connect UID
app.post('/api/connect-uid', (req, res) => {
  const { telegram_id, app_id, external_uid } = req.body;
  if (!telegram_id || !app_id || !external_uid) return res.status(400).json({ success: false, error: 'Missing fields' });
  const user = getUserByTelegramId(telegram_id);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });
  const appData = getEarningAppById(app_id);
  if (!appData) return res.status(404).json({ success: false, error: 'App not found' });
  connectUID(user.id, app_id, external_uid);
  return res.json({ success: true });
});

// Support: get messages
app.post('/api/support/messages', (req, res) => {
  try {
    const { telegramId } = parseTelegramUser(req.body);
    if (!telegramId) return res.status(401).json({ error: 'Unauthorized' });
    const user = getUserByTelegramId(telegramId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    markSupportRead(user.id);
    return res.json({ success: true, messages: getSupportMessages(user.id) });
  } catch(err) { return res.status(500).json({ error: 'Server error' }); }
});

// Support: send message
app.post('/api/support/send', async (req, res) => {
  try {
    const { telegramId, username, fullName } = parseTelegramUser(req.body);
    if (!telegramId) return res.status(401).json({ error: 'Unauthorized' });
    const user = getUserByTelegramId(telegramId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'Empty message' });
    const msg = createSupportMessage({ user_id: user.id, telegram_id: String(telegramId), sender: 'user', sender_name: user.full_name || 'User', message: message.trim() });
    await bot.sendMessage(ADMIN_CHAT_ID, `💬 Support Message\n\n👤 ${user.full_name || 'User'} (@${user.telegram_username || 'N/A'})\n🆔 UID: ${user.uid}\n\n"${message.trim()}"`, {
      reply_markup: { inline_keyboard: [[{ text: 'Reply', callback_data: `reply_support_${user.id}` }]] }
    });
    return res.json({ success: true, message: msg });
  } catch(err) { return res.status(500).json({ error: 'Server error' }); }
});

// Get transaction by ID
app.post('/api/transaction/:id', (req, res) => {
  try {
    const { telegramId } = parseTelegramUser(req.body);
    if (!telegramId) return res.status(401).json({ error: 'Unauthorized' });
    const tx = getTransactionById(parseInt(req.params.id));
    if (!tx) return res.status(404).json({ error: 'Not found' });
    const user = getUserByTelegramId(telegramId);
    if (!user || tx.user_id !== user.id) return res.status(403).json({ error: 'Forbidden' });
    return res.json({ success: true, transaction: tx });
  } catch(err) { return res.status(500).json({ error: 'Server error' }); }
});


// VIP Receipt Submission
app.post('/api/vip-receipt', async (req, res) => {
  try {
    const { telegramId, username, fullName } = parseTelegramUser(req.body);
    if (!telegramId) return res.status(401).json({ error: 'Unauthorized' });
    const user = getUserByTelegramId(telegramId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.is_vip) return res.json({ success: true, message: 'Already VIP' });
    const { receiptBase64, uid } = req.body;
    if (!receiptBase64) return res.status(400).json({ error: 'No receipt uploaded' });

    // Send to admin with Approve/Reject buttons
    const caption = `👑 VIP Upgrade Request\n\n👤 User: ${user.full_name || 'Unknown'} (@${user.telegram_username || 'N/A'})\n🆔 UID: ${user.uid}\n📱 Telegram ID: ${telegramId}\n\n📸 Payment receipt attached.\n✅ Verify that 200 USDT was received before approving.`;
    const imgBuf = Buffer.from(receiptBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    const approveCb = `vip_approve_${user.id}`;
    const rejectCb  = `vip_reject_${user.id}`;
    await bot.sendPhoto(ADMIN_CHAT_ID, imgBuf, {
      caption,
      reply_markup: { inline_keyboard: [[
        { text: 'APPROVE VIP', callback_data: approveCb },
        { text: 'REJECT', callback_data: rejectCb }
      ]]}
    });
    return res.json({ success: true, message: 'Receipt submitted for review.' });
  } catch(err) {
    console.error('VIP receipt error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
});


// ─── Migrate existing users: auto-accept terms (preserve balance/VIP) ───────
try {
  const allUsers = db.get('users').value() || [];
  let migrated = 0;
  allUsers.forEach(u => {
    const updates = {};
    if (u.terms_accepted === undefined || u.terms_accepted === null) updates.terms_accepted = true;
    if (!u.referral_code) updates.referral_code = u.uid;
    if (u.referral_count === undefined) updates.referral_count = 0;
    if (Object.keys(updates).length > 0) {
      db.get('users').find({ id: u.id }).assign(updates).write();
      migrated++;
    }
  });
  if (migrated > 0) console.log(`Migrated ${migrated} existing users`);
} catch(e) { console.error('Migration error:', e.message); }

if (bot) bot.on('polling_error', (err) => console.error('Polling error:', err.message));
process.on('uncaughtException',  (err) => console.error('Uncaught:', err));
process.on('unhandledRejection', (err) => console.error('Unhandled:', err));
