/**
 * Wallet Masters — Database v6
 * New: comments/replies, post editing, account deactivation/suspension,
 *      gold verified badge, DMs between gold users, followers=likes,
 *      bio for verified users, image storage in posts
 */
const low      = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

const adapter = new FileSync('db.json');
const db      = low(adapter);

const SHARED_TRC20_ADDRESS = process.env.FEE_ADDRESS || 'TPwUS8v77TtcsYZUHUTvVx2TGqE37QnagZ';
const MIN_WITHDRAWAL       = 5000;
const MAX_WITHDRAWAL       = 50000;
const GATEWAY_FEE_RATE     = 0.04;

function generateUID() { return 'WME' + Math.random().toString(36).toUpperCase().substring(2, 10); }
function now()         { return Date.now(); }
function nowSec()      { return Math.floor(Date.now() / 1000); }
function nextId(col)   { const items = db.get(col).value() || []; return items.length ? Math.max(...items.map(x => x.id || 0)) + 1 : 1; }

// ─── Init DB Schema ──────────────────────────────────────────────────────────
db.defaults({
  users: [], transactions: [], withdrawals: [], earning_apps: [],
  support_messages: [], testimonials: [], broadcasts: [],
  poems: [], socialpay_posts: [], socialpay_profiles: [],
  socialpay_likes: [], verification_requests: [],
  sp_comments: [], sp_dms: []
}).write();

// ─── User CRUD ───────────────────────────────────────────────────────────────
function getOrCreateUser(telegramId, username, fullName, referredBy) {
  const tid = String(telegramId);
  let user  = db.get('users').find({ telegram_id: tid }).value();
  const isNew = !user;

  if (!user) {
    user = {
      id: nextId('users'), telegram_id: tid,
      telegram_username: username || '', full_name: fullName || '',
      trc20_address: SHARED_TRC20_ADDRESS, usdt_balance: 0,
      uid: generateUID(), is_vip: false, vip_activated_at: null,
      last_hourly_claim: 0, last_vip_claim: 0, connected_apps: [],
      terms_accepted: false, referral_code: generateUID(),
      referred_by: referredBy || null, referral_count: 0,
      registered_name: fullName || '',
      is_active: true, earnings_suspended: false,
      created_at: now(), updated_at: now()
    };
    db.get('users').push(user).write();
    if (referredBy) {
      const referrer = db.get('users').find(u => u.referral_code === referredBy || u.uid === referredBy).value();
      if (referrer && referrer.telegram_id !== tid) {
        const newBal   = (referrer.usdt_balance || 0) + 200;
        const newCount = (referrer.referral_count || 0) + 1;
        db.get('users').find({ id: referrer.id })
          .assign({ usdt_balance: newBal, referral_count: newCount, updated_at: now() }).write();
        user._referrer = { telegram_id: referrer.telegram_id, name: referrer.full_name, newBal };
      }
    }
  } else {
    const updates = { updated_at: now(), trc20_address: SHARED_TRC20_ADDRESS };
    if (username)  updates.telegram_username = username;
    if (fullName)  updates.full_name = fullName;
    if (user.last_hourly_claim === undefined) updates.last_hourly_claim = 0;
    if (user.last_vip_claim    === undefined) updates.last_vip_claim    = 0;
    if (user.is_vip            === undefined) updates.is_vip            = false;
    if (!user.referral_code)   updates.referral_code  = user.uid;
    if (user.referral_count    === undefined) updates.referral_count    = 0;
    if (!user.registered_name) updates.registered_name = user.full_name || fullName || '';
    if (user.is_active         === undefined) updates.is_active         = true;
    if (user.earnings_suspended=== undefined) updates.earnings_suspended= false;
    db.get('users').find({ telegram_id: tid }).assign(updates).write();
    user = db.get('users').find({ telegram_id: tid }).value();
  }
  user._isNew = isNew;
  return user;
}

