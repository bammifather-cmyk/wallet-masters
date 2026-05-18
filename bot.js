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

// Always use the known Railway URL as fallback
let MINI_APP_URL = process.env.MINI_APP_URL || 'https://web-production-a3b658.up.railway.app';

app.get('/health', (_, res) => res.json({ status: 'ok', service: 'Wallet Masters', version: '4.0' }));

app.listen(PORT, '0.0.0.0', () => {
  const host = process.env.RENDER_EXTERNAL_URL || process.env.RAILWAY_STATIC_URL || '';
  if (host) MINI_APP_URL = host.startsWith('http') ? host : `https://${host}`;
  console.log(`Wallet Masters v4.0 on port ${PORT} | URL: ${MINI_APP_URL}`);
});

// ─── Bot Init ─────────────────────────────────────────────────────────────────
let bot;
try { bot = new TelegramBot(BOT_TOKEN, { polling: true }); console.log('Bot started'); }
catch (err) { console.error('Bot failed:', err.message); }

// ─── Startup: Clear commands + set menu button for all known users ────────────
setTimeout(async () => {
  if (!bot) return;
  try { await bot.setMyCommands([]); console.log('Bot commands cleared'); } catch(e) {}

    // Set admin menu button at startup
  setMenuButton(ADMIN_CHAT_ID).catch(() => {});

  // Set Wallet Masters button for all existing users (delayed to avoid rate limit)
  setTimeout(async () => {
    const users = getAllUsers();
    let ok = 0;
    for (const u of users) {
      try {
        await setMenuButton(u.telegram_id);
        ok++;
        await new Promise(r => setTimeout(r, 200));
      } catch(e) {}
    }
    console.log(`Menu button synced for ${ok} users on startup`);
  }, 5000);
}, 3000);

// ─── Helpers ──────────────────────────────────────────────────────────────────
// The 2-column admin panel keyboard - shown by tapping the ⊞ grid icon
const ADMIN_KEYBOARD = {
  inline_keyboard: [
    [{ text: '📋 Withdrawals', callback_data: 'admin_withdrawals' }, { text: '🎬 Testimonials', callback_data: 'admin_testimonials' }],
    [{ text: '➕ Add App',     callback_data: 'admin_add_app'     }, { text: '🗑 Remove App',   callback_data: 'admin_remove_app'   }],
    [{ text: '📢 Broadcast',   callback_data: 'admin_broadcast'   }, { text: '📊 Stats',        callback_data: 'admin_stats'        }],
    [{ text: '👥 All Users',   callback_data: 'admin_all_users'   }, { text: '💬 Support',      callback_data: 'admin_support'      }]
  ]
};

// Open Wallet Masters button for regular users
function openWalletBtn() {
  return {
    reply_markup: {
      inline_keyboard: [[
        { text: '💎 Open Wallet Masters', web_app: { url: MINI_APP_URL } }
      ]]
    }
  };
}

