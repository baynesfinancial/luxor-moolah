export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function assert(test, message, status = 400) {
  if (!test) throw new HttpError(status, message);
}
export function clean(value, max = 200) { return String(value ?? '').trim().slice(0, max); }
export function skuOf(value) {
  const sku = clean(value, 80).toUpperCase();
  assert(/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(sku), 'Enter a valid SKU (letters, numbers, dashes, underscores).');
  return sku;
}
export function units(value, optional = false) {
  if (optional && (value == null || clean(value) === '')) return null;
  assert(/^\d+$/.test(clean(value)) && Number(value) <= 1_000_000, 'Enter a whole quantity between 0 and 1,000,000.');
  return Number(value);
}
export function money(value) {
  if (value == null || clean(value) === '') return null;
  assert(/^\d{1,10}(\.\d{1,2})?$/.test(clean(value)), 'Enter an amount without a currency symbol or commas.');
  return Math.round(Number(value) * 100);
}
export function date(value, optional = false) {
  const day = clean(value);
  if (optional && !day) return null;
  assert(/^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) &&
    new Date(day).toISOString().slice(0, 10) === day, 'Enter a valid date in YYYY-MM-DD format.');
  return day;
}
export function dayInZone(zone, now = new Date()) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now).map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
export function offsetDay(day, amount) {
  const point = new Date(day + 'T12:00:00Z');
  point.setUTCDate(point.getUTCDate() + amount);
  return point.toISOString().slice(0, 10);
}
export function emailOf(value) {
  const email = clean(value, 254).toLowerCase();
  assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Enter a valid email address.');
  return email;
}
const encode = value => new TextEncoder().encode(value);
const hex = value => Array.from(new Uint8Array(value), x => x.toString(16).padStart(2, '0')).join('');
export async function hashToken(value) { return hex(await crypto.subtle.digest('SHA-256', encode(value))); }
export function goodImage(mime, bytes) {
  const ascii = (start, length) => String.fromCharCode(...bytes.slice(start, start + length));
  switch (mime) {
    case 'image/jpeg': return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    case 'image/png': return bytes[0] === 137 && ascii(1, 3) === 'PNG';
    case 'image/webp': return ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP';
    case 'image/avif': return ascii(4, 4) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 4));
    default: return false;
  }
}