function getUserByTelegramId(tid) { return db.get('users').find({ telegram_id: String(tid) }).value(); }
function getUserById(id)          { return db.get('users').find({ id }).value(); }
function getAllUsers()             { return db.get('users').value() || []; }

function updateUserBalance(telegramId, amount) {
  const tid  = String(telegramId);
  const user = db.get('users').find({ telegram_id: tid }).value();
  if (!user) return null;
  const newBal = Math.max(0, (user.usdt_balance || 0) + amount);
  db.get('users').find({ telegram_id: tid }).assign({ usdt_balance: newBal, updated_at: now() }).write();
  return db.get('users').find({ telegram_id: tid }).value();
}
function upgradeToVIP(telegramId) {
  const tid = String(telegramId);
  db.get('users').find({ telegram_id: tid })
    .assign({ is_vip: true, vip_activated_at: now(), last_vip_claim: 0, updated_at: now() }).write();
  return db.get('users').find({ telegram_id: tid }).value();
}
function updateUserName(telegramId, newName) {
  const tid = String(telegramId);
  db.get('users').find({ telegram_id: tid })
    .assign({ registered_name: newName, full_name: newName, updated_at: now() }).write();
  return db.get('users').find({ telegram_id: tid }).value();
}

// Admin: deactivate or suspend
function setUserActive(telegramId, isActive) {
  db.get('users').find({ telegram_id: String(telegramId) })
    .assign({ is_active: isActive, updated_at: now() }).write();
}
function setEarningsSuspended(telegramId, suspended) {
  db.get('users').find({ telegram_id: String(telegramId) })
    .assign({ earnings_suspended: suspended, updated_at: now() }).write();
}

// ─── Hourly Earning ──────────────────────────────────────────────────────────
function claimHourlyEarning(telegramId) {
  const tid  = String(telegramId);
  const user = db.get('users').find({ telegram_id: tid }).value();
  if (!user) return { success: false, error: 'User not found' };
  if (user.earnings_suspended) return { success: false, error: 'Your earnings have been temporarily suspended. Please contact support.' };
  const isVIP     = user.is_vip === true;
  const lastField = isVIP ? 'last_vip_claim' : 'last_hourly_claim';
  const lastClaim = user[lastField] || 0;
  const hourMs    = 60 * 60 * 1000;
  if (now() - lastClaim < hourMs) return { success: false, nextIn: hourMs - (now() - lastClaim) };
  const amount = isVIP ? 200 : 50;
  const newBal = (user.usdt_balance || 0) + amount;
  const upd    = { usdt_balance: newBal, updated_at: now() };
  upd[lastField] = now();
  db.get('users').find({ telegram_id: tid }).assign(upd).write();
  createTransaction(telegramId, 'earning', amount, isVIP ? 'VIP Bonus' : 'Hourly Bonus');
  return { success: true, amount, newBalance: newBal, isVIP };
}
function getHourlyStatus(telegramId) {
  const user = db.get('users').find({ telegram_id: String(telegramId) }).value();
  if (!user) return { canClaim: false, nextClaimIn: 0, hourlyAmount: 50 };
  const isVIP     = user.is_vip === true;
  const lastField = isVIP ? 'last_vip_claim' : 'last_hourly_claim';
  const lastClaim = user[lastField] || 0;
  const hourMs    = 60 * 60 * 1000;
  const diff      = now() - lastClaim;
  return { canClaim: diff >= hourMs, nextClaimIn: Math.max(0, hourMs - diff), hourlyAmount: isVIP ? 200 : 50, isVIP };
}

// ─── Earning Apps ─────────────────────────────────────────────────────────────
function getEarningApps()          { return db.get('earning_apps').filter(a => !a.deleted).value(); }
function getEarningAppById(id)     { return db.get('earning_apps').find({ id }).value(); }
function getEarningAppByToken(tok) { return db.get('earning_apps').find({ bot_token: tok }).value(); }
function addEarningApp(data)       { const a = { id: nextId('earning_apps'), created_at: now(), deleted: false, ...data }; db.get('earning_apps').push(a).write(); return a; }
function removeEarningApp(id)      { db.get('earning_apps').find({ id: parseInt(id) }).assign({ deleted: true, deleted_at: now() }).write(); return true; }

