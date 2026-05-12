# 🚀 Wallet Masters — Complete Setup Guide

## What's Built

| Component | Location | Technology |
|-----------|----------|-----------|
| Telegram Bot Backend | `backend/bot.js` | Node.js + node-telegram-bot-api |
| Database | `backend/database.js` | SQLite (better-sqlite3) |
| Mini App Frontend | `frontend/` | HTML + CSS + JS |
| Fee Collection Address | Hardcoded | `TPwUS8v77TtcsYZUHUTvVx2TGqE37QnagZ` |

---

## ⚙️ Step 1: Create Your Bot

1. Open Telegram and message **@BotFather**
2. Send `/newbot`
3. Follow prompts and save your **Bot Token**
4. Send `/setmenubutton` to BotFather and set Mini App URL
5. Enable web apps: `/setdomain` → enter your hosting domain

---

## 🖥️ Step 2: Deploy the Backend

### Option A: Railway (Recommended, free tier)
1. Go to [railway.app](https://railway.app)
2. Create new project → Deploy from GitHub or upload folder
3. Set environment variables (see `.env.example`)
4. Railway gives you a URL like `https://wallet-masters.up.railway.app`

### Option B: VPS (DigitalOcean, Linode, etc.)
```bash
# Upload the backend/ folder to your VPS
cd wallet-masters/backend
npm install
cp .env.example .env
nano .env   # Fill in your values

# Install PM2 for always-on process
npm install -g pm2
pm2 start bot.js --name wallet-masters
pm2 save
pm2 startup
```

### Option C: Render.com (free)
1. Go to [render.com](https://render.com)
2. New → Web Service → upload/connect repo
3. Set environment variables
4. Deploy

---

## 🌐 Step 3: Deploy the Frontend (Mini App)

The frontend must be hosted on **HTTPS** for Telegram.

### Option A: GitHub Pages (Free)
1. Create a GitHub repo
2. Upload `frontend/` contents to the repo root
3. Enable GitHub Pages in Settings → Pages
4. Your URL: `https://yourusername.github.io/repo-name`

### Option B: Netlify (Free, instant)
1. Go to [netlify.com](https://netlify.com)
2. Drag & drop the `frontend/` folder
3. Get instant HTTPS URL

### Option C: Same VPS (Express serves it)
The backend already serves `frontend/` as static files at the root URL.

---

## 🔧 Step 4: Configure BotFather

1. Send `/setmenubutton` to @BotFather
2. Select your bot
3. Enter button text: `Open Wallet`
4. Enter Web App URL: `https://your-frontend-url.com`

Or set via @BotFather:
- `/setdomain` → your domain
- `/setmenubutton` → your Mini App URL

---

## 📱 Step 5: Test

1. Open your bot in Telegram
2. Send `/start`
3. Tap **💼 Open Wallet**
4. The Mini App should open with your wallet

---

## 👤 Admin Features

When you open the bot with your own Admin Chat ID:
- You see the **Admin Menu** instead of user menu
- **📋 Pending Withdrawals** — see all withdrawals
- **➕ Add Earning App** — add earning apps by name + token
- **💰 Fee Address** — view the fee collection address

### Approve/Reject Withdrawals
When a user uploads a payment receipt:
1. You receive a photo message with full withdrawal details
2. Tap **✅ APPROVE** or **❌ REJECT** buttons
3. User is instantly notified

---

## 💰 Fee System

| Withdrawal | Total Fee | Gas Fee | Gateway Fee |
|-----------|-----------|---------|-------------|
| 100 USDT | 10 USDT | 4 USDT | 6 USDT |
| 500 USDT | 50 USDT | 20 USDT | 30 USDT |
| 1000 USDT | 100 USDT | 40 USDT | 60 USDT |
| 5000 USDT | 500 USDT | 200 USDT | 300 USDT |

All fees collected to: `TPwUS8v77TtcsYZUHUTvVx2TGqE37QnagZ` (TRC20)

---

## 🔗 Adding Earning Apps

### Via Bot (Admin)
1. Send the bot: **➕ Add Earning App**
2. Enter app name
3. Enter app bot token
4. Done!

### Via API (for earning app developers)
The earning app sends deposits to Wallet Masters using:
```
POST https://your-backend.com/api/deposit
{
  "app_token": "EARNING_APP_BOT_TOKEN",
  "external_uid": "USER_UID_IN_EARNING_APP",
  "amount": 50.00,
  "currency": "USDT"
}
```

Response:
```json
{"success": true, "tx_hash": "...", "credited": 50.00}
```

---

## 🔗 How UID Connection Works

1. User opens Wallet Masters → Connect tab
2. Selects an earning app
3. Enters their UID from that earning app
4. System validates UID format
5. Connection saved instantly
6. Earning app deposits now arrive automatically

---

## 📁 File Structure

```
wallet-masters/
├── backend/
│   ├── bot.js          ← Main bot + API server
│   ├── database.js     ← SQLite database layer
│   ├── package.json    ← Node.js dependencies
│   ├── .env.example    ← Environment variables template
│   └── wallet_masters.db  ← Created automatically on first run
└── frontend/
    ├── index.html      ← Main Mini App
    ├── css/
    │   └── style.css   ← Premium dark theme CSS
    └── js/
        └── app.js      ← Mini App JavaScript
```

---

## 🆘 Troubleshooting

**Mini App blank screen:** Check that HTTPS is enabled and MINI_APP_URL is correct in .env

**Bot doesn't respond:** Verify BOT_TOKEN is correct, check server logs

**Deposits not arriving:** Ensure earning app is using the correct API endpoint and token

**Admin menu not showing:** Make sure ADMIN_CHAT_ID matches your Telegram ID exactly (numbers only, no @)

---

## 📞 Support

Send questions and issues to your bot admin interface or contact the developer.

Built with ❤️ | Wallet Masters v1.0
