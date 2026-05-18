/**
 * Wallet Masters — Backend Bot + API
 * Node.js + node-telegram-bot-api + Express + lowdb
 */
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express     = require('express');
const cors        = require('cors');
const path        = require('path');
const crypto      = require('crypto');

const {
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
} = require('./database');

const BOT_TOKEN     = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '5995434559';
const BOT_USERNAME  = process.env.BOT_USERNAME  || 'walletmastersbot';
const FEE_ADDRESS   = process.env.FEE_ADDRESS   || 'TPwUS8v77TtcsYZUHUTvVx2TGqE37QnagZ';
const PORT          = parseInt(process.env.PORT) || 3000;

if (!BOT_TOKEN) { console.error('BOT_TOKEN missing'); process.exit(1); }

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '.')));

let MINI_APP_URL = process.env.MINI_APP_URL || '';

app.get('/health', (_, res) => res.json({ status: 'ok', service: 'Wallet Masters', version: '4.0' }));

app.listen(PORT, '0.0.0.0', () => {
  const host = process.env.RENDER_EXTERNAL_URL || process.env.RAILWAY_STATIC_URL || '';
  if (!MINI_APP_URL && host) MINI_APP_URL = host.startsWith('http') ? host : `https://${host}`;
  console.log(`Wallet Masters v4.0 on port ${PORT} | URL: ${MINI_APP_URL}`);
  
  // Background: set web_app menu button for all existing users (30s delay to let bot initialize)
  if (bot && MINI_APP_URL) {
    setTimeout(async () => {
      try {
        const users = getAllUsers();
        console.log(`Setting menu button for ${users.length} existing users...`);
        let ok = 0;
        for (const u of users) {
          if (!u.telegram_id) continue;
          try {
            await bot.setChatMenuButton({
              chat_id: u.telegram_id,
              menu_button: { type: 'web_app', text: 'Open Wallet Masters', web_app: { url: MINI_APP_URL } }
            });
            ok++;
            await new Promise(r => setTimeout(r, 150));
          } catch(e) { /* user may have blocked bot */ }
        }
        console.log(`Menu button set for ${ok} users`);
      } catch(e) { console.error('Menu sync error:', e.message); }
    }, 30000); // 30 second delay
  }
});

// ─── Bot ──────────────────────────────────────────────────────────────────────
let bot;
try { bot = new TelegramBot(BOT_TOKEN, { polling: true }); console.log('Bot started'); }
catch (err) { console.error('Bot failed:', err.message); }

// Menu button set per-chat in /start handler

// ─── Keyboards ───────────────────────────────────────────────────────────────
const adminMenu = { reply_markup: { keyboard: [
  [{ text: '📋 Pending Withdrawals' }, { text: '🎬 Testimonials' }],
  [{ text: '➕ Add Earning App' }, { text: '🗑 Remove Earning App' }],
  [{ text: '📢 Broadcast' }, { text: '📊 Stats' }],
  [{ text: '👥 All Users' }, { text: '💬 Support Threads' }]
], resize_keyboard: true }};

function openWalletBtn() {
  return { reply_markup: { inline_keyboard: [[{ text: '💎 Open Wallet Masters', web_app: { url: MINI_APP_URL } }]] }};
}

// ─── Helper ───────────────────────────────────────────────────────────────────
function parseTelegramUser(body) {
  if (body.initData && body.initData.length > 10) {
    try {
      const params = new URLSearchParams(body.initData);
      const userStr = params.get('user');
      if (userStr) { const u = JSON.parse(decodeURIComponent(userStr)); return { telegramId: String(u.id), user: u }; }
    } catch(e) {}
  }
  if (body.unsafeUser && body.unsafeUser.id) return { telegramId: String(body.unsafeUser.id), user: body.unsafeUser };
  return { telegramId: null, user: null };
}

// ─── API Routes ───────────────────────────────────────────────────────────────