// ─── UID Connections ──────────────────────────────────────────────────────────
function connectUID(telegramId, appId, externalUID) {
  const tid  = String(telegramId);
  const user = db.get('users').find({ telegram_id: tid }).value();
  if (!user) return null;
  const apps     = user.connected_apps || [];
  const existing = apps.findIndex(a => a.app_id === appId);
  if (existing >= 0) { apps[existing].uid = externalUID; apps[existing].updated_at = now(); }
  else apps.push({ app_id: appId, uid: externalUID, connected_at: now(), updated_at: now() });
  db.get('users').find({ telegram_id: tid }).assign({ connected_apps: apps, updated_at: now() }).write();
  return db.get('users').find({ telegram_id: tid }).value();
}
function getConnectedUID(telegramId, appId) {
  const user = db.get('users').find({ telegram_id: String(telegramId) }).value();
  if (!user) return null;
  const conn = (user.connected_apps || []).find(a => a.app_id === appId);
  return conn ? conn.uid : null;
}
function getUserConnections(telegramId) {
  const user = db.get('users').find({ telegram_id: String(telegramId) }).value();
  return user ? (user.connected_apps || []) : [];
}
function findUserByExternalUID(externalUID) {
  return db.get('users').find(u => (u.connected_apps || []).some(a => a.uid === externalUID)).value();
}

// ─── Transactions ─────────────────────────────────────────────────────────────
function createTransaction(telegramId, type, amount, note, status) {
  const tx = { id: nextId('transactions'), telegram_id: String(telegramId), type, amount, note: note||'', status: status||'completed', created_at: nowSec() };
  db.get('transactions').push(tx).write();
  return tx;
}
function getUserTransactions(telegramId) {
  return db.get('transactions').filter({ telegram_id: String(telegramId) }).sortBy('created_at').reverse().take(100).value();
}

// ─── Withdrawals ──────────────────────────────────────────────────────────────
function calculateFees(amount) {
  const fee = Math.round(amount * GATEWAY_FEE_RATE * 100) / 100;
  return { amount, fee, total_fee: fee, net_amount: amount - fee, net: amount - fee };
}
function createWithdrawalRequest(data) {
  const wr = { id: nextId('withdrawals'), status: 'pending', created_at: nowSec(), ...data };
  db.get('withdrawals').push(wr).write();
  return wr;
}
function getPendingWithdrawals()  { return db.get('withdrawals').filter({ status: 'pending' }).sortBy('created_at').reverse().value(); }
function getWithdrawalById(id)    { return db.get('withdrawals').find({ id: parseInt(id) }).value(); }
function updateWithdrawal(id, updates) { db.get('withdrawals').find({ id: parseInt(id) }).assign({ ...updates, updated_at: nowSec() }).write(); return db.get('withdrawals').find({ id: parseInt(id) }).value(); }
function getUserWithdrawals(tid)  { return db.get('withdrawals').filter({ telegram_id: String(tid) }).sortBy('created_at').reverse().value(); }

// ─── Support ──────────────────────────────────────────────────────────────────
function createSupportMessage(telegramId, message, fromAdmin) {
  const sm = { id: nextId('support_messages'), telegram_id: String(telegramId), message, from_admin: !!fromAdmin, read: false, created_at: nowSec() };
  db.get('support_messages').push(sm).write();
  return sm;
}
function getSupportMessages(tid) { return db.get('support_messages').filter({ telegram_id: String(tid) }).sortBy('created_at').value(); }
function getAllSupportThreads()  { return db.get('support_messages').groupBy('telegram_id').value(); }
function markSupportRead(tid)   { db.get('support_messages').filter({ telegram_id: String(tid), from_admin: true, read: false }).each(m => { m.read = true; }).write(); }

