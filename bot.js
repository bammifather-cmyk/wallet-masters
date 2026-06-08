/**
 * Wallet Masters — Bot v7
 * Database: PostgreSQL/Supabase (persistent)
 */
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express     = require('express');
const cors        = require('cors');
const path        = require('path');
const crypto      = require('crypto');

const {
  initDB, SHARED_TRC20_ADDRESS, MIN_WITHDRAWAL, MAX_WITHDRAWAL, GATEWAY_FEE_RATE,
  getOrCreateUser, getUserByTelegramId, getUserById, updateUserBalance, setUserBalance, upgradeToVIP,
  updateUserName, getAllUsers, setUserActive, setEarningsSuspended, acceptTerms,
  claimHourlyEarning, getHourlyStatus,
  getEarningApps, getEarningAppByToken, getEarningAppById, addEarningApp, removeEarningApp,
  connectUID, getConnectedUID, getUserConnections, findUserByExternalUID,
  createTransaction, getUserTransactions,
  createWithdrawalRequest, getPendingWithdrawals, getWithdrawalById, updateWithdrawal, getUserWithdrawals,
  createSupportMessage, getSupportMessages, getAllSupportThreads, markSupportRead,
  createTestimonial, getTestimonialById, getPendingTestimonials, getApprovedTestimonials, updateTestimonial, deleteTestimonial,
  createPoem, getPoemById, getPendingPoems, getApprovedPoems, updatePoem, deletePoem,
  getSocialProfile, updateSocialProfile, getAllSocialProfiles,
  createSocialPost, getSocialPostById, getPendingSocialPosts, getApprovedSocialPosts, getSocialPostsByUser, updateSocialPost, deleteSocialPost, sendLikesToPost,
  likePost, hasLiked,
  createComment, getCommentsByPost, deleteComment,
  createDM, getDMs, getDMContacts, markDMsRead,
  createVerificationRequest, getPendingVerificationRequests, getVerificationRequestById, updateVerificationRequest,
  createBroadcast,
  query,
  getSupabase
} = require('./database');

const BOT_TOKEN     = process.env.BOT_TOKEN;
// ── Professional number formatter ───────────────────────────
const formatUSDT = (n) => {
  const num = parseFloat(n) || 0;
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '5995434559';
const FEE_ADDRESS   = process.env.FEE_ADDRESS   || 'TPwUS8v77TtcsYZUHUTvVx2TGqE37QnagZ';
const PORT          = parseInt(process.env.PORT) || 3000;

if (!BOT_TOKEN) { console.error('BOT_TOKEN missing'); process.exit(1); }

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '.')));

let MINI_APP_URL = process.env.MINI_APP_URL || 'https://wallet-masters.onrender.com';

function calculateFees(amount) {
  const fee = Math.ceil(amount * GATEWAY_FEE_RATE);
  return { total_fee: fee, net_amount: amount - fee };
}

function nowSec() { return Math.floor(Date.now() / 1000); }

app.get('/health', (_, res) => res.json({ status: 'ok', service: 'Wallet Masters', version: '10.5' }));

// ── Auto-fix corrupted socialpay_reward transactions on startup ───────────────
async function fixCorruptedTransactions() {
  try {
    const supabase = getSupabase();
    const { data: txs } = await supabase.from('transactions').select('*');
    if (!txs) return;
    let fixed = 0;
    for (const tx of txs) {
      if (tx.type && typeof tx.type === 'string' && tx.type.startsWith('{')) {
        try {
          const parsed = JSON.parse(tx.type);
          const realType   = parsed.type   || 'socialpay_reward';
          const realAmount = parsed.amount  || 0;
          const realNote   = parsed.note    || 'SocialPay reward';
          const realStatus = parsed.status  || 'completed';
          await getSupabase().from('transactions').update({
            type: realType, amount: realAmount, note: realNote, status: realStatus
          }).eq('id', tx.id);
          if (realAmount > 0 && (!tx.amount || parseFloat(tx.amount) === 0)) {
            await updateUserBalance(tx.telegram_id, realAmount);
            console.log('[FIX] Credited ' + realAmount + ' USDT to ' + tx.telegram_id + ' for tx #' + tx.id);
          }
          fixed++;
        } catch(e) { /* not valid JSON */ }
      }
    }
    if (fixed > 0) console.log('[STARTUP] Fixed ' + fixed + ' corrupted transaction(s)');
  } catch(e) { console.error('[STARTUP] fixCorruptedTransactions error:', e.message); }
}
setTimeout(fixCorruptedTransactions, 5000);

// ── Auto-refund stale pending withdrawals on startup ──────────────────────────
async function refundStalePendingWithdrawals() {
  try {
    const supa = getSupabase();
    // Get all withdrawals that are still 'pending' (not fee_paid, not completed, not rejected)
    // We refund ALL pending ones since admin approval now properly marks them completed
    const { data: pendingWds } = await supa.from('withdrawals').select('*').eq('status', 'pending');
    if (!pendingWds || pendingWds.length === 0) { console.log('[REFUND] No stale pending withdrawals.'); return; }
    console.log('[REFUND] Found ' + pendingWds.length + ' pending withdrawal(s) to refund...');
    for (const wd of pendingWds) {
      const amt = parseFloat(wd.amount) || 0;
      if (amt <= 0) continue;
      // Refund the balance
      await updateUserBalance(wd.telegram_id, amt);
      // Mark withdrawal as rejected/refunded
      await supa.from('withdrawals').update({ status: 'rejected' }).eq('id', wd.id);
      // Update matching transaction
      const { data: matchedTx } = await supa.from('transactions')
        .select('id').eq('telegram_id', String(wd.telegram_id))
        .eq('type', 'withdrawal').eq('status', 'pending').order('created_at', { ascending: true }).limit(1);
      if (matchedTx && matchedTx.length > 0) {
        await supa.from('transactions').update({ status: 'rejected' }).eq('id', matchedTx[0].id);
      }
      // Notify user via Telegram
      try {
        bot.sendMessage(wd.telegram_id, 
          '💰 <b>Balance Refunded</b>\n\n' + amt + ' USDT from your pending withdrawal has been returned to your wallet balance.',
          { parse_mode: 'HTML' }
        );
      } catch(e) {}
      console.log('[REFUND] Refunded ' + amt + ' USDT to ' + wd.telegram_id + ' (withdrawal #' + wd.id + ')');
    }
    console.log('[REFUND] Done refunding ' + pendingWds.length + ' pending withdrawal(s).');
  } catch(e) { console.error('[REFUND] Error:', e.message); }
}
setTimeout(refundStalePendingWithdrawals, 10000);
app.get('/api/db-status', async (req, res) => {
  const { Client } = require('pg');
  const results = {};
  const pw = 'WalletMasters2025!';
  const ref = 'cuuekllbcrxvlxlydyta';
  // Try all Supabase pooler regions
  const regions = [
    'aws-0-us-west-1','aws-0-us-east-1','aws-0-eu-west-1',
    'aws-0-eu-central-1','aws-0-ap-southeast-1','aws-0-ap-northeast-1',
    'aws-0-ap-southeast-2','aws-0-sa-east-1','aws-0-ca-central-1'
  ];
  for (const region of regions) {
    const url = `postgresql://postgres.${ref}:${pw}@${region}.pooler.supabase.com:6543/postgres`;
    const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 7000 });
    try { await c.connect(); const r = await c.query('SELECT NOW() as t'); results[region] = 'OK! ' + r.rows[0].t; await c.end(); break; }
    catch(e) { results[region] = e.message.substring(0,60); try { await c.end(); } catch(_){} }
  }
  res.json(results);
})
app.listen(PORT, '0.0.0.0', () => {
  const host = process.env.RENDER_EXTERNAL_URL || process.env.RAILWAY_STATIC_URL || '';
  if (host) MINI_APP_URL = host.startsWith('http') ? host : `https://${host}`;
  console.log(`Wallet Masters v7.0 on port ${PORT} | URL: ${MINI_APP_URL}`);
});

let bot;
try { bot = new TelegramBot(BOT_TOKEN, { polling: true }); console.log('Bot started'); }
catch (err) { console.error('Bot failed:', err.message); }

// Init DB then sync menu buttons
initDB().then(async () => {
  console.log('[DB] Ready');
  setTimeout(async () => {
    if (!bot) return;
    try { await bot.setMyCommands([]); } catch(e) {}
    setMenuButton(ADMIN_CHAT_ID).catch(() => {});
    setTimeout(async () => {
      const users = await getAllUsers(); let ok = 0;
      for (const u of users) {
        try { await setMenuButton(u.telegram_id); ok++; await new Promise(r => setTimeout(r, 200)); } catch(e) {}
      }
      console.log(`Menu button synced for ${ok} users`);
    }, 5000);
  }, 3000);
}).catch(err => {
  console.error('[DB] Init failed:', err.message, '- retrying in 15s...');
  setTimeout(async () => {
    try {
      await initDB();
      console.log('[DB] Reconnected on retry!');
    } catch(e2) {
      console.error('[DB] Retry also failed:', e2.message, '- continuing without DB');
    }
  }, 15000);
});

const ADMIN_KEYBOARD = {
  inline_keyboard: [
    [{ text: '📋 Withdrawals',       callback_data: 'admin_withdrawals'        }, { text: '🎬 Testimonials',      callback_data: 'admin_testimonials'       }],
    [{ text: '➕ Add App',           callback_data: 'admin_add_app'            }, { text: '🗑 Remove App',        callback_data: 'admin_remove_app'         }],
    [{ text: '📢 Broadcast',         callback_data: 'admin_broadcast'          }, { text: '📊 Stats',             callback_data: 'admin_stats'              }],
    [{ text: '👥 All Users',         callback_data: 'admin_all_users'          }, { text: '💬 Support',           callback_data: 'admin_support'            }],
    [{ text: '📝 Poems',             callback_data: 'admin_poems'              }, { text: '🌟 SocialPay',         callback_data: 'admin_socialpay'          }],
    [{ text: '✅ Verifications',      callback_data: 'admin_verifications'      }, { text: '🚫 Manage Users',      callback_data: 'admin_manage_users'       }],
    [{ text: '💬 Community Post',    callback_data: 'admin_community_post'     }, { text: '💰 Resolve Balance',   callback_data: 'admin_resolve_balance'    }],
    [{ text: '🗑️ Delete Testimonials', callback_data: 'admin_del_testimonials' }, { text: '🗑️ Delete Poems',      callback_data: 'admin_del_poems'          }]
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
  const users = await getAllUsers(); let sent = 0, failed = 0;
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
  const users = await getAllUsers();
  const allIds = [...users.map(u => String(u.telegram_id)), String(ADMIN_CHAT_ID)].filter(Boolean);
  bot.sendMessage(ADMIN_CHAT_ID, `⏳ Setting button for ${allIds.length} users...`);
  let ok = 0, fail = 0;
  for (const tid of allIds) { try { await setMenuButton(tid); ok++; await new Promise(r=>setTimeout(r,100)); } catch(e){fail++;} }
  bot.sendMessage(ADMIN_CHAT_ID, `✅ Set: ${ok} | Failed: ${fail}`);
});

