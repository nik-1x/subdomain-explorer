# Subdomain Explorer

A Telegram Mini App that pulls a domain's subdomains out of public **Certificate
Transparency** logs and then checks, lazily as you scroll, which of them still
resolve.

* **Centered search screen** → type a domain, press Search.
* **Results screen** → every unique name found in CT logs, newest sources first.
* **Lazy pinging** → a host is only looked up when its row scrolls into view, so
  a domain with 2 000 certificates still opens instantly.

Built with React + Vite and the official [Telegram UI](https://github.com/Telegram-Mini-Apps/TelegramUI)
component kit, so it inherits the user's Telegram theme (light/dark, iOS/base
platform styling) and works in a plain browser too.

## How it works

### Discovery — crt.sh

`GET https://crt.sh/?q=%25.<domain>&output=json&exclude=expired`

crt.sh is free and needs no key, but from a browser it has two problems: it
sends no CORS headers, and it is frequently overloaded (502s, long stalls).
So `src/lib/crtsh.ts` starts every transport **in parallel** and takes the first
usable answer:

| Priority | Transport |
| --- | --- |
| 0 | crt.sh directly |
| 0 | crt.sh through `allorigins` / `corsproxy.io` / `codetabs` CORS relays |
| 1 | [certspotter](https://sslmate.com/ct_search_api/) — another free CT search, CORS-enabled |

A priority‑1 answer waits 3 s for crt.sh before it is accepted, so crt.sh stays
the primary source whenever it is healthy. The results screen shows which source
actually answered, plus a note for every source that did not.

Names are lowercased, wildcard prefixes (`*.`) stripped, out-of-scope and
malformed entries dropped, then deduplicated and sorted apex-first by label
depth.

### Pinging — DNS over HTTPS

A web page cannot send ICMP, so "alive" here means *public DNS still resolves
it*. Each host is queried against Cloudflare's DoH endpoint (Google's as
backup):

`GET https://cloudflare-dns.com/dns-query?name=<host>&type=A` with
`accept: application/dns-json`

* **live** — A/AAAA records (first address and count are shown), or a CNAME target
* **dead** — `NXDOMAIN`, or no address record
* **retry** — both resolvers failed; tap the pill to try again

### Lazy, on-scroll checking

`src/lib/useLazyPings.ts` keeps one `IntersectionObserver` with a 250 px
`rootMargin`. A row registers its element through a ref callback; on first
intersection it is unobserved and its lookup is queued. A `PingQueue`
(concurrency 6) keeps a fast flick from firing hundreds of requests at once, and
starting a new search aborts everything still in flight.

The list itself is paged the same way: 40 rows are rendered at a time and a
sentinel at the bottom reveals the next page, which then schedules its lookups.

## Running

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production build into dist/
npm run preview
```

Deploy `dist/` to any static host (`base: './'` makes sub-path hosting work),
then point a Telegram bot's Mini App URL at it via **@BotFather → Bot Settings →
Menu Button**. Outside Telegram the app degrades gracefully: theme follows the
OS, and the in-page back button replaces Telegram's native one.

## Layout

```
src/
  lib/crtsh.ts         CT log discovery + fallbacks
  lib/dns.ts           DoH resolution + concurrency queue
  lib/domain.ts        input normalisation, validation, sorting
  lib/useLazyPings.ts  IntersectionObserver -> queued lookups
  lib/telegram.ts      WebApp bridge (no-op in a browser)
  pages/SearchPage.tsx centered search
  pages/ResultsPage.tsx results, filters, paging
  components/          row + status pill
```

## Notes and limits

* CT logs only show names that appear in issued certificates — internal hosts
  without a public certificate will not be here, and long-dead names can linger.
* Public CORS relays are best-effort third parties; if you self-host, proxying
  crt.sh from your own backend is more reliable than any of them.