// Set Wallet Masters web_app menu button for a user
async function setMenuButton(chatId) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setChatMenuButton`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        menu_button: { type: 'web_app', text: 'Wallet Masters', web_app: { url: MINI_APP_URL } }
      })
    });
    const json = await res.json();
    if (!json.ok) console.log(`setMenuButton(${chatId}) failed:`, json.description);
  } catch(e) { console.log(`setMenuButton(${chatId}) error:`, e.message); }
}

// Broadcast a text message to all users
async function broadcastToAll(text) {
  const users = getAllUsers();
  let sent = 0, failed = 0;
  for (const u of users) {
    if (!u.telegram_id) continue;
    try {
      await bot.sendMessage(u.telegram_id, text, { parse_mode: 'HTML', ...openWalletBtn() });
      sent++;
      await new Promise(r => setTimeout(r, 60));
    } catch(e) { failed++; }
  }
  return { sent, failed };
}

// ─── /setmenu command (admin force-sync) ─────────────────────────────────────
if (bot) bot.onText(/\/setmenu/, async (msg) => {
  const adminId = String(msg.from?.id);
  if (adminId !== String(ADMIN_CHAT_ID)) return;
  const users = getAllUsers();
  const allIds = [...users.map(u => String(u.telegram_id)), String(ADMIN_CHAT_ID)].filter(Boolean);
  bot.sendMessage(adminId, `⏳ Setting Wallet Masters button for ${allIds.length} users...`);
  let ok = 0, fail = 0;
  for (const tid of allIds) {
    try {
      await setMenuButton(tid);
      ok++;
      await new Promise(r => setTimeout(r, 100));
    } catch(e) { fail++; }
  }
  bot.sendMessage(adminId, `✅ Done! Set: ${ok} | Failed: ${fail}\n\nClose and reopen bot chat to see the button.`);
});

// ─── /start ──────────────────────────────────────────────────────────────────
if (bot) bot.onText(/\/start(.*)/, async (msg, match) => {
  const { id, username, first_name, last_name } = msg.from;
  const fullName = [first_name, last_name].filter(Boolean).join(' ');
  const param    = (match[1] || '').trim();
  const refCode  = param.startsWith('ref_') ? param.replace('ref_', '') : null;
  const isAdmin  = String(id) === String(ADMIN_CHAT_ID);

  const user  = getOrCreateUser(id, username, fullName, refCode);
  const isNew = user._isNew || false;

  // Always set Wallet Masters button for this user
  await setMenuButton(id);

  if (isAdmin) {
    // Remove any old floating keyboard
    await bot.sendMessage(id,
      '⚙️ <b>Admin Panel ready.</b>\n\nYour <b>Wallet Masters</b> button is now set on the left side. If you don\'t see it yet, close and reopen this chat.\n\nUse the buttons below anytime:',
      { parse_mode: 'HTML', reply_markup: ADMIN_KEYBOARD }
    );
    return;
  }

  // Referral reward notification
  if (user._referrer) {
    try {
      await bot.sendMessage(user._referrer.telegram_id,
        `🎉 <b>Referral Reward!</b>\n\n✅ Someone joined using your link!\n💰 <b>+200 USDT</b> added to your balance!\n💼 New balance: <b>${user._referrer.newBal.toFixed(2)} USDT</b>\n\nKeep sharing and earn more! 🚀`,
        { parse_mode: 'HTML', ...openWalletBtn() });
    } catch(e) {}
  }

  // Remove old keyboard
  await bot.sendMessage(id, '💎 Wallet Masters', { reply_markup: { remove_keyboard: true } });

  if (isNew) {
    return bot.sendMessage(id,
      `🎉 <b>Welcome to Wallet Masters!</b>\n\nCongratulations and welcome to the family of millions earning per hour every day! 🚀\n\n📋 <b>Here's how to get started:</b>\n\n1️⃣ Open the Wallet Masters app using the button below\n2️⃣ Accept the Terms & Conditions\n3️⃣ Start claiming your <b>50 USDT every hour</b>!\n4️⃣ Upgrade to <b>VIP</b> to earn 200 USDT/hour\n5️⃣ Connect Earning Apps for more income\n6️⃣ Refer friends to earn <b>200 USDT per referral</b>\n\n💎 <b>VIP Benefits:</b>\n• Earn 200 USDT/hour (4x more!)\n• Withdraw to your local bank worldwide\n• Access to all global payment methods\n\n🏦 Withdraw Range: 5,000 – 50,000 USDT\n\nYou're now part of something big. Let's get earning! 💪`,
      { parse_mode: 'HTML', ...openWalletBtn() }
    );
  } else {
    return bot.sendMessage(id,
      `👋 Welcome back, <b>${fullName || 'User'}</b>!\n\n🆔 UID: <code>${user.uid}</code>\n💰 Balance: <b>${(user.usdt_balance||0).toFixed(2)} USDT</b>${user.is_vip ? '\n👑 Status: VIP Member' : ''}\n\nTap below to open your wallet 👇`,
      { parse_mode: 'HTML', ...openWalletBtn() }
    );
  }
});

