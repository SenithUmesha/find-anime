# Engineering notes — FindAnime

FindAnime is a small static browser app built around one external dependency: the Jikan REST API.

The interesting engineering work is therefore less about framework architecture and more about the network boundary: request ordering, API-version drift, safe rendering, failure states and keeping a tiny app tiny.

## 1. System shape

```text
                        browser
                           │
                           ▼
                       index.html
                           │
                 ┌─────────┴─────────┐
                 │                   │
                 ▼                   ▼
              style.css            app.js
                                     │
                                     ▼
                          Jikan REST API v4
                                     │
                                     ▼
                         public MyAnimeList data
```

There is no application server.

Every search request is made directly from the user's browser to Jikan.

## 2. Why the old version stopped being enough

The original 2022 application queried:

```text
https://api.jikan.moe/v3/search/anime?q=<query>&page=1
```

and expected:

```js
{
  results: [...]
}
```

The current Jikan REST API is v4, and anime search is exposed through:

```text
GET https://api.jikan.moe/v4/anime
```

with the result collection under:

```js
{
  data: [...],
  pagination: {...}
}
```

That is a useful reminder that a static frontend can still rot even when none of its own files change. External APIs are part of the app's runtime architecture.

## 3. Current request

The client builds the URL using `URL` and `URLSearchParams` rather than manually concatenating query text:

```text
q=<normalized query>
limit=18
sfw=true
```

Conceptually:

```js
const url = new URL("https://api.jikan.moe/v4/anime");
url.searchParams.set("q", query);
url.searchParams.set("limit", "18");
url.searchParams.set("sfw", "true");
```

This makes encoding part of the platform API instead of something the app has to remember to do correctly.

## 4. Search lifecycle

A search can enter the app from three places:

```text
form submit
quick-search chip
?q= URL on page load
```

All three go through the same `searchAnime()` function.

```text
raw query
   │
   ▼
trim / reject blank
   │
   ▼
write query to URL
   │
   ├── cache hit -> render
   │
   ▼
abort previous request
   │
   ▼
show loading state
   │
   ▼
fetch Jikan v4
   │
   ├── 429 -> rate-limit message
   ├── !ok -> generic HTTP failure
   ├── network error -> retry message
   │
   ▼
validate payload.data
   │
   ▼
cache result
   │
   ▼
render cards
```

The entire app has one request path instead of separate logic for buttons, URL restoration and manual submit.

## 5. Preventing stale-result races

Network requests do not necessarily finish in the order they start.

Example:

```text
T0  search "naruto" starts
T1  search "bleach" starts
T2  bleach response arrives
T3  naruto response arrives
```

A naive implementation would show Naruto at T3 even though Bleach was the user's latest intent.

FindAnime protects against this in two ways.

### AbortController

Before starting a new request:

```js
activeController.abort();
```

The new request gets its own controller/signal.

That avoids wasting work and normally stops the stale request before it can complete.

### request sequence

The app also increments a sequence number for each search.

Only the most recent sequence is allowed to commit its response.

That second guard makes correctness explicit even if cancellation timing is unusual.

## 6. Loading state

The old app remained visually unchanged until the request finished.

The current implementation renders lightweight skeleton cards and marks the result grid:

```html
aria-busy="true"
```

while the search button changes to:

```text
Searching…
```

and becomes disabled.

The skeletons are built with DOM nodes just like the real cards. They are presentation-only and marked `aria-hidden` so a screen reader does not announce fake content.

## 7. API failure model

The app distinguishes four broad outcomes:

```text
success with results
success with zero results
rate limited (429)
other failure
```

This is intentionally more useful than treating every non-success case as "not found".

A network outage and a valid zero-result search mean very different things to the user.

### rate limiting

Jikan is a public API, so rate limiting is a normal operational constraint.

When the client receives HTTP `429`, the UI asks the user to wait and retry instead of presenting an empty catalog.

## 8. In-memory cache

The cache is:

```js
Map<lowercased query, result array>
```

It lives only for the current page session.

That gives two benefits:

- repeated quick searches do not make duplicate API calls
- going back to a query feels instant

The cache is deliberately not persisted to `localStorage` because anime metadata can change and the app has no invalidation policy.

If caching became a real product requirement, I would store:

```text
query
results
timestamp
API/schema version
```

and expire entries after a short TTL.

## 9. URL as lightweight state

The current query is stored in:

```text
?q=<query>
```

using `history.replaceState()`.

Benefits:

- reload keeps the search
- copied URLs preserve the query
- there is no router dependency

This is enough stateful navigation for a one-screen app.

A router would become useful only when the product grows real routes such as:

```text
/anime/:id
/favorites
/season/:year/:season
```

## 10. Safe rendering of remote data

The original project interpolated values from the API into an HTML template string and wrote the string with `innerHTML`.

The current version treats API content as data, not markup.

Cards are created with:

```text
document.createElement()
textContent
href/src property assignment
appendChild()
```

That keeps titles, synopses, genres and metadata on a text boundary.

It also avoids having to reason about whether a remote string can break out of a template and become executable HTML.

