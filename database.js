/**
 * Wallet Masters — Database v9 (Supabase HTTP Client)
 * Fixes: correct hourly rewards (50/200 USDT), correct getHourlyStatus return format,
 *        balance restore on new user registration, admin balance reverse feature
 */
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://cuuekllbcrxvlxlydyta.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false }
});

const SHARED_TRC20_ADDRESS = process.env.FEE_ADDRESS || 'TPwUS8v77TtcsYZUHUTvVx2TGqE37QnagZ';
const MIN_WITHDRAWAL       = 5000;
const MAX_WITHDRAWAL       = 50000;
const GATEWAY_FEE_RATE     = 0.04;

// ─── Pending balance restores (keyed by lowercased full name) ─────────────────
// These are the balances users had before the migration.
// When a user registers fresh, if their name matches, their balance is restored.
const PENDING_BALANCE_RESTORES = {
  'balaji':           { balance: 0,      isVip: false },
  'ramesh thakur':    { balance: 150,    isVip: false },
  'burgula anil':     { balance: 50,     isVip: false },
  'gajanan nayak':    { balance: 50,     isVip: false },
  'arun kant pandey': { balance: 251450, isVip: true  },
  'mk':               { balance: 550,    isVip: false },
  'coddd mk':         { balance: 50,     isVip: false },
  'roshni nadar':     { balance: 691150, isVip: true  },
};

function generateUID() { return 'WME' + Math.random().toString(36).toUpperCase().substring(2, 10); }
function now()         { return Date.now(); }
function nowSec()      { return Math.floor(Date.now() / 1000); }

// ─── Init ─────────────────────────────────────────────────────────────────────
async function initDB() {
  const { data, error } = await supabase.from('users').select('id').limit(1);
  if (error && error.code === 'PGRST205') {
    console.error('[DB] Tables not found! Please run init SQL in Supabase dashboard.');
    throw new Error('Database tables not initialized. Run init SQL in Supabase.');
  }
  if (error) throw new Error('[DB] Connection failed: ' + error.message);
  console.log('[DB] Supabase HTTP client connected ✓');
}

// ─── User CRUD ────────────────────────────────────────────────────────────────
async function getOrCreateUser(telegramId, username, fullName, referredBy) {
  const tid = String(telegramId);
  const { data: existing } = await supabase.from('users').select('*').eq('telegram_id', tid).single();
  let user = existing || null;
  let isNew = false;

  if (!user) {
    isNew = true;
    const uid      = generateUID();
    const refCode  = generateUID();

    // Check if this user has a pending balance restore (match by name)
    const nameKey  = (fullName || '').toLowerCase().trim();
    const restore  = PENDING_BALANCE_RESTORES[nameKey] || null;
    const initBal  = restore ? restore.balance : 0;
    const initVip  = restore ? restore.isVip   : false;

    const { data: created, error } = await supabase.from('users').insert([{
      telegram_id:       tid,
      telegram_username: username    || '',
      full_name:         fullName    || '',
      registered_name:   fullName    || '',
      trc20_address:     SHARED_TRC20_ADDRESS,
      usdt_balance:      initBal,
      uid,
      is_vip:            initVip,
      vip_activated_at:  initVip ? now() : 0,
      last_hourly_claim: 0,
      last_vip_claim:    0,
      connected_apps:    [],
      terms_accepted:    false,
      referral_code:     refCode,
      referred_by:       referredBy || '',
      referral_count:    0,
      is_active:         true,
      earnings_suspended: false,
      created_at:        now(),
      updated_at:        now()
    }]).select().single();

    if (error) throw new Error('[DB:getOrCreateUser] ' + error.message);
    user = created;
    user._restored = restore ? { balance: initBal, isVip: initVip } : null;

    if (restore) {
      // Record the restore as a transaction so it shows in history
      await createTransaction(tid, 'balance_reversed', initBal, 'Balance restored from previous account', 'completed').catch(() => {});
    }

    if (referredBy) {
      const { data: referrer } = await supabase.from('users')
        .select('*')
        .or(`referral_code.eq.${referredBy},uid.eq.${referredBy}`)
        .single();
      if (referrer && referrer.telegram_id !== tid) {
        await supabase.from('users')
          .update({
            usdt_balance:  (parseFloat(referrer.usdt_balance) || 0) + 200,
            referral_count: (referrer.referral_count || 0) + 1,
            updated_at:    now()
          })
          .eq('telegram_id', referrer.telegram_id);
        user._referrer = { telegram_id: referrer.telegram_id, name: referrer.full_name };
      }
    }
  } else {
    const updates = { trc20_address: SHARED_TRC20_ADDRESS, updated_at: now() };
    if (username) updates.telegram_username = username;
    if (fullName) updates.full_name = fullName;
    await supabase.from('users').update(updates).eq('telegram_id', tid);
    const { data: refreshed } = await supabase.from('users').select('*').eq('telegram_id', tid).single();
    user = refreshed;
  }
  user._isNew = isNew;
  return user;
}