// ─── /start ──────────────────────────────────────────────────────────────────
if (bot) bot.onText(/\/start(.*)/, async (msg, match) => {
  try {
  const { id, username, first_name, last_name } = msg.from;
  const fullName = [first_name, last_name].filter(Boolean).join(' ');
  const param    = (match[1] || '').trim();
  const refCode  = param.startsWith('ref_') ? param.replace('ref_', '') : null;
  const isAdmin  = String(id) === String(ADMIN_CHAT_ID);
  let user;
  try {
    user = await getOrCreateUser(id, username, fullName, refCode);
  } catch(dbErr) {
    console.error('/start DB error:', dbErr.message);
    // DB unavailable - still greet user
    await bot.sendMessage(id, '💎 <b>Wallet Masters</b>\n\n⚙️ System initializing... Please try again in 30 seconds.', { parse_mode: 'HTML' });
    return;
  }

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
    try { await bot.sendMessage(user._referrer.telegram_id, `🎉 <b>Referral Reward!</b>\n\n+200 USDT added!`, { parse_mode: 'HTML', ...openWalletBtn() }); } catch(e) {}
  }

  await bot.sendMessage(id, '💎 Wallet Masters', { reply_markup: { remove_keyboard: true } });
  if (user._isNew) {
    bot.sendMessage(id, `🎉 <b>Welcome to Wallet Masters!</b>\n\n1️⃣ Open the app below\n2️⃣ Accept Terms & Conditions\n3️⃣ Claim <b>50 USDT every hour</b>!\n4️⃣ Upgrade to VIP → 200 USDT/hr\n5️⃣ Refer friends → 200 USDT each`, { parse_mode: 'HTML', ...openWalletBtn() });
  } else {
    bot.sendMessage(id, `👋 Welcome back, <b>${fullName||'User'}</b>!\n\n🆔 UID: <code>${user.uid}</code>\n💰 Balance: <b>${formatUSDT(user.usdt_balance||0)} USDT</b>${user.is_vip?'\n👑 VIP Member':''}`, { parse_mode: 'HTML', ...openWalletBtn() });
  }
  } catch(startErr) { console.error('/start error:', startErr.message); bot.sendMessage(msg.from.id, '💎 Wallet Masters - Please try again in a moment.', openWalletBtn()).catch(()=>{}); }
});