// ─── callback_query handler ───────────────────────────────────────────────────
if (bot) bot.on('callback_query', async (cq) => {
  const data   = cq.data || '';
  const chatId = cq.message?.chat?.id;
  const msgId  = cq.message?.message_id;
  const isAdmin = String(chatId) === String(ADMIN_CHAT_ID);

  // ── Withdrawal approve/reject ──────────────────────────────────────────────
  if (data.startsWith('wd_approve_') || data.startsWith('wd_reject_')) {
    if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
    const parts  = data.split('_');
    const action = parts[1];           // 'approve' | 'reject'
    const wdId   = parseInt(parts[2]);
    const wd     = getWithdrawalById(wdId);
    if (!wd) return bot.answerCallbackQuery(cq.id, { text: '❌ Not found' });

    if (action === 'approve') {
      updateWithdrawal(wdId, { status: 'approved' });
      bot.sendMessage(wd.telegram_id,
        `✅ <b>Withdrawal Approved!</b>\n\n💰 ${wd.amount} USDT has been sent to your account.\n\nThank you for using Wallet Masters! 💎`,
        { parse_mode: 'HTML', ...openWalletBtn() });
      bot.answerCallbackQuery(cq.id, { text: '✅ Approved!' });
      bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId }).catch(() => {});
    } else {
      updateWithdrawal(wdId, { status: 'rejected' });
      updateUserBalance(wd.telegram_id, wd.amount);
      bot.sendMessage(wd.telegram_id,
        `❌ <b>Withdrawal Rejected</b>\n\n💰 ${wd.amount} USDT has been refunded to your balance.\n\nContact support if you have questions.`,
        { parse_mode: 'HTML', ...openWalletBtn() });
      bot.answerCallbackQuery(cq.id, { text: '❌ Rejected & refunded' });
      bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId }).catch(() => {});
    }
    return;
  }

  // ── VIP approve/reject ────────────────────────────────────────────────────
  if (data.startsWith('vip_approve_') || data.startsWith('vip_reject_')) {
    if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
    const parts  = data.split('_');
    const action = parts[1];
    const tid    = parts.slice(2).join('_');

    if (action === 'approve') {
      upgradeToVIP(tid);
      bot.sendMessage(tid,
        `👑 <b>Congratulations! You're now a VIP Member!</b>\n\n✅ Your deposit has been verified.\n💎 You now earn <b>200 USDT/hour</b>\n🏦 Withdrawal limits: 5,000 – 50,000 USDT\n🌍 Global payment methods unlocked!\n\nTap below to start earning 🚀`,
        { parse_mode: 'HTML', ...openWalletBtn() });
      bot.answerCallbackQuery(cq.id, { text: '👑 VIP Activated!' });
    } else {
      bot.sendMessage(tid,
        `❌ <b>VIP Upgrade Rejected</b>\n\nYour deposit could not be verified. Please try again or contact support.`,
        { parse_mode: 'HTML', ...openWalletBtn() });
      bot.answerCallbackQuery(cq.id, { text: '❌ Rejected' });
    }
    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId }).catch(() => {});
    return;
  }

  // ── Testimonial approve/reject ────────────────────────────────────────────
  if (data.startsWith('test_approve_') || data.startsWith('test_reject_')) {
    if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
    const parts  = data.split('_');
    const action = parts[1];
    const tId    = parseInt(parts[2]);
    const tes    = getTestimonialById(tId);
    if (!tes) return bot.answerCallbackQuery(cq.id, { text: '❌ Not found' });

    if (action === 'approve') {
      const reward = tes.type === 'youtube' ? 2000 : 1000;
      updateTestimonial(tId, { status: 'approved' });
      updateUserBalance(tes.telegram_id, reward);
      createTransaction(tes.telegram_id, 'testimonial_reward', reward, `Testimonial reward (${tes.type})`);
      bot.sendMessage(tes.telegram_id,
        `🎉 <b>Testimonial Approved!</b>\n\n✅ Your ${tes.type === 'youtube' ? 'YouTube' : 'video'} testimonial has been approved!\n💰 <b>+${reward.toLocaleString()} USDT</b> added to your balance!\n\nThank you for sharing your experience! 🙏`,
        { parse_mode: 'HTML', ...openWalletBtn() });
      bot.answerCallbackQuery(cq.id, { text: `✅ Approved! +${reward} USDT sent` });
    } else {
      updateTestimonial(tId, { status: 'rejected' });
      bot.sendMessage(tes.telegram_id,
        `❌ <b>Testimonial Rejected</b>\n\nYour testimonial did not meet our guidelines. Please try again with a clearer video.`,
        { parse_mode: 'HTML', ...openWalletBtn() });
      bot.answerCallbackQuery(cq.id, { text: '❌ Rejected' });
    }
    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId }).catch(() => {});
    return;
  }

  // ── Remove app confirm ────────────────────────────────────────────────────
  if (data.startsWith('remove_app_')) {
    if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
    const appId = parseInt(data.replace('remove_app_', ''));
    removeEarningApp(appId);
    bot.answerCallbackQuery(cq.id, { text: '✅ App removed' });
    bot.editMessageText('✅ Earning App removed successfully.', { chat_id: chatId, message_id: msgId }).catch(() => {});
    return;
  }

  // ── Support Reply button ──────────────────────────────────────────────────
  // When admin taps "Reply" under a support message
  if (data.startsWith('reply_user_')) {
    if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
    const tid      = data.replace('reply_user_', '');
    const u        = getUserByTelegramId(tid);
    const userName = u?.full_name || tid;
    const uid      = u?.uid || tid;
    bot.answerCallbackQuery(cq.id);
    // Tell admin to type their reply
    return bot.sendMessage(chatId,
      `💬 <b>Replying to: ${userName}</b> [TID:${tid}]\n🆔 UID: <code>${uid}</code>\n\n<b>Type your reply:</b>`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          force_reply: true,
          input_field_placeholder: `Your reply to ${userName}...`
        }
      }
    );
  }

  // ─── ADMIN PANEL GRID BUTTONS ─────────────────────────────────────────────
  // These fire when admin taps the ⊞ grid buttons

  if (data === 'admin_withdrawals') {
    bot.answerCallbackQuery(cq.id);
    const pending = getPendingWithdrawals().filter(w => w.type !== 'vip_upgrade');
    if (!pending.length) {
      return bot.sendMessage(chatId, '✅ No pending withdrawals.', { reply_markup: ADMIN_KEYBOARD });
    }
    for (const wd of pending.slice(0, 5)) {
      const u = getUserByTelegramId(wd.telegram_id);
      await bot.sendMessage(chatId,
        `💸 <b>Withdrawal #${wd.id}</b>\n👤 ${u?.full_name || wd.telegram_id}\n💰 ${wd.amount} USDT\n🏦 ${wd.bank_name || wd.method || 'N/A'}\n🔢 ${wd.account_number || 'N/A'}`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[
          { text: '✅ Approve', callback_data: `wd_approve_${wd.id}` },
          { text: '❌ Reject',  callback_data: `wd_reject_${wd.id}`  }
        ]]}}
      );
    }
    return bot.sendMessage(chatId,
      `📋 Showing ${Math.min(pending.length, 5)} of ${pending.length} pending withdrawals.`,
      { reply_markup: ADMIN_KEYBOARD }
    );
  }

  if (data === 'admin_testimonials') {
    bot.answerCallbackQuery(cq.id);
    const pending = getPendingTestimonials();
    if (!pending.length) {
      return bot.sendMessage(chatId, '✅ No pending testimonials.', { reply_markup: ADMIN_KEYBOARD });
    }
    for (const tes of pending.slice(0, 5)) {
      const reward = tes.type === 'youtube' ? 2000 : 1000;
      await bot.sendMessage(chatId,
        `🎬 <b>Testimonial #${tes.id}</b>\n👤 ${tes.user_name || tes.telegram_id}\n📎 ${tes.type === 'youtube' ? '📺 YouTube: ' + tes.youtube_url : '🎥 Video uploaded'}\n💬 ${tes.caption || ''}\n💰 Reward: ${reward} USDT`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[
          { text: `✅ Approve (+${reward} USDT)`, callback_data: `test_approve_${tes.id}` },
          { text: '❌ Reject',                    callback_data: `test_reject_${tes.id}`  }
        ]]}}
      );
    }
    return bot.sendMessage(chatId,
      `🎬 Showing ${Math.min(pending.length, 5)} of ${pending.length} pending testimonials.`,
      { reply_markup: ADMIN_KEYBOARD }
    );
  }

  if (data === 'admin_add_app') {
    bot.answerCallbackQuery(cq.id);
    return bot.sendMessage(chatId,
      '📝 <b>Add Earning App</b>\n\nSend app details in this format:\n\n<code>ADD_APP\nName: App Name\nToken: bot_token_here</code>',
      { parse_mode: 'HTML', reply_markup: ADMIN_KEYBOARD }
    );
  }

  if (data === 'admin_remove_app') {
    bot.answerCallbackQuery(cq.id);
    const apps = getEarningApps();
    if (!apps.length) return bot.sendMessage(chatId, '❌ No earning apps to remove.', { reply_markup: ADMIN_KEYBOARD });
    const btns = apps.map(a => [{ text: `🗑 ${a.name}`, callback_data: `remove_app_${a.id}` }]);
    btns.push([{ text: '⬅️ Back', callback_data: 'admin_back' }]);
    return bot.sendMessage(chatId, '🗑 <b>Select app to remove:</b>', { parse_mode: 'HTML', reply_markup: { inline_keyboard: btns } });
  }

  if (data === 'admin_broadcast') {
    bot.answerCallbackQuery(cq.id);
    return bot.sendMessage(chatId,
      '📢 <b>Broadcast to All Users</b>\n\nSend your message in this format:\n\n<code>BROADCAST: your message here</code>\n\nOr send a photo/video with a caption.',
      { parse_mode: 'HTML', reply_markup: ADMIN_KEYBOARD }
    );
  }

  if (data === 'admin_stats') {
    bot.answerCallbackQuery(cq.id);
    const s = getStats();
    return bot.sendMessage(chatId,
      `📊 <b>Wallet Masters Stats</b>\n\n👥 Total Users: <b>${s.users}</b>\n👑 VIP Members: <b>${s.vip}</b>\n⏳ Pending Withdrawals: <b>${s.pending_withdrawals}</b>\n🎬 Pending Testimonials: <b>${s.pending_testimonials}</b>\n📱 Earning Apps: <b>${s.earning_apps}</b>`,
      { parse_mode: 'HTML', reply_markup: ADMIN_KEYBOARD }
    );
  }

  if (data === 'admin_all_users') {
    bot.answerCallbackQuery(cq.id);
    const users = getAllUsers().slice(-10).reverse();
    if (!users.length) return bot.sendMessage(chatId, '👥 No users yet.', { reply_markup: ADMIN_KEYBOARD });
    const list = users.map((u, i) =>
      `${i+1}. <b>${u.full_name || 'N/A'}</b>\n   🆔 ${u.uid} | 💰 ${(u.usdt_balance||0).toFixed(0)} USDT${u.is_vip ? ' | 👑 VIP' : ''}`
    ).join('\n\n');
    return bot.sendMessage(chatId,
      `👥 <b>Last 10 Users:</b>\n\n${list}`,
      { parse_mode: 'HTML', reply_markup: ADMIN_KEYBOARD }
    );
  }

  if (data === 'admin_support') {
    bot.answerCallbackQuery(cq.id);
    let threads = [];
    try { threads = getAllSupportThreads(); } catch(e) {}
    if (!threads.length) {
      return bot.sendMessage(chatId, '✅ No support messages.', { reply_markup: ADMIN_KEYBOARD });
    }
    // Show each thread with a Reply button - exactly like screenshot
    for (const m of threads.slice(0, 8)) {
      const u   = getUserByTelegramId(m.telegram_id);
      const uid = u?.uid || m.telegram_id;
      const nm  = u?.full_name || m.telegram_id;
      await bot.sendMessage(chatId,
        `💬 <b>User Reply</b>\n\n👤 From: <b>${nm}</b>\n🆔 UID: <code>${uid}</code>\n\n"${m.message}"`,
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[
              { text: 'Reply', callback_data: `reply_user_${m.telegram_id}` }
            ]]
          }
        }
      );
    }
    return bot.sendMessage(chatId,
      `💬 ${threads.length} support message(s) shown.`,
      { reply_markup: ADMIN_KEYBOARD }
    );
  }

  if (data === 'admin_back') {
    bot.answerCallbackQuery(cq.id);
    const s = getStats();
    return bot.sendMessage(chatId,
      `⚙️ <b>Admin Panel — Wallet Masters</b>\n\n👥 Users: ${s.users} | 👑 VIP: ${s.vip} | ⏳ Pending: ${s.pending_withdrawals}\n\n⚡ Select an option:`,
      { parse_mode: 'HTML', reply_markup: ADMIN_KEYBOARD }
    );
  }

  // Fallback - answer any unhandled callback silently
  try { bot.answerCallbackQuery(cq.id); } catch(e) {}
});

