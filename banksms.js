// ═══════════════════════════════════════════════════════════════════════════════
// BANK-STYLE SMS ALERTS (Bammi, 2026-11-20)
// A withdrawal that lands in a bank in country X produces an alert worded the way that
// country's banks word theirs: sender = the bank, local currency, masked account,
// local date format, and a running balance that continues from the previous alert.
// ═══════════════════════════════════════════════════════════════════════════════

const BANKSMS_CUR = {
  'India': ['INR', 'Rs.'], 'Nigeria': ['NGN', 'NGN'], 'Ghana': ['GHS', 'GHS'], 'Kenya': ['KES', 'KES'],
  'South Africa': ['ZAR', 'R'], 'United Kingdom': ['GBP', '£'], 'United States': ['USD', '$'], 'Canada': ['CAD', '$'],
  'Germany': ['EUR', 'EUR'], 'France': ['EUR', 'EUR'], 'Netherlands': ['EUR', 'EUR'], 'Spain': ['EUR', 'EUR'],
  'Italy': ['EUR', 'EUR'], 'Belgium': ['EUR', 'EUR'], 'Portugal': ['EUR', 'EUR'], 'Ireland': ['EUR', 'EUR'],
  'Austria': ['EUR', 'EUR'], 'Switzerland': ['CHF', 'CHF'], 'Sweden': ['SEK', 'SEK'], 'Norway': ['NOK', 'NOK'],
  'Denmark': ['DKK', 'DKK'], 'Poland': ['PLN', 'PLN'], 'Turkey': ['TRY', 'TL'], 'United Arab Emirates': ['AED', 'AED'],
  'Saudi Arabia': ['SAR', 'SAR'], 'Qatar': ['QAR', 'QAR'], 'Kuwait': ['KWD', 'KWD'], 'Bahrain': ['BHD', 'BHD'],
  'Oman': ['OMR', 'OMR'], 'Egypt': ['EGP', 'EGP'], 'Morocco': ['MAD', 'MAD'], 'Pakistan': ['PKR', 'Rs'],
  'Bangladesh': ['BDT', 'BDT'], 'Sri Lanka': ['LKR', 'Rs.'], 'Nepal': ['NPR', 'NPR'], 'Philippines': ['PHP', 'PHP'],
  'Indonesia': ['IDR', 'Rp'], 'Malaysia': ['MYR', 'RM'], 'Vietnam': ['VND', 'VND'], 'Thailand': ['THB', 'THB'],
  'Singapore': ['SGD', 'SGD'], 'China': ['CNY', '元'], 'Hong Kong': ['HKD', 'HKD'], 'Japan': ['JPY', '円'],
  'South Korea': ['KRW', '원'], 'Taiwan': ['TWD', 'NT$'], 'Australia': ['AUD', '$'], 'New Zealand': ['NZD', '$'],
  'Brazil': ['BRL', 'R$'], 'Mexico': ['MXN', '$'], 'Argentina': ['ARS', '$'], 'Chile': ['CLP', '$'],
  'Colombia': ['COP', '$'], 'Peru': ['PEN', 'S/'], 'Israel': ['ILS', 'ILS'], 'Jordan': ['JOD', 'JOD'],
  'Kazakhstan': ['KZT', 'KZT'], 'Uzbekistan': ['UZS', 'UZS'], 'Russia': ['RUB', 'RUB'], 'Ukraine': ['UAH', 'UAH'],
  'Ethiopia': ['ETB', 'ETB'], 'Tanzania': ['TZS', 'TZS'], 'Uganda': ['UGX', 'UGX'], 'Rwanda': ['RWF', 'RWF'],
  'Zambia': ['ZMW', 'ZMW'], 'Botswana': ['BWP', 'BWP'], 'Cameroon': ['XAF', 'XAF'], 'Ivory Coast': ['XOF', 'XOF'],
  'Senegal': ['XOF', 'XOF']
};
// Currencies with no minor unit: shown as whole numbers.
const BANKSMS_ZERO_DEC = new Set(['JPY', 'KRW', 'VND', 'IDR', 'CLP', 'UGX', 'RWF', 'XAF', 'XOF', 'UZS', 'TZS']);

