import { assert } from './helpers.js';

export async function storeContact(db,env) {
  const exists=await db.one("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='store_contact'");
  const saved=exists && await db.one('SELECT whatsapp,instagram,messenger FROM store_contact WHERE id=1');
  return saved || {whatsapp:env.STORE_WHATSAPP ?? '5926366630',instagram:'',messenger:''};
}

function accountName(value,hosts,linkPath) {
  const raw=value.trim();
  if (!raw.includes('/')) return raw.replace(/^@/,'');
  try {
    const url=new URL(raw);
    if (url.protocol!=='https:' || url.username || url.password || url.port || !hosts.includes(url.hostname)) return '/';
    return linkPath(url).replace(/^\//,'').replace(/\/$/,'') || '/';
  } catch { return '/'; }
}

export function contactValues(input) {
  const {whatsapp,instagram,messenger}=input ?? {};
  assert([whatsapp,instagram,messenger].every(value=>typeof value==='string' && value.length<=300),
    'Enter valid storefront contact details.');
  const phone=whatsapp.replace(/[+()\s.-]/g,'');
  assert(!whatsapp.trim() || (/^\+?[\d()\s.-]+$/.test(whatsapp.trim()) && /^[1-9]\d{6,14}$/.test(phone)),
    'Enter a WhatsApp number with its country code.');
  const ig=accountName(instagram,['instagram.com','www.instagram.com','ig.me'],url=>
    url.hostname==='ig.me' ? (url.pathname.match(/^\/m\/([^/]+)\/?$/)?.[1] ?? '/') : url.pathname);
  assert(!ig || /^[a-z0-9_](?:[a-z0-9_.]{0,28}[a-z0-9_])?$/i.test(ig),'Enter an Instagram username or profile link.');
  const fb=accountName(messenger,['facebook.com','www.facebook.com','m.facebook.com','m.me'],url=>
    url.pathname==='/profile.php' ? (url.searchParams.get('id')?.match(/^\d+$/)?.[0] ?? '/') : url.pathname);
  assert(!fb || /^[a-z0-9](?:[a-z0-9.]{0,98}[a-z0-9])?$/i.test(fb),'Enter a Facebook Page username or Messenger link.');
  return {whatsapp:phone,instagram:ig.toLowerCase(),messenger:fb.toLowerCase()};
}

export async function saveStoreContact(db,contact,audit) {
  // Existing stores can initialize this optional setting on their first save.
  await db.run(`CREATE TABLE IF NOT EXISTS store_contact (
    id INTEGER PRIMARY KEY CHECK(id=1), whatsapp TEXT NOT NULL, instagram TEXT NOT NULL, messenger TEXT NOT NULL
  )`);
  await db.batch([db.sql(`INSERT INTO store_contact(id,whatsapp,instagram,messenger) VALUES(1,?,?,?)
    ON CONFLICT(id) DO UPDATE SET whatsapp=excluded.whatsapp,instagram=excluded.instagram,messenger=excluded.messenger`,
    contact.whatsapp,contact.instagram,contact.messenger),audit]);
}