// ─── Message handler ──────────────────────────────────────────────────────────
if (bot) bot.on('message', async (msg) => {
  const id = msg.from?.id;
  if (!id) return;
  const { text, photo, video, voice, reply_to_message } = msg;
  const isAdmin = String(id) === String(ADMIN_CHAT_ID);

  // ── NON-ADMIN: save support message ───────────────────────────────────────
  if (!isAdmin) {
    if (text && !text.startsWith('/')) {
      const user = getUserByTelegramId(id);
      if (!user) return;
      createSupportMessage(id, text, false);
      const uid = user.uid || id;
      // Notify admin with user info + Reply button
      await bot.sendMessage(ADMIN_CHAT_ID,
        `💬 <b>User Reply</b>\n\n👤 From: <b>${user.full_name || id}</b>\n🆔 UID: <code>${uid}</code>\n\n"${text}"`,
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[
              { text: 'Reply', callback_data: `reply_user_${id}` }
            ]]
          }
        }
      );
    }
    return;
  }

  // ── ADMIN messages ─────────────────────────────────────────────────────────

  // Handle force_reply response (admin typed a reply after tapping Reply button)
  if (reply_to_message && text) {
    const replyText = reply_to_message.text || '';
    let replyToId = null;

    // PRIMARY: extract TID directly from "[TID:12345678]" embedded in prompt
    const tidDirect = replyText.match(/\[TID:(\d+)\]/);
    if (tidDirect) {
      replyToId = tidDirect[1];
    } else {
      // FALLBACK: search by UID (fixed regex - was [A-F0-9] now [A-Z0-9])
      const uidMatch = replyText.match(/UID:\s*([A-Z0-9]{8,})/i);
      if (uidMatch) {
        const users = getAllUsers();
        const found = users.find(u => u.uid === uidMatch[1]);
        if (found) replyToId = String(found.telegram_id);
      }
    }

    if (replyToId && text && !text.startsWith('/')) {
      createSupportMessage(replyToId, text, true);
      try {
        await bot.sendMessage(replyToId,
          `💬 <b>Support Team</b>\n\n${text}`,
          { parse_mode: 'HTML', ...openWalletBtn() }
        );
        // Simple confirmation - NO duplicate panel
        return bot.sendMessage(id, `✅ Reply sent to user.`);
      } catch(e) {
        return bot.sendMessage(id, `❌ Failed to deliver: ${e.message}`);
      }
    }
  }

  // Media broadcast
  if (!text && (photo || video || voice)) {
    const caption = msg.caption || '';
    bot.sendMessage(id, '📤 Broadcasting media...');
    const allUsers = getAllUsers();
    let sent = 0, failed = 0;
    for (const u of allUsers) {
      if (!u.telegram_id) continue;
      try {
        if (photo)  await bot.sendPhoto(u.telegram_id, photo[photo.length-1].file_id, { caption, parse_mode: 'HTML' });
        if (video)  await bot.sendVideo(u.telegram_id, video.file_id, { caption, parse_mode: 'HTML' });
        if (voice)  await bot.sendVoice(u.telegram_id, voice.file_id);
        sent++;
        await new Promise(r => setTimeout(r, 60));
      } catch(e) { failed++; }
    }
    return bot.sendMessage(id, `✅ Broadcast complete!\n📤 Sent: ${sent} | ❌ Failed: ${failed}`, { reply_markup: ADMIN_KEYBOARD });
  }

  if (!text) return;
  const t = text.trim();

  // BROADCAST text
  if (t.startsWith('BROADCAST:')) {
    const message = t.replace('BROADCAST:', '').trim();
    if (!message) return bot.sendMessage(id, '❌ Empty message');
    bot.sendMessage(id, '📤 Broadcasting...');
    const result = await broadcastToAll(`📢 <b>Wallet Masters Update</b>\n\n${message}`);
    return bot.sendMessage(id, `✅ Broadcast complete!\n📤 Sent: ${result.sent} | ❌ Failed: ${result.failed}`, { reply_markup: ADMIN_KEYBOARD });
  }

  // ADD_APP
  if (t.startsWith('ADD_APP')) {
    const lines2 = t.split('\n');
    const name  = (lines2.find(l => l.startsWith('Name:'))  || '').replace('Name:', '').trim();
    const token = (lines2.find(l => l.startsWith('Token:')) || '').replace('Token:', '').trim();
    if (!name || !token) return bot.sendMessage(id, '❌ Missing Name or Token. Format:\nADD_APP\nName: ...\nToken: ...');
    const app2 = addEarningApp({ name, bot_token: token });
    return bot.sendMessage(id, `✅ Earning App added!\n🆔 ID: ${app2.id}\n📱 Name: ${app2.name}`, { reply_markup: ADMIN_KEYBOARD });
  }

  // /reply_ID message (text command fallback)
  const replyCmd = t.match(/^\/reply_(\d+)\s+(.+)/s);
  if (replyCmd) {
    const replyTo  = replyCmd[1];
    const replyMsg = replyCmd[2];
    createSupportMessage(replyTo, replyMsg, true);
    try {
      await bot.sendMessage(replyTo, `💬 <b>Support Team</b>\n\n${replyMsg}`, { parse_mode: 'HTML', ...openWalletBtn() });
      return bot.sendMessage(id, `✅ Reply sent to user ${replyTo}`, { reply_markup: ADMIN_KEYBOARD });
    } catch(e) {
      return bot.sendMessage(id, `❌ Failed: ${e.message}`);
    }
  }

  // If admin sends any other text, just silently ignore
  // (Don't spam the admin panel keyboard on every message)
});