// ─── Callbacks ────────────────────────────────────────────────────────────────
if (bot) bot.on('callback_query', async (cq) => {
  const data    = cq.data || '';
  const chatId  = cq.message?.chat?.id;
  const msgId   = cq.message?.message_id;
  const isAdmin = String(chatId) === String(ADMIN_CHAT_ID);

  // Withdrawal approve/reject
  if (data.startsWith('wd_approve_') || data.startsWith('wd_reject_')) {
    if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
    const parts = data.split('_'); const action = parts[1]; const wdId = parseInt(parts[2]);
    const wd = await getWithdrawalById(wdId);
    if (!wd) return bot.answerCallbackQuery(cq.id, { text: '❌ Not found' });
    if (action === 'approve') {
      await updateWithdrawal(wdId, { status: 'completed' });
      // Sync the SPECIFIC transaction by withdrawal ID stored in note
      try {
        const supa = getSupabase();
        // Match by withdrawal ID in note OR by amount (most recent pending match)
        const noteMatch = `Withdrawal #${wdId}`;
        const { data: byNote } = await supa.from('transactions')
          .select('id').eq('telegram_id', String(wd.telegram_id))
          .eq('type', 'withdrawal').ilike('note', `%${noteMatch}%`).limit(1);
        if (byNote && byNote.length > 0) {
          await supa.from('transactions').update({ status: 'completed' }).eq('id', byNote[0].id);
          console.log('[APPROVE] Updated tx by note match:', byNote[0].id);
        } else {
          // Fallback: match by amount — get most recent pending withdrawal tx with same amount
          const { data: byAmt } = await supa.from('transactions')
            .select('id').eq('telegram_id', String(wd.telegram_id))
            .eq('type', 'withdrawal').eq('status', 'pending').eq('amount', String(wd.amount))
            .order('created_at', { ascending: false }).limit(1);
          if (byAmt && byAmt.length > 0) {
            await supa.from('transactions').update({ status: 'completed' }).eq('id', byAmt[0].id);
            console.log('[APPROVE] Updated tx by amount match:', byAmt[0].id);
          } else {
            // Last resort: oldest pending withdrawal tx
            const { data: oldest } = await supa.from('transactions')
              .select('id').eq('telegram_id', String(wd.telegram_id))
              .eq('type', 'withdrawal').eq('status', 'pending')
              .order('created_at', { ascending: true }).limit(1);
            if (oldest && oldest.length > 0) {
              await supa.from('transactions').update({ status: 'completed' }).eq('id', oldest[0].id);
              console.log('[APPROVE] Updated tx by oldest match:', oldest[0].id);
            }
          }
        }
      } catch(e) { console.error('tx sync approve error:', e.message); }
      bot.sendMessage(wd.telegram_id, `✅ <b>Withdrawal Approved!</b>\n\n💰 ${wd.amount} USDT has been processed and sent to your account.`, { parse_mode: 'HTML', ...openWalletBtn() });
      bot.answerCallbackQuery(cq.id, { text: '✅ Approved & Completed!' });
    } else {
      await updateWithdrawal(wdId, { status: 'rejected' });
      await updateUserBalance(wd.telegram_id, parseFloat(wd.amount));
      // Sync the SPECIFIC transaction by withdrawal ID
      try {
        const supa = getSupabase();
        const noteMatchR = `Withdrawal #${wdId}`;
        const { data: byNoteR } = await supa.from('transactions')
          .select('id').eq('telegram_id', String(wd.telegram_id))
          .eq('type', 'withdrawal').ilike('note', `%${noteMatchR}%`).limit(1);
        if (byNoteR && byNoteR.length > 0) {
          await supa.from('transactions').update({ status: 'rejected' }).eq('id', byNoteR[0].id);
        } else {
          const { data: byAmtR } = await supa.from('transactions')
            .select('id').eq('telegram_id', String(wd.telegram_id))
            .eq('type', 'withdrawal').eq('status', 'pending').eq('amount', String(wd.amount))
            .order('created_at', { ascending: false }).limit(1);
          if (byAmtR && byAmtR.length > 0) {
            await supa.from('transactions').update({ status: 'rejected' }).eq('id', byAmtR[0].id);
          } else {
            const { data: oldestR } = await supa.from('transactions')
              .select('id').eq('telegram_id', String(wd.telegram_id))
              .eq('type', 'withdrawal').eq('status', 'pending')
              .order('created_at', { ascending: true }).limit(1);
            if (oldestR && oldestR.length > 0) {
              await supa.from('transactions').update({ status: 'rejected' }).eq('id', oldestR[0].id);
            }
          }
        }
      } catch(e) { console.error('tx sync reject error:', e.message); }
      bot.sendMessage(wd.telegram_id, `❌ <b>Withdrawal Rejected</b>\n\n💰 ${wd.amount} USDT has been refunded to your wallet balance.`, { parse_mode: 'HTML', ...openWalletBtn() });
      bot.answerCallbackQuery(cq.id, { text: '❌ Rejected & Balance Refunded' });
    }
    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId }).catch(() => {});
    return;
  }

  // VIP approve/reject
  if (data.startsWith('vip_approve_') || data.startsWith('vip_reject_')) {
    if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
    const parts = data.split('_'); const action = parts[1]; const tid = parts.slice(2).join('_');
    if (action === 'approve') {
      await upgradeToVIP(tid);
      bot.sendMessage(tid, `👑 <b>You're now VIP!</b>\n\n✅ Deposit verified.\n💎 Now earning 200 USDT/hour\n🏦 Bank withdrawals unlocked!`, { parse_mode: 'HTML', ...openWalletBtn() });
      bot.answerCallbackQuery(cq.id, { text: '👑 VIP Activated!' });
    } else {
      bot.sendMessage(tid, `❌ VIP upgrade rejected. Please try again or contact support.`, openWalletBtn());
      bot.answerCallbackQuery(cq.id, { text: '❌ Rejected' });
    }
    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId }).catch(() => {});
    return;
  }

  // Testimonial approve/reject
  if (data.startsWith('test_approve_') || data.startsWith('test_reject_')) {
    if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
    const parts = data.split('_'); const action = parts[1]; const tId = parseInt(parts[2]);
    const tes = await getTestimonialById(tId);
    if (!tes) return bot.answerCallbackQuery(cq.id, { text: '❌ Not found' });
    if (action === 'approve') {
      const reward = tes.type === 'youtube' ? 2000 : 1000;
      await updateTestimonial(tId, { status: 'approved' });
      await updateUserBalance(tes.telegram_id, reward);
      await createTransaction(tes.telegram_id, 'testimonial_reward', reward, `Testimonial (${tes.type})`);
      bot.sendMessage(tes.telegram_id, `🎉 Testimonial Approved! +${reward} USDT added!`, { parse_mode: 'HTML', ...openWalletBtn() });
      bot.answerCallbackQuery(cq.id, { text: `✅ +${reward} USDT` });
    } else {
      await updateTestimonial(tId, { status: 'rejected' });
      bot.sendMessage(tes.telegram_id, `❌ Testimonial rejected. Please try again.`, openWalletBtn());
      bot.answerCallbackQuery(cq.id, { text: '❌ Rejected' });
    }
    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId }).catch(() => {});
    return;
  }

  // Testimonial DELETE (from pending notification)
  if (data.startsWith('test_delete_live_')) {
    if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
    const tId = parseInt(data.split('_')[3]);
    const tes = await getTestimonialById(tId);
    if (!tes) return bot.answerCallbackQuery(cq.id, { text: '❌ Already deleted or not found' });
    await deleteTestimonial(tId);
    await bot.answerCallbackQuery(cq.id, { text: '🗑️ Testimonial removed from app!' });
    bot.editMessageText(
      `🗑️ <b>Testimonial #${tId} DELETED</b>\n\nRemoved from the live app. Users will no longer see it.`,
      { chat_id: chatId, message_id: msgId, parse_mode: 'HTML' }
    ).catch(() => {});
    return;
  }

  // Testimonial DELETE (from pending notification)
  if (data.startsWith('test_delete_')) {
    if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
    const tId = parseInt(data.split('_')[2]);
    const tes = await getTestimonialById(tId);
    if (!tes) return bot.answerCallbackQuery(cq.id, { text: '❌ Not found' });
    await deleteTestimonial(tId);
    await bot.answerCallbackQuery(cq.id, { text: '🗑️ Testimonial deleted!' });
    bot.editMessageText(`🗑️ <b>Testimonial #${tId} DELETED</b>\n\nThis testimonial has been permanently removed.`, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML' }).catch(() => {});
    return;
  }

  // Poem approve/reject
  if (data.startsWith('poem_approve_') || data.startsWith('poem_reject_')) {
    if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
    const parts = data.split('_'); const action = parts[1]; const pId = parseInt(parts[2]);
    const poem = await getPoemById(pId);
    if (!poem) return bot.answerCallbackQuery(cq.id, { text: '❌ Not found' });
    if (action === 'approve') {
      await updatePoem(pId, { status: 'approved' });
      await updateUserBalance(poem.telegram_id, 1000);
      await createTransaction(poem.telegram_id, 'poem_reward', 1000, 'Poem/Inspiration reward');
      bot.sendMessage(poem.telegram_id, `🎉 Your Poem/Inspiration was approved! +1,000 USDT added! ✨`, { parse_mode: 'HTML', ...openWalletBtn() });
      bot.answerCallbackQuery(cq.id, { text: '✅ Approved! +1,000 USDT' });
    } else {
      await updatePoem(pId, { status: 'rejected' });
      bot.sendMessage(poem.telegram_id, `❌ Your post was not approved. Please review guidelines and try again.`, openWalletBtn());
      bot.answerCallbackQuery(cq.id, { text: '❌ Rejected' });
    }
    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId }).catch(() => {});
    return;
  }

  // Poem DELETE (from live approved list)
  if (data.startsWith('poem_delete_live_')) {
    if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
    const pId = parseInt(data.split('_')[3]);
    const poem = await getPoemById(pId);
    if (!poem) return bot.answerCallbackQuery(cq.id, { text: '❌ Already deleted or not found' });
    await deletePoem(pId);
    await bot.answerCallbackQuery(cq.id, { text: '🗑️ Post removed from app!' });
    bot.editMessageText(
      `🗑️ <b>Poem/Inspiration #${pId} DELETED</b>\n\nRemoved from the live app. Users will no longer see it.`,
      { chat_id: chatId, message_id: msgId, parse_mode: 'HTML' }
    ).catch(() => {});
    return;
  }

  // Poem DELETE (from pending notification)
  if (data.startsWith('poem_delete_')) {
    if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
    const pId = parseInt(data.split('_')[2]);
    const poem = await getPoemById(pId);
    if (!poem) return bot.answerCallbackQuery(cq.id, { text: '❌ Not found' });
    await deletePoem(pId);
    await bot.answerCallbackQuery(cq.id, { text: '🗑️ Post deleted!' });
    bot.editMessageText(`🗑️ <b>Poem/Inspiration #${pId} DELETED</b>\n\nThis post has been permanently removed.`, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML' }).catch(() => {});
    return;
  }

  // SocialPay approve/reject
  if (data.startsWith('sp_approve_') || data.startsWith('sp_reject_')) {
    if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
    const parts = data.split('_'); const action = parts[1]; const spId = parseInt(parts[2]);
    const post = await getSocialPostById(spId);
    if (!post) return bot.answerCallbackQuery(cq.id, { text: '❌ Not found' });
    if (action === 'approve') {
      await updateSocialPost(spId, { status: 'approved' });
      await bot.answerCallbackQuery(cq.id, { text: '✅ Post approved!' });
      bot.sendMessage(String(post.telegram_id), '🌟 SocialPay Post Approved!\n\n✅ Your post is now live in the feed!\n\n❤️ 1K likes → 100 USDT\n❤️ 10K → 1,000 USDT\n❤️ 100K → 10,000 USDT\n❤️ 1M → 100,000 USDT\n\nShare your post link and start earning!', { ...openWalletBtn() }).catch(e=>console.error('SP approve notify err:',e.message));
    } else {
      await updateSocialPost(spId, { status: 'rejected' });
      bot.sendMessage(post.telegram_id, `❌ SocialPay post rejected. Please review guidelines and try again.`, openWalletBtn());
      bot.answerCallbackQuery(cq.id, { text: '❌ Rejected' });
    }
    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId }).catch(() => {});
    return;
  }

  // Send likes to post
  if (data.startsWith('sp_likes_')) {
    if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
    const parts = data.split('_'); const spId = parseInt(parts[2]); const amount = parseInt(parts[3]);
    const result = await sendLikesToPost(spId, amount, bot);
    if (result.success) {
      bot.answerCallbackQuery(cq.id, { text: `✅ ${amount.toLocaleString()} likes sent!${result.earned>0?' +'+result.earned.toLocaleString()+' USDT paid':''}` });
      bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId }).catch(() => {});
    } else { bot.answerCallbackQuery(cq.id, { text: '❌ '+(result.error||'Failed') }); }
    return;
  }

  // Verification approve/reject
  if (data.startsWith('ver_approve_') || data.startsWith('ver_reject_')) {
    if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
    const parts = data.split('_'); const action = parts[1]; const vId = parseInt(parts[2]);
    const vers = await getPendingVerificationRequests();
    const ver = await getVerificationRequestById(vId);
    if (!ver) return bot.answerCallbackQuery(cq.id, { text: '❌ Not found' });
    const isGold = ver.type === 'gold';
    if (action === 'approve') {
      await updateVerificationRequest(vId, 'approved');
      if (isGold) {
        await updateSocialProfile(ver.telegram_id, { is_gold_verified: true, gold_status: 'approved' });
        bot.sendMessage(ver.telegram_id, `🌟 <b>Gold Verified Badge Granted!</b>\n\n✅ You are now a Gold Verified Creator!\n\n🏅 Benefits:\n• Gold ✅ badge on your profile\n• Private DMs with other Gold users\n• Send voice messages & photos in DMs\n\nCongratulations! 🎉`, { parse_mode: 'HTML', ...openWalletBtn() });
        bot.answerCallbackQuery(cq.id, { text: '🌟 Gold badge granted!' });
      } else {
        await updateSocialProfile(ver.telegram_id, { is_verified: true, verification_status: 'approved' });
        bot.sendMessage(ver.telegram_id, `🟠 <b>Verified Badge Granted!</b>\n\n✅ You are now a Verified Creator!\nYour orange ✅ badge is live on your profile.\n\nYou can now comment on posts and apply for Gold when you reach 500K likes! 🌟`, { parse_mode: 'HTML', ...openWalletBtn() });
        bot.answerCallbackQuery(cq.id, { text: '✅ Verified badge granted!' });
      }
    } else {
      await updateVerificationRequest(vId, 'rejected');
      if (isGold) await updateSocialProfile(ver.telegram_id, { gold_status: 'rejected' });
      else await updateSocialProfile(ver.telegram_id, { verification_status: 'rejected' });
      bot.sendMessage(ver.telegram_id, `❌ Verification request rejected. Keep growing your likes and try again!`, openWalletBtn());
      bot.answerCallbackQuery(cq.id, { text: '❌ Rejected' });
    }
    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId }).catch(() => {});
    return;
  }

  // Admin user management
  if (data.startsWith('adm_deactivate_') || data.startsWith('adm_activate_') || data.startsWith('adm_suspend_') || data.startsWith('adm_unsuspend_') || data.startsWith('adm_resolve_bal_')) {
    if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
    const parts = data.split('_'); const action = parts[1]; const tid = parts.slice(2).join('_');
    if (action === 'deactivate') {
      await setUserActive(tid, false);
      bot.answerCallbackQuery(cq.id, { text: '🚫 Account deactivated' });
      bot.sendMessage(tid, '🚫 Your account has been deactivated. Contact support.', openWalletBtn()).catch(()=>{});
    } else if (action === 'activate') {
      await setUserActive(tid, true);
      bot.answerCallbackQuery(cq.id, { text: '✅ Account activated' });
      bot.sendMessage(tid, '✅ Your account has been reactivated! Welcome back.', openWalletBtn()).catch(()=>{});
    } else if (action === 'suspend') {
      await setEarningsSuspended(tid, true);
      bot.answerCallbackQuery(cq.id, { text: '⚠️ Earnings suspended' });
    } else if (action === 'unsuspend') {
      await setEarningsSuspended(tid, false);
      bot.answerCallbackQuery(cq.id, { text: '✅ Earnings restored' });
    } else if (action === 'resolve' && parts[2] === 'bal') {
      // Resolve Balance — prompt admin to enter amount
      const tid2 = parts.slice(3).join('_');
      const u2 = await getUserByTelegramId(tid2);
      if (!u2) return bot.answerCallbackQuery(cq.id, { text: '❌ User not found' });
      bot.answerCallbackQuery(cq.id, { text: '💚 Enter amount below' });
      bot.sendMessage(chatId,
        `💚 <b>Resolve / Reverse Balance</b>\n\n👤 User: <b>${u2.full_name||'?'}</b>\n🆔 UID: <code>${u2.uid}</code>\n💰 Current Balance: <b>${formatUSDT(u2.usdt_balance||0)} USDT</b>\n\nType the amount to credit and send:\n<code>RESOLVE:${u2.uid}:AMOUNT</code>\n\n<i>Example: RESOLVE:${u2.uid}:500</i>`,
        { parse_mode: 'HTML' });
    }
    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId }).catch(() => {});
    return;
  }

  // Community comment approval
  if (data.startsWith('cc_approve_') || data.startsWith('cc_reject_')) {
    if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
    const ccId = parseInt(data.replace('cc_approve_','').replace('cc_reject_',''));
    const status = data.startsWith('cc_approve_') ? 'approved' : 'rejected';
    const supa4 = getSupabase();
    await supa4.from('community_comments').update({ status }).eq('id', ccId);
    bot.answerCallbackQuery(cq.id, { text: status === 'approved' ? '✅ Comment approved' : '❌ Comment rejected' });
    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId }).catch(()=>{});
    return;
  }

  if (data.startsWith('remove_app_')) {
    if (!isAdmin) return;
    const appId = parseInt(data.replace('remove_app_', ''));
    await removeEarningApp(appId);
    bot.answerCallbackQuery(cq.id, { text: '✅ App removed' });
    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId }).catch(() => {});
    return;
  }

  if (data.startsWith('reply_user_')) {
    if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
    const tid = data.replace('reply_user_', '');
    const u   = await getUserByTelegramId(tid);
    bot.answerCallbackQuery(cq.id, { text: 'Reply mode' });
    bot.sendMessage(chatId, `💬 Reply to ${u?.full_name||'User'} (${u?.uid||tid})\n\nType:\n<code>UID:${u?.uid||tid} Your message</code>`, { parse_mode: 'HTML' });
    return;
  }

  if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
  bot.answerCallbackQuery(cq.id);

  if (data === 'admin_stats') {
    const users = await getAllUsers();
    const wds   = await getPendingWithdrawals();
    const tests = await getPendingTestimonials();
    const poems = await getPendingPoems();
    const posts = await getPendingSocialPosts();
    const vers  = await getPendingVerificationRequests();
    const apps  = await getEarningApps();
    bot.sendMessage(chatId, `📊 <b>Stats</b>\n\n👥 Users: ${users.length} | 👑 VIP: ${users.filter(u=>u.is_vip).length}\n💸 Pending WDs: ${wds.length}\n📱 Apps: ${apps.length}\n🎬 Testimonials: ${tests.length}\n📝 Poems: ${poems.length}\n🌟 SocialPay: ${posts.length}\n✅ Verifications: ${vers.length}\n🚫 Deactivated: ${users.filter(u=>!u.is_active).length}\n⚠️ Suspended: ${users.filter(u=>u.earnings_suspended).length}`, { parse_mode: 'HTML', reply_markup: ADMIN_KEYBOARD });
    return;
  }
  if (data === 'admin_withdrawals') {
    const wds = await getPendingWithdrawals();
    if (!wds.length) { bot.sendMessage(chatId, '✅ No pending withdrawals.', { reply_markup: ADMIN_KEYBOARD }); return; }
    for (const wd of wds.slice(0,5)) {
      const u = await getUserByTelegramId(wd.telegram_id);
      bot.sendMessage(chatId, `💸 <b>Withdrawal #${wd.id}</b>\n👤 ${u?.full_name||'User'} (${u?.uid||wd.telegram_id})\n💰 ${wd.amount} USDT\n🏦 ${wd.bank_name||wd.method||'Crypto'} — ${wd.account_number||''}`, { parse_mode:'HTML', reply_markup:{inline_keyboard:[[{text:'✅ Approve',callback_data:`wd_approve_${wd.id}`},{text:'❌ Reject',callback_data:`wd_reject_${wd.id}`}]]}});
    }
    return;
  }
  if (data === 'admin_testimonials') {
    const tests = await getPendingTestimonials();
    if (!tests.length) { bot.sendMessage(chatId, '✅ No pending testimonials.', { reply_markup: ADMIN_KEYBOARD }); return; }
    for (const t of tests.slice(0,5)) {
      const reward = t.type==='youtube'?2000:1000;
      bot.sendMessage(chatId, `🎬 <b>Testimonial #${t.id}</b>\n👤 ${t.name||'User'}\n📎 ${t.type||'video'}\n${t.video_url?'🔗 '+t.video_url+'\n':''}💬 ${t.message||'none'}\n💰 ${reward} USDT`, { parse_mode:'HTML', reply_markup:{inline_keyboard:[[{text:`✅ Approve (+${reward})`,callback_data:`test_approve_${t.id}`},{text:'❌ Reject',callback_data:`test_reject_${t.id}`}],[{text:'🗑️ Delete',callback_data:`test_delete_${t.id}`}]]}});
    }
    return;
  }
  if (data === 'admin_poems') {
    const poems = await getPendingPoems();
    if (!poems.length) { bot.sendMessage(chatId, '✅ No pending poems.', { reply_markup: ADMIN_KEYBOARD }); return; }
    for (const p of poems.slice(0,5)) {
      const u = await getUserByTelegramId(p.telegram_id);
      bot.sendMessage(chatId, `📝 <b>Poem #${p.id}</b>\n👤 ${u?.full_name||'User'}\n📂 ${p.category||'General'}\n"${(p.content||'').substring(0,300)}..."\n💰 1,000 USDT`, { parse_mode:'HTML', reply_markup:{inline_keyboard:[[{text:'✅ Approve (+1,000)',callback_data:`poem_approve_${p.id}`},{text:'❌ Reject',callback_data:`poem_reject_${p.id}`}],[{text:'🗑️ Delete',callback_data:`poem_delete_${p.id}`}]]}});
    }
    return;
  }
  // ── Delete APPROVED Testimonials ──────────────────────────────────────────
  if (data === 'admin_del_testimonials') {
    if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
    const tests = await getApprovedTestimonials();
    if (!tests.length) {
      bot.sendMessage(chatId, '✅ No approved testimonials to delete.', { reply_markup: ADMIN_KEYBOARD });
      return;
    }
    bot.sendMessage(chatId, `🗑️ <b>Live Testimonials</b> — ${tests.length} approved

Tap DELETE to remove from the app:`, { parse_mode: 'HTML' });
    for (const t of tests.slice(0, 8)) {
      const preview = t.message ? t.message.substring(0, 120) : (t.video_url ? '🔗 ' + t.video_url.substring(0, 80) : 'No preview');
      bot.sendMessage(chatId,
        `🎬 <b>Testimonial #${t.id}</b>\n👤 ${t.name || 'User'}\n📎 ${t.type || 'video'}\n${t.video_url ? '🔗 ' + t.video_url + '\n' : ''}💬 ${preview}`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🗑️ DELETE from App', callback_data: `test_delete_live_${t.id}` }]] } }
      );
    }
    if (tests.length > 8) bot.sendMessage(chatId, `...and ${tests.length - 8} more. Showing first 8.`);
    return;
  }

  // ── Delete APPROVED Poems / Inspirations ───────────────────────────────────
  if (data === 'admin_del_poems') {
    if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
    const poems = await getApprovedPoems();
    if (!poems.length) {
      bot.sendMessage(chatId, '✅ No approved poems/inspirations to delete.', { reply_markup: ADMIN_KEYBOARD });
      return;
    }
    bot.sendMessage(chatId, `🗑️ <b>Live Poems & Inspirations</b> — ${poems.length} approved

Tap DELETE to remove from the app:`, { parse_mode: 'HTML' });
    for (const p of poems.slice(0, 8)) {
      const u = await getUserByTelegramId(p.telegram_id);
      bot.sendMessage(chatId,
        `📝 <b>${p.title || 'Post'} #${p.id}</b>
👤 ${p.author || u?.full_name || 'User'}
📂 ${p.category || 'General'}
"${(p.content || '').substring(0, 200)}"`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🗑️ DELETE from App', callback_data: `poem_delete_live_${p.id}` }]] } }
      );
    }
    if (poems.length > 8) bot.sendMessage(chatId, `...and ${poems.length - 8} more. Showing first 8.`);
    return;
  }

  if (data === 'admin_socialpay') {
    const posts = await getPendingSocialPosts();
    if (!posts.length) { bot.sendMessage(chatId, '✅ No pending SocialPay posts.', { reply_markup: ADMIN_KEYBOARD }); return; }
    for (const p of posts.slice(0,5)) {
      const u = await getUserByTelegramId(p.telegram_id);
      bot.sendMessage(chatId, `🌟 <b>SocialPay #${p.id}</b>\n👤 ${u?.full_name||'User'}\n💬 "${(p.caption||p.content||'').substring(0,200)}"`, { parse_mode:'HTML', reply_markup:{inline_keyboard:[
        [{text:'✅ Approve',callback_data:`sp_approve_${p.id}`},{text:'❌ Reject',callback_data:`sp_reject_${p.id}`}],
        [{text:'❤️ 1K likes',callback_data:`sp_likes_${p.id}_1000`},{text:'❤️ 10K likes',callback_data:`sp_likes_${p.id}_10000`}],
        [{text:'❤️ 100K likes',callback_data:`sp_likes_${p.id}_100000`},{text:'❤️ 1M likes',callback_data:`sp_likes_${p.id}_1000000`}]
      ]}});
    }
    return;
  }
  if (data === 'admin_verifications') {
    const vers = await getPendingVerificationRequests();
    if (!vers.length) { bot.sendMessage(chatId, '✅ No pending verifications.', { reply_markup: ADMIN_KEYBOARD }); return; }
    for (const v of vers.slice(0,5)) {
      const u = await getUserByTelegramId(v.telegram_id);
      const prof = await getSocialProfile(v.telegram_id);
      bot.sendMessage(chatId, `${v.type==='gold'?'🌟 Gold':'✅ Orange'} <b>Verification #${v.id}</b>\n👤 ${u?.full_name||'User'}\n❤️ ${(prof?.total_likes||0).toLocaleString()} likes`, { parse_mode:'HTML', reply_markup:{inline_keyboard:[[{text:`${v.type==='gold'?'🌟':'🟠'} Grant Badge`,callback_data:`ver_approve_${v.id}`},{text:'❌ Reject',callback_data:`ver_reject_${v.id}`}]]}});
    }
    return;
  }
  if (data === 'admin_manage_users') {
    bot.sendMessage(chatId, '🚫 <b>Manage Users</b>\n\nSend user UID to manage:\n<code>MANAGE:uid_here</code>', { parse_mode: 'HTML' }); return;

    } else if (data === 'admin_community_post') {
    if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
    bot.answerCallbackQuery(cq.id);
    bot.sendMessage(chatId,
      `💬 <b>Post Community Comment</b>\n\nYou can post a community comment with a custom name, location, and country flag.\n\nSend in this format:\n<code>COMMUNITY:Name|Location|🇳🇬|Comment text here</code>\n\n<i>Example:\nCOMMUNITY:Amina Bello|Lagos, Nigeria|🇳🇬|I earned 5,000 USDT this week on Wallet Masters! Best platform ever.</i>\n\nTo attach a payment receipt image, send it as a photo with the caption:\n<code>COMMUNITY_IMG:Name|Location|🇳🇬|Comment text</code>`,
      { parse_mode: 'HTML' }); return;

    } else if (data === 'admin_resolve_balance') {
    if (!isAdmin) return bot.answerCallbackQuery(cq.id, { text: '❌ Not authorized' });
    bot.answerCallbackQuery(cq.id);
    bot.sendMessage(chatId,
      `💰 <b>Resolve / Set User Balance</b>\n\n<b>RESOLVE:UID:AMOUNT</b> — Sets balance to exact amount\n<b>ADD:UID:AMOUNT</b> — Adds amount to existing balance\n\nGet UID from 👥 All Users, then send:\n<code>RESOLVE:UID:AMOUNT</code>\n<code>ADD:UID:AMOUNT</code>\n\n<i>Example (set to 5000): RESOLVE:WMERHEX58DT:5000</i>\n<i>Example (add 500): ADD:WMERHEX58DT:500</i>`,
      { parse_mode: 'HTML' }); return;
  }
  if (data === 'admin_all_users') {
    const users = (await getAllUsers()).slice(-10).reverse();
    const lines = users.map(u => `• ${u.full_name||'?'} | ${u.uid} | ${formatUSDT(u.usdt_balance||0)} USDT${u.is_vip?' 👑':''}${!u.is_active?' 🚫':''}${u.earnings_suspended?' ⚠️':''}`).join('\n');
    bot.sendMessage(chatId, `👥 <b>Recent Users</b>\n\n${lines}`, { parse_mode: 'HTML', reply_markup: ADMIN_KEYBOARD }); return;
  }
  if (data === 'admin_support') {
    const threads = await getAllSupportThreads();
    const tids = Object.keys(threads).filter(tid => threads[tid].some(m => !m.from_admin && !m.read));
    if (!tids.length) { bot.sendMessage(chatId, '✅ No unread messages.', { reply_markup: ADMIN_KEYBOARD }); return; }
    for (const tid of tids.slice(0,5)) {
      const u = await getUserByTelegramId(tid); const msgs = threads[tid].filter(m=>!m.from_admin).slice(-3);
      bot.sendMessage(chatId, `💬 <b>${u?.full_name||'User'} (${u?.uid||tid})</b>\n\n${msgs.map(m=>'"'+m.message+'"').join('\n')}`, { parse_mode:'HTML', reply_markup:{inline_keyboard:[[{text:'Reply',callback_data:`reply_user_${tid}`}]]}});
    }
    return;
  }
  if (data === 'admin_broadcast') { bot.sendMessage(chatId, '📢 Send: <code>BROADCAST: your message</code>', { parse_mode: 'HTML' }); return; }
  if (data === 'admin_add_app')   { bot.sendMessage(chatId, '➕ Send:\n<code>ADD_APP\nName: ...\nToken: ...</code>', { parse_mode: 'HTML' }); return; }
  if (data === 'admin_remove_app') {
    const apps = await getEarningApps();
    if (!apps.length) { bot.sendMessage(chatId, '✅ No apps.', { reply_markup: ADMIN_KEYBOARD }); return; }
    bot.sendMessage(chatId, '🗑 Select app:', { reply_markup: { inline_keyboard: apps.map(a=>[{text:`🗑 ${a.name}`,callback_data:`remove_app_${a.id}`}]) }});
    return;
  }
});

