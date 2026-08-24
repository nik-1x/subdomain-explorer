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

crt.name is free, needs no token, and allows 1000 requests per IP per day.

**CORS:** crt.name sends no `Access-Control-Allow-Origin` header — verified on
the plain call, `?format=json` and `&dates=1` alike — so a page on another
origin cannot read the response: the browser makes the request and then throws
it away. This app carries no proxy, so rather than dead-ending, the request is
handed to the user:

1. the app tries the direct fetch first — that succeeds the day crt.name adds
   the header, or if you host the app on the same origin;
2. when it is blocked, the results screen shows the exact API URL with an
   **Open request** button. The user runs the query themselves — their browser,
   their IP, their share of the free daily budget;
3. they paste the response back. `parseHostList` accepts either the plain-text
   body or a `?format=json` array, and everything downstream behaves exactly as
   it would have after a direct fetch.

One line on the crt.name side removes steps 2 and 3 entirely (in Caddy:
`header /v1/* Access-Control-Allow-Origin "*"`).

### Pinging — DNS over HTTPS

A web page cannot send ICMP, so "online" here means *public DNS still resolves
it*. Cloudflare and Google are queried at the same time under one **3-second
deadline**:

`GET https://cloudflare-dns.com/dns-query?name=<host>&type=A` with
`accept: application/dns-json`

* **online** — the first resolver to return an A/AAAA record wins (the address,
  the count of extras, or a CNAME target is shown alongside the round trip)
* **offline** — everything else: `NXDOMAIN`, no address record, a resolver
  error, or nothing back within 3 s

A negative answer from one resolver does not settle the host — it waits for the
other, and only falls to offline when both have spoken or the deadline passes.

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
  lib/crtname.ts       crt.name lookup + response parsing
  lib/dns.ts           DoH resolution (3s deadline) + concurrency queue
  lib/domain.ts        input normalisation, validation, sorting
  lib/useLazyPings.ts  IntersectionObserver -> queued lookups
  lib/telegram.ts      WebApp bridge (no-op in a browser)
  pages/SearchPage.tsx centered search
  pages/ResultsPage.tsx results, filters, paging
  components/          row, status pill, user-run request handoff
```

## Notes and limits

* Certificate data only shows names that appear in issued certificates —
  internal hosts without a public certificate will not be here, and long-dead
  names can linger, which is what the online/offline check is for.
* crt.name returns an `X-RateLimit-Limit: 1000` header; one search is one
  request, so the app never fans out across that endpoint.
