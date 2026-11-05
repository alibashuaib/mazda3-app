// The only Deno-specific resolver for safeFetch. Returns every A and AAAA address, or null when DNS
// resolution is unavailable or either lookup failed for any reason other than "no record"
// (safeFetch then fails closed). If the staging spike shows Deno.resolveDns is missing, swap this
// one function to node:dns.
// Note: Deno fetch cannot connect to a pre-validated IP (no IP pinning), so DNS rebinding between
// this check and the connect stays an accepted residual risk (T-01-35).
import { resolveAll } from './dns-logic.mjs';

export async function resolveHostAddresses(host: string): Promise<string[] | null> {
  if (typeof Deno === 'undefined' || typeof Deno.resolveDns !== 'function') return null;
  return resolveAll(
    (h: string, t: string) => Deno.resolveDns(h, t as 'A' | 'AAAA'),
    (e: unknown) => e instanceof Deno.errors.NotFound,
    host,
  );
}
