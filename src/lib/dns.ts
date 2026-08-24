/**
 * "Ping" for a browser: ICMP is not reachable from a web page, so a host counts
 * as online when public DNS still resolves it within the deadline below.
 * Anything else — no record, a resolver error, or silence past the deadline —
 * is simply offline.
 */

export type PingState = 'idle' | 'checking' | 'online' | 'offline';

export interface PingResult {
  state: PingState;
  /** First A/AAAA address, when the host is online. */
  address?: string;
  /** CNAME target for hosts that only alias somewhere else. */
  cname?: string;
  /** Number of addresses found, for the "+2" hint. */
  addressCount?: number;
  ms?: number;
}

/** A host that has not answered within this many ms is reported as offline. */
export const PING_TIMEOUT_MS = 3_000;

const RESOLVERS = ['https://cloudflare-dns.com/dns-query', 'https://dns.google/resolve'];

interface DohAnswer {
  type: number;
  data: string;
}

interface DohResponse {
  Status: number;
  Answer?: DohAnswer[];
}

function read(data: DohResponse, ms: number): PingResult {
  const answers = data.Answer ?? [];
  const addresses = answers.filter((a) => a.type === 1 || a.type === 28).map((a) => a.data);
  const cname = answers.find((a) => a.type === 5)?.data.replace(/\.$/, '');

  if (addresses.length > 0) {
    return { state: 'online', address: addresses[0], addressCount: addresses.length, cname, ms };
  }
  if (cname) return { state: 'online', cname, ms };
  return { state: 'offline', ms };
}

/**
 * Resolves `host`, or reports it offline. Both resolvers are queried at once
 * under one shared deadline, so a slow or broken resolver cannot hold a row in
 * the checking state for longer than `PING_TIMEOUT_MS`.
 */
export async function pingHost(host: string, signal?: AbortSignal): Promise<PingResult> {
  const started = performance.now();
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);

  const elapsed = () => Math.round(performance.now() - started);

  const lookup = async (resolver: string): Promise<PingResult> => {
    const response = await fetch(`${resolver}?name=${encodeURIComponent(host)}&type=A`, {
      signal: controller.signal,
      headers: { accept: 'application/dns-json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return read((await response.json()) as DohResponse, elapsed());
  };

  try {
    // First `online` answer wins; a negative or failed answer waits for the
    // other resolver rather than settling the host on its own.
    return await new Promise<PingResult>((resolve) => {
      let outstanding = RESOLVERS.length;
      const settleOffline = () => {
        outstanding -= 1;
        if (outstanding === 0) resolve({ state: 'offline', ms: elapsed() });
      };
      controller.signal.addEventListener('abort', () => resolve({ state: 'offline', ms: elapsed() }), {
        once: true,
      });
      for (const resolver of RESOLVERS) {
        lookup(resolver).then((result) => {
          if (result.state === 'online') resolve(result);
          else settleOffline();
        }, settleOffline);
      }
    });
  } finally {
    clearTimeout(deadline);
    controller.abort();
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Small FIFO queue so a fast scroll cannot fire hundreds of lookups at once. */
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