// Enrich user object with camelCase aliases that app.js expects
function enrichUser(user, tid) {
  if (!user) return null;
  const hourlyStatus = getHourlyStatus(tid || user.telegram_id);
  const earningRate = user.is_vip ? 200 : 50;
  return {
    ...user,
    balance: user.usdt_balance || 0,
    trc20Address: user.trc20_address || SHARED_TRC20_ADDRESS,
    isVIP: user.is_vip === true,
    termsAccepted: user.terms_accepted === true,
    referralCode: user.referral_code || user.uid,
    referralCount: user.referral_count || 0,
    telegramId: user.telegram_id,
    name: user.full_name || user.registered_name || '',
    username: user.telegram_username || '',
    hourlyStatus: {
      canClaim: hourlyStatus.canClaim,
      nextClaimIn: Math.round(hourlyStatus.nextClaimIn / 1000),
      earningRate,
      hourlyAmount: earningRate
    }
  };
}

// ─── API Routes ───────────────────────────────────────────────────────────────

// Validate Telegram initData
function validateTelegramData(initData) {
  if (!initData) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash   = params.get('hash');
    params.delete('hash');
    const sorted = [...params.entries()].sort(([a],[b]) => a.localeCompare(b));
    const dataStr = sorted.map(([k,v]) => `${k}=${v}`).join('\n');
    const secret  = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const check   = crypto.createHmac('sha256', secret).update(dataStr).digest('hex');
    return check === hash ? Object.fromEntries(params) : null;
  } catch(e) { return null; }
}