// ─── Admin text ───────────────────────────────────────────────────────────────
if (bot) bot.on('message', async (msg) => {
  try {
  const id = String(msg.from?.id);
  if (id !== String(ADMIN_CHAT_ID)) return;
  if (msg.web_app_data) return;
  const text  = msg.text;
  const photo = msg.photo; const video = msg.video; const voice = msg.voice;

  const uidMatch = text?.match(/^UID:(\S+)\s+([\s\S]+)/);
  if (uidMatch) {
    const users = await getAllUsers(); const found = users.find(u => u.uid===uidMatch[1]||u.telegram_id===uidMatch[1]);
    if (found && uidMatch[2]) {
      await createSupportMessage(found.telegram_id, uidMatch[2], true);
      try { await bot.sendMessage(found.telegram_id, `💬 <b>Support Team</b>\n\n${uidMatch[2]}`, { parse_mode:'HTML', ...openWalletBtn() }); return bot.sendMessage(id, `✅ Reply sent.`); }
      catch(e) { return bot.sendMessage(id, `❌ Failed: ${e.message}`); }
    }
  }

  const manageMatch = text?.match(/^MANAGE:(\S+)/);
  if (manageMatch) {
    const users = await getAllUsers(); const u = users.find(usr => usr.uid===manageMatch[1]||usr.telegram_id===manageMatch[1]);
    if (!u) { bot.sendMessage(id, '❌ User not found'); return; }
    bot.sendMessage(id,
      `🔧 <b>Manage: ${u.full_name||'User'}</b>\n🆔 UID: ${u.uid}\n💰 Balance: ${formatUSDT(u.usdt_balance||0)} USDT\n👑 VIP: ${u.is_vip?'Yes':'No'}\n✅ Active: ${u.is_active!==false?'Yes':'No'}\n⚠️ Suspended: ${u.earnings_suspended?'Yes':'No'}`,
      { parse_mode:'HTML', reply_markup:{inline_keyboard:[
        [{text:u.is_active!==false?'🚫 Deactivate Account':'✅ Activate Account', callback_data:`adm_${u.is_active!==false?'deactivate':'activate'}_${u.telegram_id}`}],
        [{text:u.earnings_suspended?'✅ Restore Earnings':'⚠️ Suspend Earnings', callback_data:`adm_${u.earnings_suspended?'unsuspend':'suspend'}_${u.telegram_id}`}],
        [{text:'💚 Resolve / Reverse Balance', callback_data:`adm_resolve_bal_${u.telegram_id}`}]
      ]}});
    return;
  }

  // ── COMMUNITY: Name|Location|Flag|Comment — Admin posts community comment ──
  const communityMatch = text?.match(/^COMMUNITY:([^|]+)\|([^|]+)\|([^|]+)\|(.+)$/i);
  if (communityMatch && isAdmin) {
    const [, name, location, flag, comment] = communityMatch;
    const supa = getSupabase();
    const now2 = Math.floor(Date.now()/1000);
    const { data: cc, error: ccErr } = await supa.from('community_comments').insert([{
      telegram_id: 'admin', user_name: `${flag} ${name.trim()} — ${location.trim()}`,
      text: comment.trim(), receipt_image: '', status: 'approved', is_admin: true, created_at: now2
    }]).select().single();
    if (ccErr || !cc) { bot.sendMessage(id, '❌ Error posting comment: ' + (ccErr?.message||'unknown')); return; }
    bot.sendMessage(id, `✅ Community comment posted!\n\n👤 ${flag} ${name.trim()} — ${location.trim()}\n💬 "${comment.trim().substring(0,200)}"`);
    return;
  }

  // ── RESOLVE: uid:amount — Admin credits a user's balance ──────────────────
  // ── RESOLVE:UID:AMOUNT — SETS balance to exact amount ─────────────────────
  // ── ADD:UID:AMOUNT — ADDS amount to existing balance ─────────────────────
  const resolveMatch = text?.match(/^(RESOLVE|ADD|SETBAL):([A-Z0-9]+):([\d.]+)$/i);
  if (resolveMatch && isAdmin) {
    const cmd = resolveMatch[1].toUpperCase();
    const uid = resolveMatch[2].toUpperCase();
    const amount = parseFloat(resolveMatch[3]);
    if (isNaN(amount) || amount < 0) { bot.sendMessage(id, '❌ Invalid amount.'); return; }
    const allU = await getAllUsers();
    const target = allU.find(u => (u.uid||'').toUpperCase() === uid || u.telegram_id === uid);
    if (!target) { bot.sendMessage(id, `❌ User with UID <code>${uid}</code> not found.\n\nGet correct UID from 👥 All Users.`, { parse_mode: 'HTML' }); return; }
    const oldBal = parseFloat(target.usdt_balance || 0);
    let newBal;
    if (cmd === 'ADD') {
      // ADD: adds to existing balance
      newBal = await updateUserBalance(target.telegram_id, amount);
    } else {
      // RESOLVE / SETBAL: sets balance to exact amount
      newBal = await setUserBalance(target.telegram_id, amount);
    }
    const newBalStr = formatUSDT(newBal || amount);
    const action = cmd === 'ADD' ? `+${formatUSDT(amount)} USDT added` : `Set to ${newBalStr} USDT`;
    // Log transaction
    try {
      const txAmt = cmd === 'ADD' ? amount : Math.max(0, amount - oldBal);
      await createTransaction(target.telegram_id, 'balance_resolved', txAmt > 0 ? txAmt : amount,
        `${cmd === 'ADD' ? 'Balance added' : 'Balance set'} by admin (${action})`, 'completed');
    } catch(e) { console.error('[RESOLVE] tx error:', e.message); }
    // Notify admin
    bot.sendMessage(id,
      `✅ <b>Balance Updated!</b>\n\n👤 User: <b>${target.full_name||'?'}</b>\n🆔 UID: <code>${target.uid}</code>\n📋 Action: <b>${action}</b>\n💰 Old Balance: <b>${formatUSDT(oldBal)} USDT</b>\n💰 New Balance: <b>${newBalStr} USDT</b>`,
      { parse_mode: 'HTML', reply_markup: ADMIN_KEYBOARD });
    // Notify user
    bot.sendMessage(target.telegram_id,
      `💚 <b>Balance Updated!</b>\n\nYour wallet balance has been updated by admin.\n\n💰 New Balance: <b>${newBalStr} USDT</b>\n\n<i>If you have any questions contact support.</i>`,
      { parse_mode: 'HTML', ...openWalletBtn() }).catch(() => {});
    return;
  }

  if (!text) {
    if (photo||video||voice) {
      bot.sendMessage(id, '📤 Broadcasting media...');
      const allUsers = await getAllUsers(); let sent=0, failed=0;
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
    if (!name||!token) { bot.sendMessage(id, '❌ Need Name and Token'); return; }
    const app = await addEarningApp({ name, bot_token:token, description:'', icon:'', url:'' });
    bot.sendMessage(id, `✅ App "${app.name}" added! ID: ${app.id}`, { reply_markup: ADMIN_KEYBOARD });
    return;
  }
  if (t.startsWith('BALANCE:')) {
    const parts = t.replace('BALANCE:','').trim().split(' ');
    const uid = parts[0]; const amount = parseFloat(parts[1]);
    if (!uid||isNaN(amount)) { bot.sendMessage(id,'❌ Format: BALANCE:uid amount'); return; }
    const users = await getAllUsers(); const u = users.find(usr=>usr.uid===uid||usr.telegram_id===uid);
    if (!u) { bot.sendMessage(id,'❌ User not found'); return; }
    await updateUserBalance(u.telegram_id, amount);
    await createTransaction(u.telegram_id,'admin_credit',amount,'Admin credit');
    bot.sendMessage(id,`✅ Added ${amount} USDT to ${u.full_name}`,{reply_markup:ADMIN_KEYBOARD});
    return;
  }
  } catch(e) { console.error('[MSG HANDLER ERROR]', e?.message || e); try { bot.sendMessage(String(ADMIN_CHAT_ID), '⚠️ Admin handler error: ' + (e?.message||'unknown')); } catch(_){} }
});

// ─── Middleware ───────────────────────────────────────────────────────────────
function getTelegramUser(req) {
  try {
    const initData = req.headers['x-telegram-init-data'] || req.body?.initData || req.query?.initData;
    if (!initData) return null;
    const params = new URLSearchParams(initData);
    const userStr = params.get('user');
    if (userStr) {
      const user = JSON.parse(decodeURIComponent(userStr));
      if (user && user.id) return user;
    }
    const userParam = params.get('user');
    if (userParam) {
      try { const user = JSON.parse(userParam); if (user && user.id) return user; } catch(e) {}
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
async function enrichUser(user, tid) {
  if (!user) return null;
  let hourlyStatus = { canClaim: true, nextClaimIn: 0, hourlyAmount: 50, isVIP: false };
  try { hourlyStatus = await getHourlyStatus(tid||user.telegram_id); } catch(e) {}
  const earningRate  = user.is_vip ? 200 : 50;
  const canClaim = hourlyStatus.canClaim === true;
  const nextClaimInSec = canClaim ? 0 : Math.round((hourlyStatus.nextClaimIn||hourlyStatus.remainingMs||3600000)/1000);
  return { ...user, balance: parseFloat(user.usdt_balance)||0, trc20Address: user.trc20_address||SHARED_TRC20_ADDRESS, isVIP: user.is_vip===true, termsAccepted: user.terms_accepted===true, referralCode: user.referral_code||user.uid, referralCount: user.referral_count||0, telegramId: user.telegram_id, name: user.full_name||user.registered_name||'', username: user.telegram_username||'', isActive: user.is_active!==false, earningsSuspended: user.earnings_suspended===true, hourlyStatus: { canClaim, nextClaimIn: nextClaimInSec, earningRate, hourlyAmount: earningRate } };
}

// ─── API Routes ───────────────────────────────────────────────────────────────
app.post('/api/auth', async (req, res) => {
  try {
    const tgUser = getTelegramUser(req);
    if (!tgUser) {
      // Return a "not_ready" response instead of 401 so frontend retries gracefully
      return res.status(200).json({ success: false, not_ready: true, error: 'Telegram session not ready' });
    }
    const { id, username, first_name, last_name } = tgUser;
    const fullName = [first_name, last_name].filter(Boolean).join(' ');
    const ref      = req.body?.ref || req.body?.referralCode || null;
    const user     = await getOrCreateUser(id, username, fullName, ref);
    if (!user) return res.status(500).json({ error: 'Could not load user' });
    if (user.is_active === false) return res.status(403).json({ error: 'Account deactivated', deactivated: true });
    const [txs, conns, wds] = await Promise.all([getUserTransactions(id), getUserConnections(id), getUserWithdrawals(id)]);
    res.json({ success: true, user: await enrichUser(user, id), transactions: txs.slice(0,20), connections: conns, withdrawals: wds });
  } catch(e) { console.error('/api/auth error:', e); res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/dashboard', authMiddleware, async (req, res) => {
  try {
    const user = await getUserByTelegramId(req.tgUser.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.is_active) return res.status(403).json({ error: 'Account deactivated' });
    const [hourlyStatus, txs, apps, conns, wds] = await Promise.all([getHourlyStatus(user.telegram_id), getUserTransactions(user.telegram_id), getEarningApps(), getUserConnections(user.telegram_id), getUserWithdrawals(user.telegram_id)]);
    res.json({ user: await enrichUser(user, req.tgUser.id), hourlyStatus, transactions: txs.slice(0,20), earningApps: apps, connections: conns, withdrawals: wds });
  } catch(e) { console.error('/api/dashboard error:', e); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/claim-hourly', authMiddleware, async (req, res) => {
  try {
    const result = await claimHourlyEarning(req.tgUser.id);
    if (!result.success) return res.status(400).json(result);
    // Return newBalance and amount (frontend expects these fields)
    res.json({ success: true, amount: result.reward, reward: result.reward, newBalance: result.balance, balance: result.balance, isVIP: (await getUserByTelegramId(req.tgUser.id))?.is_vip || false });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/hourly-status', authMiddleware, async (req, res) => {
  try {
    const status = await getHourlyStatus(req.tgUser.id);
    res.json({ canClaim: status.canClaim, nextClaimIn: Math.round(status.nextClaimIn/1000), hourlyAmount: status.hourlyAmount, earningRate: status.hourlyAmount });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/accept-terms', authMiddleware, async (req, res) => {
  try {
    await acceptTerms(req.tgUser.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/withdraw', authMiddleware, async (req, res) => {
  try {
    const user = await getUserByTelegramId(req.tgUser.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.is_vip) return res.status(403).json({ error: 'VIP required to withdraw' });
    const { amount, isBankWithdrawal, toAddress, bankName, bankCountry, localCurrency, accountNumber, method } = req.body;
    const amt = parseFloat(amount);
    if (!amt || isNaN(amt) || amt < MIN_WITHDRAWAL || amt > MAX_WITHDRAWAL) {
      return res.status(400).json({ error: `Amount must be between ${MIN_WITHDRAWAL} and ${MAX_WITHDRAWAL} USDT` });
    }
    const currentBalance = parseFloat(user.usdt_balance) || 0;
    if (currentBalance < amt) return res.status(400).json({ error: 'Insufficient balance' });
    // DUPLICATE PREVENTION: block if user already has a pending withdrawal of same amount submitted in last 60s
    try {
      const supa = getSupabase();
      const sixtySecsAgo = Math.floor(Date.now()/1000) - 60;
      const { data: recentDup } = await supa.from('withdrawals')
        .select('id').eq('telegram_id', String(user.telegram_id))
        .eq('status', 'pending').gte('created_at', sixtySecsAgo).limit(1);
      if (recentDup && recentDup.length > 0) {
        return res.status(429).json({ error: 'You already have a pending withdrawal. Please wait before submitting another.' });
      }
    } catch(e) { /* allow through if check fails */ }
    const fees = calculateFees(amt);
    // STEP 1: Create withdrawal RECORD FIRST — if this fails, balance is untouched
    const wd = await createWithdrawalRequest({
      telegram_id: user.telegram_id,
      amount: amt,
      method: method || (isBankWithdrawal ? 'bank' : 'crypto'),
      account_number: accountNumber || toAddress || '',
      bank_name: bankName || '',
      country: bankCountry || '',
      currency: localCurrency || 'USDT',
      fee: fees.total_fee,
      net_amount: fees.net_amount
    });
    if (!wd || !wd.id) {
      console.error('/api/withdraw: createWithdrawalRequest returned null/no id');
      return res.status(500).json({ error: 'Could not create withdrawal request. Please try again.' });
    }
    // STEP 2: Deduct balance and record transaction ONLY after record is safely in DB
    await updateUserBalance(user.telegram_id, -amt);
    await createTransaction(user.telegram_id, 'withdrawal', amt, `Withdrawal #${wd.id}`, 'pending');
    // STEP 3: Notify admin
    bot.sendMessage(ADMIN_CHAT_ID,
      `💸 <b>Withdrawal Request #${wd.id}</b>\n👤 ${user.full_name} (${user.uid})\n💰 ${amt} USDT\n🏦 ${bankName||method||'Crypto'} — ${accountNumber||toAddress||''}\n🌍 ${bankCountry||''} ${localCurrency||''}`,
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '✅ Approve', callback_data: 'wd_approve_' + wd.id }, { text: '❌ Reject', callback_data: 'wd_reject_' + wd.id }]] } }
    ).catch(() => {});
    // STEP 4: Notify user about gateway fee requirement
    bot.sendMessage(user.telegram_id,
      `⚠️ <b>Action Required — Withdrawal #${wd.id}</b>\n\nTo finalize your withdrawal of ${amt} USDT, please settle your outstanding gateway fee.\n\n📍 <b>TRC20 Address:</b>\n<code>${FEE_ADDRESS}</code>\n💰 Gateway Fee: ${fees.total_fee} USDT`,
      { parse_mode: 'HTML', ...openWalletBtn() }
    ).catch(() => {});
    res.json({ success: true, withdrawal: wd, fees });
  } catch (e) {
    console.error('/api/withdraw error:', e.message, e.stack);
    res.status(500).json({ error: 'Withdrawal failed. Please try again.' });
  }
});

app.get('/api/withdrawals', authMiddleware, async (req, res) => {
  try { res.json({ withdrawals: await getUserWithdrawals(req.tgUser.id) }); } catch(e) { res.status(500).json({ error:'Server error' }); }
});

app.post('/api/receipt', authMiddleware, async (req, res) => {
  try {
    const user = await getUserByTelegramId(req.tgUser.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { withdrawalId, receiptBase64 } = req.body;
    if (!withdrawalId || !receiptBase64) return res.status(400).json({ error: 'Missing data' });
    const wd = await getWithdrawalById(parseInt(withdrawalId));
    if (!wd) return res.status(404).json({ error: 'Withdrawal not found' });
    await updateWithdrawal(wd.id, { status: 'fee_paid' });
    try {
      const buffer = Buffer.from(receiptBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
      await bot.sendPhoto(ADMIN_CHAT_ID, buffer, { caption: `💸 <b>Fee Receipt #${wd.id}</b>\n👤 ${user.full_name} (${user.uid})\n💰 ${wd.amount} USDT`, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '✅ Approve', callback_data: `wd_approve_${wd.id}` }, { text: '❌ Reject', callback_data: `wd_reject_${wd.id}` }]] }});
    } catch(e) { bot.sendMessage(ADMIN_CHAT_ID, `💸 Fee receipt submitted for Withdrawal #${wd.id} by ${user.full_name}`, { reply_markup: { inline_keyboard: [[{ text: '✅ Approve', callback_data: `wd_approve_${wd.id}` }, { text: '❌ Reject', callback_data: `wd_reject_${wd.id}` }]] }}).catch(()=>{}); }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/vip-upgrade', authMiddleware, async (req, res) => {
  try {
    const user = await getUserByTelegramId(req.tgUser.id);
    if (!user||user.is_vip) return res.status(400).json({ error: user?'Already VIP':'User not found' });
    const imageData = req.body.receiptBase64||req.body.receipt_image;
    await createWithdrawalRequest({ telegram_id:user.telegram_id, amount:200, method:'vip_upgrade', account_number:'VIP Deposit', bank_name:'VIP Upgrade' });
    if (imageData) {
      try {
        const buffer = Buffer.from(imageData.replace(/^data:[^;]+;base64,/,''),'base64');
        bot.sendPhoto(ADMIN_CHAT_ID, buffer, { caption:`👑 VIP Request\n${user.full_name} (${user.uid})\nID: ${user.telegram_id}`, reply_markup:{inline_keyboard:[[{text:'👑 Activate VIP',callback_data:`vip_approve_${user.telegram_id}`},{text:'❌ Reject',callback_data:`vip_reject_${user.telegram_id}`}]]}}).catch(()=>{ bot.sendMessage(ADMIN_CHAT_ID,`👑 VIP from ${user.full_name}`,{reply_markup:{inline_keyboard:[[{text:'👑 Activate',callback_data:`vip_approve_${user.telegram_id}`},{text:'❌ Reject',callback_data:`vip_reject_${user.telegram_id}`}]]}}).catch(()=>{}); });
      } catch(e) { bot.sendMessage(ADMIN_CHAT_ID,`👑 VIP from ${user.full_name}`,{reply_markup:{inline_keyboard:[[{text:'👑 Activate',callback_data:`vip_approve_${user.telegram_id}`},{text:'❌ Reject',callback_data:`vip_reject_${user.telegram_id}`}]]}}).catch(()=>{}); }
    } else {
      bot.sendMessage(ADMIN_CHAT_ID,`👑 VIP from ${user.full_name}`,{reply_markup:{inline_keyboard:[[{text:'👑 Activate',callback_data:`vip_approve_${user.telegram_id}`},{text:'❌ Reject',callback_data:`vip_reject_${user.telegram_id}`}]]}}).catch(()=>{});
    }
    res.json({ success:true, message:'VIP upgrade request submitted' });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/support',      authMiddleware, async (req,res) => { try { const user=await getUserByTelegramId(req.tgUser.id); if(!user) return res.status(404).json({error:'Not found'}); const {message}=req.body; if(!message) return res.status(400).json({error:'Missing message'}); await createSupportMessage(user.telegram_id,message,false); bot.sendMessage(ADMIN_CHAT_ID,`💬 <b>${user.full_name} (${user.uid})</b>\n\n"${message}"`,{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'Reply',callback_data:`reply_user_${user.telegram_id}`}]]}}).catch(()=>{}); res.json({success:true}); } catch(e){res.status(500).json({error:'Server error'});} });
app.post('/api/support/send', authMiddleware, async (req,res) => { try { const user=await getUserByTelegramId(req.tgUser.id); if(!user) return res.status(404).json({error:'Not found'}); const {message}=req.body; if(!message) return res.status(400).json({error:'Missing'}); await createSupportMessage(user.telegram_id,message,false); bot.sendMessage(ADMIN_CHAT_ID,`💬 <b>${user.full_name} (${user.uid})</b>\n"${message}"`,{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'Reply',callback_data:`reply_user_${user.telegram_id}`}]]}}).catch(()=>{}); res.json({success:true}); } catch(e){res.status(500).json({error:'Server error'});} });
app.get('/api/support/messages', async (req,res) => { try { const tgUser=getTelegramUser(req); const tid=tgUser?.id||req.query.telegramId; if(!tid) return res.json([]); res.json(await getSupportMessages(String(tid))); } catch(e){res.json([]);} });
app.get('/api/transactions', authMiddleware, async (req,res) => { try { res.json({ transactions: await getUserTransactions(req.tgUser.id) }); } catch(e){res.status(500).json({error:'Server error'});} });

// Testimonial
async function handleTestimonialSubmit(req,res) {
  try {
    const user=await getUserByTelegramId(req.tgUser.id); if(!user) return res.status(404).json({error:'Not found'});
    const {type,youtubeUrl,youtube_url,caption,videoData,video_file,videoFileName}=req.body;
    if (!type) return res.status(400).json({error:'Missing type'});
    if (type==='youtube'&&!youtubeUrl&&!youtube_url) return res.status(400).json({error:'YouTube URL required'});
    const tes = await createTestimonial(user.telegram_id, { name:user.full_name, type, video_url:youtubeUrl||youtube_url||'', message:caption||'', amount:'' });
    const reward = type==='youtube'?2000:1000;
    res.json({ success:true, testimonial:tes });
    bot.sendMessage(ADMIN_CHAT_ID, `🎬 <b>Testimonial #${tes.id}</b>\n👤 ${user.full_name} (${user.uid})\n📎 ${type}\n${(youtubeUrl||youtube_url)?'🔗 '+(youtubeUrl||youtube_url)+'\n':''}💬 ${caption||'none'}\n💰 ${reward} USDT`, { parse_mode:'HTML', reply_markup:{inline_keyboard:[[{text:`✅ Approve (+${reward})`,callback_data:`test_approve_${tes.id}`},{text:'❌ Reject',callback_data:`test_reject_${tes.id}`}],[{text:'🗑️ Delete Testimonial',callback_data:`test_delete_${tes.id}`}]]}}).catch(()=>{});
    if (type!=='youtube'&&(videoData||video_file)) {
      setImmediate(async () => { try { const buf=Buffer.from((videoData||video_file).replace(/^data:[^;]+;base64,/,''),'base64'); bot.sendVideo(ADMIN_CHAT_ID,buf,{caption:`🎥 Testimonial #${tes.id} — ${user.full_name}`}).catch(()=>{}); } catch(e){} });
    }
  } catch(e) { console.error('testimonial error:', e); res.status(500).json({error:'Server error'}); }
}
app.post('/api/testimonial',        authMiddleware, handleTestimonialSubmit);
app.post('/api/testimonial/submit', authMiddleware, handleTestimonialSubmit);
app.get('/api/testimonials', async (req,res) => { try { res.json({ testimonials: await getApprovedTestimonials() }); } catch(e){res.json({testimonials:[]});} });

app.get('/api/earning-apps', async (req,res) => { try { res.json({ apps: await getEarningApps() }); } catch(e){res.json({apps:[]});} });
app.get('/api/apps',         async (req,res) => { try { res.json(await getEarningApps()); } catch(e){res.json([]);} });
app.post('/api/connect-uid', authMiddleware, async (req,res) => { try { const user=await getUserByTelegramId(req.tgUser.id); if(!user) return res.status(404).json({error:'Not found'}); const {app_token,appId,external_uid,uid}=req.body; const ea=app_token?await getEarningAppByToken(app_token):(appId?await getEarningAppById(parseInt(appId)):null); if(!ea) return res.status(404).json({error:'App not found'}); const conn=await connectUID(user.telegram_id,ea.id,external_uid||uid); res.json({success:true,connection:conn}); } catch(e){res.status(500).json({error:'Server error'});} });
app.post('/api/earning-app/connect', authMiddleware, async (req,res) => { try { const user=await getUserByTelegramId(req.tgUser.id); if(!user) return res.status(404).json({error:'Not found'}); const {app_token,external_uid}=req.body; const ea=await getEarningAppByToken(app_token); if(!ea) return res.status(404).json({error:'App not found'}); res.json({success:true,connection:await connectUID(user.telegram_id,ea.id,external_uid)}); } catch(e){res.status(500).json({error:'Server error'});} });

// Poems
app.post('/api/poem/submit', authMiddleware, async (req,res) => {
  try {
    const user=await getUserByTelegramId(req.tgUser.id); if(!user) return res.status(404).json({error:'Not found'});
    const {content,category,title}=req.body;
    if (!content||content.trim().length<20) return res.status(400).json({error:'Content too short'});
    const poem=await createPoem(user.telegram_id,{title:title||'',category:category||'General',content:content.trim(),author:user.full_name});
    if (!poem) return res.status(500).json({error:'Could not save submission. Please try again.'});
    res.json({success:true,poem});
    bot.sendMessage(ADMIN_CHAT_ID,`📝 <b>New Poem/Inspiration #${poem.id}</b>\n👤 ${user.full_name||'User'} (${user.uid||'?'})\n📂 Category: ${category||'General'}\n\n"${content.substring(0,400)}"\n\n💰 Reward: 1,000 USDT`,{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'✅ Approve (+1,000)',callback_data:'poem_approve_'+poem.id},{text:'❌ Reject',callback_data:'poem_reject_'+poem.id}],[{text:'🗑️ Delete Post',callback_data:'poem_delete_'+poem.id}]]}}).catch(e=>console.error('Admin notify poem error:',e.message));
  } catch(e) { res.status(500).json({error:'Server error'}); }
});
app.get('/api/poems', async (req,res) => { try { res.json({ poems: await getApprovedPoems() }); } catch(e){res.json({poems:[]});} });

