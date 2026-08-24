# Subdomain Explorer

A Telegram Mini App that looks up a domain's subdomains on **crt.name** and
then checks, lazily as you scroll, which of them still resolve.

* **Centered search screen** → type a domain, press Search.
* **Results screen** → every unique name crt.name knows about.
* **Lazy pinging** → a host is only looked up when its row scrolls into view, so
  an apex with 20 000 names still opens instantly.

Built with React + Vite and the official [Telegram UI](https://github.com/Telegram-Mini-Apps/TelegramUI)
component kit, so it inherits the user's Telegram theme (light/dark, iOS/base
platform styling) and works in a plain browser too.

## How it works

### Discovery — crt.name

```
GET https://crt.name/v1/search?apex=<domain>
```

The response is plain text, one hostname per line; an empty body means the apex
has no records (the app shows a "no subdomains found" state rather than an
error). Names are lowercased, wildcard prefixes (`*.`) stripped, out-of-scope
and malformed entries dropped, then deduplicated and sorted apex-first by label
depth.

**CORS:** the endpoint does not currently send `Access-Control-Allow-Origin`, so
a browser on another origin cannot read the response. `src/lib/crtname.ts`
therefore tries the direct call first and falls back to public CORS relays
(`allorigins`, `corsproxy.io`, `codetabs`), showing which transport answered.
Adding one header on the crt.name side removes the need for the relays entirely
— in Caddy:

```
header /v1/* Access-Control-Allow-Origin "*"
```

Once that is live, the relay list in `crtname.ts` can be deleted.

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

The compiled app is published to the **`build`** branch of this repository —
serve that branch as a static site (`base: './'` makes sub-path hosting work),
then point a Telegram bot's Mini App URL at it via **@BotFather → Bot Settings →
Menu Button**. Outside Telegram the app degrades gracefully: theme follows the
OS, and the in-page back button replaces Telegram's native one.

## Layout

```
src/
  lib/crtname.ts       crt.name lookup + CORS fallbacks
  lib/dns.ts           DoH resolution + concurrency queue
  lib/domain.ts        input normalisation, validation, sorting
  lib/useLazyPings.ts  IntersectionObserver -> queued lookups
  lib/telegram.ts      WebApp bridge (no-op in a browser)
  pages/SearchPage.tsx centered search
  pages/ResultsPage.tsx results, filters, paging
  components/          row + status pill
```

## Notes and limits

* Certificate data only shows names that appear in issued certificates —
  internal hosts without a public certificate will not be here, and long-dead
  names can linger, which is what the live/dead check is for.
* crt.name returns an `X-RateLimit-Limit: 1000` header; one search is one
  request, so the app never fans out across that endpoint.
