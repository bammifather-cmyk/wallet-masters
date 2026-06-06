/**
 * Wallet Masters — Database v7 (PostgreSQL/Supabase)
 * Migrated from lowdb flat-file to persistent PostgreSQL
 */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

const SHARED_TRC20_ADDRESS = process.env.FEE_ADDRESS || 'TPwUS8v77TtcsYZUHUTvVx2TGqE37QnagZ';
const MIN_WITHDRAWAL       = 5000;
const MAX_WITHDRAWAL       = 50000;
const GATEWAY_FEE_RATE     = 0.04;

function generateUID() { return 'WME' + Math.random().toString(36).toUpperCase().substring(2, 10); }
function now()         { return Date.now(); }
function nowSec()      { return Math.floor(Date.now() / 1000); }

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    const res = await client.query(sql, params);
    return res;
  } finally {
    client.release();
  }
}

// ─── Init Tables ──────────────────────────────────────────────────────────────
async function initDB() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      telegram_id TEXT UNIQUE NOT NULL,
      telegram_username TEXT DEFAULT '',
      full_name TEXT DEFAULT '',
      registered_name TEXT DEFAULT '',
      trc20_address TEXT DEFAULT '',
      usdt_balance NUMERIC DEFAULT 0,
      uid TEXT UNIQUE,
      is_vip BOOLEAN DEFAULT false,
      vip_activated_at BIGINT DEFAULT 0,
      last_hourly_claim BIGINT DEFAULT 0,
      last_vip_claim BIGINT DEFAULT 0,
      connected_apps JSONB DEFAULT '[]',
      terms_accepted BOOLEAN DEFAULT false,
      referral_code TEXT DEFAULT '',
      referred_by TEXT DEFAULT '',
      referral_count INT DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      earnings_suspended BOOLEAN DEFAULT false,
      created_at BIGINT DEFAULT 0,
      updated_at BIGINT DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      telegram_id TEXT NOT NULL,
      type TEXT DEFAULT '',
      amount NUMERIC DEFAULT 0,
      note TEXT DEFAULT '',
      status TEXT DEFAULT 'completed',
      created_at BIGINT DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS withdrawals (
      id SERIAL PRIMARY KEY,
      telegram_id TEXT NOT NULL,
      amount NUMERIC DEFAULT 0,
      fee NUMERIC DEFAULT 0,
      net_amount NUMERIC DEFAULT 0,
      address TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      receipt_url TEXT DEFAULT '',
      tx_hash TEXT DEFAULT '',
      created_at BIGINT DEFAULT 0,
      updated_at BIGINT DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS earning_apps (
      id SERIAL PRIMARY KEY,
      name TEXT DEFAULT '',
      description TEXT DEFAULT '',
      bot_token TEXT DEFAULT '',
      icon TEXT DEFAULT '',
      url TEXT DEFAULT '',
      deleted BOOLEAN DEFAULT false,
      deleted_at BIGINT DEFAULT 0,
      created_at BIGINT DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS support_messages (
      id SERIAL PRIMARY KEY,
      telegram_id TEXT NOT NULL,
      message TEXT DEFAULT '',
      from_admin BOOLEAN DEFAULT false,
      read BOOLEAN DEFAULT false,
      created_at BIGINT DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS testimonials (
      id SERIAL PRIMARY KEY,
      telegram_id TEXT NOT NULL,
      name TEXT DEFAULT '',
      message TEXT DEFAULT '',
      video_url TEXT DEFAULT '',
      amount TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      created_at BIGINT DEFAULT 0,
      updated_at BIGINT DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS poems (
      id SERIAL PRIMARY KEY,
      telegram_id TEXT NOT NULL,
      title TEXT DEFAULT '',
      content TEXT DEFAULT '',
      author TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      created_at BIGINT DEFAULT 0,
      updated_at BIGINT DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS socialpay_profiles (
      id SERIAL PRIMARY KEY,
      telegram_id TEXT UNIQUE NOT NULL,
      display_name TEXT DEFAULT '',
      profile_pic TEXT DEFAULT '',
      country TEXT DEFAULT '',
      age TEXT DEFAULT '',
      bio TEXT DEFAULT '',
      is_verified BOOLEAN DEFAULT false,
      is_gold_verified BOOLEAN DEFAULT false,
      verification_status TEXT DEFAULT 'none',
      gold_status TEXT DEFAULT 'none',
      total_likes BIGINT DEFAULT 0,
      followers BIGINT DEFAULT 0,
      created_at BIGINT DEFAULT 0,
      updated_at BIGINT DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS socialpay_posts (
      id SERIAL PRIMARY KEY,
      telegram_id TEXT NOT NULL,
      content TEXT DEFAULT '',
      image_url TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      likes BIGINT DEFAULT 0,
      user_likes BIGINT DEFAULT 0,
      total_earned NUMERIC DEFAULT 0,
      created_at BIGINT DEFAULT 0,
      updated_at BIGINT DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS socialpay_likes (
      id SERIAL PRIMARY KEY,
      telegram_id TEXT NOT NULL,
      post_id INT NOT NULL,
      created_at BIGINT DEFAULT 0,
      UNIQUE(telegram_id, post_id)
    );
    CREATE TABLE IF NOT EXISTS verification_requests (
      id SERIAL PRIMARY KEY,
      telegram_id TEXT NOT NULL,
      type TEXT DEFAULT 'orange',
      status TEXT DEFAULT 'pending',
      created_at BIGINT DEFAULT 0,
      updated_at BIGINT DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sp_comments (
      id SERIAL PRIMARY KEY,
      telegram_id TEXT NOT NULL,
      post_id INT NOT NULL,
      text TEXT DEFAULT '',
      parent_id INT DEFAULT NULL,
      is_deleted BOOLEAN DEFAULT false,
      created_at BIGINT DEFAULT 0,
      updated_at BIGINT DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sp_dms (
      id SERIAL PRIMARY KEY,
      from_tid TEXT NOT NULL,
      to_tid TEXT NOT NULL,
      text TEXT DEFAULT '',
      media_url TEXT DEFAULT '',
      media_type TEXT DEFAULT '',
      read BOOLEAN DEFAULT false,
      created_at BIGINT DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS broadcasts (
      id SERIAL PRIMARY KEY,
      message TEXT DEFAULT '',
      sent_count INT DEFAULT 0,
      created_at BIGINT DEFAULT 0
    );
  `);
  console.log('[DB] PostgreSQL tables initialized');
}

// ─── User CRUD ───────────────────────────────────────────────────────────────
async function getOrCreateUser(telegramId, username, fullName, referredBy) {
  const tid = String(telegramId);
  const existing = await query('SELECT * FROM users WHERE telegram_id = $1', [tid]);
  let user = existing.rows[0] || null;
  let isNew = false;

  if (!user) {
    isNew = true;
    const uid = generateUID();
    const refCode = generateUID();
    const res = await query(`
      INSERT INTO users (telegram_id, telegram_username, full_name, registered_name,
        trc20_address, usdt_balance, uid, is_vip, vip_activated_at,
        last_hourly_claim, last_vip_claim, connected_apps, terms_accepted,
        referral_code, referred_by, referral_count, is_active, earnings_suspended,
        created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,0,$6,false,0,0,0,'[]',false,$7,$8,0,true,false,$9,$9)
      RETURNING *
    `, [tid, username||'', fullName||'', fullName||'', SHARED_TRC20_ADDRESS, uid, refCode, referredBy||'', now()]);
    user = res.rows[0];

    if (referredBy) {
      const refRes = await query('SELECT * FROM users WHERE referral_code=$1 OR uid=$1', [referredBy]);
      const referrer = refRes.rows[0];
      if (referrer && referrer.telegram_id !== tid) {
        await query('UPDATE users SET usdt_balance=usdt_balance+200, referral_count=referral_count+1, updated_at=$1 WHERE telegram_id=$2',
          [now(), referrer.telegram_id]);
        user._referrer = { telegram_id: referrer.telegram_id, name: referrer.full_name };
      }
    }
  } else {
    const updates = [];
    const vals = [];
    let idx = 1;
    if (username)  { updates.push(`telegram_username=$${idx++}`); vals.push(username); }
    if (fullName)  { updates.push(`full_name=$${idx++}`); vals.push(fullName); }
    updates.push(`trc20_address=$${idx++}`); vals.push(SHARED_TRC20_ADDRESS);
    updates.push(`updated_at=$${idx++}`); vals.push(now());
    vals.push(tid);
    await query(`UPDATE users SET ${updates.join(',')} WHERE telegram_id=$${idx}`, vals);
    const res = await query('SELECT * FROM users WHERE telegram_id=$1', [tid]);
    user = res.rows[0];
  }
  user._isNew = isNew;
  return user;
}

async function getUserByTelegramId(tid) {
  const r = await query('SELECT * FROM users WHERE telegram_id=$1', [String(tid)]);
  return r.rows[0] || null;
}
async function getUserById(id) {
  const r = await query('SELECT * FROM users WHERE id=$1', [id]);
  return r.rows[0] || null;
}
async function getAllUsers() {
  const r = await query('SELECT * FROM users ORDER BY created_at DESC');
  return r.rows;
}
async function updateUserBalance(telegramId, amount) {
  const tid = String(telegramId);
  await query('UPDATE users SET usdt_balance=GREATEST(0,usdt_balance+$1), updated_at=$2 WHERE telegram_id=$3',
    [amount, now(), tid]);
  return getUserByTelegramId(tid);
}
async function upgradeToVIP(telegramId) {
  const tid = String(telegramId);
  await query('UPDATE users SET is_vip=true, vip_activated_at=$1, last_vip_claim=0, updated_at=$1 WHERE telegram_id=$2',
    [now(), tid]);
  return getUserByTelegramId(tid);
}
async function updateUserName(telegramId, newName) {
  const tid = String(telegramId);
  await query('UPDATE users SET registered_name=$1, full_name=$1, updated_at=$2 WHERE telegram_id=$3',
    [newName, now(), tid]);
  return getUserByTelegramId(tid);
}
async function setUserActive(telegramId, isActive) {
  await query('UPDATE users SET is_active=$1, updated_at=$2 WHERE telegram_id=$3',
    [isActive, now(), String(telegramId)]);
}
async function setEarningsSuspended(telegramId, suspended) {
  await query('UPDATE users SET earnings_suspended=$1, updated_at=$2 WHERE telegram_id=$3',
    [suspended, now(), String(telegramId)]);
}
async function acceptTerms(telegramId) {
  await query('UPDATE users SET terms_accepted=true, updated_at=$1 WHERE telegram_id=$2',
    [now(), String(telegramId)]);
}

// ─── Hourly Earning ──────────────────────────────────────────────────────────
async function claimHourlyEarning(telegramId) {
  const tid  = String(telegramId);
  const user = await getUserByTelegramId(tid);
  if (!user) return { success: false, error: 'User not found' };
  if (user.earnings_suspended) return { success: false, error: 'Your earnings have been temporarily suspended. Please contact support.' };
  const isVIP     = user.is_vip === true;
  const lastField = isVIP ? 'last_vip_claim' : 'last_hourly_claim';
  const lastClaim = parseInt(user[lastField]) || 0;
  const hourMs    = 60 * 60 * 1000;
  if (now() - lastClaim < hourMs) return { success: false, nextIn: hourMs - (now() - lastClaim) };
  const amount = isVIP ? 200 : 50;
  await query(`UPDATE users SET usdt_balance=usdt_balance+$1, ${lastField}=$2, updated_at=$2 WHERE telegram_id=$3`,
    [amount, now(), tid]);
  const updated = await getUserByTelegramId(tid);
  await createTransaction(telegramId, 'earning', amount, isVIP ? 'VIP Bonus' : 'Hourly Bonus');
  return { success: true, amount, newBalance: parseFloat(updated.usdt_balance), isVIP };
}
async function getHourlyStatus(telegramId) {
  const user = await getUserByTelegramId(String(telegramId));
  if (!user) return { canClaim: false, nextClaimIn: 0, hourlyAmount: 50 };
  const isVIP     = user.is_vip === true;
  const lastField = isVIP ? 'last_vip_claim' : 'last_hourly_claim';
  const lastClaim = parseInt(user[lastField]) || 0;
  const hourMs    = 60 * 60 * 1000;
  const diff      = now() - lastClaim;
  return { canClaim: diff >= hourMs, nextClaimIn: Math.max(0, hourMs - diff), hourlyAmount: isVIP ? 200 : 50, isVIP };
}

// ─── Earning Apps ─────────────────────────────────────────────────────────────
async function getEarningApps() {
  const r = await query('SELECT * FROM earning_apps WHERE deleted=false');
  return r.rows;
}
async function getEarningAppById(id) {
  const r = await query('SELECT * FROM earning_apps WHERE id=$1', [id]);
  return r.rows[0] || null;
}
async function getEarningAppByToken(tok) {
  const r = await query('SELECT * FROM earning_apps WHERE bot_token=$1', [tok]);
  return r.rows[0] || null;
}
async function addEarningApp(data) {
  const r = await query(
    'INSERT INTO earning_apps (name,description,bot_token,icon,url,deleted,created_at) VALUES ($1,$2,$3,$4,$5,false,$6) RETURNING *',
    [data.name||'', data.description||'', data.bot_token||'', data.icon||'', data.url||'', now()]);
  return r.rows[0];
}
async function removeEarningApp(id) {
  await query('UPDATE earning_apps SET deleted=true, deleted_at=$1 WHERE id=$2', [now(), parseInt(id)]);
  return true;
}

// ─── UID Connections ──────────────────────────────────────────────────────────
async function connectUID(telegramId, appId, externalUID) {
  const tid  = String(telegramId);
  const user = await getUserByTelegramId(tid);
  if (!user) return null;
  const apps = Array.isArray(user.connected_apps) ? user.connected_apps : [];
  const existing = apps.findIndex(a => a.app_id === appId);
  if (existing >= 0) { apps[existing].uid = externalUID; apps[existing].updated_at = now(); }
  else apps.push({ app_id: appId, uid: externalUID, connected_at: now(), updated_at: now() });
  await query('UPDATE users SET connected_apps=$1, updated_at=$2 WHERE telegram_id=$3',
    [JSON.stringify(apps), now(), tid]);
  return getUserByTelegramId(tid);
}
async function getConnectedUID(telegramId, appId) {
  const user = await getUserByTelegramId(String(telegramId));
  if (!user) return null;
  const apps = Array.isArray(user.connected_apps) ? user.connected_apps : [];
  const conn = apps.find(a => a.app_id === appId);
  return conn ? conn.uid : null;
}
async function getUserConnections(telegramId) {
  const user = await getUserByTelegramId(String(telegramId));
  return user ? (Array.isArray(user.connected_apps) ? user.connected_apps : []) : [];
}
async function findUserByExternalUID(externalUID) {
  const r = await query("SELECT * FROM users WHERE connected_apps::text LIKE $1", [`%${externalUID}%`]);
  return r.rows.find(u => (u.connected_apps||[]).some(a => a.uid === externalUID)) || null;
}

// ─── Transactions ─────────────────────────────────────────────────────────────
async function createTransaction(telegramId, type, amount, note, status) {
  const r = await query(
    'INSERT INTO transactions (telegram_id,type,amount,note,status,created_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [String(telegramId), type, amount, note||'', status||'completed', nowSec()]);
  return r.rows[0];
}
async function getUserTransactions(tid) {
  const r = await query('SELECT * FROM transactions WHERE telegram_id=$1 ORDER BY created_at DESC LIMIT 50', [String(tid)]);
  return r.rows;
}

// ─── Withdrawals ──────────────────────────────────────────────────────────────
async function createWithdrawalRequest(data) {
  const r = await query(
    'INSERT INTO withdrawals (telegram_id,amount,fee,net_amount,address,status,receipt_url,tx_hash,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *',
    [String(data.telegram_id), data.amount||0, data.fee||0, data.net_amount||0, data.address||'', 'pending', data.receipt_url||'', data.tx_hash||'', nowSec()]);
  return r.rows[0];
}
async function getPendingWithdrawals() {
  const r = await query("SELECT * FROM withdrawals WHERE status='pending' ORDER BY created_at DESC");
  return r.rows;
}
async function getWithdrawalById(id) {
  const r = await query('SELECT * FROM withdrawals WHERE id=$1', [parseInt(id)]);
  return r.rows[0] || null;
}
async function updateWithdrawal(id, updates) {
  const fields = Object.keys(updates).map((k, i) => `${k}=$${i+1}`).join(',');
  const vals   = Object.values(updates);
  vals.push(nowSec(), parseInt(id));
  await query(`UPDATE withdrawals SET ${fields}, updated_at=$${vals.length-1} WHERE id=$${vals.length}`, vals);
  return getWithdrawalById(id);
}
async function getUserWithdrawals(tid) {
  const r = await query('SELECT * FROM withdrawals WHERE telegram_id=$1 ORDER BY created_at DESC', [String(tid)]);
  return r.rows;
}

// ─── Support ──────────────────────────────────────────────────────────────────
async function createSupportMessage(telegramId, message, fromAdmin) {
  const r = await query(
    'INSERT INTO support_messages (telegram_id,message,from_admin,read,created_at) VALUES ($1,$2,$3,false,$4) RETURNING *',
    [String(telegramId), message, !!fromAdmin, nowSec()]);
  return r.rows[0];
}
async function getSupportMessages(tid) {
  const r = await query('SELECT * FROM support_messages WHERE telegram_id=$1 ORDER BY created_at ASC', [String(tid)]);
  return r.rows;
}
async function getAllSupportThreads() {
  const r = await query('SELECT * FROM support_messages ORDER BY created_at DESC');
  const grouped = {};
  for (const m of r.rows) {
    if (!grouped[m.telegram_id]) grouped[m.telegram_id] = [];
    grouped[m.telegram_id].push(m);
  }
  return grouped;
}
async function markSupportRead(tid) {
  await query("UPDATE support_messages SET read=true WHERE telegram_id=$1 AND from_admin=true AND read=false", [String(tid)]);
}

// ─── Testimonials ─────────────────────────────────────────────────────────────
async function createTestimonial(telegramId, data) {
  const r = await query(
    'INSERT INTO testimonials (telegram_id,name,message,video_url,amount,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING *',
    [String(telegramId), data.name||'', data.message||'', data.video_url||'', data.amount||'', 'pending', nowSec()]);
  return r.rows[0];
}
async function getTestimonialById(id) {
  const r = await query('SELECT * FROM testimonials WHERE id=$1', [parseInt(id)]);
  return r.rows[0] || null;
}
async function getPendingTestimonials() {
  const r = await query("SELECT * FROM testimonials WHERE status='pending'");
  return r.rows;
}
async function getApprovedTestimonials() {
  const r = await query("SELECT * FROM testimonials WHERE status='approved' ORDER BY created_at DESC");
  return r.rows;
}
async function updateTestimonial(id, data) {
  const fields = Object.keys(data).map((k, i) => `${k}=$${i+1}`).join(',');
  const vals   = [...Object.values(data), nowSec(), parseInt(id)];
  await query(`UPDATE testimonials SET ${fields}, updated_at=$${vals.length-1} WHERE id=$${vals.length}`, vals);
  return getTestimonialById(id);
}

// ─── Poems ────────────────────────────────────────────────────────────────────
async function createPoem(telegramId, data) {
  const r = await query(
    'INSERT INTO poems (telegram_id,title,content,author,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING *',
    [String(telegramId), data.title||'', data.content||'', data.author||'', 'pending', nowSec()]);
  return r.rows[0];
}
async function getPoemById(id) {
  const r = await query('SELECT * FROM poems WHERE id=$1', [parseInt(id)]);
  return r.rows[0] || null;
}
async function getPendingPoems() {
  const r = await query("SELECT * FROM poems WHERE status='pending' ORDER BY created_at DESC");
  return r.rows;
}
async function getApprovedPoems() {
  const r = await query("SELECT * FROM poems WHERE status='approved' ORDER BY created_at DESC");
  return r.rows;
}
async function updatePoem(id, data) {
  const fields = Object.keys(data).map((k, i) => `${k}=$${i+1}`).join(',');
  const vals   = [...Object.values(data), nowSec(), parseInt(id)];
  await query(`UPDATE poems SET ${fields}, updated_at=$${vals.length-1} WHERE id=$${vals.length}`, vals);
  return getPoemById(id);
}

// ─── SocialPay Profiles ───────────────────────────────────────────────────────
async function getSocialProfile(telegramId) {
  const tid = String(telegramId);
  let r = await query('SELECT * FROM socialpay_profiles WHERE telegram_id=$1', [tid]);
  if (r.rows.length === 0) {
    const user = await getUserByTelegramId(tid);
    const ins = await query(
      'INSERT INTO socialpay_profiles (telegram_id,display_name,profile_pic,country,age,bio,is_verified,is_gold_verified,verification_status,gold_status,total_likes,followers,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) ON CONFLICT (telegram_id) DO NOTHING RETURNING *',
      [tid, user ? (user.full_name||'User') : 'User', '', '', '', '', false, false, 'none', 'none', 0, 0, nowSec()]);
    if (ins.rows.length > 0) return ins.rows[0];
    r = await query('SELECT * FROM socialpay_profiles WHERE telegram_id=$1', [tid]);
  }
  return r.rows[0] || null;
}
async function updateSocialProfile(telegramId, data) {
  const tid = String(telegramId);
  await getSocialProfile(tid);
  const fields = Object.keys(data).map((k, i) => `${k}=$${i+1}`).join(',');
  const vals   = [...Object.values(data), nowSec(), tid];
  await query(`UPDATE socialpay_profiles SET ${fields}, updated_at=$${vals.length-1} WHERE telegram_id=$${vals.length}`, vals);
  return getSocialProfile(tid);
}
async function getAllSocialProfiles() {
  const r = await query('SELECT * FROM socialpay_profiles');
  return r.rows;
}

// ─── SocialPay Posts ──────────────────────────────────────────────────────────
async function createSocialPost(telegramId, data) {
  const r = await query(
    'INSERT INTO socialpay_posts (telegram_id,content,image_url,status,likes,user_likes,total_earned,created_at,updated_at) VALUES ($1,$2,$3,$4,0,0,0,$5,$5) RETURNING *',
    [String(telegramId), data.content||'', data.image_url||'', 'pending', nowSec()]);
  return r.rows[0];
}
async function getSocialPostById(id) {
  const r = await query('SELECT * FROM socialpay_posts WHERE id=$1', [parseInt(id)]);
  return r.rows[0] || null;
}
async function getPendingSocialPosts() {
  const r = await query("SELECT * FROM socialpay_posts WHERE status='pending' ORDER BY created_at DESC");
  return r.rows;
}
async function getApprovedSocialPosts() {
  const r = await query("SELECT * FROM socialpay_posts WHERE status='approved' ORDER BY created_at DESC");
  return r.rows;
}
async function getSocialPostsByUser(tid) {
  const r = await query("SELECT * FROM socialpay_posts WHERE telegram_id=$1 ORDER BY created_at DESC", [String(tid)]);
  return r.rows;
}
async function updateSocialPost(id, data) {
  const fields = Object.keys(data).map((k, i) => `${k}=$${i+1}`).join(',');
  const vals   = [...Object.values(data), nowSec(), parseInt(id)];
  await query(`UPDATE socialpay_posts SET ${fields}, updated_at=$${vals.length-1} WHERE id=$${vals.length}`, vals);
  return getSocialPostById(id);
}
async function deleteSocialPost(id) {
  await query("UPDATE socialpay_posts SET status='deleted', updated_at=$1 WHERE id=$2", [nowSec(), parseInt(id)]);
}

async function sendLikesToPost(postId, likesToAdd, botRef) {
  const post = await getSocialPostById(postId);
  if (!post || post.status !== 'approved') return { success: false, error: 'Post not found or not approved' };
  const oldLikes = parseInt(post.likes) || 0;
  const newLikes = oldLikes + likesToAdd;
  const milestones = [{ threshold:1000000, payout:100000 }, { threshold:100000, payout:10000 }, { threshold:10000, payout:1000 }, { threshold:1000, payout:100 }];
  let earned = 0;
  for (const m of milestones) { if (oldLikes < m.threshold && newLikes >= m.threshold) earned += m.payout; }
  const totalEarned = (parseFloat(post.total_earned)||0) + earned;
  await query('UPDATE socialpay_posts SET likes=$1, total_earned=$2, updated_at=$3 WHERE id=$4',
    [newLikes, totalEarned, nowSec(), parseInt(postId)]);

  const allPosts = await query("SELECT * FROM socialpay_posts WHERE telegram_id=$1 AND status='approved'", [post.telegram_id]);
  const totalAdminLikes = allPosts.rows.reduce((sum, p) => sum + (p.id === parseInt(postId) ? newLikes : (parseInt(p.likes)||0)), 0);
  await query('UPDATE socialpay_profiles SET total_likes=$1, followers=$1, updated_at=$2 WHERE telegram_id=$3',
    [totalAdminLikes, nowSec(), post.telegram_id]);

  if (earned > 0) {
    await updateUserBalance(post.telegram_id, earned);
    await createTransaction(post.telegram_id, 'socialpay_reward', earned, `SocialPay: ${newLikes.toLocaleString()} likes`);
    if (botRef) botRef.sendMessage(post.telegram_id,
      `🎉 <b>SocialPay Reward!</b>\n\n❤️ Your post reached <b>${newLikes.toLocaleString()} likes</b>!\n💰 <b>+${earned.toLocaleString()} USDT</b> added to your balance!\n\nKeep posting great content! 🚀`,
      { parse_mode: 'HTML' }).catch(() => {});
  }
  return { success: true, newLikes, earned, totalEarned };
}

// ─── SocialPay Likes (user) ───────────────────────────────────────────────────
async function likePost(telegramId, postId) {
  const tid = String(telegramId);
  const pId = parseInt(postId);
  try {
    await query('INSERT INTO socialpay_likes (telegram_id,post_id,created_at) VALUES ($1,$2,$3)', [tid, pId, nowSec()]);
    await query('UPDATE socialpay_posts SET user_likes=user_likes+1 WHERE id=$1', [pId]);
    return { success: true };
  } catch (e) {
    return { success: false, error: 'Already liked' };
  }
}
async function hasLiked(tid, postId) {
  const r = await query('SELECT 1 FROM socialpay_likes WHERE telegram_id=$1 AND post_id=$2', [String(tid), parseInt(postId)]);
  return r.rows.length > 0;
}

// ─── Comments ─────────────────────────────────────────────────────────────────
async function createComment(telegramId, postId, text, parentId) {
  const r = await query(
    'INSERT INTO sp_comments (telegram_id,post_id,text,parent_id,is_deleted,created_at) VALUES ($1,$2,$3,$4,false,$5) RETURNING *',
    [String(telegramId), parseInt(postId), text, parentId ? parseInt(parentId) : null, nowSec()]);
  return r.rows[0];
}
async function getCommentsByPost(postId) {
  const r = await query('SELECT * FROM sp_comments WHERE post_id=$1 AND is_deleted=false ORDER BY created_at ASC', [parseInt(postId)]);
  return r.rows;
}
async function deleteComment(commentId) {
  await query('UPDATE sp_comments SET is_deleted=true, updated_at=$1 WHERE id=$2', [nowSec(), parseInt(commentId)]);
}

// ─── DMs (Gold Verified only) ─────────────────────────────────────────────────
async function createDM(fromTid, toTid, data) {
  const r = await query(
    'INSERT INTO sp_dms (from_tid,to_tid,text,media_url,media_type,read,created_at) VALUES ($1,$2,$3,$4,$5,false,$6) RETURNING *',
    [String(fromTid), String(toTid), data.text||'', data.media_url||'', data.media_type||'', nowSec()]);
  return r.rows[0];
}
async function getDMs(tid1, tid2) {
  const t1 = String(tid1), t2 = String(tid2);
  const r = await query('SELECT * FROM sp_dms WHERE (from_tid=$1 AND to_tid=$2) OR (from_tid=$2 AND to_tid=$1) ORDER BY created_at ASC', [t1, t2]);
  return r.rows;
}
async function getDMContacts(tid) {
  const t = String(tid);
  const r = await query('SELECT DISTINCT CASE WHEN from_tid=$1 THEN to_tid ELSE from_tid END as contact FROM sp_dms WHERE from_tid=$1 OR to_tid=$1', [t]);
  return r.rows.map(row => row.contact);
}
async function markDMsRead(fromTid, toTid) {
  await query('UPDATE sp_dms SET read=true WHERE from_tid=$1 AND to_tid=$2 AND read=false', [String(fromTid), String(toTid)]);
}

// ─── Verification ─────────────────────────────────────────────────────────────
async function createVerificationRequest(telegramId, type) {
  const existing = await query("SELECT * FROM verification_requests WHERE telegram_id=$1 AND type=$2 AND status='pending'", [String(telegramId), type]);
  if (existing.rows.length > 0) return existing.rows[0];
  const r = await query(
    'INSERT INTO verification_requests (telegram_id,type,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$4) RETURNING *',
    [String(telegramId), type, 'pending', nowSec()]);
  return r.rows[0];
}
async function getPendingVerificationRequests() {
  const r = await query("SELECT * FROM verification_requests WHERE status='pending' ORDER BY created_at ASC");
  return r.rows;
}
async function updateVerificationRequest(id, status) {
  await query('UPDATE verification_requests SET status=$1, updated_at=$2 WHERE id=$3', [status, nowSec(), parseInt(id)]);
  return (await query('SELECT * FROM verification_requests WHERE id=$1', [parseInt(id)])).rows[0];
}

// ─── Broadcasts ───────────────────────────────────────────────────────────────
async function createBroadcast(message, sentCount) {
  const r = await query('INSERT INTO broadcasts (message,sent_count,created_at) VALUES ($1,$2,$3) RETURNING *',
    [message, sentCount||0, nowSec()]);
  return r.rows[0];
}

// ─── Export ───────────────────────────────────────────────────────────────────
module.exports = {
  initDB, query,
  getOrCreateUser, getUserByTelegramId, getUserById, getAllUsers,
  updateUserBalance, upgradeToVIP, updateUserName,
  setUserActive, setEarningsSuspended, acceptTerms,
  claimHourlyEarning, getHourlyStatus,
  getEarningApps, getEarningAppById, getEarningAppByToken, addEarningApp, removeEarningApp,
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
  createBroadcast,
  MIN_WITHDRAWAL, MAX_WITHDRAWAL, GATEWAY_FEE_RATE, SHARED_TRC20_ADDRESS
};
