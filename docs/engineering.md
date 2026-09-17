# Engineering notes — FindAnime

FindAnime is a deliberately small static browser app built around one external dependency: the Jikan REST API.

The useful engineering work is therefore not framework architecture. It is the network boundary: API drift, pagination, request races, request timeouts, cache expiry, safe rendering, incomplete third-party data and failure behavior.

## 1. Current system

```text
index.html
   │
   ├── style.css
   │
   └── app.js
         │
         ├── DOM / interaction state
         ├── AbortController + request sequencing
         ├── timeout guard
         ├── page cache
         │
         └── lib/search.mjs
               ├── URL construction
               ├── Jikan payload parsing
               ├── page merge rules
               ├── cache TTL helpers
               ├── Retry-After parsing
               ├── timeout policy
               └── remote URL validation
                        │
                        ▼
               Jikan REST API v4
                        │
                        ▼
               MyAnimeList-derived data
```

There is no app server, build pipeline or runtime dependency install. The browser calls Jikan directly.

## 2. Why this project needed a revisit

The original 2022 client queried Jikan v3:

```text
https://api.jikan.moe/v3/search/anime?q=<query>&page=1
```

and expected a response shaped around:

```js
{ results: [...] }
```

The current API is v4:

```text
GET https://api.jikan.moe/v4/anime
```

with data and pagination separated:

```js
{
  data: [...],
  pagination: {
    current_page: 1,
    has_next_page: true,
    items: { total: 84 }
  }
}
```

That failure mode is worth keeping visible: a static frontend can rot even when its own source never changes. External APIs are runtime dependencies and their contracts are part of the architecture.

## 3. Search inputs converge on one path

A search can start from:

```text
form submit
quick-search chip
?q= parameter on page load
load-more action
```

Everything eventually goes through `searchAnime()`.

For a fresh search:

```text
raw query
   │
   ▼
trim / reject blank
   │
   ▼
page = 1
   │
   ▼
write ?q= URL state
   │
   ▼
check page cache
   │
   ├── valid -> commit cached page
   │
   └── miss/expired
            │
            ▼
      abort older request
            │
            ▼
      arm 12s timeout
            │
            ▼
      show loading state
            │
            ▼
        fetch Jikan
            │
      ┌─────┼───────────┐
      │     │           │
     429  timeout     success
      │     │           │
      │     │           ▼
      │     │       parse payload
      │     │           │
      │     │           ▼
      │     │       cache page
      │     │           │
      └─────┴───────────┘
            │
            ▼
 only latest request may commit
```

Load-more uses the same path but increments the current page and preserves existing results if the append request fails or times out.

## 4. Request race protection

Network completion order is not user intent order.

```text
T0  search A starts
T1  search B starts
T2  B finishes
T3  A finishes
```

A naive client renders A at T3 and visually rewinds the user's search.

FindAnime protects against that twice.

### AbortController

Starting another network request aborts the previous controller. That reduces wasted network/processing work and normally prevents the old response from completing.

### monotonic request sequence

Every request receives an incrementing ID.

```text
requestId === requestSequence
```

must still be true before a response can change UI state.

This is the actual correctness guard. Cancellation is useful, but the UI does not rely on cancellation timing for correctness.

## 5. Timeout semantics

Cancellation because the user searched again is different from cancellation because the API never responded.

Each live network request gets a 12-second timer:

```text
request starts
   │
   ├── response arrives -> clear timeout
   │
   └── 12s expires -> mark timedOut -> abort controller
```

The catch path checks both request identity and `timedOut`.

That produces three distinct outcomes:

```text
superseded request -> silent, because newer user intent exists
fresh-search timeout -> visible timeout state
load-more timeout -> keep current cards + status message
```

This prevents a hanging fetch from leaving the UI in an indefinite loading state while still keeping superseded requests quiet.

## 6. URL construction

`lib/search.mjs` builds Jikan URLs with `URL` / `URLSearchParams`:

```text
q=<query>
limit=18
page=<page>
sfw=true
```

Using the platform URL API means query encoding is not hand-written string concatenation.

Page values are normalized to at least `1`, so malformed internal input cannot produce page zero or a negative page request.

## 7. Payload boundary

`parseSearchPayload()` does not let DOM code depend directly on every detail of the raw response.

It produces:

```js
{
  results,
  currentPage,
  hasNextPage,
  totalItems
}
```