async function getUserByTelegramId(tid) {
  const { data } = await supabase.from('users').select('*').eq('telegram_id', String(tid)).single();
  return data || null;
}
async function getUserById(id) {
  const { data } = await supabase.from('users').select('*').eq('id', id).single();
  return data || null;
}
async function getAllUsers() {
  const { data } = await supabase.from('users').select('*').order('created_at', { ascending: false });
  return data || [];
}
async function updateUserBalance(telegramId, amount) {
  const tid  = String(telegramId);
  const user = await getUserByTelegramId(tid);
  if (!user) return null;
  const newBal = Math.max(0, (parseFloat(user.usdt_balance) || 0) + amount);
  await supabase.from('users').update({ usdt_balance: newBal, updated_at: now() }).eq('telegram_id', tid);
  return getUserByTelegramId(tid);
}
async function upgradeToVIP(telegramId) {
  const tid = String(telegramId);
  await supabase.from('users').update({ is_vip: true, vip_activated_at: now(), last_vip_claim: 0, updated_at: now() }).eq('telegram_id', tid);
  return getUserByTelegramId(tid);
}
async function updateUserName(telegramId, newName) {
  const tid = String(telegramId);
  await supabase.from('users').update({ registered_name: newName, full_name: newName, updated_at: now() }).eq('telegram_id', tid);
  return getUserByTelegramId(tid);
}
async function setUserActive(telegramId, isActive) {
  await supabase.from('users').update({ is_active: isActive, updated_at: now() }).eq('telegram_id', String(telegramId));
}
async function setEarningsSuspended(telegramId, suspended) {
  await supabase.from('users').update({ earnings_suspended: suspended, updated_at: now() }).eq('telegram_id', String(telegramId));
}
async function acceptTerms(telegramId) {
  await supabase.from('users').update({ terms_accepted: true, updated_at: now() }).eq('telegram_id', String(telegramId));
}

// ─── Hourly Earnings ──────────────────────────────────────────────────────────
// Normal users: 50 USDT/hr | VIP users: 200 USDT/hr
async function claimHourlyEarning(telegramId) {
  const tid  = String(telegramId);
  const user = await getUserByTelegramId(tid);
  if (!user) return { success: false, reason: 'User not found' };
  if (!user.is_active) return { success: false, reason: 'Account deactivated' };
  if (user.earnings_suspended) return { success: false, reason: 'Earnings suspended' };
  const ONE_HOUR = 3600000;
  const elapsed  = now() - (user.last_hourly_claim || 0);
  if (elapsed < ONE_HOUR) return { success: false, reason: 'Not ready', remaining: ONE_HOUR - elapsed };
  const reward  = user.is_vip ? 200 : 50;   // ✅ Fixed: was 10/5
  const newBal  = (parseFloat(user.usdt_balance) || 0) + reward;
  await supabase.from('users').update({ usdt_balance: newBal, last_hourly_claim: now(), updated_at: now() }).eq('telegram_id', tid);
  await createTransaction(tid, 'hourly_earning', reward, 'Hourly earning claimed', 'completed');
  return { success: true, reward, balance: newBal };
}

// ✅ Fixed: return { canClaim, nextClaimIn, hourlyAmount } to match what bot.js expects
async function getHourlyStatus(telegramId) {
  const user = await getUserByTelegramId(String(telegramId));
  if (!user) return { canClaim: false, nextClaimIn: 3600000, hourlyAmount: 50 };
  const ONE_HOUR    = 3600000;
  const elapsed     = now() - (user.last_hourly_claim || 0);
  const canClaim    = elapsed >= ONE_HOUR;
  const nextClaimIn = canClaim ? 0 : ONE_HOUR - elapsed;
  const hourlyAmount = user.is_vip ? 200 : 50;
  return { canClaim, nextClaimIn, hourlyAmount, lastClaim: user.last_hourly_claim };
}