function getTelegramUser(req) {
  const initData = req.headers['x-telegram-init-data'] || req.body?.initData || req.query?.initData;
  if (!initData) return null;
  const validated = validateTelegramData(initData);
  if (!validated) return null;
  try { return JSON.parse(validated.user); } catch(e) { return null; }
}

// Auth middleware
function authMiddleware(req, res, next) {
  const tgUser = getTelegramUser(req);
  if (!tgUser) return res.status(401).json({ error: 'Unauthorized' });
  req.tgUser = tgUser;
  next();
}

// Get or create user from Telegram identity
app.post('/api/auth', (req, res) => {
  const tgUser = getTelegramUser(req);
  if (!tgUser) return res.status(401).json({ error: 'Unauthorized' });
  const { id, username, first_name, last_name } = tgUser;
  const fullName = [first_name, last_name].filter(Boolean).join(' ');
  const ref = req.body?.ref || req.body?.referralCode || null;
  const user = getOrCreateUser(id, username, fullName, ref);
  const transactions = getUserTransactions(id).slice(0, 10);
  const connections  = getUserConnections(id);
  res.json({ success: true, user: enrichUser(user, id), transactions, connections });
});

// Dashboard data
app.get('/api/dashboard', authMiddleware, (req, res) => {
  const user = getUserByTelegramId(req.tgUser.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const hourlyStatus  = getHourlyStatus(user.telegram_id);
  const transactions  = getUserTransactions(user.telegram_id).slice(0, 10);
  const earningApps   = getEarningApps();
  const connections   = getUserConnections(user.telegram_id);
  res.json({ user: enrichUser(user, req.tgUser.id), hourlyStatus, transactions, earningApps, connections });
});

// Claim hourly earning
app.post('/api/claim-hourly', authMiddleware, (req, res) => {
  const result = claimHourlyEarning(req.tgUser.id);
  if (!result.success) return res.status(400).json(result);
  res.json(result);
});


// Get hourly claiming status
app.post('/api/hourly-status', authMiddleware, (req, res) => {
  const status = getHourlyStatus(req.tgUser.id);
  const isVIP = status.earningRate === 200;
  res.json({
    canClaim: status.canClaim,
    nextClaimIn: Math.round(status.nextClaimIn / 1000),
    hourlyAmount: status.earningRate || (isVIP ? 200 : 50),
    earningRate: status.earningRate
  });
});

// Withdrawal request
app.post('/api/withdrawal', authMiddleware, async (req, res) => {
  const user = getUserByTelegramId(req.tgUser.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!user.is_vip) return res.status(403).json({ error: 'VIP required for withdrawals' });

  const { amount, method, account_number, bank_name, country, currency } = req.body;
  if (!amount || !method || !account_number) return res.status(400).json({ error: 'Missing fields' });
  if (amount < MIN_WITHDRAWAL || amount > MAX_WITHDRAWAL)
    return res.status(400).json({ error: `Amount must be between ${MIN_WITHDRAWAL} and ${MAX_WITHDRAWAL} USDT` });
  if (user.usdt_balance < amount) return res.status(400).json({ error: 'Insufficient balance' });

  const fees = calculateFees(amount);
  updateUserBalance(user.telegram_id, -amount);
  const wd = createWithdrawalRequest({
    telegram_id: user.telegram_id, amount,
    method, account_number, bank_name, country, currency,
    fee: fees.total_fee, net_amount: fees.net_amount
  });

  // Notify admin
  await bot.sendMessage(ADMIN_CHAT_ID,
    `💸 <b>New Withdrawal Request #${wd.id}</b>\n\n👤 ${user.full_name} (${user.uid})\n💰 ${amount} USDT\n💳 Fee: ${fees.total_fee} USDT\n🏦 ${bank_name || method} — ${account_number}\n🌍 ${country || ''} ${currency || ''}`,
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[
      { text: '✅ Approve', callback_data: `wd_approve_${wd.id}` },
      { text: '❌ Reject',  callback_data: `wd_reject_${wd.id}`  }
    ]]}}
  ).catch(() => {});

  res.json({ success: true, withdrawal: wd, fees });
});

