/**
 * Wallet Masters — Database v9 (Supabase JS HTTP API)
 * No pg driver needed — uses Supabase REST API via HTTP
 */
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false }
});

const SHARED_TRC20_ADDRESS = process.env.FEE_ADDRESS || 'TPwUS8v77TtcsYZUHUTvVx2TGqE37QnagZ';
const MIN_WITHDRAWAL       = 5000;
const MAX_WITHDRAWAL       = 50000;
const GATEWAY_FEE_RATE     = 0.04;

function generateUID() { return 'WME' + Math.random().toString(36).toUpperCase().substring(2, 10); }
function now()         { return Date.now(); }

// ─── Raw query wrapper (for migration/DDL) ────────────────────────────────────
// Supabase JS cannot run raw DDL — DDL is handled via initDB using table creation
// This stub exists so bot.js imports don't break
async function query() { return { rows: [] }; }

// ─── Init DB (tables already created in Supabase) ────────────────────────────
async function initDB() {
  console.log('[DB] Using Supabase JS HTTP API — no pg needed');
  // Test connection
  const { error } = await supabase.from('users').select('id').limit(1);
  if (error) console.error('[DB] Connection test failed:', error.message);
  else console.log('[DB] Supabase connection OK');
}

// ─── User CRUD ────────────────────────────────────────────────────────────────
async function getOrCreateUser(telegramId, username, fullName, referredBy) {
  const tid = String(telegramId);
  const { data: existing } = await supabase.from('users').select('*').eq('telegram_id', tid).single();
  if (existing) {
    await supabase.from('users').update({ telegram_username: username||'', full_name: fullName||'', updated_at: now() }).eq('telegram_id', tid);
    // Refresh user after update
    const { data: refreshed } = await supabase.from('users').select('*').eq('telegram_id', tid).single();
    return refreshed || existing;
  }
  const uid = generateUID();
  const refCode = generateUID();
  let referredByCode = referredBy || '';
  let referrer = null;
  if (referredByCode) {
    const { data: ref } = await supabase.from('users').select('*').or(`referral_code.eq.${referredByCode},uid.eq.${referredByCode}`).single();
    referrer = ref;
  }
  const newUser = {
    telegram_id: tid, telegram_username: username||'', full_name: fullName||'',
    registered_name: fullName||'', trc20_address: SHARED_TRC20_ADDRESS,
    usdt_balance: 0, uid, is_vip: false, vip_activated_at: 0,
    last_hourly_claim: 0, last_vip_claim: 0, connected_apps: [],
    terms_accepted: false, referral_code: refCode, referred_by: referredByCode,
    referral_count: 0, is_active: true, earnings_suspended: false,
    created_at: now(), updated_at: now()
  };
  const { data: created, error } = await supabase.from('users').insert([newUser]).select().single();
  if (error) { console.error('createUser error:', error); return null; }
  if (referrer) {
    await supabase.from('users').update({ referral_count: (referrer.referral_count||0)+1, usdt_balance: (parseFloat(referrer.usdt_balance)||0)+500, updated_at: now() }).eq('telegram_id', String(referrer.telegram_id));
    await createTransaction(referrer.telegram_id, 'referral_bonus', 500, `Referral bonus for ${fullName}`, 'completed');
  }
  // Mark as new user for bot.js
  if (created) created._isNew = true;
  return created;
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
  const user = await getUserByTelegramId(telegramId);
  if (!user) return;
  const newBalance = (parseFloat(user.usdt_balance) || 0) + parseFloat(amount);
  await supabase.from('users').update({ usdt_balance: newBalance, updated_at: now() }).eq('telegram_id', String(telegramId));
  return newBalance;
}

async function upgradeToVIP(telegramId) {
  await supabase.from('users').update({ is_vip: true, vip_activated_at: now(), updated_at: now() }).eq('telegram_id', String(telegramId));
}