// ─── Admin: Balance Reverse / Resolve ─────────────────────────────────────────
// Allows admin to manually add balance to any user with a clear transaction record.
async function adminResolveBalance(telegramId, amount, category) {
  const tid  = String(telegramId);
  const user = await getUserByTelegramId(tid);
  if (!user) return { success: false, reason: 'User not found' };
  const addAmt = parseFloat(amount) || 0;
  if (addAmt <= 0) return { success: false, reason: 'Amount must be > 0' };
  const newBal = (parseFloat(user.usdt_balance) || 0) + addAmt;
  await supabase.from('users').update({ usdt_balance: newBal, updated_at: now() }).eq('telegram_id', tid);
  const txType = (category || 'balance_reversed').toLowerCase().replace(/\s+/g, '_');
  await createTransaction(tid, txType, addAmt, category || 'Balance Reversed', 'completed');
  return { success: true, newBalance: newBal, added: addAmt };
}

// ─── Earning Apps ─────────────────────────────────────────────────────────────
async function getEarningApps() {
  const { data } = await supabase.from('earning_apps').select('*').eq('deleted', false).order('created_at', { ascending: false });
  return data || [];
}
async function getEarningAppById(id) {
  const { data } = await supabase.from('earning_apps').select('*').eq('id', id).single();
  return data || null;
}
async function getEarningAppByToken(tok) {
  const { data } = await supabase.from('earning_apps').select('*').eq('bot_token', tok).single();
  return data || null;
}
async function addEarningApp(data) {
  const { data: created } = await supabase.from('earning_apps').insert([{ ...data, deleted: false, created_at: now() }]).select().single();
  return created;
}
async function removeEarningApp(id) {
  await supabase.from('earning_apps').update({ deleted: true, deleted_at: now() }).eq('id', id);
}

// ─── Connections ──────────────────────────────────────────────────────────────
async function connectUID(telegramId, appId, externalUID) {
  const tid  = String(telegramId);
  const user = await getUserByTelegramId(tid);
  if (!user) return;
  let apps = Array.isArray(user.connected_apps) ? user.connected_apps : [];
  apps = apps.filter(a => a.appId != appId);
  apps.push({ appId, externalUID, connectedAt: now() });
  await supabase.from('users').update({ connected_apps: apps, updated_at: now() }).eq('telegram_id', tid);
}
async function getConnectedUID(telegramId, appId) {
  const user = await getUserByTelegramId(String(telegramId));
  if (!user) return null;
  const apps = Array.isArray(user.connected_apps) ? user.connected_apps : [];
  const conn = apps.find(a => a.appId == appId);
  return conn ? conn.externalUID : null;
}
async function getUserConnections(telegramId) {
  const user = await getUserByTelegramId(String(telegramId));
  return user ? (Array.isArray(user.connected_apps) ? user.connected_apps : []) : [];
}
async function findUserByExternalUID(externalUID) {
  const { data: all } = await supabase.from('users').select('*');
  if (!all) return null;
  return all.find(u => Array.isArray(u.connected_apps) && u.connected_apps.some(a => a.externalUID === externalUID)) || null;
}

// ─── Transactions ─────────────────────────────────────────────────────────────
async function createTransaction(telegramId, type, amount, note, status) {
  const { data } = await supabase.from('transactions').insert([{
    telegram_id: String(telegramId), type, amount, note, status: status || 'completed', created_at: now()
  }]).select().single();
  return data;
}
async function getUserTransactions(tid) {
  const { data } = await supabase.from('transactions').select('*').eq('telegram_id', String(tid)).order('created_at', { ascending: false });
  return data || [];
}

// ─── Withdrawals ──────────────────────────────────────────────────────────────
async function createWithdrawalRequest(data) {
  const { data: created } = await supabase.from('withdrawals').insert([{ ...data, status: 'pending', created_at: now(), updated_at: now() }]).select().single();
  return created;
}
async function getPendingWithdrawals() {
  const { data } = await supabase.from('withdrawals').select('*').eq('status', 'pending').order('created_at', { ascending: false });
  return data || [];
}
async function getWithdrawalById(id) {
  const { data } = await supabase.from('withdrawals').select('*').eq('id', id).single();
  return data || null;
}
async function updateWithdrawal(id, data) {
  await supabase.from('withdrawals').update({ ...data, updated_at: now() }).eq('id', id);
}
async function getUserWithdrawals(tid) {
  const { data } = await supabase.from('withdrawals').select('*').eq('telegram_id', String(tid)).order('created_at', { ascending: false });
  return data || [];
}

