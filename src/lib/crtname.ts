/**
 * Subdomain discovery via crt.name.
 *
 *   GET https://crt.name/v1/search?apex=<domain>
 *
 * The response is plain text: one hostname per line, empty when the apex has
 * no known certificates. The endpoint currently sends no
 * `Access-Control-Allow-Origin` header, so a browser on another origin cannot
 * read the response — until it does, the direct call is tried first and public
 * CORS relays are used as a fallback.
 */
import { isValidDomain, sortHosts } from './domain';

export type SourceId = 'crt.name' | 'crt.name (relay)';

export interface DiscoveryResult {
  apex: string;
  hosts: string[];
  source: SourceId;
  /** Transports that failed before one worked, surfaced as a hint in the UI. */
  notes: string[];
}

export class DiscoveryError extends Error {}

const ENDPOINT = 'https://crt.name/v1/search';
const DIRECT_TIMEOUT_MS = 30_000;
const RELAY_TIMEOUT_MS = 30_000;

function searchUrl(apex: string): string {
  return `${ENDPOINT}?apex=${encodeURIComponent(apex)}`;
}

/** Used only when the direct call is blocked by the browser's CORS check. */
const RELAYS: Array<(target: string) => string> = [
  (target) => `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`,
  (target) => `https://corsproxy.io/?url=${encodeURIComponent(target)}`,
  (target) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(target)}`,
];

async function fetchText(url: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    // No custom headers: keeps this a CORS "simple request", so there is no
    // preflight for the endpoint to answer.
    const response = await fetch(url, { signal: controller.signal });
    const body = await response.text();
    if (!response.ok) throw new Error(body.trim().slice(0, 120) || `HTTP ${response.status}`);
    return body;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

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

function describe(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return 'timed out';
  if (error instanceof TypeError) return 'blocked by CORS or unreachable';
  return error instanceof Error ? error.message : String(error);
}

/**
 * Looks up every known subdomain of `apex`. An empty `hosts` array is a valid
 * answer — crt.name simply has nothing for that apex. Rejects only when no
 * transport could reach the API.
 */
export async function discoverSubdomains(apex: string, signal?: AbortSignal): Promise<DiscoveryResult> {
  const target = searchUrl(apex);
  const notes: string[] = [];

  const transports: Array<{ source: SourceId; label: string; url: string; timeout: number }> = [
    { source: 'crt.name', label: 'crt.name', url: target, timeout: DIRECT_TIMEOUT_MS },
    ...RELAYS.map((build, index) => ({
      source: 'crt.name (relay)' as SourceId,
      label: `relay #${index + 1}`,
      url: build(target),
      timeout: RELAY_TIMEOUT_MS,
    })),
  ];

  for (const transport of transports) {
    if (signal?.aborted) throw new DiscoveryError('Search cancelled');
    try {
      const body = await fetchText(transport.url, transport.timeout, signal);
      return { apex, hosts: parseHosts(body, apex), source: transport.source, notes };
    } catch (error) {
      if (signal?.aborted) throw new DiscoveryError('Search cancelled');
      notes.push(`${transport.label}: ${describe(error)}`);
    }
  }

  throw new DiscoveryError(`crt.name could not be reached. ${notes.join(' · ')}`);
}
