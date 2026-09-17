import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSearchUrl,
  cacheKeyForSearch,
  imageForAnime,
  mergeAnimeResults,
  normalizeQuery,
  parseSearchPayload,
  safeHttpsUrl,
  safeMyAnimeListUrl,
  titleForAnime,
} from "../lib/search.mjs";

test("normalizes queries and builds encoded Jikan URLs", () => {
  assert.equal(normalizeQuery("  Fullmetal Alchemist  "), "Fullmetal Alchemist");
  assert.equal(cacheKeyForSearch("  NARUTO  ", 2), "naruto::2");

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
  });

  assert.deepEqual(
    parseSearchPayload({
      data: [{ mal_id: 1 }],
      pagination: { current_page: 2, has_next_page: true },
    }),
    {
      results: [{ mal_id: 1 }],
      currentPage: 2,
      hasNextPage: true,
    }
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

test("only accepts HTTPS URLs and constrains MAL links to MyAnimeList", () => {
  assert.equal(safeHttpsUrl("javascript:alert(1)"), null);
  assert.equal(safeHttpsUrl("http://example.com/image.jpg"), null);
  assert.equal(safeHttpsUrl("https://cdn.example.com/image.jpg"), "https://cdn.example.com/image.jpg");

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
    imageForAnime({ images: { webp: { large_image_url: "https://cdn.example.com/a.webp" } } }),
    "https://cdn.example.com/a.webp"
  );
  assert.equal(
    imageForAnime({ images: { jpg: { image_url: "javascript:bad" } } }),
    "img/icon.png"
  );
});
