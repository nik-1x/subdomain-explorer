/**
 * Subdomain discovery via crt.name.
 *
 *   GET https://crt.name/v1/search?apex=<domain>
 *
 * The response is plain text: one hostname per line, empty when the apex has
 * no known certificates. `?format=json` returns `{ sub, first_seen }` objects
 * instead; both shapes are accepted by `parseHostList`.
 *
 * crt.name sends no `Access-Control-Allow-Origin` header, so a page on another
 * origin cannot read the response — the fetch below only succeeds where the
 * header exists (or same-origin). When it is blocked the app falls back to
 * handing the request to the user: they open the URL themselves and paste the
 * response back. Hence `DiscoveryBlockedError`, which the UI treats as
 * "hand it over" rather than as a failure.
 */
import { isValidDomain, sortHosts } from './domain';

export interface DiscoveryResult {
  apex: string;
  hosts: string[];
}

export class DiscoveryError extends Error {}

/** The request never got through the browser — CORS, offline, or DNS. */
export class DiscoveryBlockedError extends DiscoveryError {}

const ENDPOINT = 'https://crt.name/v1/search';
const TIMEOUT_MS = 30_000;

/** The exact URL a user can open for themselves to run the same query. */
export function searchUrl(apex: string): string {
  return `${ENDPOINT}?apex=${encodeURIComponent(apex)}`;
}

/** Pulls the hostnames out of a JSON response, so a pasted `?format=json` body works too. */
function linesFromJson(body: string): string[] | null {
  try {
    const parsed = JSON.parse(body);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .map((row) => (typeof row === 'string' ? row : (row as { sub?: string })?.sub))
      .filter((value): value is string => typeof value === 'string');
  } catch {
    return null;
  }
}

/**
 * Cleans a raw crt.name response — fetched or pasted — into in-scope hostnames:
 * lowercase, no wildcards, deduplicated, sorted.
 */
export function parseHostList(body: string, apex: string): string[] {
  const suffix = `.${apex}`;
  const hosts = new Set<string>();
  const lines = linesFromJson(body) ?? body.split('\n');
  for (const line of lines) {
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
    const response = await fetch(searchUrl(apex), { signal: controller.signal });
    const body = await response.text();
    if (!response.ok) {
      throw new DiscoveryError(body.trim().slice(0, 140) || `The index returned HTTP ${response.status}`);
    }
    return { apex, hosts: parseHostList(body, apex) };
  } catch (error) {
    if (error instanceof DiscoveryError) throw error;
    if (signal?.aborted) throw new DiscoveryError('Search cancelled');
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new DiscoveryBlockedError('The index took too long to answer.');
    }
    throw new DiscoveryBlockedError('This page cannot fetch the list directly.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