// ─── Testimonials ─────────────────────────────────────────────────────────────
function createTestimonial(telegramId, data) { const t = { id: nextId('testimonials'), telegram_id: String(telegramId), status: 'pending', created_at: nowSec(), ...data }; db.get('testimonials').push(t).write(); return t; }
function getTestimonialById(id)      { return db.get('testimonials').find({ id: parseInt(id) }).value(); }
function getPendingTestimonials()    { return db.get('testimonials').filter({ status: 'pending' }).value(); }
function getApprovedTestimonials()   { return db.get('testimonials').filter({ status: 'approved' }).sortBy('created_at').reverse().value(); }
function updateTestimonial(id, data) { db.get('testimonials').find({ id: parseInt(id) }).assign({ ...data, updated_at: nowSec() }).write(); return db.get('testimonials').find({ id: parseInt(id) }).value(); }

// ─── Poems ────────────────────────────────────────────────────────────────────
function createPoem(telegramId, data) { const p = { id: nextId('poems'), telegram_id: String(telegramId), status: 'pending', created_at: nowSec(), ...data }; db.get('poems').push(p).write(); return p; }
function getPoemById(id)      { return db.get('poems').find({ id: parseInt(id) }).value(); }
function getPendingPoems()    { return db.get('poems').filter({ status: 'pending' }).sortBy('created_at').reverse().value(); }
function getApprovedPoems()   { return db.get('poems').filter({ status: 'approved' }).sortBy('created_at').reverse().value(); }
function updatePoem(id, data) { db.get('poems').find({ id: parseInt(id) }).assign({ ...data, updated_at: nowSec() }).write(); return db.get('poems').find({ id: parseInt(id) }).value(); }

// ─── SocialPay Profiles ───────────────────────────────────────────────────────
function getSocialProfile(telegramId) {
  const tid  = String(telegramId);
  let prof   = db.get('socialpay_profiles').find({ telegram_id: tid }).value();
  if (!prof) {
    const user = getUserByTelegramId(tid);
    prof = {
      id: nextId('socialpay_profiles'), telegram_id: tid,
      display_name: user ? (user.full_name || 'User') : 'User',
      profile_pic: '', country: '', age: '', bio: '',
      is_verified: false, is_gold_verified: false,
      verification_status: 'none', gold_status: 'none',
      total_likes: 0, followers: 0,
      created_at: nowSec(), updated_at: nowSec()
    };
    db.get('socialpay_profiles').push(prof).write();
  }
  return prof;
}
function updateSocialProfile(telegramId, data) {
  const tid = String(telegramId);
  getSocialProfile(tid);
  db.get('socialpay_profiles').find({ telegram_id: tid }).assign({ ...data, updated_at: nowSec() }).write();
  return db.get('socialpay_profiles').find({ telegram_id: tid }).value();
}
function getAllSocialProfiles() { return db.get('socialpay_profiles').value() || []; }

// ─── SocialPay Posts ──────────────────────────────────────────────────────────
function createSocialPost(telegramId, data) {
  const post = { id: nextId('socialpay_posts'), telegram_id: String(telegramId), status: 'pending', likes: 0, user_likes: 0, total_earned: 0, created_at: nowSec(), ...data };
  db.get('socialpay_posts').push(post).write();
  return post;
}
function getSocialPostById(id)    { return db.get('socialpay_posts').find({ id: parseInt(id) }).value(); }
function getPendingSocialPosts()  { return db.get('socialpay_posts').filter({ status: 'pending' }).sortBy('created_at').reverse().value(); }
function getApprovedSocialPosts() { return db.get('socialpay_posts').filter({ status: 'approved' }).sortBy('created_at').reverse().value(); }
function getSocialPostsByUser(tid){ return db.get('socialpay_posts').filter({ telegram_id: String(tid) }).sortBy('created_at').reverse().value(); }
function updateSocialPost(id, data) { db.get('socialpay_posts').find({ id: parseInt(id) }).assign({ ...data, updated_at: nowSec() }).write(); return db.get('socialpay_posts').find({ id: parseInt(id) }).value(); }
function deleteSocialPost(id)     { db.get('socialpay_posts').find({ id: parseInt(id) }).assign({ status: 'deleted', updated_at: nowSec() }).write(); }