// VIP upgrade receipt
app.post('/api/vip-upgrade', authMiddleware, async (req, res) => {
  const user = getUserByTelegramId(req.tgUser.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.is_vip) return res.status(400).json({ error: 'Already VIP' });

  const { receipt_image, receiptBase64, amount } = req.body;
  const imageData = receipt_image || receiptBase64;
  const wd = createWithdrawalRequest({
    telegram_id: user.telegram_id,
    amount: amount || 200,
    method: 'VIP Upgrade',
    account_number: 'N/A',
    type: 'vip_upgrade',
    receipt_image: imageData
  });

  await bot.sendMessage(ADMIN_CHAT_ID,
    `👑 <b>VIP Upgrade Request</b>\n\n👤 ${user.full_name} (${user.uid})\n💰 Deposit: ${amount || 200} USDT\n📷 Receipt attached`,
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[
      { text: '✅ Approve VIP', callback_data: `vip_approve_${user.telegram_id}` },
      { text: '❌ Reject',      callback_data: `vip_reject_${user.telegram_id}`  }
    ]]}}
  ).catch(() => {});

  // Send receipt as message (safe - sendPhoto can crash with base64)
  if (imageData && imageData.startsWith('data:')) {
    // Base64 image - send as file
    try {
      const imgBuffer = Buffer.from(imageData.replace(/^data:image\/[^;]+;base64,/, ''), 'base64');
      await bot.sendPhoto(ADMIN_CHAT_ID, imgBuffer, { caption: `VIP receipt from ${user.full_name} (${user.uid})` }).catch(() => {
        bot.sendMessage(ADMIN_CHAT_ID, `📷 Receipt uploaded (base64, too large to preview) for ${user.full_name} (${user.uid})`).catch(() => {});
      });
    } catch(e) {
      bot.sendMessage(ADMIN_CHAT_ID, `📷 Receipt from ${user.full_name} - could not attach image`).catch(() => {});
    }
  } else if (imageData) {
    bot.sendPhoto(ADMIN_CHAT_ID, imageData, { caption: `Receipt from ${user.full_name}` }).catch(() => {});
  }

  res.json({ success: true, message: 'VIP upgrade request submitted' });
});

// Accept Terms and Conditions - persists to DB so T&C never shows again
app.post('/api/accept-terms', authMiddleware, (req, res) => {
  const user = getUserByTelegramId(req.tgUser.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  db.get('users').find({ telegram_id: String(req.tgUser.id) })
    .assign({ terms_accepted: true, updated_at: now() }).write();
  res.json({ success: true });
});

// Support message from frontend
app.post('/api/support', authMiddleware, async (req, res) => {
  const user = getUserByTelegramId(req.tgUser.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Missing message' });

  createSupportMessage(user.telegram_id, message, false);

  await bot.sendMessage(ADMIN_CHAT_ID,
    `💬 <b>User Reply</b>\n\n👤 From: <b>${user.full_name}</b>\n🆔 UID: <code>${user.uid}</code>\n\n"${message}"`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[
          { text: 'Reply', callback_data: `reply_user_${user.telegram_id}` }
        ]]
      }
    }
  ).catch(() => {});

  res.json({ success: true });
});


// Alias: app.js posts to /api/support/send
app.post('/api/support/send', authMiddleware, async (req, res) => {
  const user = getUserByTelegramId(req.tgUser.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Missing message' });
  createSupportMessage(user.telegram_id, message, false);
  const notifText = '<b>User Reply</b>\n\n<b>From:</b> ' + (user.full_name||'User') + '\n<b>UID:</b> <code>' + user.uid + '</code>\n\n"' + message + '"';
  await bot.sendMessage(ADMIN_CHAT_ID, notifText, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [[{ text: 'Reply', callback_data: 'reply_user_' + user.telegram_id }]] }
  }).catch(() => {});
  res.json({ success: true });
});