The parser:

- treats missing/non-array `data` as an empty collection
- drops non-object entries
- normalizes invalid/missing current-page values to `1`
- turns pagination continuation into a boolean
- converts `pagination.items.total` into a finite non-negative number when possible
- otherwise exposes `totalItems: null`

The UI can therefore show `36 of 84 · page 2` when total metadata exists without coupling rendering directly to Jikan's nested response shape.

## 8. Pagination and merge semantics

Each request asks Jikan for 18 records.

Page 1 replaces search state. Later pages append:

```text
existing results
      +
new page
      │
      ▼
mergeAnimeResults()
      │
      ├── mal_id identity when available
      ├── URL fallback
      └── title/index fallback as last resort
      │
      ▼
deduplicated ordered results
```

The incoming page wins when the same identity appears twice, which is useful if Jikan returns a fresher representation of the same record.

The load-more button is shown only when there are results and Jikan reports `has_next_page`.

## 9. Append failures preserve successful work

A page-2 failure should not erase page 1.

For a fresh-search failure, the result region becomes an error state.

For an append failure or timeout:

```text
current cards stay rendered
+
status text explains what failed
```

The client keeps already-successful user-visible work instead of treating every request as all-or-nothing.

## 10. Short-lived cache

The cache key is:

```text
lowercased normalized query :: page
```

Each entry is:

```js
{
  pageData,
  expiresAt
}
```

with a five-minute TTL.

```text
cache lookup
   │
   ├── missing -> fetch
   ├── expired -> delete -> fetch
   └── valid -> commit cached page
```

The cache remains memory-only. Closing/reloading the page drops it.

That is a deliberate product boundary: this is request de-duplication and short-term responsiveness, not an offline anime database.

## 11. Why cache expiry matters

The earlier in-memory cache lived for the entire tab session with no invalidation rule.

That is fine for a prototype, but an explicit TTL is a better model because anime metadata can change and because cache policy should be visible in code rather than accidental.

The TTL helper accepts an injected `now` value, which makes expiry behavior deterministic in tests.

## 12. Rate limiting is a normal state

Jikan is a public API. HTTP `429` is therefore an expected operational outcome, not an impossible exception.

The client distinguishes it from generic failure and reads `Retry-After` when available.

Supported forms include:

```text
Retry-After: 12
Retry-After: Thu, 17 Sep 2026 15:00:08 GMT
```

`retryAfterSeconds()` accepts an injectable clock value, so HTTP-date handling can be tested deterministically instead of depending on wall-clock timing.

The UI can then say approximately how long to wait rather than returning an empty grid that looks like "no anime found".

## 13. Rendering remote content safely

The original project interpolated API fields into an HTML string and assigned it through `innerHTML`.

The current client uses DOM APIs:

```text
createElement()
textContent
appendChild()
DocumentFragment
```

Remote titles, synopses, genres and metadata therefore remain text instead of becoming part of an HTML parser boundary.

For a small project, this is both safer and easier to reason about than sanitizing generated HTML.

## 14. URL validation

Text safety and URL safety are separate problems.

### MyAnimeList links

Clickable result links must:

```text
protocol = https
host = myanimelist.net or subdomain
```

Anything else becomes non-clickable.

### poster images

Poster candidates must be HTTPS. The selection order is:

```text
webp.large_image_url
jpg.large_image_url
webp.image_url
jpg.image_url
local img/icon.png fallback
```

If the chosen remote image later fails to load, the image element falls back to the bundled icon.

Remote poster images also use:

```js
image.referrerPolicy = "no-referrer";
```

so the image host does not receive the FindAnime page URL as HTTP referrer data.

## 15. External-tab isolation

Valid MyAnimeList links use:

```html
target="_blank"
rel="noopener noreferrer"
```

`noopener` prevents the destination page from getting a useful `window.opener` reference back to FindAnime, while `noreferrer` also suppresses the originating page URL.

## 16. Display fallbacks

Jikan records are not assumed to be complete.

Preferred title order:

```text
title_english
title
title_japanese
"Untitled anime"
```

Other optional fields—score, episodes, year, status, genres, members and synopsis—are rendered only when meaningful or receive a small explicit fallback.

That keeps unreleased/obscure/incomplete titles from breaking card construction.

## 17. Result-card model

A card roughly contains:

```text
poster

preferred title                 score
Japanese title

[type] [episodes] [year] [status]

synopsis (visually clamped)

[genre] [genre] [genre]

members                       More info ↗
```

The app intentionally does not reproduce an entire MyAnimeList detail page. Search gives enough information to decide whether to open the source page.

## 18. Query URL state

The current query is stored in:

```text
?q=<query>
```

with `history.replaceState()`.

That gives the one-screen app useful routing behavior:

- reload restores the search
- copied URLs keep search intent
- no client router dependency is required

Pagination itself is not written to the URL; load-more is progressive UI state rather than a separate navigable page in this small product.

## 19. Loading and failure states

The result surface explicitly models:

```text
initial
loading skeletons
results
empty result
fresh-search timeout
fresh-search HTTP/network error
rate limited
append timeout
append error
```

Skeletons are presentation-only and marked `aria-hidden`.

The result grid uses `aria-busy`, and a polite live region announces search status changes.

## 20. Accessibility choices

The current UI uses:

- semantic `main`, `header`, `section`, `article` and `footer`
- a real search form
- hidden-but-accessible input label
- native button controls
- Enter-to-submit behavior
- `aria-controls` connecting the search input to the result region
- `aria-busy` during requests
- `role="status"` / `aria-live="polite"`
- meaningful poster alt text
- visible focus treatment
- reduced-motion handling

The search input is capped at 120 characters as a small client-side sanity boundary.

This is not presented as a formal accessibility audit, but the interaction model starts with browser semantics rather than custom clickable containers.

## 21. Performance model

The application has no framework runtime or bundle graph.

Runtime cost is roughly:

```text
small HTML/CSS/JS files
+
Jikan JSON requests
+
remote poster images
```

Useful choices include:

- short-lived page cache
- aborting superseded requests
- timing out stuck requests
- lazy image loading
- async image decoding
- `DocumentFragment` for batched card append
- no external font/icon UI dependencies

The third-party images are normally much heavier than the app's own JavaScript.

## 22. Privacy boundary

FindAnime has no first-party account, database, analytics SDK or server.

But searches are not local in the way a localStorage-only app is local.

```text
query -> Jikan
poster request -> remote image host
link click -> MyAnimeList
```

The repository therefore says **no first-party analytics**, not "no network visibility". Poster requests additionally suppress referrer information, but the remote image host still receives the image request itself.

## 23. Testing strategy

`lib/search.mjs` is deliberately DOM-free so important rules can be tested with Node's built-in test runner.

Current tests cover:

```text
query normalization
URL/page construction
timeout configuration
Jikan payload parsing
pagination total parsing
invalid response records
page deduplication
cache expiry
Retry-After seconds
Retry-After HTTP dates
HTTPS validation
MyAnimeList host restriction
title/image fallbacks
```

Run them with:

```bash
node --test tests/*.test.mjs
```

No npm install is required.

## 24. CI

GitHub Actions runs on pushes to `main` and pull requests.

The workflow checks:

```text
node --check app.js
node --check lib/search.mjs
node --test tests/*.test.mjs
runtime sources contain no api.jikan.moe/v3 endpoint
required static assets exist
```

The retired-endpoint guard deliberately targets runtime source files rather than recursively grepping the entire repository. That matters because documentation and the workflow itself legitimately mention the old v3 URL as historical context.

That exact distinction fixed a false-positive CI failure during the overhaul.

## 25. Why there is still no framework

This app needs:

```text
fetch
AbortController
URL / URLSearchParams
history
DOM APIs
Intl.NumberFormat
Map
DocumentFragment
```

The browser already provides all of them.

React/Vue/Svelte would become easier to justify if the product grew multiple routes, richer shared state, favorites/details workflows or reusable interactive surfaces. They are not automatically an upgrade for one search screen.

## 26. Sensible next steps

If the side quest grows, useful next steps are:

```text
1. local favorites with a compact stored snapshot
2. /v4/anime/{id}/full detail view on demand
3. browser-level interaction tests for request races and DOM states
4. optional advanced filters
5. a compatibility proxy only if API reliability becomes important
```

I would not add authentication, a database or a backend before a feature actually needs them.

The current architecture has one job:

> **turn a title into useful anime results with as little machinery as possible, while still behaving correctly when the network is slow, stale, paginated, rate-limited or temporarily unavailable.**
