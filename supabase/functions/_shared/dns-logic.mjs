/* Pure DNS combine rule for safeFetch, split from dns.ts so Node tests can run it with a fake lookup.
   Only "no such record" (isNotFound) counts as empty. Any other resolver error on A or AAAA makes the
   whole answer unusable (null), so an unchecked record can never slip past validation. */
export async function resolveAll(lookup, isNotFound, host) {
  const one = (type) => lookup(host, type).catch((e) => { if (isNotFound(e)) return []; throw e; });
  try {
    const [a, aaaa] = await Promise.all([one('A'), one('AAAA')]);
    return [...a, ...aaaa];
  } catch { return null; }
}