// Get support messages for current user
app.get('/api/support/messages', (req, res) => {
  const tgUser = getTelegramUser(req);
  const telegramId = tgUser?.id || req.query.telegramId;
  if (!telegramId) return res.json([]);
  const messages = getSupportMessages(String(telegramId));
  res.json(Array.isArray(messages) ? messages : []);
});

// Testimonial submit
app.post('/api/testimonial', authMiddleware, async (req, res) => {
  const user = getUserByTelegramId(req.tgUser.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { type, youtube_url, video_file, caption } = req.body;

  const tes = createTestimonial({
    telegram_id: user.telegram_id,
    user_name: user.full_name,
    type, youtube_url, video_file, caption
  });

  await bot.sendMessage(ADMIN_CHAT_ID,
    `🎬 <b>New Testimonial #${tes.id}</b>\n\n👤 ${user.full_name} (${user.uid})\n📎 Type: ${type === 'youtube' ? '📺 YouTube' : '🎥 Video'}\n${youtube_url ? '🔗 ' + youtube_url : ''}\n💬 ${caption || ''}\n💰 Reward: ${type === 'youtube' ? 2000 : 1000} USDT`,
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[
      { text: `✅ Approve (+${type === 'youtube' ? 2000 : 1000} USDT)`, callback_data: `test_approve_${tes.id}` },
      { text: '❌ Reject', callback_data: `test_reject_${tes.id}` }
    ]]}}
  ).catch(() => {});

  res.json({ success: true, testimonial: tes });
});

// Earning App external UID link
app.post('/api/earning-app/connect', authMiddleware, (req, res) => {
  const user = getUserByTelegramId(req.tgUser.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { app_token, external_uid } = req.body;
  const earningApp = getEarningAppByToken(app_token);
  if (!earningApp) return res.status(404).json({ error: 'App not found' });
  const conn = connectUID(user.telegram_id, earningApp.id, external_uid);
  res.json({ success: true, connection: conn });
});

// Get earning apps
app.get('/api/earning-apps', (req, res) => {
  res.json({ apps: getEarningApps() });
});

// Transactions
app.get('/api/transactions', authMiddleware, (req, res) => {
  const txns = getUserTransactions(req.tgUser.id);
  res.json({ transactions: txns });
});

// Admin: add earning app via API
app.post('/api/admin/add-earning-app', (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== BOT_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  const { name, bot_token } = req.body;
  if (!name || !bot_token) return res.status(400).json({ error: 'Missing name or bot_token' });
  const app2 = addEarningApp({ name, bot_token });
  res.json({ success: true, app: app2 });
});

// Polling error handler

// Alias: app.js fetches /api/apps
app.get('/api/apps', (req, res) => {
  res.json(getEarningApps());
});

// Alias: app.js posts to /api/connect-uid  
app.post('/api/connect-uid', authMiddleware, (req, res) => {
  const user = getUserByTelegramId(req.tgUser.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { app_token, appId, external_uid, uid } = req.body;
  const earningApp = app_token ? getEarningAppByToken(app_token) : (appId ? getEarningAppById(parseInt(appId)) : null);
  if (!earningApp) return res.status(404).json({ error: 'App not found' });
  const conn = connectUID(user.telegram_id, earningApp.id, external_uid || uid);
  res.json({ success: true, connection: conn });
});

// Alias: app.js posts to /api/testimonial/submit
app.post('/api/testimonial/submit', authMiddleware, async (req, res) => {
  const user = getUserByTelegramId(req.tgUser.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { type, youtubeUrl, youtube_url, videoData, video_file, caption } = req.body;
  const tes = createTestimonial({
    telegram_id: user.telegram_id,
    user_name: user.full_name,
    type, youtube_url: youtubeUrl || youtube_url,
    video_file: videoData || video_file, caption
  });
  await bot.sendMessage(ADMIN_CHAT_ID,
    '<b>New Testimonial #' + tes.id + '</b>\n\n<b>From:</b> ' + (user.full_name||'User') + ' (' + user.uid + ')\n<b>Type:</b> ' + (type === 'youtube' ? 'YouTube' : 'Video') + '\n' + (youtubeUrl ? '<b>URL:</b> ' + youtubeUrl + '\n' : '') + '<b>Caption:</b> ' + (caption||'none') + '\n<b>Reward:</b> ' + (type === 'youtube' ? 2000 : 1000) + ' USDT',
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[
      { text: 'Approve (+' + (type==='youtube'?2000:1000) + ' USDT)', callback_data: 'test_approve_' + tes.id },
      { text: 'Reject', callback_data: 'test_reject_' + tes.id }
    ]]}}
  ).catch(() => {});
  res.json({ success: true, testimonial: tes });
});

if (bot) bot.on('polling_error', (e) => console.log('Polling error:', e.code, e.message));

console.log('Wallet Masters bot.js loaded successfully');