## 11. External links

MyAnimeList result links open in a new tab.

They use:

```html
target="_blank"
rel="noopener noreferrer"
```

`noopener` prevents the newly opened page from receiving a reference to the original page through `window.opener`.

## 12. Poster loading

Poster resolution is selected with a fallback chain:

```text
webp.large_image_url
jpg.large_image_url
webp.image_url
jpg.image_url
local icon
```

Images use:

```html
loading="lazy"
decoding="async"
```

so off-screen posters do not all need to compete for network/decoding work immediately.

If a remote poster fails to load, the local app icon is used as a fallback.

## 13. Display model

The Jikan response is intentionally not copied into a second application model.

The UI reads a small subset:

```text
mal_id
url
title / title_english / title_japanese
images
score
scored_by
type
episodes
year / aired
status
synopsis
genres
members
```

Several values are optional, so rendering uses fallbacks rather than assuming the API always has complete metadata.

That is important for titles that are unreleased, obscure or missing an English title/score/episode count.

## 14. Result card composition

A result card is roughly:

```text
poster
   │
   ▼
English/preferred title      score
Japanese title

[type] [episodes] [year] [status]

synopsis (clamped)

[genre] [genre] [genre]

members                    More info ↗
```

Long synopses are visually clamped instead of determining the height of the whole grid.

The full data remains available from the linked MyAnimeList page rather than being duplicated into a complex local details UI.

## 15. No framework/build step

The project intentionally has:

```text
index.html
style.css
app.js
```

No package manager is required to run the source.

That removes:

- build tooling
- dependency updates
- bundler configuration
- client framework runtime
- lock files

For this scale, the browser APIs already provide everything needed:

```text
fetch
AbortController
URL / URLSearchParams
history
DOM APIs
Intl.NumberFormat
DocumentFragment
```

A framework would be justified by product complexity, not by the age of the project.

## 16. Styling architecture

The CSS uses one small token system:

```css
--bg
--surface
--text
--muted
--accent
--border
--radius-*
```

The result layout is responsive:

```text
wide screen   -> 3 columns
medium        -> 2 columns
small/mobile  -> 1 column
```

No CSS framework is used.

The app also removes the original Font Awesome and Google Fonts dependencies. That reduces page-level network dependencies that have nothing to do with anime search itself.

## 17. Accessibility

Useful accessibility details in the current pass include:

- semantic `main`, `header`, `section` and `footer`
- a real `<form role="search">`
- visible label text for assistive tech via `.sr-only`
- search works with Enter by default
- polite status live region for request feedback
- `aria-busy` on the results grid
- meaningful poster alt text
- focus-visible treatment
- buttons for quick actions
- reduced-motion handling

The app has not been through a formal accessibility audit, but the interaction model now starts from semantic browser controls instead of generic clickable elements.

## 18. Performance choices

The app's performance model is simple:

```text
small static assets
+
one JSON request per uncached search
+
lazy poster images
+
DocumentFragment batch append
```

There is no framework hydration, no client bundle graph and no charting/UI dependency.

The largest runtime cost is normally the third-party poster images, not the app JavaScript.

## 19. Privacy boundary

The project does not have its own analytics, accounts or server.

However, a search is **not local/private in the same sense as the Expense Tracker project**: the browser sends the query to Jikan and poster requests go to image hosts referenced by the API.

That distinction matters.

The footer therefore says "no tracking" in the sense that this repository does not add its own tracking layer; it does not claim that no network service sees requests.

## 20. Operational dependency

A static app can be deployed forever while its external API changes underneath it.

The v3 -> v4 break is exactly what happened here.

A more production-oriented version would add a small compatibility layer or proxy so the UI depends on an internal response contract:

```text
browser
   │
   ▼
/find-anime/search?q=...
   │
   ▼
adapter
   │
   ▼
Jikan
```

Then API migrations are isolated from presentation code.

That would be overkill for this side project today, but it is the direction I would take if reliability mattered.

## 21. Testing strategy if the app grows

The first tests worth adding would not be snapshot tests for every card.

I would cover behavior:

```text
blank query does not fetch
successful search renders results
empty data renders empty state
429 renders rate-limit state
older request cannot replace newer result
query parameter restores a search
remote text is rendered as text
```

Those tests protect the parts most likely to break during API/client changes.

## 22. Next sensible features

The next additions that fit the existing product shape are:

### pagination

Use Jikan's pagination metadata to fetch another page without replacing current results.

### local favorites

Store selected MAL IDs and a small display snapshot in `localStorage`.

### detail view

Fetch `/v4/anime/{id}/full` only when a user asks for deeper information rather than making every result card huge.

### cache expiry

Add timestamps and a TTL if repeated API traffic becomes a real concern.

## 23. What I would not add yet

I would not add React, Redux, a backend, a database or an authentication system just to make the repository look more sophisticated.

Those tools should arrive when the product needs them.

The current architecture has one job:

> **turn a title into useful anime results with as little machinery as possible, while still behaving like a real networked app when requests are slow, stale or broken.**
