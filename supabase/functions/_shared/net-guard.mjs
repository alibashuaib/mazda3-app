/* Pure SSRF guards shared by Edge Functions (plain ES module, no Deno/Node APIs).
   Moved out of plan-intake/logic.mjs so safe-fetch.mjs and Autopilot reuse one copy. */

const PRIVATE_HOST = /^(localhost|.*\.(local|internal|localdomain))$/i;

export function isSafeUrl(u) {
  let x; try { x = new URL(String(u)); } catch { return false; }
  if (x.protocol !== 'https:' || x.username || x.password) return false;
  if (x.port && x.port !== '443') return false;
  const h = x.hostname.replace(/\.$/, '');   // "localhost." must not dodge the name check
  if (!h || h.startsWith('[') || /^[\d.]+$/.test(h) || PRIVATE_HOST.test(h) || !h.includes('.')) return false;
  return true;
}

function privateV4(a, b, c) {
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||     // 192.0.0.0/24, 192.0.2.0/24
    (a === 198 && (b === 18 || b === 19)) ||               // 198.18.0.0/15
    (a === 198 && b === 51 && c === 100) ||                // 198.51.100.0/24
    (a === 203 && b === 0 && c === 113);                   // 203.0.113.0/24
}

/* Expand an IPv6 string to eight numeric hextets, or null when malformed. */
function expandV6(s) {
  let x = s;
  const dot = x.match(/^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (dot) {
    const [p, q, r, t] = dot.slice(2).map(Number);
    if ([p, q, r, t].some(n => n > 255)) return null;
    x = dot[1] + ((p << 8) | q).toString(16) + ':' + ((r << 8) | t).toString(16);
  }
  const halves = x.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const all = [...head, ...Array(fill).fill('0'), ...tail];
  if (all.length !== 8 || !all.every(h => /^[0-9a-f]{1,4}$/.test(h))) return null;
  return all.map(h => parseInt(h, 16));
}

/* True when a resolved address is not a public one. Unparseable input counts as private (fail closed). */
export function isPrivateIp(ip) {
  const x = String(ip ?? '').toLowerCase();
  const m = x.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) return privateV4(Number(m[1]), Number(m[2]), Number(m[3]));
  const h = expandV6(x);
  if (!h) return true;
  const v4 = (hi, lo) => privateV4(hi >> 8, hi & 255, lo >> 8);
  if (h.every(n => n === 0) || (h.slice(0, 7).every(n => n === 0) && h[7] === 1)) return true;   // :: and ::1
  if (h.slice(0, 5).every(n => n === 0) && h[5] === 0xffff) return v4(h[6], h[7]);                // ::ffff:a.b.c.d
  if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every(n => n === 0)) return v4(h[6], h[7]); // NAT64
  if (h[0] === 0x2002) return v4(h[1], h[2]);                                                       // 6to4
  return (h[0] & 0xfe00) === 0xfc00 || (h[0] & 0xffc0) === 0xfe80 || (h[0] & 0xffc0) === 0xfec0 || (h[0] & 0xff00) === 0xff00;
}
