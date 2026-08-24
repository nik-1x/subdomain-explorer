/**
 * "Ping" for a browser: ICMP is not reachable from a web page, so a host counts
 * as alive when public DNS still resolves it. Cloudflare's DNS-over-HTTPS
 * endpoint is free, fast and CORS-enabled; Google's is the backup.
 */

export type PingState = 'idle' | 'checking' | 'alive' | 'dead' | 'error';

export interface PingResult {
  state: PingState;
  /** First A/AAAA address, when there is one. */
  address?: string;
  /** CNAME target for hosts that only alias somewhere else. */
  cname?: string;
  /** Number of addresses found, for the "+2 more" hint. */
  addressCount?: number;
  ms?: number;
  detail?: string;
}

const RESOLVERS = [
  'https://cloudflare-dns.com/dns-query',
  'https://dns.google/resolve',
];

const TIMEOUT_MS = 8_000;

interface DohAnswer {
  name: string;
  type: number;
  data: string;
}

interface DohResponse {
  Status: number;
  Answer?: DohAnswer[];
}

async function query(resolver: string, host: string, signal?: AbortSignal): Promise<DohResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const response = await fetch(
      `${resolver}?name=${encodeURIComponent(host)}&type=A`,
      { signal: controller.signal, headers: { accept: 'application/dns-json' } },
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as DohResponse;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export async function pingHost(host: string, signal?: AbortSignal): Promise<PingResult> {
  const started = performance.now();
  let lastError = 'lookup failed';

  for (const resolver of RESOLVERS) {
    try {
      const data = await query(resolver, host, signal);
      const ms = Math.round(performance.now() - started);
      const answers = data.Answer ?? [];
      const addresses = answers.filter((a) => a.type === 1 || a.type === 28).map((a) => a.data);
      const cname = answers.find((a) => a.type === 5)?.data.replace(/\.$/, '');

      if (addresses.length > 0) {
        return { state: 'alive', address: addresses[0], addressCount: addresses.length, cname, ms };
      }
      // NXDOMAIN (3) is a hard "gone"; anything else with no address is a name
      // that exists but points nowhere useful right now.
      if (data.Status === 3) return { state: 'dead', ms, detail: 'NXDOMAIN' };
      if (cname) return { state: 'alive', cname, ms, detail: 'CNAME only' };
      return { state: 'dead', ms, detail: data.Status === 0 ? 'no A record' : `status ${data.Status}` };
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  return { state: 'error', detail: lastError, ms: Math.round(performance.now() - started) };
}

/** Small FIFO queue so a fast scroll cannot fire 400 DoH requests at once. */
export class PingQueue {
  private readonly pending: Array<() => void> = [];
  private active = 0;

  constructor(private readonly limit = 6) {}

  run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.active += 1;
        task()
          .then(resolve, reject)
          .finally(() => {
            this.active -= 1;
            this.pending.shift()?.();
          });
      };
      if (this.active < this.limit) start();
      else this.pending.push(start);
    });
  }
}
