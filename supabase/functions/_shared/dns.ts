// The only Deno-specific resolver for safeFetch. Returns every A and AAAA address, or null when DNS
// resolution is unavailable (safeFetch then fails closed). If the staging spike shows Deno.resolveDns
// is missing, swap this one function to node:dns.
export async function resolveHostAddresses(host: string): Promise<string[] | null> {
  if (typeof Deno === 'undefined' || typeof Deno.resolveDns !== 'function') return null;
  const [a, aaaa] = await Promise.all([
    Deno.resolveDns(host, 'A').catch(() => [] as string[]),
    Deno.resolveDns(host, 'AAAA').catch(() => [] as string[]),
  ]);
  return [...a, ...aaaa];
}
