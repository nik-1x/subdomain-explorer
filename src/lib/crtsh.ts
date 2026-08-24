/**
 * Subdomain discovery from Certificate Transparency logs.
 *
 * crt.sh is the primary (and free) source. Two things make it awkward from a
 * browser: it does not send CORS headers, and it is frequently overloaded
 * (502 / long stalls). So every transport below is tried in order until one
 * returns usable JSON, and certspotter — another free CT log search that does
 * send `Access-Control-Allow-Origin: *` — is kept as a last resort so the app
 * still works while crt.sh is down.
 */
import { isValidDomain, sortHosts } from './domain';

export type SourceId = 'crt.sh' | 'crt.sh (proxy)' | 'certspotter';

export interface DiscoveryResult {
  apex: string;
  hosts: string[];
  source: SourceId;
  /** Non-fatal problems worth surfacing, e.g. "crt.sh timed out". */
  notes: string[];
}

export class DiscoveryError extends Error {}

const CRTSH_TIMEOUT_MS = 25_000;
const PROXY_TIMEOUT_MS = 25_000;
const CERTSPOTTER_TIMEOUT_MS = 20_000;
/** How long a fallback answer waits for crt.sh before it is used. */
const PRIMARY_GRACE_MS = 3_000;

interface CrtShRow {
  name_value?: string;
  common_name?: string;
}

interface CertSpotterRow {
  dns_names?: string[];
}

function crtShUrl(domain: string): string {
  return `https://crt.sh/?q=${encodeURIComponent(`%.${domain}`)}&output=json&exclude=expired`;
}

/** Public CORS relays, used only when crt.sh is queried straight from a browser. */
const PROXIES: Array<(target: string) => string> = [
  (t) => `https://api.allorigins.win/raw?url=${encodeURIComponent(t)}`,
  (t) => `https://corsproxy.io/?url=${encodeURIComponent(t)}`,
  (t) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(t)}`,
];

async function fetchJson(url: string, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (!text.trim()) throw new Error('empty response');
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Turns raw CT names into a clean, deduplicated, in-scope host list. */
function collectHosts(names: Iterable<string>, apex: string): string[] {
  const suffix = `.${apex}`;
  const hosts = new Set<string>();
  for (const raw of names) {
    for (const part of raw.split(/[\n,]/)) {
      let host = part.trim().toLowerCase().replace(/\.+$/, '');
      if (!host) continue;
      if (host.startsWith('*.')) host = host.slice(2);
      if (host.includes('@') || host.includes(' ')) continue;
      if (host !== apex && !host.endsWith(suffix)) continue;
      if (!isValidDomain(host)) continue;
      hosts.add(host);
    }
  }
  return sortHosts([...hosts], apex);
}

function parseCrtSh(payload: unknown, apex: string): string[] {
  if (!Array.isArray(payload)) throw new Error('unexpected crt.sh payload');
  const names: string[] = [];
  for (const row of payload as CrtShRow[]) {
    if (row?.name_value) names.push(row.name_value);
    if (row?.common_name) names.push(row.common_name);
  }
  return collectHosts(names, apex);
}

function parseCertSpotter(payload: unknown, apex: string): string[] {
  if (!Array.isArray(payload)) throw new Error('unexpected certspotter payload');
  const names: string[] = [];
  for (const row of payload as CertSpotterRow[]) {
    for (const name of row?.dns_names ?? []) names.push(name);
  }
  return collectHosts(names, apex);
}

function describe(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return 'timed out';
  return error instanceof Error ? error.message : String(error);
}

/**
 * Discovers subdomains of `apex`.
 *
 * All transports are started at once and the first usable answer wins, because
 * a dead crt.sh should not cost the user a minute of serial timeouts. crt.sh
 * still gets priority: a fallback answer waits `PRIMARY_GRACE_MS` for it before
 * being accepted. Rejects only when every source failed.
 */
export async function discoverSubdomains(apex: string, signal?: AbortSignal): Promise<DiscoveryResult> {
  const target = crtShUrl(apex);

  interface Attempt {
    source: SourceId;
    label: string;
    /** 0 = crt.sh (what the user asked for), 1 = anything else. */
    priority: number;
    run: () => Promise<string[]>;
  }

  const attempts: Attempt[] = [
    {
      source: 'crt.sh',
      label: 'crt.sh',
      priority: 0,
      run: async () => parseCrtSh(await fetchJson(target, CRTSH_TIMEOUT_MS, signal), apex),
    },
    ...PROXIES.map((build, index) => ({
      source: 'crt.sh (proxy)' as SourceId,
      label: `crt.sh via relay #${index + 1}`,
      priority: 0,
      run: async () => parseCrtSh(await fetchJson(build(target), PROXY_TIMEOUT_MS, signal), apex),
    })),
    {
      source: 'certspotter',
      label: 'certspotter',
      priority: 1,
      run: async () =>
        parseCertSpotter(
          await fetchJson(
            `https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(apex)}` +
              '&include_subdomains=true&expand=dns_names',
            CERTSPOTTER_TIMEOUT_MS,
            signal,
          ),
          apex,
        ),
    },
  ];

  const notes: string[] = [];
  let best: DiscoveryResult | null = null;
  let bestPriority = Number.POSITIVE_INFINITY;
  let settled = false;
  let onAbort = () => {};

  return new Promise<DiscoveryResult>((resolve, reject) => {
    let outstanding = attempts.length;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(graceTimer);
      if (best) resolve(best);
      else reject(new DiscoveryError(`No certificate transparency source answered for ${apex}. ${notes.join(' · ')}`));
    };

    onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(graceTimer);
      reject(new DiscoveryError('Search cancelled'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    for (const attempt of attempts) {
      attempt.run().then(
        (hosts) => {
          outstanding -= 1;
          // An empty array is a legal crt.sh answer, but far more often it is a
          // half-broken relay — treat it as a miss while other sources are live.
          if (hosts.length === 0) {
            notes.push(`${attempt.label}: no records`);
          } else if (attempt.priority < bestPriority) {
            bestPriority = attempt.priority;
            best = { apex, hosts, source: attempt.source, notes };
          }
          if (best && bestPriority === 0) finish();
          else if (best && graceTimer === undefined) graceTimer = setTimeout(finish, PRIMARY_GRACE_MS);
          else if (outstanding === 0) finish();
        },
        (error: unknown) => {
          outstanding -= 1;
          notes.push(`${attempt.label}: ${describe(error)}`);
          if (outstanding === 0) finish();
        },
      );
    }
  }).finally(() => signal?.removeEventListener('abort', onAbort));
}