// ─── Support ──────────────────────────────────────────────────────────────────
async function createSupportMessage(telegramId, message, fromAdmin) {
  const { data } = await supabase.from('support_messages').insert([{
    telegram_id: String(telegramId), message, from_admin: fromAdmin || false, read: false, created_at: now()
  }]).select().single();
  return data;
}
async function getSupportMessages(tid) {
  const { data } = await supabase.from('support_messages').select('*').eq('telegram_id', String(tid)).order('created_at', { ascending: true });
  return data || [];
}
async function getAllSupportThreads() {
  const { data } = await supabase.from('support_messages').select('*').order('created_at', { ascending: false });
  if (!data) return [];
  const threads = {};
  for (const msg of data) {
    if (!threads[msg.telegram_id]) threads[msg.telegram_id] = { telegram_id: msg.telegram_id, messages: [], unread: 0 };
    threads[msg.telegram_id].messages.push(msg);
    if (!msg.from_admin && !msg.read) threads[msg.telegram_id].unread++;
  }
  return Object.values(threads);
}
async function markSupportRead(tid) {
  await supabase.from('support_messages').update({ read: true }).eq('telegram_id', String(tid)).eq('from_admin', false);
}

// ─── Testimonials ─────────────────────────────────────────────────────────────
async function createTestimonial(telegramId, data) {
  const { data: created } = await supabase.from('testimonials').insert([{
    telegram_id: String(telegramId), ...data, status: 'pending', created_at: now(), updated_at: now()
  }]).select().single();
  return created;
}
async function getTestimonialById(id) {
  const { data } = await supabase.from('testimonials').select('*').eq('id', id).single();
  return data || null;
}
async function getPendingTestimonials() {
  const { data } = await supabase.from('testimonials').select('*').eq('status', 'pending').order('created_at', { ascending: false });
  return data || [];
}
async function getApprovedTestimonials() {
  const { data } = await supabase.from('testimonials').select('*').eq('status', 'approved').order('created_at', { ascending: false });
  return data || [];
}
async function updateTestimonial(id, data) {
  await supabase.from('testimonials').update({ ...data, updated_at: now() }).eq('id', id);
}

// ─── Poems ────────────────────────────────────────────────────────────────────
async function createPoem(telegramId, data) {
  const { data: created } = await supabase.from('poems').insert([{
    telegram_id: String(telegramId), ...data, status: 'pending', created_at: now(), updated_at: now()
  }]).select().single();
  return created;
}
async function getPoemById(id) {
  const { data } = await supabase.from('poems').select('*').eq('id', id).single();
  return data || null;
}
async function getPendingPoems() {
  const { data } = await supabase.from('poems').select('*').eq('status', 'pending').order('created_at', { ascending: false });
  return data || [];
}
async function getApprovedPoems() {
  const { data } = await supabase.from('poems').select('*').eq('status', 'approved').order('created_at', { ascending: false });
  return data || [];
}
async function updatePoem(id, data) {
  await supabase.from('poems').update({ ...data, updated_at: now() }).eq('id', id);
}

// ─── SocialPay Profiles ───────────────────────────────────────────────────────
async function getSocialProfile(telegramId) {
  const { data } = await supabase.from('socialpay_profiles').select('*').eq('telegram_id', String(telegramId)).single();
  return data || null;
}
async function updateSocialProfile(telegramId, data) {
  const tid      = String(telegramId);
  const existing = await getSocialProfile(tid);
  if (existing) {
    await supabase.from('socialpay_profiles').update({ ...data, updated_at: now() }).eq('telegram_id', tid);
  } else {
    await supabase.from('socialpay_profiles').insert([{ telegram_id: tid, ...data, created_at: now(), updated_at: now() }]);
  }
  return getSocialProfile(tid);
}
async function getAllSocialProfiles() {
  const { data } = await supabase.from('socialpay_profiles').select('*').order('total_likes', { ascending: false });
  return data || [];
}

