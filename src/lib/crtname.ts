/**
 * Subdomain discovery via crt.name.
 *
 *   GET https://crt.name/v1/search?apex=<domain>
 *
 * The response is plain text: one hostname per line, empty when the apex has
 * no known certificates.
 *
 * Note: the endpoint must send `Access-Control-Allow-Origin` for a browser on
 * another origin to read the response (in Caddy:
 * `header /v1/* Access-Control-Allow-Origin "*"`).
 */
import { isValidDomain, sortHosts } from './domain';

export interface DiscoveryResult {
  apex: string;
  hosts: string[];
}

export class DiscoveryError extends Error {}

const ENDPOINT = 'https://crt.name/v1/search';
const TIMEOUT_MS = 30_000;

/** Cleans the raw host list: lowercase, no wildcards, in-scope names only. */
function parseHosts(body: string, apex: string): string[] {
  const suffix = `.${apex}`;
  const hosts = new Set<string>();
  for (const line of body.split('\n')) {
    let host = line.trim().toLowerCase().replace(/\.+$/, '');
    if (!host) continue;
    if (host.startsWith('*.')) host = host.slice(2);
    if (host !== apex && !host.endsWith(suffix)) continue;
    if (!isValidDomain(host)) continue;
    hosts.add(host);
  }
  return sortHosts([...hosts], apex);
}

/**
 * Looks up every known subdomain of `apex`. An empty `hosts` array is a valid
 * answer — crt.name simply has nothing on record for that apex.
 */
export async function discoverSubdomains(apex: string, signal?: AbortSignal): Promise<DiscoveryResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);

  try {
    // No custom headers: keeps this a CORS "simple request", so the endpoint
    // never has to answer a preflight.
    const response = await fetch(`${ENDPOINT}?apex=${encodeURIComponent(apex)}`, {
      signal: controller.signal,
    });
    const body = await response.text();
    if (!response.ok) {
      throw new DiscoveryError(body.trim().slice(0, 140) || `crt.name returned HTTP ${response.status}`);
    }
    return { apex, hosts: parseHosts(body, apex) };
  } catch (error) {
    if (error instanceof DiscoveryError) throw error;
    if (signal?.aborted) throw new DiscoveryError('Search cancelled');
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new DiscoveryError('crt.name took too long to answer.');
    }
    throw new DiscoveryError('crt.name could not be reached from this page.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
