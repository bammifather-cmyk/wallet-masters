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

  // ── Column migrations: add missing columns safely ────────────────────────
  // Check & add is_pinned to socialpay_posts
  const { error: pinErr } = await supabase.from('socialpay_posts').select('is_pinned').limit(1);
  if (pinErr && pinErr.message && pinErr.message.includes('is_pinned')) {
    console.log('[DB MIGRATION] Adding is_pinned column to socialpay_posts...');
    // Use Supabase REST + service role to run raw SQL via PostgREST RPC
    // Fallback: patch via direct HTTP to management API
    try {
      const SUPABASE_URL = process.env.SUPABASE_URL || '';
      const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
      const PROJECT_REF = SUPABASE_URL.replace('https://','').replace('.supabase.co','').split('.')[0];
      // Try via pg REST proxy
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` },
        body: JSON.stringify({ query: 'ALTER TABLE socialpay_posts ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT false' })
      });
      console.log('[DB MIGRATION] is_pinned migration attempt status:', resp.status);
    } catch(e) { console.warn('[DB MIGRATION] is_pinned migration failed:', e.message); }
  }

  // Check & add caption to socialpay_posts
  const { error: capErr } = await supabase.from('socialpay_posts').select('caption').limit(1);
  if (capErr && capErr.message && capErr.message.includes('caption')) {
    console.log('[DB MIGRATION] socialpay_posts.caption missing — will use content field as fallback');
  }

  // Check & add screenshot_url to support_messages
  const { error: ssErr } = await supabase.from('support_messages').select('screenshot_url').limit(1);
  if (ssErr && ssErr.message && ssErr.message.includes('screenshot_url')) {
    console.log('[DB MIGRATION] support_messages.screenshot_url missing — image attachments will be skipped');
  }
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

async function setUserBalance(telegramId, amount) {
  const newBalance = parseFloat(amount) || 0;
  const { error } = await supabase
    .from('users')
    .update({ usdt_balance: newBalance, updated_at: now() })
    .eq('telegram_id', String(telegramId));
  if (error) throw error;
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
  // VIP users earn 200 USDT/hr, non-VIP earn 50 USDT/hr
    const amount = user.is_vip === true ? 200 : 50;
  const newBalance = (parseFloat(user.usdt_balance) || 0) + amount;
  await supabase.from('users').update({ usdt_balance: newBalance, last_hourly_claim: now(), updated_at: now() }).eq('telegram_id', String(telegramId));
  await createTransaction(telegramId, 'hourly_earning', amount, 'Hourly earning claim', 'completed');
  return { success: true, amount, reward: amount, newBalance, balance: newBalance };
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
  // Map all fields to the existing schema columns
  const { method, account_number, bank_name, country, currency, ...rest } = d;
  // Store bank/crypto details in address field as readable string
  let addressStr = account_number || rest.address || '';
  if (bank_name) addressStr = `${bank_name} | ${addressStr}`;
  if (country) addressStr = `${addressStr} | ${country}`;
  if (currency && currency !== 'USDT') addressStr = `${addressStr} | ${currency}`;
  if (method) addressStr = `[${method.toUpperCase()}] ${addressStr}`;
  const insertData = {
    telegram_id: String(d.telegram_id),
    amount: d.amount,
    fee: d.fee || 0,
    net_amount: d.net_amount || d.amount,
    address: addressStr,
    status: 'pending',
    created_at: now(),
    updated_at: now()
  };
  const { data, error } = await supabase.from('withdrawals').insert([insertData]).select().single();
  if (error) { console.error('createWithdrawalRequest error:', error.message, error.details); return null; }
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
  const { data, error } = await supabase.from('withdrawals').select('*').eq('telegram_id', String(tid)).order('created_at', { ascending: false });
  if (error) { console.error('getUserWithdrawals error:', error.message); return []; }
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
  // Map 'type' into 'amount' field (stores type info) since schema has no 'type' column
  const { type, category, ...rest } = data;
  const insertData = { ...rest, telegram_id: String(telegramId), status: 'pending', created_at: now(), updated_at: now() };
  if (type) insertData.amount = insertData.amount || type; // store type in amount if no amount
  if (type && !insertData.message) insertData.message = '';
  // Store type in message prefix for admin to see
  if (type) insertData.message = `[${type.toUpperCase()}] ${insertData.message||''}`.trim();
  const { data: d, error } = await supabase.from('testimonials').insert([insertData]).select().single();
  if (error) { console.error('createTestimonial error:', error); return null; }
  if (d && type) d.type = type; // reattach for bot.js use
  return d;
}

async function getTestimonialById(id) {
  const { data } = await supabase.from('testimonials').select('*').eq('id', id).single();
  if (!data) return null;
  // Detect type from video_url or message prefix so reward is always correct
  if (!data.type || data.type === 'video') {
    if (data.video_url && (data.video_url.includes('youtube') || data.video_url.includes('youtu.be'))) {
      data.type = 'youtube';
    } else if (data.message && data.message.startsWith('[YOUTUBE]')) {
      data.type = 'youtube';
    } else {
      data.type = data.message && data.message.startsWith('[') ? data.message.split(']')[0].replace('[','').toLowerCase() : 'video';
    }
  }
  return data;
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

async function deleteTestimonial(id) {
  const { error } = await supabase.from('testimonials').delete().eq('id', id);
  return !error;
}

// ─── Poems ────────────────────────────────────────────────────────────────────
async function createPoem(telegramId, data) {
  const { category, ...rest } = data;
  // Store category in title prefix
  const title = category && rest.title ? `[${category}] ${rest.title}` : (category || rest.title || '');
  const insertData = { ...rest, title, telegram_id: String(telegramId), status: 'pending', created_at: now(), updated_at: now() };
  const { data: d, error } = await supabase.from('poems').insert([insertData]).select().single();
  if (error) { console.error('createPoem error:', error); return null; }
  if (d && category) d.category = category;
  return d;
}

async function getPoemById(id) {
  const { data } = await supabase.from('poems').select('*').eq('id', id).single();
  return data || null;
}

async function getPendingPoems() {
  const { data } = await supabase.from('poems').select('*').eq('status', 'pending').order('created_at', { ascending: false });
  if (!data) return [];
  return data.map(p => {
    const { category, cleanTitle } = extractPoemCategory(p.title);
    return { ...p, category, title: cleanTitle };
  });
}

function extractPoemCategory(title) {
  if (!title) return { category: 'General', cleanTitle: title || '' };
  const m = title.match(/^\[([^\]]+)\]\s*(.+)$/);
  if (m) return { category: m[1], cleanTitle: m[2].trim() };
  return { category: 'General', cleanTitle: title.trim() };
}

async function getApprovedPoems() {
  const { data } = await supabase.from('poems').select('*').eq('status', 'approved').order('created_at', { ascending: false });
  if (!data) return [];
  return data.map(p => {
    const { category, cleanTitle } = extractPoemCategory(p.title);
    return { ...p, category, title: cleanTitle };
  });
}

async function updatePoem(id, updates) {
  await supabase.from('poems').update({ ...updates, updated_at: now() }).eq('id', id);
}

async function deletePoem(id) {
  const { error } = await supabase.from('poems').delete().eq('id', id);
  return !error;
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
  // Map fields to actual DB schema: content, image_url (no caption/post_type/has_image/voice_data)
  const { caption, post_type, image_data, voice_data, has_image, has_voice, content, image_url, ...rest } = data;
  const insertData = {
    telegram_id: String(telegramId),
    content: caption || content || '',
    image_url: image_data || image_url || null,  // store base64 or URL
    status: 'pending', likes: 0, user_likes: 0, total_earned: 0,
    created_at: now(), updated_at: now()
  };
  const { data: d, error } = await supabase.from('socialpay_posts').insert([insertData]).select().single();
  if (error) { console.error('createSocialPost error:', error); return null; }
  // Attach post_type for admin notification (not in DB)
  if (d) { d.post_type = post_type || 'text'; d.caption = d.content; }
  return d;
}

async function getSocialPostById(id) {
  const { data } = await supabase.from('socialpay_posts').select('*').eq('id', id).single();
  if (!data) return null;
  return { ...data, caption: data.content || '' };
}

async function getPendingSocialPosts() {
  const { data } = await supabase.from('socialpay_posts').select('*').eq('status', 'pending').order('created_at', { ascending: false });
  return (data || []).map(p => ({ ...p, caption: p.content || '' }));
}

async function getApprovedSocialPosts() {
  // Try with is_pinned; graceful fallback if column doesn't exist yet
  let posts = null, hasPinned = false;
  const { data: d1, error: e1 } = await supabase.from('socialpay_posts')
    .select('id,telegram_id,content,image_url,status,likes,user_likes,total_earned,created_at,updated_at,is_pinned')
    .eq('status', 'approved').order('created_at', { ascending: false });
  if (e1 && (e1.message||'').includes('is_pinned')) {
    const { data: d2 } = await supabase.from('socialpay_posts')
      .select('id,telegram_id,content,image_url,status,likes,user_likes,total_earned,created_at,updated_at')
      .eq('status', 'approved').order('created_at', { ascending: false });
    posts = d2 || []; hasPinned = false;
  } else { posts = d1 || []; hasPinned = true; }
  const mapped = posts.map(p => ({ ...p, caption: p.content||'', is_pinned: hasPinned ? (p.is_pinned||false) : false }));
  const pinned = mapped.filter(p => p.is_pinned);
  const normal = mapped.filter(p => !p.is_pinned);
  return [...pinned, ...normal];
}

async function setPinnedPost(postId, isPinned) {
  // Try with is_pinned column; if missing, return error message to trigger SQL reminder
  const { error } = await supabase.from('socialpay_posts').update({ is_pinned: isPinned, updated_at: Date.now() }).eq('id', postId);
  if (error && (error.message||'').includes('is_pinned')) {
    console.warn('[DB] is_pinned column missing — run: ALTER TABLE socialpay_posts ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT false;');
    return false;
  }
  return !error;
}

async function getSocialPostsByUser(telegramId) {
  let data = null;
  const { data: d1, error: e1 } = await supabase.from('socialpay_posts')
    .select('id,telegram_id,content,image_url,status,likes,user_likes,total_earned,created_at,updated_at,is_pinned')
    .eq('telegram_id', String(telegramId)).order('created_at', { ascending: false });
  if (e1 && (e1.message||'').includes('is_pinned')) {
    const { data: d2 } = await supabase.from('socialpay_posts')
      .select('id,telegram_id,content,image_url,status,likes,user_likes,total_earned,created_at,updated_at')
      .eq('telegram_id', String(telegramId)).order('created_at', { ascending: false });
    data = d2 || [];
  } else { data = d1 || []; }
  return data.map(p => ({ ...p, caption: p.content||'', is_pinned: p.is_pinned||false }));
}

async function updateSocialPost(id, updates) {
  await supabase.from('socialpay_posts').update({ ...updates, updated_at: now() }).eq('id', id);
}

async function deleteSocialPost(id) {
  await supabase.from('socialpay_posts').delete().eq('id', id);
}

async function sendLikesToPost(postId, adminLikes) {
  try {
    const { data: post } = await supabase.from('socialpay_posts').select('id,telegram_id,likes,total_earned').eq('id', postId).single();
    if (!post) return { success: false, error: 'Post not found' };
    const newLikes = (post.likes || 0) + adminLikes;
    await supabase.from('socialpay_posts').update({ likes: newLikes, updated_at: now() }).eq('id', postId);
    const profile = await getSocialProfile(post.telegram_id);
    let earned = 0;
    if (profile) {
      const newTotal = (profile.total_likes || 0) + adminLikes;
      const newFollowers = Math.floor(newTotal / 2); // followers = 50% of total likes
      const isVerified = newTotal >= 1000 || profile.is_verified;
      const isGold = newTotal >= 500000 || profile.is_gold_verified;
      // Calculate earning: every 1000 likes = 100 USDT
      const prevMilestone = Math.floor((profile.total_likes || 0) / 1000);
      const newMilestone = Math.floor(newTotal / 1000);
      earned = (newMilestone - prevMilestone) * 100;
      await supabase.from('socialpay_profiles').update({ total_likes: newTotal, followers: newFollowers, is_verified: isVerified, is_gold_verified: isGold, updated_at: now() }).eq('telegram_id', post.telegram_id);
      // Credit user balance if earned
      if (earned > 0) {
        await updateUserBalance(post.telegram_id, earned);
        await createTransaction(post.telegram_id, 'socialpay_reward', earned, `SocialPay: ${adminLikes.toLocaleString()} likes added`, 'completed');
      }
    }
    return { success: true, earned, newLikes };
  } catch(e) { console.error('sendLikesToPost error:', e.message); return { success: false, error: e.message }; }
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
    const newFollowers = Math.floor(newTotal / 2); // followers = 50% of total likes
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
async function createDM(fromTid, toTid, dataOrText, mediaUrl, mediaType) {
  let text='', mUrl='', mType='text';
  if (dataOrText && typeof dataOrText === 'object') {
    text = dataOrText.text||'';
    mUrl = dataOrText.image_data || dataOrText.voice_data || '';
    mType = dataOrText.image_data ? 'image' : dataOrText.voice_data ? 'voice' : 'text';
  } else {
    // Handle case where a stringified object was passed — parse it back
    let raw = dataOrText||'';
    if (typeof raw === 'string' && raw.startsWith('{')) {
      try { const parsed = JSON.parse(raw); text = parsed.text||raw; mUrl = parsed.image_data||parsed.voice_data||''; mType = parsed.image_data?'image':parsed.voice_data?'voice':'text'; }
      catch { text = raw; }
    } else { text = raw; mUrl = mediaUrl||''; mType = mediaType||'text'; }
  }
  const { data } = await supabase.from('sp_dms').insert([{
    from_tid: String(fromTid), to_tid: String(toTid), text,
    media_url: mUrl, media_type: mType, read: false, created_at: now()
  }]).select().single();
  return data;
}

async function getDMs(tid1, tid2) {
  const { data } = await supabase.from('sp_dms').select('*')
    .or(`and(from_tid.eq.${tid1},to_tid.eq.${tid2}),and(from_tid.eq.${tid2},to_tid.eq.${tid1})`)
    .order('created_at');
  if (!data) return [];
  return data.map(dm => {
    let text = dm.text||'', mUrl = dm.media_url||'', mType = dm.media_type||'text';
    // Fix old records where the whole object was stored as JSON string in text field
    if (text.startsWith('{')) {
      try {
        const p = JSON.parse(text);
        text = p.text || '';
        if (!mUrl && p.image_data) { mUrl = p.image_data; mType = 'image'; }
        else if (!mUrl && p.voice_data) { mUrl = p.voice_data; mType = 'voice'; }
        else if (p.media_type) mType = p.media_type;
      } catch {}
    }
    return { ...dm, text, media_url: mUrl, media_type: mType,
      dm_type: mType || 'text',
      image_data: mType === 'image' ? mUrl : null,
      voice_data: mType === 'voice' ? mUrl : null
    };
  });
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

async function getVerificationRequestById(id) {
  const { data } = await supabase.from('verification_requests').select('*').eq('id', id).single();
  return data || null;
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


// ─── Delete Community Comment ────────────────────────────────────────────────
async function deleteCommunityComment(commentId) {
  try {
    const { error } = await supabase.from('community_comments').delete().eq('id', commentId);
    return !error;
  } catch(e) { console.error('deleteCommunityComment error:', e.message); return false; }
}


// ─── Admin post YouTube Testimonial ──────────────────────────────────────────
async function createAdminTestimonial(data) {
  const { caption, youtube_url } = data;
  const row = {
    telegram_id: 'ADMIN',
    name: 'Wallet Masters',
    type: 'youtube',
    video_url: youtube_url,
    message: '',        // users cannot set caption; only admin can
    caption: caption || '',
    status: 'approved', // admin posts go live instantly
    created_at: now(),
    updated_at: now(),
    is_admin_post: true
  };
  const { data: created, error } = await supabase.from('testimonials').insert([row]).select().single();
  if (error) throw error;
  return created;
}

module.exports = {
  setUserBalance,
  createAdminTestimonial,
  deleteCommunityComment,
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
  createTestimonial, getTestimonialById, getPendingTestimonials, getApprovedTestimonials, updateTestimonial, deleteTestimonial,
  createPoem, getPoemById, getPendingPoems, getApprovedPoems, updatePoem, deletePoem,
  getSocialProfile, updateSocialProfile, getAllSocialProfiles,
  createSocialPost, getSocialPostById, getPendingSocialPosts, getApprovedSocialPosts, getSocialPostsByUser, updateSocialPost, deleteSocialPost, sendLikesToPost,
  likePost, hasLiked,
  createComment, getCommentsByPost, deleteComment,
  createDM, getDMs, getDMContacts, markDMsRead, setPinnedPost,
  createVerificationRequest, getPendingVerificationRequests, getVerificationRequestById, updateVerificationRequest,
  createBroadcast
};