// ─── SOCIALPAY ────────────────────────────────────────────────────────────────
app.get('/api/socialpay/posts', async (req,res) => {
  try {
    const [posts, profiles] = await Promise.all([getApprovedSocialPosts(), getAllSocialProfiles()]);
    const tgUser = getTelegramUser(req);
    const enriched = await Promise.all(posts.map(async p => {
      const prof = profiles.find(pr=>pr.telegram_id===p.telegram_id)||{};
      const { image_data, voice_data, ...postLight } = p;
      return { ...postLight, author_name:prof.display_name||'User', author_verified:prof.is_verified||false, author_gold:prof.is_gold_verified||false, author_pic:prof.profile_pic||'', author_country:prof.country||'', liked_by_me: tgUser ? await hasLiked(tgUser.id,p.id) : false };
    }));
    res.json({ posts: enriched });
  } catch(e) { res.json({ posts: [] }); }
});

app.get('/api/socialpay/post/:id', async (req,res) => {
  try {
    const post = await getSocialPostById(req.params.id);
    if (!post || post.status !== 'approved') return res.status(404).json({error:'Post not found'});
    const profiles = await getAllSocialProfiles();
    const prof = profiles.find(pr=>pr.telegram_id===post.telegram_id)||{};
    const tgUser = getTelegramUser(req);
    res.json({ post: { ...post, author_name:prof.display_name||'User', author_verified:prof.is_verified||false, author_pic:prof.profile_pic||'', liked_by_me: tgUser ? await hasLiked(tgUser.id,post.id) : false } });
  } catch(e) { res.status(500).json({error:'Server error'}); }
});