function bsmsNum(n, cur, style) {
  const dec = BANKSMS_ZERO_DEC.has(cur) ? 0 : 2;
  const x = Math.abs(Number(n) || 0);
  if (style === 'in') {            // Indian digit grouping: 12,34,567.00
    const fixed = x.toFixed(dec); let [i, f] = fixed.split('.');
    let last3 = i.slice(-3), rest = i.slice(0, -3);
    if (rest) rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',';
    return rest + last3 + (f ? '.' + f : '');
  }
  if (style === 'eu') {            // 1.234,56
    return x.toFixed(dec).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }
  return x.toFixed(dec).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function bsmsMask(acc, style) {
  const a = String(acc || '').replace(/\D/g, '');
  const l4 = a.slice(-4) || '0000';
  if (style === 'xx') return 'XX' + l4;
  if (style === 'x') return 'X' + l4;
  if (style === 'star') return '******' + l4;
  if (style === 'ng') return a.slice(0, 3) + '****' + a.slice(-3);
  if (style === 'dots') return '••' + l4;
  return '****' + l4;
}
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const Mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function bsmsParts(d, tz) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d);
  const g = {}; f.forEach(p => { g[p.type] = p.value; });
  const h24 = g.hour === '24' ? '00' : g.hour;
  const h12 = ((parseInt(h24, 10) + 11) % 12) + 1;
  return { yyyy: g.year, yy: g.year.slice(2), mm: g.month, dd: g.day, HH: h24, MI: g.minute, SS: g.second,
    mon: Mon[parseInt(g.month, 10) - 1], MON: MON[parseInt(g.month, 10) - 1],
    h12: String(h12).padStart(2, '0'), ampm: parseInt(h24, 10) >= 12 ? 'PM' : 'AM', mInt: parseInt(g.month, 10), dInt: parseInt(g.day, 10) };
}
const BANKSMS_TZ = {
  'India': 'Asia/Kolkata', 'Nigeria': 'Africa/Lagos', 'Ghana': 'Africa/Accra', 'Kenya': 'Africa/Nairobi', 'South Africa': 'Africa/Johannesburg',
  'United Kingdom': 'Europe/London', 'United States': 'America/New_York', 'Canada': 'America/Toronto', 'China': 'Asia/Shanghai',
  'Hong Kong': 'Asia/Hong_Kong', 'Japan': 'Asia/Tokyo', 'South Korea': 'Asia/Seoul', 'Australia': 'Australia/Sydney',
  'United Arab Emirates': 'Asia/Dubai', 'Saudi Arabia': 'Asia/Riyadh', 'Qatar': 'Asia/Qatar', 'Kuwait': 'Asia/Kuwait',
  'Singapore': 'Asia/Singapore', 'Malaysia': 'Asia/Kuala_Lumpur', 'Philippines': 'Asia/Manila', 'Pakistan': 'Asia/Karachi',
  'Bangladesh': 'Asia/Dhaka', 'Germany': 'Europe/Berlin', 'France': 'Europe/Paris', 'Egypt': 'Africa/Cairo', 'Brazil': 'America/Sao_Paulo',
  'Mexico': 'America/Mexico_City', 'Turkey': 'Europe/Istanbul', 'Indonesia': 'Asia/Jakarta', 'Thailand': 'Asia/Bangkok', 'Vietnam': 'Asia/Ho_Chi_Minh'
};

