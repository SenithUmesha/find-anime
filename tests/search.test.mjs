import test from "node:test";
import assert from "node:assert/strict";

import {
  CACHE_TTL_MS,
  REQUEST_TIMEOUT_MS,
  buildSearchUrl,
  cacheKeyForSearch,
  createCacheEntry,
  imageForAnime,
  mergeAnimeResults,
  normalizeQuery,
  parseSearchPayload,
  readCacheEntry,
  retryAfterSeconds,
  safeHttpsUrl,
  safeMyAnimeListUrl,
  titleForAnime,
} from "../lib/search.mjs";

test("normalizes queries and builds encoded Jikan URLs", () => {
  assert.equal(normalizeQuery("  Fullmetal Alchemist  "), "Fullmetal Alchemist");
  assert.equal(cacheKeyForSearch("  NARUTO  ", 2), "naruto::2");
  assert.equal(cacheKeyForSearch("Bleach", -4), "bleach::1");
  assert.equal(REQUEST_TIMEOUT_MS, 12_000);

  const url = buildSearchUrl("Cowboy Bebop", 3);
  assert.equal(url.origin + url.pathname, "https://api.jikan.moe/v4/anime");
  assert.equal(url.searchParams.get("q"), "Cowboy Bebop");
  assert.equal(url.searchParams.get("page"), "3");
  assert.equal(url.searchParams.get("limit"), "18");
  assert.equal(url.searchParams.get("sfw"), "true");
});

test("parses Jikan pagination without trusting missing fields", () => {
  assert.deepEqual(parseSearchPayload(null), {
    results: [],
    currentPage: 1,
    hasNextPage: false,
    totalItems: null,
  });

  assert.deepEqual(
    parseSearchPayload({
      data: [{ mal_id: 1 }, null, "bad"],
      pagination: {
        current_page: 2,
        has_next_page: true,
        items: { total: 73 },
      },
    }),
    {
      results: [{ mal_id: 1 }],
      currentPage: 2,
      hasNextPage: true,
      totalItems: 73,
    }
  );

  assert.equal(
    parseSearchPayload({ pagination: { items: { total: "not-a-number" } } })
      .totalItems,
    null
  );
});

test("merges pages by MAL id instead of duplicating entries", () => {
  const merged = mergeAnimeResults(
    [
      { mal_id: 1, title: "One" },
      { mal_id: 2, title: "Old Two" },
    ],
    [
      { mal_id: 2, title: "New Two" },
      { mal_id: 3, title: "Three" },
    ]
  );

  assert.equal(merged.length, 3);
  assert.equal(merged.find((anime) => anime.mal_id === 2).title, "New Two");
});

test("expires cached search pages after the short in-memory TTL", () => {
  const pageData = {
    results: [{ mal_id: 1 }],
    currentPage: 1,
    hasNextPage: false,
    totalItems: 1,
  };
  const entry = createCacheEntry(pageData, 1_000);

  assert.equal(entry.expiresAt, 1_000 + CACHE_TTL_MS);
  assert.deepEqual(readCacheEntry(entry, 1_000 + CACHE_TTL_MS - 1), pageData);
  assert.equal(readCacheEntry(entry, 1_000 + CACHE_TTL_MS), null);
  assert.equal(readCacheEntry(null, 1_000), null);
});

test("parses Retry-After seconds and HTTP dates deterministically", () => {
  assert.equal(retryAfterSeconds("12"), 12);
  assert.equal(retryAfterSeconds("0"), 0);
  assert.equal(retryAfterSeconds("nope"), null);

  const now = Date.parse("2026-09-17T15:00:00.000Z");
  assert.equal(
    retryAfterSeconds("Thu, 17 Sep 2026 15:00:08 GMT", now),
    8
  );
  assert.equal(
    retryAfterSeconds("Thu, 17 Sep 2026 14:59:59 GMT", now),
    0
  );
});

test("only accepts HTTPS URLs and constrains MAL links to MyAnimeList", () => {
  assert.equal(safeHttpsUrl("javascript:alert(1)"), null);
  assert.equal(safeHttpsUrl("http://example.com/image.jpg"), null);
  assert.equal(
    safeHttpsUrl("https://cdn.example.com/image.jpg"),
    "https://cdn.example.com/image.jpg"
  );

  assert.equal(
    safeMyAnimeListUrl("https://myanimelist.net/anime/1"),
    "https://myanimelist.net/anime/1"
  );
  assert.equal(
    safeMyAnimeListUrl("https://www.myanimelist.net/anime/1"),
    "https://www.myanimelist.net/anime/1"
  );
  assert.equal(safeMyAnimeListUrl("https://example.com/anime/1"), null);
});

test("chooses useful display fallbacks for incomplete anime records", () => {
  assert.equal(
    titleForAnime({ title_english: "English", title: "Default" }),
    "English"
  );
  assert.equal(titleForAnime({}), "Untitled anime");

  assert.equal(
    imageForAnime({
      images: { webp: { large_image_url: "https://cdn.example.com/a.webp" } },
    }),
    "https://cdn.example.com/a.webp"
  );
  assert.equal(
    imageForAnime({ images: { jpg: { image_url: "javascript:bad" } } }),
    "img/icon.png"
  );
});