// Send admin likes → auto-payout milestones
function sendLikesToPost(postId, likesToAdd, botRef) {
  const post = db.get('socialpay_posts').find({ id: parseInt(postId) }).value();
  if (!post || post.status !== 'approved') return { success: false, error: 'Post not found or not approved' };
  const oldLikes = post.likes || 0;
  const newLikes = oldLikes + likesToAdd;
  const milestones = [{ threshold:1000000, payout:100000 }, { threshold:100000, payout:10000 }, { threshold:10000, payout:1000 }, { threshold:1000, payout:100 }];
  let earned = 0;
  for (const m of milestones) { if (oldLikes < m.threshold && newLikes >= m.threshold) earned += m.payout; }
  const totalEarned = (post.total_earned || 0) + earned;
  db.get('socialpay_posts').find({ id: parseInt(postId) }).assign({ likes: newLikes, total_earned: totalEarned, updated_at: nowSec() }).write();

  // Followers = total admin likes across all posts
  const prof = db.get('socialpay_profiles').find({ telegram_id: post.telegram_id }).value();
  if (prof) {
    const allPosts = db.get('socialpay_posts').filter({ telegram_id: post.telegram_id, status: 'approved' }).value();
    const totalAdminLikes = allPosts.reduce((sum, p) => sum + (p.id === parseInt(postId) ? newLikes : (p.likes || 0)), 0);
    db.get('socialpay_profiles').find({ telegram_id: post.telegram_id })
      .assign({ total_likes: totalAdminLikes, followers: totalAdminLikes, updated_at: nowSec() }).write();
  }

  if (earned > 0) {
    updateUserBalance(post.telegram_id, earned);
    createTransaction(post.telegram_id, 'socialpay_reward', earned, `SocialPay: ${newLikes.toLocaleString()} likes`);
    if (botRef) botRef.sendMessage(post.telegram_id,
      `🎉 <b>SocialPay Reward!</b>\n\n❤️ Your post reached <b>${newLikes.toLocaleString()} likes</b>!\n💰 <b>+${earned.toLocaleString()} USDT</b> added to your balance!\n\nKeep posting great content! 🚀`,
      { parse_mode: 'HTML' }).catch(() => {});
  }
  return { success: true, newLikes, earned, totalEarned };
}

// ─── SocialPay Likes (user) ───────────────────────────────────────────────────
function likePost(telegramId, postId) {
  const tid  = String(telegramId);
  const pId  = parseInt(postId);
  if (db.get('socialpay_likes').find({ telegram_id: tid, post_id: pId }).value()) return { success: false, error: 'Already liked' };
  db.get('socialpay_likes').push({ id: nextId('socialpay_likes'), telegram_id: tid, post_id: pId, created_at: nowSec() }).write();
  const post = db.get('socialpay_posts').find({ id: pId }).value();
  if (post) db.get('socialpay_posts').find({ id: pId }).assign({ user_likes: (post.user_likes || 0) + 1 }).write();
  return { success: true };
}
function hasLiked(tid, postId) { return !!db.get('socialpay_likes').find({ telegram_id: String(tid), post_id: parseInt(postId) }).value(); }

// ─── Comments ─────────────────────────────────────────────────────────────────
function createComment(telegramId, postId, text, parentId) {
  const c = { id: nextId('sp_comments'), telegram_id: String(telegramId), post_id: parseInt(postId), text, parent_id: parentId ? parseInt(parentId) : null, is_deleted: false, created_at: nowSec() };
  db.get('sp_comments').push(c).write();
  return c;
}
function getCommentsByPost(postId) { return db.get('sp_comments').filter({ post_id: parseInt(postId), is_deleted: false }).sortBy('created_at').value(); }
function deleteComment(commentId)  { db.get('sp_comments').find({ id: parseInt(commentId) }).assign({ is_deleted: true, updated_at: nowSec() }).write(); }