// ── Real per-bank wordings (Bammi's own alerts, 2026-11-21) ─────────────────────
// These override the country default so an FCMB or FirstBank alert reads exactly like
// the SMS the bank itself sends. Keys are the bank name lowercased with punctuation
// removed; a stored name like "First Bank of Nigeria" matches the 'firstbank' key.
function bsmsBankKey(name){ return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function bsmsLetters(n){
  let s = ''; const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (let i = 0; i < n; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}
const BANKSMS_BANK = {
  // FCMB real alert: "Cr Amt:NGN200,000.00 / AC: **7176 / DESC: NIP FRM ... / DT:31/10/25 10:33 / BAL:NGN603,850.92"
  'fcmb': {
    cr: x => `Cr Amt:${x.cur}${x.n(x.amt)}\nAC: **${x.l4}\nDESC: NIP FRM ${x.from}-${bsmsLetters(7)}\nDT:${x.p.dd}/${x.p.mm}/${x.p.yy} ${x.p.HH}:${x.p.MI}\nBAL:${x.cur}${x.n(x.bal)}\nGet Our Mobile App https://on.fcmb.com/A`,
    dr: x => `Dr Amt:${x.cur}${x.n(x.amt)}\nAC: **${x.l4}\nDESC: NIP TO ${x.from}-${bsmsLetters(7)}\nDT:${x.p.dd}/${x.p.mm}/${x.p.yy} ${x.p.HH}:${x.p.MI}\nBAL:${x.cur}${x.n(x.bal)}\nGet Our Mobile App https://on.fcmb.com/A`
  },
  'firstcitymonumentbank': null,   // resolved to 'fcmb' below
  // UBA real alert: "Txn:CR / Ac:2XX..03X / Amt:NGN 122,477.06 / Des:TNF-Transfer/ + code / Date:06-10-2026 09:54 / Bal:NGN 122,526.30 / Loan? Dial *919*28#"
  'uba': {
    cr: x => `Txn:CR\nAc:${bsmsUbaAcct(x)}\nAmt:${x.cur} ${x.n(x.amt)}\nDes:TNF-Transfer/\nPYT_${bsmsMixed(12)}\nDate:${x.p.dd}-${x.p.mm}-${x.p.yyyy} ${x.p.HH}:${x.p.MI}\nBal:${x.cur} ${x.n(x.bal)}\nLoan? Dial *919*28#`,
    dr: x => `Txn:DR\nAc:${bsmsUbaAcct(x)}\nAmt:${x.cur} ${x.n(x.amt)}\nDes:TNF-Transfer/\nPYT_${bsmsMixed(12)}\nDate:${x.p.dd}-${x.p.mm}-${x.p.yyyy} ${x.p.HH}:${x.p.MI}\nBal:${x.cur} ${x.n(x.bal)}\nLoan? Dial *919*28#`
  },
  // FirstBank real alert (one line): "Credit: 321XXXX853 Amt: NGN2,000.00 Date: 11-DEC-2024 12:06:05 Desc: FIP:MMB/RAPHAEL BONNY/ Raphael Bonny /AT6. Bal: NGN2,000.00CR Pay with FirstOnline"
  'firstbank': {
    cr: x => `Credit: ${x.m.replace(/\*/g,'X')} Amt: ${x.cur}${x.n(x.amt)} Date: ${x.p.dd}-${x.p.MON}-${x.p.yyyy} ${x.p.HH}:${x.p.MI}:${x.p.SS} Desc: FIP:MMB/${x.from}/ ${x.from} /AT6. Bal: ${x.cur}${x.n(x.bal)}CR Pay with FirstOnline`,
    dr: x => `Debit: ${x.m.replace(/\*/g,'X')} Amt: ${x.cur}${x.n(x.amt)} Date: ${x.p.dd}-${x.p.MON}-${x.p.yyyy} ${x.p.HH}:${x.p.MI}:${x.p.SS} Desc: FIP:MMB/${x.from}/ ${x.from} /AT6. Bal: ${x.cur}${x.n(x.bal)}DR Pay with FirstOnline`
  }
};
BANKSMS_BANK['firstcitymonumentbank'] = BANKSMS_BANK['fcmb'];
BANKSMS_BANK['unitedbankforafrica'] = BANKSMS_BANK['uba'];
// UBA masks the account as 2XX..03X: first digit, two X, two dots, then the 3rd- and
// 2nd-to-last digits and a final X (taken from Bammi's real UBA alerts).
function bsmsUbaAcct(x){
  const a = String(x.acc || x.l4 || '');
  if (a.length < 5) return '2XX..' + a.slice(-2) + 'X';
  return a.slice(0, 1) + 'XX..' + a.slice(-3, -1) + 'X';
}
function bsmsMixed(n){
  const A = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < n; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}
function bsmsBankFmt(name){
  const k = bsmsBankKey(name);
  if (!k) return null;
  if (BANKSMS_BANK[k]) return BANKSMS_BANK[k];
  const hit = Object.keys(BANKSMS_BANK).find(key => k.includes(key) || key.includes(k));
  return hit ? BANKSMS_BANK[hit] : null;
}

// Each builder gets: { bank, holder, acc, amt (local number), bal (local number), cur, sym, ref, utr, p (date parts), from, side }
// side is 'cr' (money in) or 'dr' (money out). Builders return the SMS text.
const BANKSMS_FMT = {
  'India': {
    mask: 'xx', num: 'in',
    cr: x => `${x.sym} ${x.n(x.amt)} credited to ${x.bank} A/c ${x.m} on ${x.p.dd}-${x.p.mm}-${x.p.yy} at ${x.p.HH}:${x.p.MI} via IMPS from ${x.from}. Ref ${x.utr}. Avl Bal: ${x.sym} ${x.n(x.bal)}.`,
    dr: x => `${x.sym} ${x.n(x.amt)} debited from ${x.bank} A/c ${x.m} on ${x.p.dd}-${x.p.mm}-${x.p.yy} at ${x.p.HH}:${x.p.MI} via IMPS to ${x.from}. Ref ${x.utr}. Avl Bal: ${x.sym} ${x.n(x.bal)}. Not you? Call customer care.`
  },
  'Nigeria': {
    mask: 'ng', num: 'us',
    cr: x => `Acct: ${x.m}\nAmt: ${x.cur}${x.n(x.amt)} CR\nDesc: TRF FRM ${x.from}/${x.ref}\nAvail Bal: ${x.cur}${x.n(x.bal)}\nDate: ${x.p.dd}-${x.p.mon}-${x.p.yyyy} ${x.p.HH}:${x.p.MI}`,
    dr: x => `Acct: ${x.m}\nAmt: ${x.cur}${x.n(x.amt)} DR\nDesc: TRF TO ${x.from}/${x.ref}\nAvail Bal: ${x.cur}${x.n(x.bal)}\nDate: ${x.p.dd}-${x.p.mon}-${x.p.yyyy} ${x.p.HH}:${x.p.MI}`
  },
  'Ghana': {
    mask: 'star', num: 'us',
    cr: x => `${x.bank}: Your A/C ${x.m} has been credited with GHS ${x.n(x.amt)} on ${x.p.dd}/${x.p.mm}/${x.p.yyyy} ${x.p.HH}:${x.p.MI}. Ref: ${x.ref}. Available balance: GHS ${x.n(x.bal)}.`,
    dr: x => `${x.bank}: Your A/C ${x.m} has been debited with GHS ${x.n(x.amt)} on ${x.p.dd}/${x.p.mm}/${x.p.yyyy} ${x.p.HH}:${x.p.MI}. Ref: ${x.ref}. Available balance: GHS ${x.n(x.bal)}.`
  },
  'Kenya': {
    mask: 'star', num: 'us',
    cr: x => `${x.ref} Confirmed. You have received KES ${x.n(x.amt)} in your ${x.bank} A/C ${x.m} from ${x.from} on ${x.p.dd}/${x.p.mInt}/${x.p.yy} at ${x.p.h12}:${x.p.MI} ${x.p.ampm}. New balance is KES ${x.n(x.bal)}.`,
    dr: x => `${x.ref} Confirmed. KES ${x.n(x.amt)} sent from your ${x.bank} A/C ${x.m} to ${x.from} on ${x.p.dd}/${x.p.mInt}/${x.p.yy} at ${x.p.h12}:${x.p.MI} ${x.p.ampm}. New balance is KES ${x.n(x.bal)}.`
  },
  'South Africa': {
    mask: 'star', num: 'sa',
    cr: x => `${x.bank}: R${x.n(x.amt)} received into acc ${x.m} from ${x.from} on ${x.p.dd} ${x.p.mon} ${x.p.yy} at ${x.p.HH}:${x.p.MI}. Ref ${x.ref}. Avail bal R${x.n(x.bal)}.`,
    dr: x => `${x.bank}: R${x.n(x.amt)} paid from acc ${x.m} to ${x.from} on ${x.p.dd} ${x.p.mon} ${x.p.yy} at ${x.p.HH}:${x.p.MI}. Ref ${x.ref}. Avail bal R${x.n(x.bal)}.`
  },
  'United States': {
    mask: 'x', num: 'us',
    cr: x => `${x.bank}: A deposit of $${x.n(x.amt)} was posted to your account ending ${x.l4} on ${x.p.mm}/${x.p.dd}/${x.p.yyyy} at ${x.p.h12}:${x.p.MI} ${x.p.ampm} from ${x.from}. Available balance: $${x.n(x.bal)}. Reply STOP to opt out.`,
    dr: x => `${x.bank}: A transfer of $${x.n(x.amt)} was sent from your account ending ${x.l4} on ${x.p.mm}/${x.p.dd}/${x.p.yyyy} at ${x.p.h12}:${x.p.MI} ${x.p.ampm} to ${x.from}. Available balance: $${x.n(x.bal)}. Reply STOP to opt out.`
  },
  'Canada': {
    mask: 'x', num: 'us',
    cr: x => `${x.bank}: You received a deposit of $${x.n(x.amt)} CAD in account ending ${x.l4} on ${x.p.mon} ${x.p.dd}, ${x.p.yyyy} at ${x.p.h12}:${x.p.MI} ${x.p.ampm} from ${x.from}. Balance: $${x.n(x.bal)}.`,
    dr: x => `${x.bank}: An Interac e-Transfer of $${x.n(x.amt)} CAD was sent from account ending ${x.l4} on ${x.p.mon} ${x.p.dd}, ${x.p.yyyy} at ${x.p.h12}:${x.p.MI} ${x.p.ampm} to ${x.from}. Balance: $${x.n(x.bal)}.`
  },
  'United Kingdom': {
    mask: 'x', num: 'us',
    cr: x => `${x.bank}: £${x.n(x.amt)} received to a/c ending ${x.l4} from ${x.from} on ${x.p.dd}/${x.p.mm}/${x.p.yy} at ${x.p.HH}:${x.p.MI}. Ref ${x.ref}. Balance £${x.n(x.bal)}.`,
    dr: x => `${x.bank}: £${x.n(x.amt)} paid from a/c ending ${x.l4} to ${x.from} on ${x.p.dd}/${x.p.mm}/${x.p.yy} at ${x.p.HH}:${x.p.MI}. Ref ${x.ref}. Balance £${x.n(x.bal)}.`
  },
  'China': {
    mask: 'x', num: 'us', zh: true,
    cr: x => `【${x.bank}】您尾号${x.l4}的储蓄卡${x.p.mInt}月${x.p.dInt}日${x.p.HH}:${x.p.MI}网银转入收入(跨行汇款)${x.n(x.amt)}元，余额${x.n(x.bal)}元。`,
    dr: x => `【${x.bank}】您尾号${x.l4}的储蓄卡${x.p.mInt}月${x.p.dInt}日${x.p.HH}:${x.p.MI}网银转出支出(跨行汇款)${x.n(x.amt)}元，余额${x.n(x.bal)}元。`
  },
  'United Arab Emirates': {
    mask: 'x', num: 'us',
    cr: x => `${x.bank}: AED ${x.n(x.amt)} credited to your a/c ${x.m} on ${x.p.dd}-${x.p.mon}-${x.p.yy} ${x.p.HH}:${x.p.MI}. Ref ${x.ref}. Avl bal AED ${x.n(x.bal)}.`,
    dr: x => `${x.bank}: AED ${x.n(x.amt)} debited from your a/c ${x.m} on ${x.p.dd}-${x.p.mon}-${x.p.yy} ${x.p.HH}:${x.p.MI}. Ref ${x.ref}. Avl bal AED ${x.n(x.bal)}.`
  }
};
// Fallback for every other country: a clean, generic bank wording in the local currency.
function bsmsGeneric(x, side) {
  const verb = side === 'cr' ? 'credited to' : 'debited from';
  return `${x.bank}: ${x.cur} ${x.n(x.amt)} ${verb} your account ${x.m} on ${x.p.dd}/${x.p.mm}/${x.p.yyyy} ${x.p.HH}:${x.p.MI}. Ref ${x.ref}. Available balance: ${x.cur} ${x.n(x.bal)}.`;
}

function bsmsRef(len) {
  const c = '0123456789'; let s = '';
  for (let i = 0; i < len; i++) s += c[Math.floor(Math.random() * 10)];
  return s;
}

// Build one bank-style SMS. `local` is the amount in the country's currency, `prevBal` is
// the running balance from the previous alert in that same currency (or null for the first).
function buildBankSms(opts) {
  const country = opts.country || '';
  const fm = BANKSMS_FMT[country] || {};
  const cs = BANKSMS_CUR[country] || [opts.currency || 'USD', opts.currency || ''];
  const cur = cs[0], sym = cs[1];
  const side = opts.side === 'dr' ? 'dr' : 'cr';
  const prev = Number(opts.prevBal);
  const hasPrev = opts.prevBal !== null && opts.prevBal !== undefined && isFinite(prev);
  const amt = Math.max(0, Number(opts.amount) || 0);
  const bal = hasPrev ? (side === 'cr' ? prev + amt : Math.max(0, prev - amt)) : amt;
  const style = fm.num || 'us';
  const n = v => bsmsNum(v, cur, style === 'sa' ? 'us' : style);
  const tz = BANKSMS_TZ[country] || 'UTC';
  const p = bsmsParts(opts.when || new Date(), tz);
  const acc = String(opts.account || '').replace(/\D/g, '');
  const x = {
    bank: String(opts.bank || 'Bank'), holder: String(opts.holder || ''), cur, sym, amt, bal, p, n,
    m: bsmsMask(acc, fm.mask), l4: acc.slice(-4) || '0000', acc,
    // India uses UTR numbers; every other country gets a plain numeric reference.
    ref: opts.ref || (country === 'India' ? 'UTR' + bsmsRef(12) : bsmsRef(country === 'Kenya' ? 7 : 12)),
    utr: opts.ref || ('UTR' + bsmsRef(12)),
    from: String(opts.counterparty || 'OAT TRADES')
  };
  const bankFm = bsmsBankFmt(opts.bank);
  const body = (bankFm && bankFm[side]) ? bankFm[side](x) : (fm[side] ? fm[side](x) : bsmsGeneric(x, side));
  return { body, balance: bal, currency: cur, country };
}
module.exports = { buildBankSms, BANKSMS_CUR, BANKSMS_FMT, BANKSMS_TZ, BANKSMS_BANK };