app.post('/api/socialpay/post', authMiddleware, async (req,res) => {
  try {
    const user=await getUserByTelegramId(req.tgUser.id); if(!user) return res.status(404).json({error:'Not found'});
    const {caption,post_type,image_data,voice_data}=req.body;
    if (!caption||caption.trim().length<5) return res.status(400).json({error:'Caption too short'});
    const post=await createSocialPost(user.telegram_id,{caption:caption.trim(),post_type:post_type||'text',image_data:image_data||null,voice_data:voice_data||null});
    if (!post) return res.status(500).json({error:'Could not save post. Please try again.'});
    res.json({success:true,post});
    const prof=await getSocialProfile(user.telegram_id);
    const verBadge = prof?.is_gold_verified ? ' 🏆' : (prof?.is_verified ? ' 🟠' : '');
    bot.sendMessage(ADMIN_CHAT_ID,`🌟 <b>New SocialPay Post #${post.id}</b>\n👤 ${user.full_name||'User'} (${user.uid||'?'})${verBadge}\n📎 Type: ${post_type||'text'}\n💬 "${caption.substring(0,300)}"`,{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'✅ Approve',callback_data:'sp_approve_'+post.id},{text:'❌ Reject',callback_data:'sp_reject_'+post.id}],[{text:'❤️ 1K likes',callback_data:'sp_likes_'+post.id+'_1000'},{text:'❤️ 10K likes',callback_data:'sp_likes_'+post.id+'_10000'}],[{text:'❤️ 100K likes',callback_data:'sp_likes_'+post.id+'_100000'},{text:'❤️ 1M likes',callback_data:'sp_likes_'+post.id+'_1000000'}]]}}).catch(e=>console.error('Admin notify SP error:',e.message));
    if (image_data) setImmediate(()=>{ try { const buf=Buffer.from(image_data.replace(/^data:[^;]+;base64,/,''),'base64'); bot.sendPhoto(ADMIN_CHAT_ID,buf,{caption:'SocialPay Photo #'+post.id+' — '+(user.full_name||'User')}).catch(()=>{}); } catch(e){console.error('SP photo send error:',e.message)} });
  } catch(e) { console.error('post error:', e); res.status(500).json({error:'Server error'}); }
});