async function updateUserName(telegramId, newName) {
  await supabase.from('users').update({ registered_name: newName, updated_at: now() }).eq('telegram_id', String(telegramId));
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

async function claimHourlyEarning(telegramId) {
  const user = await getUserByTelegramId(telegramId);
  if (!user) return { success: false, error: 'User not found' };
  if (user.earnings_suspended) return { success: false, error: 'Earnings suspended' };
  const HOUR_MS = 60 * 60 * 1000;
  const last = parseInt(user.last_hourly_claim) || 0;
  const elapsed = now() - last;
  if (elapsed < HOUR_MS) return { success: false, error: 'Not ready', remainingMs: HOUR_MS - elapsed };
  const amount = 200;
  const newBalance = (parseFloat(user.usdt_balance) || 0) + amount;
  await supabase.from('users').update({ usdt_balance: newBalance, last_hourly_claim: now(), updated_at: now() }).eq('telegram_id', String(telegramId));
  await createTransaction(telegramId, 'hourly_earning', amount, 'Hourly earning claim', 'completed');
  return { success: true, amount, newBalance };
}

async function getHourlyStatus(telegramId) {
  const user = await getUserByTelegramId(telegramId);
  if (!user) return { canClaim: false, nextClaimIn: 3600000, ready: false, remainingMs: 3600000 };
  const HOUR_MS = 60 * 60 * 1000;
  const last = parseInt(user.last_hourly_claim) || 0;
  const elapsed = now() - last;
  const isVIP = user.is_vip === true;
  const hourlyAmount = isVIP ? 200 : 50;
  if (elapsed >= HOUR_MS) return { canClaim: true, nextClaimIn: 0, ready: true, remainingMs: 0, hourlyAmount };
  const remaining = HOUR_MS - elapsed;
  return { canClaim: false, nextClaimIn: remaining, ready: false, remainingMs: remaining, hourlyAmount };
}

// ─── Earning Apps ─────────────────────────────────────────────────────────────
async function getEarningApps() {
  const { data } = await supabase.from('earning_apps').select('*').eq('deleted', false).order('created_at');
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

async function addEarningApp(d) {
  const { data } = await supabase.from('earning_apps').insert([{ ...d, deleted: false, created_at: now() }]).select().single();
  return data;
}

async function removeEarningApp(id) {
  await supabase.from('earning_apps').update({ deleted: true, deleted_at: now() }).eq('id', id);
}

// ─── Connected Apps ───────────────────────────────────────────────────────────
async function connectUID(telegramId, appId, externalUID) {
  const user = await getUserByTelegramId(telegramId);
  if (!user) return;
  const apps = Array.isArray(user.connected_apps) ? user.connected_apps : [];
  const idx = apps.findIndex(a => a.appId == appId);
  if (idx >= 0) apps[idx] = { appId, uid: externalUID };
  else apps.push({ appId, uid: externalUID });
  await supabase.from('users').update({ connected_apps: apps, updated_at: now() }).eq('telegram_id', String(telegramId));
}

async function getConnectedUID(telegramId, appId) {
  const user = await getUserByTelegramId(telegramId);
  if (!user) return null;
  const apps = Array.isArray(user.connected_apps) ? user.connected_apps : [];
  return apps.find(a => a.appId == appId)?.uid || null;
}

async function getUserConnections(telegramId) {
  const user = await getUserByTelegramId(telegramId);
  if (!user) return [];
  return Array.isArray(user.connected_apps) ? user.connected_apps : [];
}

async function findUserByExternalUID(externalUID) {
  const { data } = await supabase.from('users').select('*');
  if (!data) return null;
  return data.find(u => {
    const apps = Array.isArray(u.connected_apps) ? u.connected_apps : [];
    return apps.some(a => a.uid === externalUID);
  }) || null;
}

// ─── Transactions ─────────────────────────────────────────────────────────────
async function createTransaction(telegramId, type, amount, note, status) {
  const { data } = await supabase.from('transactions').insert([{
    telegram_id: String(telegramId), type, amount, note: note||'', status: status||'completed', created_at: now()
  }]).select().single();
  return data;
}

async function getUserTransactions(tid) {
  const { data } = await supabase.from('transactions').select('*').eq('telegram_id', String(tid)).order('created_at', { ascending: false });
  return data || [];
}

// ─── Withdrawals ──────────────────────────────────────────────────────────────
async function createWithdrawalRequest(d) {
  const { data } = await supabase.from('withdrawals').insert([{ ...d, status: 'pending', created_at: now(), updated_at: now() }]).select().single();
  return data;
}

async function getPendingWithdrawals() {
  const { data } = await supabase.from('withdrawals').select('*').eq('status', 'pending').order('created_at', { ascending: false });
  return data || [];
}

async function getWithdrawalById(id) {
  const { data } = await supabase.from('withdrawals').select('*').eq('id', id).single();
  return data || null;
}

async function updateWithdrawal(id, updates) {
  await supabase.from('withdrawals').update({ ...updates, updated_at: now() }).eq('id', id);
}

async function getUserWithdrawals(tid) {
  const { data } = await supabase.from('withdrawals').select('*').eq('telegram_id', String(tid)).order('created_at', { ascending: false });
  return data || [];
}

// ─── Support ──────────────────────────────────────────────────────────────────
async function createSupportMessage(telegramId, message, fromAdmin) {
  const { data } = await supabase.from('support_messages').insert([{
    telegram_id: String(telegramId), message, from_admin: fromAdmin||false, read: false, created_at: now()
  }]).select().single();
  return data;
}

async function getSupportMessages(telegramId) {
  const { data } = await supabase.from('support_messages').select('*').eq('telegram_id', String(telegramId)).order('created_at');
  return data || [];
}

async function getAllSupportThreads() {
  const { data } = await supabase.from('support_messages').select('*').eq('from_admin', false).order('created_at', { ascending: false });
  if (!data) return [];
  const threads = {};
  for (const m of data) {
    if (!threads[m.telegram_id]) threads[m.telegram_id] = m;
  }
  return Object.values(threads);
}

async function markSupportRead(telegramId) {
  await supabase.from('support_messages').update({ read: true }).eq('telegram_id', String(telegramId)).eq('from_admin', true);
}

// ─── Testimonials ─────────────────────────────────────────────────────────────
async function createTestimonial(telegramId, data) {
  const { data: d } = await supabase.from('testimonials').insert([{ telegram_id: String(telegramId), ...data, status: 'pending', created_at: now(), updated_at: now() }]).select().single();
  return d;
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

async function updateTestimonial(id, updates) {
  await supabase.from('testimonials').update({ ...updates, updated_at: now() }).eq('id', id);
}

// ─── Poems ────────────────────────────────────────────────────────────────────
async function createPoem(telegramId, data) {
  const { data: d } = await supabase.from('poems').insert([{ telegram_id: String(telegramId), ...data, status: 'pending', created_at: now(), updated_at: now() }]).select().single();
  return d;
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

async function updatePoem(id, updates) {
  await supabase.from('poems').update({ ...updates, updated_at: now() }).eq('id', id);
}

// ─── SocialPay Profiles ───────────────────────────────────────────────────────
async function getSocialProfile(telegramId) {
  const { data } = await supabase.from('socialpay_profiles').select('*').eq('telegram_id', String(telegramId)).single();
  return data || null;
}

async function updateSocialProfile(telegramId, updates) {
  const existing = await getSocialProfile(telegramId);
  if (existing) {
    await supabase.from('socialpay_profiles').update({ ...updates, updated_at: now() }).eq('telegram_id', String(telegramId));
  } else {
    await supabase.from('socialpay_profiles').insert([{ telegram_id: String(telegramId), ...updates, created_at: now(), updated_at: now() }]);
  }
}

async function getAllSocialProfiles() {
  const { data } = await supabase.from('socialpay_profiles').select('*').order('total_likes', { ascending: false });
  return data || [];
}

// ─── SocialPay Posts ──────────────────────────────────────────────────────────
async function createSocialPost(telegramId, data) {
  const { data: d } = await supabase.from('socialpay_posts').insert([{ telegram_id: String(telegramId), ...data, status: 'pending', likes: 0, user_likes: 0, total_earned: 0, created_at: now(), updated_at: now() }]).select().single();
  return d;
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
  const { data } = await supabase.from('socialpay_posts').select('id,telegram_id,content,status,likes,user_likes,total_earned,created_at,updated_at').eq('status', 'approved').order('created_at', { ascending: false });
  return data || [];
}

async function getSocialPostsByUser(telegramId) {
  const { data } = await supabase.from('socialpay_posts').select('id,telegram_id,content,status,likes,user_likes,total_earned,created_at,updated_at').eq('telegram_id', String(telegramId)).order('created_at', { ascending: false });
  return data || [];
}

async function updateSocialPost(id, updates) {
  await supabase.from('socialpay_posts').update({ ...updates, updated_at: now() }).eq('id', id);
}

async function deleteSocialPost(id) {
  await supabase.from('socialpay_posts').delete().eq('id', id);
}

async function sendLikesToPost(postId, adminLikes) {
  const { data: post } = await supabase.from('socialpay_posts').select('*').eq('id', postId).single();
  if (!post) return;
  const newLikes = (post.likes || 0) + adminLikes;
  await supabase.from('socialpay_posts').update({ likes: newLikes, updated_at: now() }).eq('id', postId);
  const profile = await getSocialProfile(post.telegram_id);
  if (profile) {
    const newTotal = (profile.total_likes || 0) + adminLikes;
    const newFollowers = Math.floor(newTotal / 10);
    const isVerified = newTotal >= 1000 || profile.is_verified;
    const isGold = newTotal >= 500000 || profile.is_gold_verified;
    await supabase.from('socialpay_profiles').update({ total_likes: newTotal, followers: newFollowers, is_verified: isVerified, is_gold_verified: isGold, updated_at: now() }).eq('telegram_id', post.telegram_id);
  }
}

// ─── Likes ────────────────────────────────────────────────────────────────────
async function likePost(telegramId, postId) {
  const { error } = await supabase.from('socialpay_likes').insert([{ telegram_id: String(telegramId), post_id: postId, created_at: now() }]);
  if (error) return false; // already liked
  const post = await getSocialPostById(postId);
  if (!post) return false;
  const newUserLikes = (post.user_likes || 0) + 1;
  const newLikes = (post.likes || 0) + 1;
  await supabase.from('socialpay_posts').update({ likes: newLikes, user_likes: newUserLikes, updated_at: now() }).eq('id', postId);
  const profile = await getSocialProfile(post.telegram_id);
  if (profile) {
    const newTotal = (profile.total_likes || 0) + 1;
    const newFollowers = Math.floor(newTotal / 10);
    const isVerified = newTotal >= 1000 || profile.is_verified;
    const isGold = newTotal >= 500000 || profile.is_gold_verified;
    await supabase.from('socialpay_profiles').update({ total_likes: newTotal, followers: newFollowers, is_verified: isVerified, is_gold_verified: isGold, updated_at: now() }).eq('telegram_id', post.telegram_id);
  }
  return true;
}

async function hasLiked(telegramId, postId) {
  const { data } = await supabase.from('socialpay_likes').select('id').eq('telegram_id', String(telegramId)).eq('post_id', postId).single();
  return !!data;
}

// ─── Comments ─────────────────────────────────────────────────────────────────
async function createComment(telegramId, postId, text, parentId) {
  const { data } = await supabase.from('sp_comments').insert([{
    telegram_id: String(telegramId), post_id: postId, text, parent_id: parentId||null,
    is_deleted: false, created_at: now(), updated_at: now()
  }]).select().single();
  return data;
}

async function getCommentsByPost(postId) {
  const { data } = await supabase.from('sp_comments').select('*').eq('post_id', postId).eq('is_deleted', false).order('created_at');
  return data || [];
}

async function deleteComment(id) {
  await supabase.from('sp_comments').update({ is_deleted: true, updated_at: now() }).eq('id', id);
}

// ─── DMs ──────────────────────────────────────────────────────────────────────
async function createDM(fromTid, toTid, text, mediaUrl, mediaType) {
  const { data } = await supabase.from('sp_dms').insert([{
    from_tid: String(fromTid), to_tid: String(toTid), text: text||'',
    media_url: mediaUrl||'', media_type: mediaType||'', read: false, created_at: now()
  }]).select().single();
  return data;
}

async function getDMs(tid1, tid2) {
  const { data } = await supabase.from('sp_dms').select('*')
    .or(`and(from_tid.eq.${tid1},to_tid.eq.${tid2}),and(from_tid.eq.${tid2},to_tid.eq.${tid1})`)
    .order('created_at');
  return data || [];
}

async function getDMContacts(telegramId) {
  const tid = String(telegramId);
  const { data } = await supabase.from('sp_dms').select('*').or(`from_tid.eq.${tid},to_tid.eq.${tid}`).order('created_at', { ascending: false });
  if (!data) return [];
  const seen = new Set();
  const contacts = [];
  for (const dm of data) {
    const other = dm.from_tid === tid ? dm.to_tid : dm.from_tid;
    if (!seen.has(other)) { seen.add(other); contacts.push(other); }
  }
  return contacts;
}

async function markDMsRead(fromTid, toTid) {
  await supabase.from('sp_dms').update({ read: true }).eq('from_tid', String(fromTid)).eq('to_tid', String(toTid));
}

// ─── Verification ─────────────────────────────────────────────────────────────
async function createVerificationRequest(telegramId, type) {
  const { data } = await supabase.from('verification_requests').insert([{
    telegram_id: String(telegramId), type: type||'orange', status: 'pending', created_at: now(), updated_at: now()
  }]).select().single();
  return data;
}

async function getPendingVerificationRequests() {
  const { data } = await supabase.from('verification_requests').select('*').eq('status', 'pending').order('created_at', { ascending: false });
  return data || [];
}

async function updateVerificationRequest(id, updates) {
  await supabase.from('verification_requests').update({ ...updates, updated_at: now() }).eq('id', id);
}

// ─── Broadcasts ───────────────────────────────────────────────────────────────
async function createBroadcast(message, sentCount) {
  const { data } = await supabase.from('broadcasts').insert([{ message, sent_count: sentCount||0, created_at: now() }]).select().single();
  return data;
}

// ─── Supabase direct client (for bot.js new endpoints) ────────────────────────
function getSupabase() { return supabase; }

module.exports = {
  initDB, query, getSupabase,
  SHARED_TRC20_ADDRESS, MIN_WITHDRAWAL, MAX_WITHDRAWAL, GATEWAY_FEE_RATE,
  getOrCreateUser, getUserByTelegramId, getUserById, updateUserBalance, upgradeToVIP,
  updateUserName, getAllUsers, setUserActive, setEarningsSuspended, acceptTerms,
  claimHourlyEarning, getHourlyStatus,
  getEarningApps, getEarningAppByToken, getEarningAppById, addEarningApp, removeEarningApp,
  connectUID, getConnectedUID, getUserConnections, findUserByExternalUID,
  createTransaction, getUserTransactions,
  createWithdrawalRequest, getPendingWithdrawals, getWithdrawalById, updateWithdrawal, getUserWithdrawals,
  createSupportMessage, getSupportMessages, getAllSupportThreads, markSupportRead,
  createTestimonial, getTestimonialById, getPendingTestimonials, getApprovedTestimonials, updateTestimonial,
  createPoem, getPoemById, getPendingPoems, getApprovedPoems, updatePoem,
  getSocialProfile, updateSocialProfile, getAllSocialProfiles,
  createSocialPost, getSocialPostById, getPendingSocialPosts, getApprovedSocialPosts, getSocialPostsByUser, updateSocialPost, deleteSocialPost, sendLikesToPost,
  likePost, hasLiked,
  createComment, getCommentsByPost, deleteComment,
  createDM, getDMs, getDMContacts, markDMsRead,
  createVerificationRequest, getPendingVerificationRequests, updateVerificationRequest,
  createBroadcast
};
