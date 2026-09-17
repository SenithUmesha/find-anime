# FindAnime 🍥

> a tiny anime search side quest. type a title, skim the good bits, disappear into MyAnimeList.

I built the first version of this in 2022 with plain HTML, CSS and JavaScript. It was basically one search box wired to Jikan v3.

That API version eventually became the most interesting bug in the project: the page could still look completely fine while the external contract underneath it had gone stale.

So I kept the original **no framework, no build step** idea and rebuilt the parts that actually mattered: the API boundary, stale-request handling, pagination, safe rendering, failure states, caching and a small test/CI story.

`HTML` · `CSS` · `JavaScript` · `Jikan REST API v4` · `Node test runner`

## what it does

- search anime by title
- submit with the button or Enter
- use quick-search chips when you do not know what to type
- fetch 18 results at a time from Jikan v4
- progressively load more pages without replacing the results already on screen
- deduplicate appended pages by MyAnimeList ID
- show poster, preferred title, Japanese title, score, type, episode count, year and status when available
- show a short synopsis, genres and member count
- link each result back to its MyAnimeList page
- keep the current search in `?q=` so the URL survives reload/copy-paste
- cache individual search pages in memory for five minutes
- cancel stale network requests when a newer search starts
- protect against late responses with a request-sequence guard as well as `AbortController`
- show loading, empty, network-error and rate-limit states
- honor `Retry-After` when Jikan provides it
- render third-party text with DOM APIs instead of injecting API strings through `innerHTML`
- constrain outbound MyAnimeList links to HTTPS MyAnimeList hosts
- run helper tests and source checks in GitHub Actions
- stay responsive without a framework or package install at runtime

No account. No backend. No database. No first-party analytics.

## the request flow

```text
form / quick search / ?q= URL
            │
            ▼
      normalize query
            │
            ▼
 query + page cache key
            │
      ┌─────┴─────┐
      │           │
 valid cache      expired / miss
      │           │
      │           ▼
      │    abort older request
      │           │
      │           ▼
      │    Jikan /v4/anime
      │    q + page + limit + sfw
      │           │
      │     ┌─────┼──────────┐
      │     │     │          │
      │    429   !ok       success
      │     │     │          │
      │     │     │          ▼
      │     │     │    validate payload
      │     │     │          │
      │     │     │          ▼
      │     │     │      cache page
      │     │     │          │
      └─────┴─────┴──────────┘
                    │
                    ▼
          commit only newest request
                    │
                    ▼
      replace page 1 / append later pages
                    │
                    ▼
             render result cards
```

The original implementation called Jikan v3 and expected a `results` array. Jikan v4 exposes anime search through `/v4/anime`, returns records in `data`, and carries pagination metadata separately. That migration is the core engineering story of this repository.

## pagination without turning it into a framework app

Page 1 replaces the current result set. Later pages append to it.

```text
page 1
  │
  ▼
18 results
  │
  ├── has_next_page = false -> done
  │
  └── has_next_page = true
             │
             ▼
          Load more
             │
             ▼
          page 2
             │
             ▼
merge by mal_id / URL fallback
```

Appending uses stable anime identity instead of simply concatenating arrays, so an item repeated by the API does not show up twice.

There is still no router, state library or pagination component abstraction. The product does not need them.

## remote data stays data

The old version built cards using HTML strings and assigned the result to `innerHTML`.

The current version uses:

```text
createElement()
textContent
appendChild()
explicit href/src assignment
```

for API-provided values.

Outbound result links are separately validated so a MyAnimeList URL must be HTTPS and actually belong to `myanimelist.net` (including subdomains) before it becomes a clickable external link.

Poster URLs are also required to be HTTPS, with a bundled icon as the final fallback.

## stale-request handling

Search UIs have a race that is easy to miss:

```text
search A starts
search B starts
search B finishes
search A finishes later
```

If every response is allowed to render, A can overwrite B even though B was the user's latest intent.

FindAnime uses two guards:

```text
AbortController
+
monotonic requestSequence
```

The abort saves unnecessary work. The sequence check is the correctness boundary: only the newest request is allowed to commit results.

Cached searches go through the same sequencing path, so switching rapidly between cached and uncached searches does not bypass the stale-request protection.

## a cache with an expiry policy

The cache is intentionally tiny and session-only:

```text
normalized query + page
          │
          ▼
{ pageData, expiresAt }
```

Each page lives for five minutes. After that it is discarded and Jikan is queried again.

That is more honest than an immortal tab cache: anime metadata can change, while persistent offline catalog behavior is not a goal of this project.

## public API failure states

A public API is an operational dependency, not a magic data source.

The UI distinguishes:

```text
initial
loading
results
no matches
network / HTTP failure
429 rate limit
load-more failure while preserving current results
```

For `429`, the client reads `Retry-After` when available and turns it into a useful wait message instead of pretending the API returned zero anime.

If loading another page fails, existing cards stay visible. A failed append should not destroy a successful first page.

## URL state

The current query lives in:

```text
?q=Cowboy%20Bebop
```

using `history.replaceState()`.

That gives the app the useful part of routing—reloadable/shareable search state—without introducing a router for a single-screen tool.

## project shape

```text
find-anime/
├── index.html
├── style.css
├── app.js
├── lib/
│   └── search.mjs
├── tests/
│   └── search.test.mjs
├── img/
│   └── icon.png
├── docs/
│   └── engineering.md
└── .github/
    └── workflows/
        └── ci.yml
```

`app.js` owns browser orchestration and rendering. `lib/search.mjs` owns the parts worth testing without a DOM: URL construction, payload parsing, page merging, cache entries, retry timing, safe URLs and display fallbacks.

## tests + CI

The repository deliberately avoids adding a package manifest only to run tests. The helpers are ES modules and the tests use Node's built-in test runner:

```bash
node --test tests/*.test.mjs
```

CI also runs:

```bash
node --check app.js
```

and guards the runtime tree against accidentally reintroducing the retired Jikan v3 endpoint.

The tests cover query/URL normalization, pagination parsing, result deduplication, cache expiry, retry timing, HTTPS/host validation and display fallbacks.

## run it

Any static file server works.

```bash
git clone https://github.com/SenithUmesha/find-anime.git
cd find-anime
python -m http.server 8080
```

Then open `http://localhost:8080`.

There is no dependency install or build command required for the app itself.

## visual pass

The original version was a very 2022 tutorial-style white page. The current UI keeps the product small but gives it a proper app feel:

- dark compact shell
- responsive 3 → 2 → 1 column grid
- skeleton loading states
- compact metadata and genre chips
- clamped synopsis text
- lazy poster loading
- keyboard focus treatment
- semantic form/buttons/status regions
- reduced-motion handling
- no Font Awesome or Google Fonts network dependency

## boundaries

This is still an anime search toy, not a tracker or streaming service.

It intentionally has no account, watchlist, local favorites, advanced filters, detail route, seasonal browser, recommendation engine, offline catalog or API proxy.

It also talks directly to Jikan, which means searches are network requests to a third-party service and the app inherits that service's uptime/rate limits. "No tracking" here means this repository adds no first-party analytics layer; it does not mean network requests are invisible to external services.

## if i kept going

The next features that still fit the product would be local favorites, a lightweight details view using `/v4/anime/{id}/full`, and a small browser-level interaction test suite.

I would still keep the framework question boring: if one page and a few browser APIs remain enough, they remain enough.

More detail: [`docs/engineering.md`](docs/engineering.md)