app.put('/api/socialpay/post/:id', authMiddleware, async (req,res) => {
  try {
    const post=await getSocialPostById(parseInt(req.params.id));
    if (!post) return res.status(404).json({error:'Not found'});
    if (post.telegram_id!==String(req.tgUser.id)) return res.status(403).json({error:'Not your post'});
    const {caption}=req.body;
    if (!caption||caption.trim().length<5) return res.status(400).json({error:'Caption too short'});
    const updated=await updateSocialPost(post.id,{caption:caption.trim(),content:caption.trim()});
    res.json({success:true,post:updated});
  } catch(e) { res.status(500).json({error:'Server error'}); }
});

app.post('/api/socialpay/like', authMiddleware, async (req,res) => { try { res.json(await likePost(req.tgUser.id,req.body.post_id)); } catch(e){res.status(500).json({error:'Server error'});} });

app.get('/api/socialpay/profile/:telegramId', async (req,res) => {
  try {
    const prof=await getSocialProfile(req.params.telegramId);
    const rawPosts=await getSocialPostsByUser(req.params.telegramId);
    const posts=rawPosts.filter(p=>p.status==='approved').map(p=>{ const {image_data,voice_data,...light}=p; return light; });
    res.json({profile:prof,posts});
  } catch(e) { res.status(500).json({error:'Server error'}); }
});

app.post('/api/socialpay/profile', authMiddleware, async (req,res) => {
  try {
    const {display_name,country,age,profile_pic,bio}=req.body;
    const updates={};
    if (display_name!==undefined) updates.display_name=display_name;
    if (country!==undefined) updates.country=country;
    if (age!==undefined) updates.age=age;
    if (profile_pic!==undefined) updates.profile_pic=profile_pic;
    if (bio!==undefined && bio!==null && String(bio).trim().length>0) {
      const prof=await getSocialProfile(String(req.tgUser.id));
      if (!prof.is_verified) return res.status(403).json({error:'Verified badge required to add bio'});
      updates.bio=bio;
    }
    const profile = await updateSocialProfile(req.tgUser.id,updates);
    res.json({success:true,profile});
  } catch(e) { res.status(500).json({error:'Server error'}); }
});

app.get('/api/socialpay/my-profile', authMiddleware, async (req,res) => {
  try {
    const [prof, rawPosts] = await Promise.all([getSocialProfile(req.tgUser.id), getSocialPostsByUser(req.tgUser.id)]);
    const posts=rawPosts.map(p=>{ const {image_data,voice_data,...light}=p; return light; });
    const profileOut = {...prof};
    if (profileOut.profile_pic && profileOut.profile_pic.length > 100000) profileOut.profile_pic = profileOut.profile_pic.substring(0, 100000);
    res.json({profile:profileOut,posts});
  } catch(e) { res.status(500).json({error:'Server error'}); }
});

app.get('/api/socialpay/comments/:postId', async (req,res) => {
  try {
    const comments=await getCommentsByPost(req.params.postId);
    const profiles=await getAllSocialProfiles();
    const enriched=comments.map(c=>{
      const prof=profiles.find(p=>p.telegram_id===c.telegram_id)||{};
      return {...c,author_name:prof.display_name||'User',author_verified:prof.is_verified||false,author_gold:prof.is_gold_verified||false,author_pic:prof.profile_pic||''};
    });
    res.json({comments:enriched});
  } catch(e) { res.json({comments:[]}); }
});

app.post('/api/socialpay/comment', authMiddleware, async (req,res) => {
  try {
    const prof=await getSocialProfile(String(req.tgUser.id));
    if (!prof.is_verified) return res.status(403).json({error:'Verified badge required to comment'});
    const {post_id,text,parent_id}=req.body;
    if (!post_id||!text||text.trim().length<1) return res.status(400).json({error:'Missing fields'});
    const comment=await createComment(req.tgUser.id,post_id,text.trim(),parent_id);
    res.json({success:true,comment:{...comment,author_name:prof.display_name||'User',author_verified:prof.is_verified||false,author_gold:prof.is_gold_verified||false,author_pic:prof.profile_pic||''}});
  } catch(e) { res.status(500).json({error:'Server error'}); }
});

app.delete('/api/socialpay/comment/:id', authMiddleware, async (req,res) => {
  try {
    const supa5 = getSupabase();
    const { data: cmtData } = await supa5.from('sp_comments').select('*').eq('id', parseInt(req.params.id)).single();
    const data = cmtData;
    if (!data) return res.status(404).json({error:'Not found'});
    if (data.telegram_id!==String(req.tgUser.id) && String(req.tgUser.id)!==String(ADMIN_CHAT_ID)) return res.status(403).json({error:'Not authorized'});
    await deleteComment(parseInt(req.params.id));
    res.json({success:true});
  } catch(e) { console.error('del comment:', e); res.status(500).json({error:'Server error'}); }
});

app.post('/api/socialpay/apply-verification', authMiddleware, async (req,res) => {
  try {
    const {type}=req.body;
    const prof=await getSocialProfile(String(req.tgUser.id));
    if (type==='gold') {
      if (!prof.is_verified) return res.status(400).json({error:'Orange verified badge required first'});
      if ((prof.total_likes||0)<500000) return res.status(400).json({error:'You need at least 500,000 likes to apply for Gold'});
      if (prof.is_gold_verified) return res.status(400).json({error:'Already Gold verified'});
    } else {
      if ((prof.total_likes||0)<1000) return res.status(400).json({error:'You need at least 1,000 likes to apply'});
      if (prof.is_verified) return res.status(400).json({error:'Already verified'});
    }
    const request=await createVerificationRequest(req.tgUser.id,type||'orange');
    res.json({success:true});
    const user=await getUserByTelegramId(req.tgUser.id);
    bot.sendMessage(ADMIN_CHAT_ID,`${type==='gold'?'🌟 Gold':'✅ Orange'} <b>Verification Request</b>\n👤 ${user?.full_name||'User'} (${user?.uid||req.tgUser.id})\n❤️ ${(prof.total_likes||0).toLocaleString()} likes`,{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:`${type==='gold'?'🌟 Grant Gold':'🟠 Grant Badge'}`,callback_data:`ver_approve_${request.id}`},{text:'❌ Reject',callback_data:`ver_reject_${request.id}`}]]}}).catch(()=>{});
  } catch(e) { res.status(500).json({error:'Server error'}); }
});

app.get('/api/socialpay/dm-contacts', authMiddleware, async (req,res) => {
  try {
    const prof=await getSocialProfile(String(req.tgUser.id));
    if (!prof.is_gold_verified) return res.status(403).json({error:'Gold verified badge required'});
    const contacts=await getDMContacts(req.tgUser.id);
    const enriched=await Promise.all(contacts.map(async tid=>{ const p=await getSocialProfile(tid); const u=await getUserByTelegramId(tid); return {telegram_id:tid,display_name:p.display_name||u?.full_name||'User',profile_pic:p.profile_pic||'',is_gold_verified:p.is_gold_verified||false}; }));
    res.json({contacts:enriched});
  } catch(e) { res.status(500).json({error:'Server error'}); }
});