// ─── SocialPay Posts ──────────────────────────────────────────────────────────
async function createSocialPost(telegramId, data) {
  const { data: created } = await supabase.from('socialpay_posts').insert([{
    telegram_id: String(telegramId), ...data, status: 'pending', likes: 0, user_likes: 0, total_earned: 0, created_at: now(), updated_at: now()
  }]).select().single();
  return created;
}
async function getSocialPostById(id) {
  const { data } = await supabase.from('socialpay_posts').select('*').eq('id', id).single();
  return data || null;
}
async function getPendingSocialPosts() {
  const { data } = await supabase.from('socialpay_posts').select('*').eq('status', 'pending').order('created_at', { ascending: false });
  return data || [];
}
async function getApprovedSocialPosts() {
  const { data } = await supabase.from('socialpay_posts').select('*').eq('status', 'approved').order('created_at', { ascending: false });
  return data || [];
}
async function getSocialPostsByUser(tid) {
  const { data } = await supabase.from('socialpay_posts').select('*').eq('telegram_id', String(tid)).order('created_at', { ascending: false });
  return data || [];
}
async function updateSocialPost(id, data) {
  await supabase.from('socialpay_posts').update({ ...data, updated_at: now() }).eq('id', id);
}
async function deleteSocialPost(id) {
  await supabase.from('socialpay_posts').delete().eq('id', id);
}
async function sendLikesToPost(postId, likesToAdd) {
  const post = await getSocialPostById(postId);
  if (!post) return;
  const newLikes     = (parseInt(post.likes) || 0) + likesToAdd;
  const newUserLikes = (parseInt(post.user_likes) || 0) + likesToAdd;
  await supabase.from('socialpay_posts').update({ likes: newLikes, user_likes: newUserLikes, updated_at: now() }).eq('id', postId);
  const profile      = await getSocialProfile(post.telegram_id);
  const currentTotal = parseInt(profile?.total_likes || 0) + likesToAdd;
  await updateSocialProfile(post.telegram_id, { total_likes: currentTotal, followers: currentTotal });
  if (profile) {
    if (currentTotal >= 500000 && !profile.is_gold_verified) {
      await updateSocialProfile(post.telegram_id, { is_gold_verified: true, gold_status: 'approved' });
    } else if (currentTotal >= 1000 && !profile.is_verified) {
      await updateSocialProfile(post.telegram_id, { is_verified: true, verification_status: 'approved' });
    }
  }
}
async function likePost(telegramId, postId) {
  const tid     = String(telegramId);
  const already = await hasLiked(tid, postId);
  if (already) return { success: false, reason: 'Already liked' };
  await supabase.from('socialpay_likes').insert([{ telegram_id: tid, post_id: postId, created_at: now() }]);
  const post = await getSocialPostById(postId);
  if (post) {
    const newLikes     = (parseInt(post.likes) || 0) + 1;
    await supabase.from('socialpay_posts').update({ likes: newLikes, updated_at: now() }).eq('id', postId);
    const profile      = await getSocialProfile(post.telegram_id);
    const currentTotal = (parseInt(profile?.total_likes || 0)) + 1;
    await updateSocialProfile(post.telegram_id, { total_likes: currentTotal, followers: currentTotal });
    if (currentTotal >= 500000 && profile && !profile.is_gold_verified) {
      await updateSocialProfile(post.telegram_id, { is_gold_verified: true, gold_status: 'approved' });
    } else if (currentTotal >= 1000 && profile && !profile.is_verified) {
      await updateSocialProfile(post.telegram_id, { is_verified: true, verification_status: 'approved' });
    }
  }
  return { success: true };
}
async function hasLiked(tid, postId) {
  const { data } = await supabase.from('socialpay_likes').select('id').eq('telegram_id', String(tid)).eq('post_id', postId).single();
  return !!data;
}

// ─── Comments ─────────────────────────────────────────────────────────────────
async function createComment(telegramId, postId, text, parentId) {
  const { data } = await supabase.from('sp_comments').insert([{
    telegram_id: String(telegramId), post_id: postId, text, parent_id: parentId || null, is_deleted: false, created_at: now(), updated_at: now()
  }]).select().single();
  return data;
}
async function getCommentsByPost(postId) {
  const { data } = await supabase.from('sp_comments').select('*').eq('post_id', postId).eq('is_deleted', false).order('created_at', { ascending: true });
  return data || [];
}
async function deleteComment(commentId) {
  await supabase.from('sp_comments').update({ is_deleted: true, updated_at: now() }).eq('id', commentId);
}

