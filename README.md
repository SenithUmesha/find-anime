# FindAnime 🍥

> a tiny anime search side quest. type a title, skim the good bits, disappear into MyAnimeList.

I built the first version of this in 2022 with plain HTML, CSS and JavaScript. It was basically one search box wired to Jikan v3.

That API version eventually became the most interesting bug in the project: the UI still looked fine, but the request it depended on was old enough to stop being useful.

So I kept the original no-framework idea and rebuilt the parts that actually mattered.

`HTML` · `CSS` · `JavaScript` · `Jikan REST API v4`

## what it does

- search anime by title
- submit with the button or Enter
- use a few quick-search chips when you do not know what to type
- fetch up to 18 results from Jikan v4
- show poster, title, Japanese title, score, type, episode count, year and status when available
- show a short synopsis and genre chips
- link each result back to its MyAnimeList page
- keep the current search in `?q=` so the URL is shareable/reloadable
- reuse repeated searches from a tiny in-memory cache
- cancel stale network requests when a newer search starts
- show loading, empty, API-error and rate-limit states
- stay responsive without a framework or build step

No account. No backend. No database. No tracking.

## the request flow

```text
search form / quick search / ?q= URL
              │
              ▼
        normalize query
              │
              ├── cache hit ───────────────┐
              │                            │
              ▼                            │
     abort previous request                │
              │                            │
              ▼                            │
    GET api.jikan.moe/v4/anime             │
       ?q=<query>&limit=18&sfw=true         │
              │                            │
              ▼                            │
       validate response                   │
              │                            │
              ├── 429 -> rate-limit state  │
              ├── error -> retry state     │
              │                            │
              ▼                            │
        payload.data[]                     │
              │                            │
              └──────────────┬─────────────┘
                             ▼
                    render result cards
```

The original implementation called the old v3 search endpoint and expected a `results` array. The current Jikan REST API uses v4 and returns search items in `data`, so the request and response handling were rebuilt around the current shape.

## no `innerHTML` for API data

The old version built result cards by interpolating API values into an HTML string:

```js
html += `... ${results.title} ...`;
animeList.innerHTML = html;
```

That is quick for a prototype, but it makes remote content part of an HTML parser boundary.

The current version creates DOM nodes and assigns remote values with `textContent` instead:

```text
Jikan JSON
   │
   ▼
createElement()
   │
   ├── textContent for titles/synopsis/meta
   ├── explicit href/src properties
   └── rel="noopener noreferrer" for external tabs
```

It is a small app, but there is no reason to turn third-party text into markup when the app only needs text.

## stale-request handling

Search APIs create a subtle race:

```text
search A starts
search B starts
search B finishes
search A finishes later
```

Without protection, the older result can overwrite the newer one.

FindAnime uses an `AbortController` to cancel the previous fetch whenever another search begins, plus a monotonically increasing request sequence so only the latest request can commit a result.

That is intentionally more robust than just hoping requests finish in order.

## URL state

Successful search attempts write the query into the current URL:

```text
?q=Cowboy%20Bebop
```

On page load the app checks for that parameter and runs the search automatically.

For this project that is enough routing. Pulling in a client-side router for one query parameter would be a lot of machinery for very little product.

## tiny cache

Repeated searches are stored in a `Map` for the life of the tab:

```text
normalized query -> Jikan result array
```

This avoids hitting the public API again when clicking the same quick search or repeating the same query.

It is deliberately not persistent. Anime metadata changes, and this is not trying to be an offline catalog.

## loading and failure states

A search UI is not just the success cards.

The current version also handles:

```text
initial state
loading skeletons
no matches
HTTP failure
network failure
429 / rate limiting
```

The search button disables while the active request is running and a polite live region announces state changes for assistive technology.

## project shape

```text
find-anime/
├── app.js
├── index.html
├── style.css
├── img/
│   ├── icon.png
│   └── one_piece.jpg
└── docs/
    └── engineering.md
```

There is no bundler and no package manifest.

That is part of the point: it is a browser app small enough that the browser platform itself is the framework.

## run it

Any static file server works.

Python:

```bash
git clone https://github.com/SenithUmesha/find-anime.git
cd find-anime
python -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

You can also host the folder on GitHub Pages, Cloudflare Pages, Netlify or any other static host.

## API dependency

FindAnime uses the public **Jikan REST API**, an unofficial API around publicly available MyAnimeList data.

The app currently queries:

```text
GET https://api.jikan.moe/v4/anime
```

with:

```text
q=<title>
limit=18
sfw=true
```

Because it depends on a public third-party API, temporary errors and rate limiting are normal failure modes rather than impossible edge cases.

The app does not proxy or hide requests behind its own server; the browser talks to Jikan directly.

## visual pass

The original UI was a white tutorial-style page with three large cards per row and a red search control.

The current version keeps the same simple search-first product but makes it feel more like a small app:

- dark compact shell
- responsive 3 → 2 → 1 column result grid
- consistent card/meta/genre language
- truncated synopsis instead of giant uneven cards
- lazy-loaded poster images
- skeleton loading states
- keyboard focus treatment
- reduced-motion support
- no Font Awesome or Google Font network dependency

The only network dependency left in the interface itself is the anime data/poster content it actually needs.

## limits

This is still a search toy, not an anime-tracking product.

There is no:

- watchlist
- account/login
- local favorites
- pagination / load more
- advanced genre/status filtering
- anime detail route
- seasonal browsing
- recommendations
- offline data
- API proxy/cache server

Those would all be reasonable directions if the side quest ever became a real product, but they are intentionally outside the current scope.

## if i rebuilt it again

I would keep it framework-free until the UI genuinely needed multiple routes or richer shared state.

The next useful changes would probably be:

1. pagination or load-more
2. local favorites
3. a lightweight details dialog/route
4. request caching with expiry
5. basic automated browser tests

I would **not** start by moving it to React just because React exists.

For this project, one HTML file + one stylesheet + one JavaScript file is a feature.

More detail: [`docs/engineering.md`](docs/engineering.md)