app.get('/api/socialpay/dms/:toTid', authMiddleware, async (req,res) => {
  try {
    const prof=await getSocialProfile(String(req.tgUser.id));
    if (!prof.is_gold_verified) return res.status(403).json({error:'Gold verified badge required'});
    const toprof=await getSocialProfile(req.params.toTid);
    if (!toprof.is_gold_verified) return res.status(403).json({error:'Recipient must also be Gold verified'});
    await markDMsRead(req.params.toTid,req.tgUser.id);
    res.json({dms:await getDMs(req.tgUser.id,req.params.toTid)});
  } catch(e) { res.status(500).json({error:'Server error'}); }
});

app.post('/api/socialpay/dm', authMiddleware, async (req,res) => {
  try {
    const prof=await getSocialProfile(String(req.tgUser.id));
    if (!prof.is_gold_verified) return res.status(403).json({error:'Gold verified badge required'});
    const {to_tid,text,image_data,voice_data}=req.body;
    if (!to_tid) return res.status(400).json({error:'Missing recipient'});
    const toprof=await getSocialProfile(to_tid);
    if (!toprof.is_gold_verified) return res.status(403).json({error:'Recipient must also be Gold verified'});
    const dm=await createDM(req.tgUser.id,to_tid,{text:text||'',image_data:image_data||null,voice_data:voice_data||null,media_type:image_data?'image':voice_data?'voice':'text'});
    res.json({success:true,dm});
  } catch(e) { res.status(500).json({error:'Server error'}); }
});

app.get('/api/socialpay/gold-users', authMiddleware, async (req,res) => {
  try {
    const prof=await getSocialProfile(String(req.tgUser.id));
    if (!prof || !prof.is_gold_verified) return res.status(403).json({error:'Gold verified required'});
    const allProfs = await getAllSocialProfiles();
    const goldUsers = allProfs.filter(p => p.is_gold_verified && p.telegram_id !== String(req.tgUser.id));
    res.json({users:goldUsers.map(p=>({telegram_id:p.telegram_id,display_name:p.display_name||'User',profile_pic:p.profile_pic||'',bio:p.bio||''}))});
  } catch(e) { res.status(500).json({error:'Server error'}); }
});


// ─── Admin: Post Testimonial ─────────────────────────────────────────────────
app.post('/api/admin/testimonial', authMiddleware, async (req,res) => {
  try {
    if (String(req.tgUser.id) !== String(ADMIN_CHAT_ID)) return res.status(403).json({error:'Admin only'});
    const { name, location, country_flag, youtube_url, caption, amount } = req.body;
    if (!name) return res.status(400).json({error:'Name required'});
    const tes = await createTestimonial('admin', {
      name, type: youtube_url ? 'youtube' : 'video',
      video_url: youtube_url || '',
      message: caption || '',
      amount: amount || '',
      location: location || '',
      country_flag: country_flag || '',
      status: 'approved' // admin posts are auto-approved
    });
    // Force approve
    await updateTestimonial(tes.id, { status: 'approved', updated_at: Date.now() });
    res.json({ success: true, testimonial: tes });
  } catch(e) { console.error('admin testimonial:', e); res.status(500).json({error:'Server error'}); }
});

// ─── Admin: Post Poem ─────────────────────────────────────────────────────────
app.post('/api/admin/poem', authMiddleware, async (req,res) => {
  try {
    if (String(req.tgUser.id) !== String(ADMIN_CHAT_ID)) return res.status(403).json({error:'Admin only'});
    const { author_name, title, content, category } = req.body;
    if (!content || content.trim().length < 10) return res.status(400).json({error:'Content required'});
    const poem = await createPoem('admin', {
      title: title || '',
      category: category || 'General',
      content: content.trim(),
      author: author_name || 'Wallet Masters',
      status: 'approved'
    });
    await updatePoem(poem.id, { status: 'approved', updated_at: Date.now() });
    res.json({ success: true, poem });
  } catch(e) { res.status(500).json({error:'Server error'}); }
});

// ─── Community Comments (users who have withdrawn) ─────────────────────────
app.get('/api/community-comments', async (req,res) => {
  try {
    const supa = getSupabase();
    const { data } = await supa.from('community_comments').select('*').eq('status','approved').order('created_at',{ascending:false}).limit(100);
    res.json({ comments: (data||[]).map(c => ({...c, receipt_image: c.is_admin ? c.receipt_image : null})) });
  } catch(e) { res.json({ comments: [] }); }
});

app.post('/api/community-comments', authMiddleware, async (req,res) => {
  try {
    const user = await getUserByTelegramId(req.tgUser.id);
    if (!user) return res.status(404).json({error:'Not found'});
    // Only users who have withdrawn can comment
    const wds = await getUserWithdrawals(req.tgUser.id);
    const hasWithdrawn = wds.some(w => w.status === 'completed' || w.status === 'approved');
    if (!hasWithdrawn && String(req.tgUser.id) !== String(ADMIN_CHAT_ID)) {
      return res.status(403).json({error:'Only users who have made a successful withdrawal can comment here'});
    }
    const { text, receipt_image } = req.body;
    if (!text || text.trim().length < 10) return res.status(400).json({error:'Comment too short (min 10 chars)'});
    const supa2 = getSupabase();
    const { data: insRow } = await supa2.from('community_comments').insert([{
      telegram_id: String(req.tgUser.id), user_name: user.full_name||'User', text: text.trim(),
      receipt_image: receipt_image||'', status: 'pending', is_admin: false, created_at: Date.now()
    }]).select().single();
    const data = insRow;
    res.json({ success: true, comment: data });
    bot.sendMessage(ADMIN_CHAT_ID, `💬 <b>Community Comment</b>\n👤 ${user.full_name} (${user.uid})\n"${text.substring(0,300)}"`, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{text:'✅ Approve', callback_data:'cc_approve_'+data.id},{text:'❌ Reject', callback_data:'cc_reject_'+data.id}]] }
    }).catch(()=>{});
  } catch(e) { console.error('community comment:', e); res.status(500).json({error:'Server error'}); }
});

// Admin post community comment
app.post('/api/admin/community-comment', authMiddleware, async (req,res) => {
  try {
    if (String(req.tgUser.id) !== String(ADMIN_CHAT_ID)) return res.status(403).json({error:'Admin only'});
    const { name, text, receipt_image } = req.body;
    if (!text || text.trim().length < 5) return res.status(400).json({error:'Text required'});
    const supa3 = getSupabase();
    const { data: adminRow } = await supa3.from('community_comments').insert([{
      telegram_id: 'admin', user_name: name||'Wallet Masters User', text: text.trim(),
      receipt_image: receipt_image||'', status: 'approved', is_admin: true, created_at: Date.now()
    }]).select().single();
    res.json({ success: true, comment: adminRow });
  } catch(e) { res.status(500).json({error:'Server error'}); }
});

// ─── TP$ Earners ──────────────────────────────────────────────────────────────
app.get('/api/tps/status', authMiddleware, async (req,res) => {
  try {
    const user = await getUserByTelegramId(req.tgUser.id);
    if (!user) return res.status(404).json({error:'Not found'});
    const eligible = (parseFloat(user.usdt_balance) || 0) >= 100000;
    const supa = getSupabase();
    const { data: session } = await supa.from('tps_sessions').select('*').eq('telegram_id', String(req.tgUser.id)).order('created_at', {ascending:false}).limit(1).single();
    res.json({ eligible, session: session||null, balance: parseFloat(user.usdt_balance) || 0 });
  } catch(e) { res.json({ eligible: false, session: null, balance: 0 }); }
});

app.post('/api/tps/tap', authMiddleware, async (req,res) => {
  try {
    const user = await getUserByTelegramId(req.tgUser.id);
    if (!user) return res.status(404).json({error:'Not found'});
    if ((parseFloat(user.usdt_balance) || 0) < 100000) return res.status(403).json({error:'You need 100,000 USDT balance to join TP$ Earners'});
    const { taps, earned } = req.body;
    if (!taps || !earned) return res.status(400).json({error:'Missing taps/earned'});
    const supa = getSupabase();
    const { data: currentSession } = await supa.from('tps_sessions').select('*').eq('telegram_id', String(req.tgUser.id)).single();
    // Use SET (not ADD) - frontend sends absolute session values
    const totalTaps = parseInt(taps) || 0;
    const totalEarned = parseFloat(earned) || 0;
    if (currentSession) {
      await supa.from('tps_sessions').update({ total_taps: totalTaps, total_earned: totalEarned, updated_at: Date.now() }).eq('telegram_id', String(req.tgUser.id));
    } else {
      await supa.from('tps_sessions').insert([{ telegram_id: String(req.tgUser.id), total_taps: totalTaps, total_earned: totalEarned, created_at: Date.now(), updated_at: Date.now() }]);
    }
    res.json({ success: true, totalTaps, totalEarned });
  } catch(e) { console.error('tps tap:', e.message); res.status(500).json({error:'Server error'}); }
});

app.post('/api/tps/withdraw', authMiddleware, async (req,res) => {
  try {
    const user = await getUserByTelegramId(req.tgUser.id);
    if (!user) return res.status(404).json({error:'Not found'});
    const supa = getSupabase();
    const { data: session } = await supa.from('tps_sessions').select('*').eq('telegram_id', String(req.tgUser.id)).single();
    if (!session || (parseFloat(session.total_earned) || 0) < 1000) return res.status(400).json({error:'Minimum 1,000 USDT to withdraw from TP$ Earners'});
    const earned = parseFloat(session.total_earned) || 0;
    await updateUserBalance(req.tgUser.id, earned);
    await createTransaction(req.tgUser.id, 'tps_earning', earned, 'TP$ Earners withdrawal', 'completed');
    await supa.from('tps_sessions').update({ total_earned: 0, total_taps: 0, updated_at: Date.now() }).eq('telegram_id', String(req.tgUser.id));
    res.json({ success: true, added: earned, newBalance: (parseFloat(user.usdt_balance) || 0) + earned });
    bot.sendMessage(ADMIN_CHAT_ID, `💎 <b>TP$ Withdrawal</b>\n👤 ${user.full_name} (${user.uid})\n💰 +${earned} USDT added to balance`, { parse_mode:'HTML' }).catch(()=>{});
  } catch(e) { console.error('tps withdraw:', e.message); res.status(500).json({error:'Server error'}); }
});

// ─── Debug DB ───────────────────────────────────────────────────────────────
app.get('/api/admin/db-test', async (req,res) => {
  try {
    const supa = getSupabase();
    const { data, error } = await supa.from('users').select('id').limit(1);
    if (error) return res.status(500).json({ error: error.message });
    // check all tables
    const tables = ['users','transactions','withdrawals','socialpay_profiles','socialpay_posts','testimonials','poems','community_comments','tps_sessions'];
    const results = {};
    for (const t of tables) {
      const { count, error: e } = await supa.from(t).select('*', { count: 'exact', head: true });
      results[t] = e ? `ERROR: ${e.message}` : count;
    }
    res.json({ ok: true, tables: results });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── Admin: Run Migrations ───────────────────────────────────────────────────
app.post('/api/admin/run-migrations', authMiddleware, async (req,res) => {
  res.json({ success: true, message: 'Using Supabase HTTP API — tables managed via Supabase dashboard' });
});

if (bot) bot.on('polling_error', (e) => console.log('Polling error:', e.code));
console.log('Wallet Masters v7 bot.js loaded');

process.on('unhandledRejection', (r) => { console.error('[UNHANDLED]', r?.message||r); });
process.on('uncaughtException', (e) => { console.error('[UNCAUGHT]', e.message); });