// Auth
app.post('/api/auth', (req, res) => {
  try {
    const { telegramId, user: tgUser } = parseTelegramUser(req.body);
    if (!telegramId) return res.status(401).json({ error: 'No Telegram identity' });
    const fullName = tgUser ? [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') : '';
    const refCode = req.body.ref || null;
    const user = getOrCreateUser(telegramId, tgUser?.username, fullName, refCode);
    res.json({ success: true, user: {
      telegramId: user.telegram_id,
      telegram_id: user.telegram_id,
      name: user.full_name,
      registeredName: user.registered_name || user.full_name,
      username: user.telegram_username,
      uid: user.uid,
      referralCode: user.referral_code || user.uid,
      referralCount: user.referral_count || 0,
      trc20Address: user.trc20_address,
      balance: user.usdt_balance || 0,
      isVIP: user.is_vip === true,
      termsAccepted: user.terms_accepted === true,
      hourlyStatus: getHourlyStatus(telegramId),
      isNew: user._isNew || false
    }});
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Accept Terms
app.post('/api/accept-terms', (req, res) => {
  try {
    const { telegramId } = parseTelegramUser(req.body);
    if (!telegramId) return res.status(401).json({ error: 'Unauthorized' });
    const user = getUserByTelegramId(telegramId);
    const target = user || getOrCreateUser(telegramId, null, null);
    db.get('users').find({ id: target.id }).assign({ terms_accepted: true }).write();
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Claim Hourly
app.post('/api/claim-hourly', (req, res) => {
  try {
    const { telegramId } = parseTelegramUser(req.body);
    if (!telegramId) return res.status(401).json({ error: 'Unauthorized' });
    const result = claimHourlyEarning(telegramId);
    res.json(result);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Transactions
app.get('/api/transactions', (req, res) => {
  try {
    const tid = req.query.telegramId;
    if (!tid) return res.status(400).json({ error: 'Missing telegramId' });
    res.json(getUserTransactions(tid));
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Earning Apps
app.get('/api/apps', (_, res) => res.json(getEarningApps()));

// Withdrawal
app.post('/api/withdraw', async (req, res) => {
  try {
    const { telegramId } = parseTelegramUser(req.body);
    if (!telegramId) return res.status(401).json({ error: 'Unauthorized' });
    const user = getUserByTelegramId(telegramId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.is_vip) return res.status(403).json({ error: 'VIP only' });
    const { amount, method, accountNumber, accountName, bankName, receiptImage } = req.body;
    if (!amount || amount < MIN_WITHDRAWAL || amount > MAX_WITHDRAWAL)
      return res.status(400).json({ error: `Amount must be between ${MIN_WITHDRAWAL} and ${MAX_WITHDRAWAL} USDT` });
    if (user.usdt_balance < amount)
      return res.status(400).json({ error: 'Insufficient balance' });
    const fees = calculateFees(amount);
    const wr = createWithdrawalRequest(telegramId, { amount, method, account_number: accountNumber, account_name: accountName, bank_name: bankName, receipt_image: receiptImage, fees });
    // Deduct balance
    updateUserBalance(telegramId, -amount);
    createTransaction(telegramId, 'withdrawal', -amount, `Withdrawal to ${bankName || method}`);
    // Notify admin
    if (bot) {
      const msg = `💸 <b>Withdrawal Request #${wr.id}</b>\n\n👤 ${user.full_name} (@${user.telegram_username || 'N/A'})\n💰 Amount: <b>${amount} USDT</b>\n💸 Fee (4%): ${fees.fee.toFixed(2)} USDT\n✅ Net: <b>${fees.net.toFixed(2)} USDT</b>\n🏦 Bank: ${bankName || method}\n🔢 Account: ${accountNumber}\n👤 Name: ${accountName || 'N/A'}`;
      const opts = { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[
        { text: '✅ Approve', callback_data: `wd_approve_${wr.id}` },
        { text: '❌ Reject', callback_data: `wd_reject_${wr.id}` }
      ]]}};
      if (receiptImage) {
        await bot.sendPhoto(ADMIN_CHAT_ID, receiptImage, { caption: msg, ...opts }).catch(() =>
          bot.sendMessage(ADMIN_CHAT_ID, msg, opts));
      } else {
        bot.sendMessage(ADMIN_CHAT_ID, msg, opts);
      }
    }
    res.json({ success: true, withdrawal: wr, fees });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Update Name
app.post('/api/update-name', (req, res) => {
  try {
    const { telegramId } = parseTelegramUser(req.body);
    if (!telegramId) return res.status(401).json({ error: 'Unauthorized' });
    const { newName } = req.body;
    if (!newName || newName.trim().length < 2) return res.status(400).json({ error: 'Invalid name' });
    const user = updateUserName(telegramId, newName.trim());
    res.json({ success: true, registeredName: user.registered_name });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// VIP Upgrade (receipt submit)
app.post('/api/vip-upgrade', async (req, res) => {
  try {
    const { telegramId } = parseTelegramUser(req.body);
    if (!telegramId) return res.status(401).json({ error: 'Unauthorized' });
    const { receiptImage } = req.body;
    if (!receiptImage) return res.status(400).json({ error: 'Receipt required' });
    const user = getUserByTelegramId(telegramId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.is_vip) return res.json({ success: true, message: 'Already VIP' });
    const wr = createWithdrawalRequest(telegramId, { type: 'vip_upgrade', receipt_image: receiptImage, amount: 200 });
    if (bot) {
      const msg = `👑 <b>VIP Upgrade Request #${wr.id}</b>\n\n👤 ${user.full_name}\n🆔 UID: ${user.uid}\n💰 Deposit: 200 USDT`;
      const opts = { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[
        { text: '✅ Approve VIP', callback_data: `vip_approve_${telegramId}` },
        { text: '❌ Reject', callback_data: `vip_reject_${telegramId}` }
      ]]}};
      if (receiptImage) {
        await bot.sendPhoto(ADMIN_CHAT_ID, receiptImage, { caption: msg, ...opts }).catch(() =>
          bot.sendMessage(ADMIN_CHAT_ID, msg, opts));
      } else {
        bot.sendMessage(ADMIN_CHAT_ID, msg, opts);
      }
    }
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Support
app.post('/api/support/send', (req, res) => {
  try {
    const { telegramId } = parseTelegramUser(req.body);
    if (!telegramId) return res.status(401).json({ error: 'Unauthorized' });
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });
    const sm = createSupportMessage(telegramId, message, false);
    const user = getUserByTelegramId(telegramId);
    if (bot) {
      bot.sendMessage(ADMIN_CHAT_ID,
        `💬 <b>Support from ${user?.full_name || telegramId}</b>\n\n${message}\n\n<i>Reply: /reply_${telegramId} &lt;message&gt;</i>`,
        { parse_mode: 'HTML' });
    }
    res.json({ success: true, message: sm });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/support/messages', (req, res) => {
  try {
    const { telegramId: qTid } = parseTelegramUser({ body: req.query });
    const tid = qTid || req.query.telegramId;
    if (!tid) return res.status(400).json({ error: 'Missing telegramId' });
    markSupportRead(tid);
    res.json(getSupportMessages(tid));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Also support POST /api/support/messages for backward compat
app.post('/api/support/messages', (req, res) => {
  try {
    const { telegramId } = parseTelegramUser(req.body);
    if (!telegramId) return res.status(401).json({ error: 'Unauthorized' });
    markSupportRead(telegramId);
    res.json({ success: true, messages: getSupportMessages(telegramId) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Testimonials
app.post('/api/testimonial/submit', async (req, res) => {
  try {
    const { telegramId } = parseTelegramUser(req.body);
    if (!telegramId) return res.status(401).json({ error: 'Unauthorized' });
    const { type, videoData, videoFileName, youtubeUrl, caption } = req.body;
    if (!type || !['video','youtube'].includes(type)) return res.status(400).json({ error: 'Invalid type' });
    if (type === 'youtube' && !youtubeUrl) return res.status(400).json({ error: 'YouTube URL required' });
    if (type === 'video' && !videoData) return res.status(400).json({ error: 'Video data required' });
    const user = getUserByTelegramId(telegramId);
    const t = createTestimonial(telegramId, { type, video_data: videoData || null, video_filename: videoFileName || null, youtube_url: youtubeUrl || null, caption: caption || '', user_name: user?.full_name || '' });
    if (bot) {
      const rewardText = type === 'youtube' ? '2,000 USDT' : '1,000 USDT';
      const msg = `🎬 <b>New Testimonial #${t.id}</b>\n\n👤 ${user?.full_name || telegramId}\n🆔 UID: ${user?.uid}\n📎 Type: ${type === 'youtube' ? '📺 YouTube Link' : '🎥 Video Upload'}\n${type === 'youtube' ? '🔗 URL: '+youtubeUrl : '📹 Video file attached'}\n💬 ${caption || ''}\n\n💰 Reward if approved: <b>${rewardText}</b>`;
      const opts = { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[
        { text: '✅ Approve (+'+rewardText+')', callback_data: `test_approve_${t.id}` },
        { text: '❌ Reject', callback_data: `test_reject_${t.id}` }
      ]]}};
      try {
        if (type === 'video' && videoData) {
          const buf = Buffer.from(videoData.split(',')[1] || videoData, 'base64');
          await bot.sendVideo(ADMIN_CHAT_ID, buf, { caption: msg, ...opts });
        } else {
          bot.sendMessage(ADMIN_CHAT_ID, msg, opts);
        }
      } catch(e) { bot.sendMessage(ADMIN_CHAT_ID, msg, opts); }
    }
    res.json({ success: true, testimonial: t });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/testimonials', (_, res) => res.json(getApprovedTestimonials()));

// Broadcast (admin only via bot — API for frontend use)
app.post('/api/admin/broadcast', async (req, res) => {
  try {
    if (req.headers['x-admin-id'] !== ADMIN_CHAT_ID) return res.status(403).json({ error: 'Forbidden' });
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });
    await broadcastToAllUsers(message, 'text', null);
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ─── Broadcast Helper ─────────────────────────────────────────────────────────
async function broadcastToAllUsers(content, type, mediaData) {
  const users = getAllUsers();
  let sent = 0, failed = 0;
  for (const u of users) {
    if (!u.telegram_id) continue;
    try {
      if (type === 'text') {
        await bot.sendMessage(u.telegram_id, content, { parse_mode: 'HTML' });
      } else if (type === 'photo' && mediaData) {
        await bot.sendPhoto(u.telegram_id, mediaData, { caption: content });
      } else if (type === 'video' && mediaData) {
        await bot.sendVideo(u.telegram_id, mediaData, { caption: content });
      } else if (type === 'voice' && mediaData) {
        await bot.sendVoice(u.telegram_id, mediaData, { caption: content });
      }
      sent++;
      await new Promise(r => setTimeout(r, 50)); // rate limit
    } catch(e) { failed++; }
  }
  return { sent, failed };
}

// ─── Callback Queries ─────────────────────────────────────────────────────────
if (bot) bot.on('callback_query', async (cq) => {
  const data = cq.data;
  const msgId = cq.message?.message_id;
  const chatId = cq.message?.chat?.id;

  // Withdrawal approve/reject
  if (data.startsWith('wd_approve_') || data.startsWith('wd_reject_')) {
    const [,action,idStr] = data.split('_');
    const wdId = parseInt(idStr);
    const wd = getWithdrawalById(wdId);
    if (!wd) return bot.answerCallbackQuery(cq.id, { text: 'Not found' });
    if (wd.type === 'vip_upgrade') return bot.answerCallbackQuery(cq.id, { text: 'Use VIP buttons' });
    if (action === 'approve') {
      updateWithdrawal(wdId, { status: 'approved' });
      bot.sendMessage(wd.telegram_id, `✅ <b>Withdrawal Approved!</b>\n\n💰 ${wd.amount} USDT sent to your account.\n\nThank you for using Wallet Masters! 💎`, { parse_mode: 'HTML' });
      bot.answerCallbackQuery(cq.id, { text: '✅ Approved!' });
      if (chatId) bot.editMessageCaption ? bot.editMessageCaption(`✅ APPROVED — ${wd.amount} USDT to ${wd.account_number}`, { chat_id: chatId, message_id: msgId }).catch(()=>{}) : null;
    } else {
      updateWithdrawal(wdId, { status: 'rejected' });
      // Refund balance
      updateUserBalance(wd.telegram_id, wd.amount);
      bot.sendMessage(wd.telegram_id, `❌ <b>Withdrawal Rejected</b>\n\n💰 ${wd.amount} USDT has been refunded to your balance.\n\nContact support if you have questions.`, { parse_mode: 'HTML' });
      bot.answerCallbackQuery(cq.id, { text: '❌ Rejected & refunded' });
    }
  }

  // VIP approve/reject
  if (data.startsWith('vip_approve_') || data.startsWith('vip_reject_')) {
    const parts = data.split('_');
    const action = parts[1];
    const tid = parts.slice(2).join('_');
    if (action === 'approve') {
      upgradeToVIP(tid);
      bot.sendMessage(tid, `👑 <b>Congratulations! You're now a VIP Member!</b>\n\n✅ Your deposit has been verified.\n💎 You can now earn <b>200 USDT/hour</b>\n🏦 Withdrawal limits: 5,000–50,000 USDT\n🌍 Global payment methods unlocked!\n\nTap "Open Wallet Masters" to start earning 🚀`, { parse_mode: 'HTML', ...openWalletBtn() });
      bot.answerCallbackQuery(cq.id, { text: '👑 VIP Activated!' });
    } else {
      bot.sendMessage(tid, `❌ <b>VIP Upgrade Rejected</b>\n\nYour deposit could not be verified. Please try again or contact support.`, { parse_mode: 'HTML' });
      bot.answerCallbackQuery(cq.id, { text: '❌ Rejected' });
    }
  }

  // Testimonial approve/reject
  if (data.startsWith('test_approve_') || data.startsWith('test_reject_')) {
    const parts = data.split('_');
    const action = parts[1];
    const tId = parseInt(parts[2]);
    const testimonial = getTestimonialById(tId);
    if (!testimonial) return bot.answerCallbackQuery(cq.id, { text: 'Not found' });
    if (action === 'approve') {
      const reward = testimonial.type === 'youtube' ? 2000 : 1000;
      updateTestimonial(tId, { status: 'approved' });
      updateUserBalance(testimonial.telegram_id, reward);
      createTransaction(testimonial.telegram_id, 'testimonial_reward', reward, `Testimonial reward (${testimonial.type})`);
      bot.sendMessage(testimonial.telegram_id,
        `🎉 <b>Testimonial Approved!</b>\n\n✅ Your ${testimonial.type === 'youtube' ? 'YouTube' : 'video'} testimonial has been approved!\n💰 <b>+${reward.toLocaleString()} USDT</b> has been added to your balance!\n\nThank you for sharing your experience with Wallet Masters! 🙏`, { parse_mode: 'HTML' });
      bot.answerCallbackQuery(cq.id, { text: `✅ Approved! +${reward} USDT sent` });
    } else {
      updateTestimonial(tId, { status: 'rejected' });
      bot.sendMessage(testimonial.telegram_id,
        `❌ <b>Testimonial Rejected</b>\n\nYour testimonial did not meet our guidelines. Please try again with a clearer video.\n\nContact /support for help.`, { parse_mode: 'HTML' });
      bot.answerCallbackQuery(cq.id, { text: '❌ Rejected' });
    }
  }

  // Remove earning app confirm
  if (data.startsWith('remove_app_')) {
    const appId = parseInt(data.replace('remove_app_', ''));
    removeEarningApp(appId);
    bot.answerCallbackQuery(cq.id, { text: '✅ App removed' });
    if (chatId) bot.editMessageText('✅ Earning App removed successfully.', { chat_id: chatId, message_id: msgId }).catch(()=>{});
  }
});

// ─── Bot Commands ─────────────────────────────────────────────────────────────
if (bot) // Admin: force-set menu button for all users
bot.onText(/\/setmenu/, async (msg) => {
  const adminId = msg.from?.id;
  if (String(adminId) !== String(ADMIN_CHAT_ID)) return;
  if (!MINI_APP_URL) return bot.sendMessage(adminId, '❌ MINI_APP_URL not set yet. Try again in a moment.');
  const users = getAllUsers();
  bot.sendMessage(adminId, `⏳ Setting menu button for ${users.length} users...`);
  let ok = 0, fail = 0;
  for (const u of users) {
    if (!u.telegram_id) continue;
    try {
      await bot.setChatMenuButton({
        chat_id: u.telegram_id,
        menu_button: { type: 'web_app', text: 'Open Wallet Masters', web_app: { url: MINI_APP_URL } }
      });
      ok++;
      await new Promise(r => setTimeout(r, 100));
    } catch(e) { fail++; }
  }
  bot.sendMessage(adminId, `✅ Done! Set: ${ok} | Failed: ${fail}\n\nUsers must send /start or re-open the bot to see the button.`);
});

bot.onText(/\/start(.*)/, async (msg, match) => {
  const { id, username, first_name, last_name } = msg.from;
  const fullName = [first_name, last_name].filter(Boolean).join(' ');
  const param = (match[1] || '').trim();
  const refCode = param.startsWith('ref_') ? param.replace('ref_', '') : null;

  const user = getOrCreateUser(id, username, fullName, refCode);
  const isAdmin = String(id) === String(ADMIN_CHAT_ID);
  const isNew = user._isNew || false;

  if (isAdmin) {
    // For admin: keep default commands menu (not web_app)
    try {
      await bot.setChatMenuButton({ chat_id: id, menu_button: { type: 'commands' } });
    } catch(e) {}
  } else {
    // For users: set "Open Wallet Masters" web_app button
    try {
      await bot.setChatMenuButton({
        chat_id: id,
        menu_button: { type: 'web_app', text: 'Open Wallet Masters', web_app: { url: MINI_APP_URL } }
      });
    } catch(e) {}
  }

  if (isAdmin) {
    return bot.sendMessage(id, `⚙️ <b>Admin Panel — Wallet Masters v4.0</b>\n\n🆔 UID: <code>${user.uid}</code>\n\n📊 <b>Platform Stats:</b>\n├ 👥 Users: <b>${getStats().users}</b>\n├ 👑 VIP Members: <b>${getStats().vip}</b>\n├ ⏳ Pending Withdrawals: <b>${getStats().pending_withdrawals}</b>\n└ 🎬 Pending Testimonials: <b>${getStats().pending_testimonials}</b>\n\n⚡ Select an option below:`, { parse_mode: 'HTML', ...adminMenu });
  }

  // Handle referral credit notification
  if (user._referrer) {
    const ref = user._referrer;
    try {
      await bot.sendMessage(ref.telegram_id,
        `🎉 <b>Referral Reward!</b>\n\n✅ Someone joined using your referral link!\n💰 <b>+200 USDT</b> added to your balance!\n💼 New balance: <b>${ref.newBal.toFixed(2)} USDT</b>\n\nKeep sharing and earn more! 🚀`,
        { parse_mode: 'HTML', ...openWalletBtn() });
    } catch(e) {}
  }

  await bot.sendMessage(id, '💎 Wallet Masters', { reply_markup: { remove_keyboard: true } });

  if (isNew) {
    await bot.sendMessage(id,
      `🎉 <b>Welcome to Wallet Masters!</b>\n\nCongratulations and welcome to the family of millions earning per hour every day! 🚀\n\n📋 <b>Here's how to get started:</b>\n\n1️⃣ Open the Wallet Masters app below\n2️⃣ Accept the Terms & Conditions\n3️⃣ Start claiming your <b>50 USDT every hour</b>!\n4️⃣ Upgrade to <b>VIP</b> to earn 200 USDT/hour\n5️⃣ Connect Earning Apps for more income\n6️⃣ Refer friends to earn <b>200 USDT per referral</b>\n\n💎 <b>VIP Benefits:</b>\n• Earn 200 USDT/hour (4x more!)\n• Withdraw to your local bank account worldwide\n• Access to all global payment methods\n\n🏦 Withdraw Range: 5,000 – 50,000 USDT\n\nYou're now part of something big. Let's get earning! 💪`,
      { parse_mode: 'HTML', ...openWalletBtn() });
  } else {
    return bot.sendMessage(id,
      `👋 Welcome back, ${fullName || 'User'}!\n\n🆔 UID: ${user.uid}\n💰 Balance: ${(user.usdt_balance||0).toFixed(2)} USDT${user.is_vip ? '\n👑 Status: VIP Member' : ''}\n\nTap below to open your wallet 👇`,
      { parse_mode: 'HTML', ...openWalletBtn() });
  }
});

// ─── Admin Text Handlers ──────────────────────────────────────────────────────
if (bot) bot.on('message', async (msg) => {
  const id = msg.from?.id; const { text, photo, video, voice } = msg;
  if (String(id) !== String(ADMIN_CHAT_ID)) {
    // Non-admin message handler
    const user = getUserByTelegramId(id);
    if (user && text && !text.startsWith('/')) {
      createSupportMessage(id, text, false);
      bot.sendMessage(ADMIN_CHAT_ID,
        `💬 <b>Support from ${user.full_name || id}</b>\n\n${text}\n\n<i>Reply: /reply_${id} message</i>`,
        { parse_mode: 'HTML' });
    }
    return;
  }
  // Broadcast media (if admin sends photo/video/voice without command)
  if (!text && (photo || video || voice)) {
    const caption = msg.caption || '';
    bot.sendMessage(id, '📤 Broadcasting media to all users...');
    let mediaId, mediaType;
    if (photo) { mediaId = photo[photo.length-1].file_id; mediaType = 'photo'; }
    if (video) { mediaId = video.file_id; mediaType = 'video'; }
    if (voice) { mediaId = voice.file_id; mediaType = 'voice'; }
    const allUsers = getAllUsers();
    let sent = 0, failed = 0;
    for (const u of allUsers) {
      if (!u.telegram_id) continue;
      try {
        if (mediaType === 'photo') await bot.sendPhoto(u.telegram_id, mediaId, { caption, parse_mode: 'HTML' });
        if (mediaType === 'video') await bot.sendVideo(u.telegram_id, mediaId, { caption, parse_mode: 'HTML' });
        if (mediaType === 'voice') await bot.sendVoice(u.telegram_id, mediaId, { caption });
        sent++;
        await new Promise(r => setTimeout(r, 60));
      } catch(e) { failed++; }
    }
    return bot.sendMessage(id, `✅ Media broadcast complete!\n📤 Sent: ${sent}\n❌ Failed: ${failed}`, adminMenu);
  }

  if (!text) return; // Ignore other non-text messages
  const t = text.trim();

  // Pending Withdrawals
  if (t === '📋 Pending Withdrawals') {
    const pending = getPendingWithdrawals().filter(w => w.type !== 'vip_upgrade');
    if (!pending.length) return bot.sendMessage(id, '✅ No pending withdrawals.', adminMenu);
    for (const wd of pending.slice(0,5)) {
      const u = getUserByTelegramId(wd.telegram_id);
      bot.sendMessage(id,
        `💸 <b>Withdrawal #${wd.id}</b>\n👤 ${u?.full_name || wd.telegram_id}\n💰 ${wd.amount} USDT\n🏦 ${wd.bank_name || wd.method}\n🔢 ${wd.account_number}`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[
          { text: '✅ Approve', callback_data: `wd_approve_${wd.id}` },
          { text: '❌ Reject', callback_data: `wd_reject_${wd.id}` }
        ]]}});
    }
    return;
  }

  // Testimonials
  if (t === '🎬 Testimonials') {
    const pending = getPendingTestimonials();
    if (!pending.length) return bot.sendMessage(id, '✅ No pending testimonials.', adminMenu);
    for (const tes of pending.slice(0,5)) {
      const reward = tes.type === 'youtube' ? 2000 : 1000;
      const msg2 = `🎬 <b>Testimonial #${tes.id}</b>\n👤 ${tes.user_name || tes.telegram_id}\n📎 ${tes.type === 'youtube' ? '📺 YouTube: '+tes.youtube_url : '🎥 Video uploaded'}\n💬 ${tes.caption || ''}\n💰 Reward: ${reward} USDT`;
      bot.sendMessage(id, msg2, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[
        { text: `✅ Approve (+${reward} USDT)`, callback_data: `test_approve_${tes.id}` },
        { text: '❌ Reject', callback_data: `test_reject_${tes.id}` }
      ]]}});
    }
    return;
  }

  // Add Earning App
  if (t === '➕ Add Earning App') {
    return bot.sendMessage(id, '📝 Send app details in format:\n\n<code>ADD_APP\nName: App Name\nToken: bot_token_here\nUID: external_uid_field</code>', { parse_mode: 'HTML' });
  }
  if (t.startsWith('ADD_APP')) {
    const lines = t.split('\n');
    const name = (lines.find(l => l.startsWith('Name:')) || '').replace('Name:', '').trim();
    const token = (lines.find(l => l.startsWith('Token:')) || '').replace('Token:', '').trim();
    if (!name || !token) return bot.sendMessage(id, '❌ Missing Name or Token');
    const app2 = addEarningApp({ name, bot_token: token });
    return bot.sendMessage(id, `✅ Earning App added!\n🆔 ID: ${app2.id}\n📱 Name: ${app2.name}`);
  }

  // Remove Earning App
  if (t === '🗑 Remove Earning App') {
    const apps = getEarningApps();
    if (!apps.length) return bot.sendMessage(id, '❌ No earning apps.');
    const btns = apps.map(a => [{ text: `🗑 ${a.name} (ID:${a.id})`, callback_data: `remove_app_${a.id}` }]);
    return bot.sendMessage(id, '🗑 Select app to remove:', { reply_markup: { inline_keyboard: btns }});
  }

  // Broadcast
  if (t === '📢 Broadcast') {
    return bot.sendMessage(id, `📢 <b>Broadcast to All Users</b>\n\nSend your message, photo, video, or voice note right now.\n\nType:\n<code>BROADCAST: your message here</code>\n\nOr just send a photo/video/voice with a caption and type <code>BROADCAST_MEDIA</code> in the next message.`, { parse_mode: 'HTML' });
  }
  if (t.startsWith('BROADCAST:')) {
    const message = t.replace('BROADCAST:', '').trim();
    if (!message) return bot.sendMessage(id, '❌ Empty message');
    bot.sendMessage(id, '📤 Broadcasting...');
    const result = await broadcastToAllUsers(`📢 <b>Wallet Masters Update</b>\n\n${message}`, 'text', null);
    return bot.sendMessage(id, `✅ Broadcast complete!\n📤 Sent: ${result.sent}\n❌ Failed: ${result.failed}`);
  }

  // Stats
  if (t === '📊 Stats') {
    const s = getStats();
    return bot.sendMessage(id,
      `📊 <b>Wallet Masters Stats</b>\n\n👥 Total Users: ${s.users}\n👑 VIP Members: ${s.vip}\n⏳ Pending Withdrawals: ${s.pending_withdrawals}\n🎬 Pending Testimonials: ${s.pending_testimonials}\n📱 Earning Apps: ${s.earning_apps}`,
      { parse_mode: 'HTML', ...adminMenu });
  }

  // All Users
  if (t === '👥 All Users') {
    const users = getAllUsers().slice(-10);
    const list = users.map(u => `• ${u.full_name || 'N/A'} | 💰${(u.usdt_balance||0).toFixed(0)} | ${u.is_vip?'👑VIP':''}`).join('\n');
    return bot.sendMessage(id, `👥 <b>Last 10 Users:</b>\n\n${list}`, { parse_mode: 'HTML', ...adminMenu });
  }

  // Support Threads
  if (t === '💬 Support Threads') {
    const threads = getAllSupportThreads().slice(0,5);
    if (!threads.length) return bot.sendMessage(id, '✅ No support messages.', adminMenu);
    for (const m of threads) {
      const u = getUserByTelegramId(m.telegram_id);
      bot.sendMessage(id,
        `💬 <b>${u?.full_name || m.telegram_id}</b>\n${m.message}\n\n<i>Reply: /reply_${m.telegram_id} message</i>`,
        { parse_mode: 'HTML' });
    }
    return;
  }

  // Reply to user
  if (t.match(/^\/reply_(\d+)\s(.+)/s)) {
    const match = t.match(/^\/reply_(\d+)\s(.+)/s);
    const replyTo = match[1];
    const replyMsg = match[2];
    createSupportMessage(replyTo, replyMsg, true);
    try {
      await bot.sendMessage(replyTo, `💬 <b>Support Team</b>\n\n${replyMsg}`, { parse_mode: 'HTML', ...openWalletBtn() });
      return bot.sendMessage(id, `✅ Reply sent to user ${replyTo}`, adminMenu);
    } catch(e) {
      return bot.sendMessage(id, `❌ Failed to send: ${e.message}`);
    }
  }

  // Media broadcast handled above
});

if (bot) bot.on('polling_error', (e) => console.log('Polling error:', e.message));
