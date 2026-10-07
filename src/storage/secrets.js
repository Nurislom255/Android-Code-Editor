// storage/secrets.js — git tokens, encrypted at rest (spec §4.4: "never in
// plain DataStore"; the Android Keystore's role).
//
// An AES-GCM key is generated with `extractable: false` and kept in
// IndexedDB. Non-extractable means JavaScript can *use* the key but never read
// its bytes, so a copy of the database alone doesn't reveal the tokens.
// Honest limit: code running inside this app can still decrypt them — the same
// is true of a Keystore-backed key used by the app itself.

import { kv } from './db.js';

async function getKey() {
  let key = await kv.get('secrets-key');
  if (!key) {
    key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await kv.set('secrets-key', key);
  }
  return key;
}

export async function saveSecret(name, value) {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)));
  await kv.set(`secret:${name}`, { iv, data: new Uint8Array(data) });
}

export async function loadSecret(name) {
  const rec = await kv.get(`secret:${name}`);
  if (!rec) return null;
  try {
    const key = await getKey();
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv }, key, rec.data);
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return null;
  }
}

export async function deleteSecret(name) {
  await kv.delete(`secret:${name}`);
}