// ─── DMs ──────────────────────────────────────────────────────────────────────
async function createDM(fromTid, toTid, data) {
  const { data: created } = await supabase.from('sp_dms').insert([{
    from_tid: String(fromTid), to_tid: String(toTid), ...data, read: false, created_at: now()
  }]).select().single();
  return created;
}
async function getDMs(tid1, tid2) {
  const t1 = String(tid1), t2 = String(tid2);
  const { data } = await supabase.from('sp_dms').select('*')
    .or(`and(from_tid.eq.${t1},to_tid.eq.${t2}),and(from_tid.eq.${t2},to_tid.eq.${t1})`)
    .order('created_at', { ascending: true });
  return data || [];
}
async function getDMContacts(tid) {
  const t = String(tid);
  const { data } = await supabase.from('sp_dms').select('*').or(`from_tid.eq.${t},to_tid.eq.${t}`).order('created_at', { ascending: false });
  if (!data) return [];
  const seen     = new Set();
  const contacts = [];
  for (const dm of data) {
    const other = dm.from_tid === t ? dm.to_tid : dm.from_tid;
    if (!seen.has(other)) { seen.add(other); contacts.push({ tid: other, lastMessage: dm }); }
  }
  return contacts;
}
async function markDMsRead(fromTid, toTid) {
  await supabase.from('sp_dms').update({ read: true }).eq('from_tid', String(fromTid)).eq('to_tid', String(toTid));
}

// ─── Verification Requests ────────────────────────────────────────────────────
async function createVerificationRequest(telegramId, type) {
  const { data } = await supabase.from('verification_requests').insert([{
    telegram_id: String(telegramId), type, status: 'pending', created_at: now(), updated_at: now()
  }]).select().single();
  return data;
}
async function getPendingVerificationRequests() {
  const { data } = await supabase.from('verification_requests').select('*').eq('status', 'pending').order('created_at', { ascending: false });
  return data || [];
}
async function updateVerificationRequest(id, status) {
  await supabase.from('verification_requests').update({ status, updated_at: now() }).eq('id', id);
}

// ─── Broadcasts ───────────────────────────────────────────────────────────────
async function createBroadcast(message, sentCount) {
  const { data } = await supabase.from('broadcasts').insert([{ message, sent_count: sentCount, created_at: now() }]).select().single();
  return data;
}

module.exports = {
  initDB,
  getOrCreateUser, getUserByTelegramId, getUserById, getAllUsers,
  updateUserBalance, upgradeToVIP, updateUserName,
  setUserActive, setEarningsSuspended, acceptTerms,
  claimHourlyEarning, getHourlyStatus,
  adminResolveBalance,
  getEarningApps, getEarningAppById, getEarningAppByToken, addEarningApp, removeEarningApp,
  connectUID, getConnectedUID, getUserConnections, findUserByExternalUID,
  createTransaction, getUserTransactions,
  createWithdrawalRequest, getPendingWithdrawals, getWithdrawalById, updateWithdrawal, getUserWithdrawals,
  createSupportMessage, getSupportMessages, getAllSupportThreads, markSupportRead,
  createTestimonial, getTestimonialById, getPendingTestimonials, getApprovedTestimonials, updateTestimonial,
  createPoem, getPoemById, getPendingPoems, getApprovedPoems, updatePoem,
  getSocialProfile, updateSocialProfile, getAllSocialProfiles,
  createSocialPost, getSocialPostById, getPendingSocialPosts, getApprovedSocialPosts,
  getSocialPostsByUser, updateSocialPost, deleteSocialPost,
  sendLikesToPost, likePost, hasLiked,
  createComment, getCommentsByPost, deleteComment,
  createDM, getDMs, getDMContacts, markDMsRead,
  createVerificationRequest, getPendingVerificationRequests, updateVerificationRequest,
  createBroadcast,
  SHARED_TRC20_ADDRESS, MIN_WITHDRAWAL, MAX_WITHDRAWAL, GATEWAY_FEE_RATE,
  generateUID, now, nowSec
};