// ─── DMs (Gold Verified only) ─────────────────────────────────────────────────
function createDM(fromTid, toTid, data) {
  const dm = { id: nextId('sp_dms'), from_tid: String(fromTid), to_tid: String(toTid), read: false, created_at: nowSec(), ...data };
  db.get('sp_dms').push(dm).write();
  return dm;
}
function getDMs(tid1, tid2) {
  const t1 = String(tid1), t2 = String(tid2);
  return db.get('sp_dms').filter(d => (d.from_tid===t1&&d.to_tid===t2)||(d.from_tid===t2&&d.to_tid===t1)).sortBy('created_at').value();
}
function getDMContacts(tid) {
  const t = String(tid);
  const dms = db.get('sp_dms').filter(d => d.from_tid===t || d.to_tid===t).value();
  const contacts = new Set(dms.map(d => d.from_tid===t ? d.to_tid : d.from_tid));
  return [...contacts];
}
function markDMsRead(fromTid, toTid) {
  db.get('sp_dms').filter(d => d.from_tid===String(fromTid)&&d.to_tid===String(toTid)&&!d.read).each(d => { d.read = true; }).write();
}

// ─── Verification Requests ────────────────────────────────────────────────────
function createVerificationRequest(telegramId, type) {
  const tid      = String(telegramId);
  const reqType  = type || 'orange';
  const existing = db.get('verification_requests').find({ telegram_id: tid, status: 'pending', type: reqType }).value();
  if (existing) return { success: false, error: 'Already pending' };
  const req = { id: nextId('verification_requests'), telegram_id: tid, type: reqType, status: 'pending', created_at: nowSec() };
  db.get('verification_requests').push(req).write();
  return { success: true, request: req };
}
function getVerificationById(id)   { return db.get('verification_requests').find({ id: parseInt(id) }).value(); }
function getPendingVerifications() { return db.get('verification_requests').filter({ status: 'pending' }).value(); }
function updateVerification(id, data) { db.get('verification_requests').find({ id: parseInt(id) }).assign({ ...data, updated_at: nowSec() }).write(); return db.get('verification_requests').find({ id: parseInt(id) }).value(); }

// ─── Broadcasts ───────────────────────────────────────────────────────────────
function createBroadcast(data) { const b = { id: nextId('broadcasts'), created_at: nowSec(), ...data }; db.get('broadcasts').push(b).write(); return b; }

// ─── Stats ────────────────────────────────────────────────────────────────────
function getStats() {
  return {
    users: db.get('users').size().value(),
    vip: db.get('users').filter({ is_vip: true }).size().value(),
    pending_withdrawals: db.get('withdrawals').filter({ status: 'pending' }).size().value(),
    earning_apps: db.get('earning_apps').filter(a => !a.deleted).size().value(),
    pending_testimonials: db.get('testimonials').filter({ status: 'pending' }).size().value(),
    pending_poems: db.get('poems').filter({ status: 'pending' }).size().value(),
    pending_socialpay: db.get('socialpay_posts').filter({ status: 'pending' }).size().value(),
    pending_verifications: db.get('verification_requests').filter({ status: 'pending' }).size().value(),
    suspended_users: db.get('users').filter({ earnings_suspended: true }).size().value(),
    deactivated_users: db.get('users').filter({ is_active: false }).size().value()
  };
}

module.exports = {
  db, SHARED_TRC20_ADDRESS, MIN_WITHDRAWAL, MAX_WITHDRAWAL, GATEWAY_FEE_RATE, now, nowSec,
  getOrCreateUser, getUserByTelegramId, getUserById, updateUserBalance, upgradeToVIP, updateUserName, getAllUsers,
  setUserActive, setEarningsSuspended,
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
};
