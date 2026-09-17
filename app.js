import {
  buildSearchUrl,
  cacheKeyForSearch,
  firstValue,
  imageForAnime,
  mergeAnimeResults,
  normalizeQuery,
  parseSearchPayload,
  safeMyAnimeListUrl,
  titleForAnime,
} from "./lib/search.mjs";

const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("search-input");
const searchButton = document.getElementById("search-btn");
const animeList = document.getElementById("anime");
const searchStatus = document.getElementById("search-status");
const resultCount = document.getElementById("result-count");
const quickSearches = document.querySelectorAll("[data-query]");
const loadMoreRow = document.getElementById("load-more-row");
const loadMoreButton = document.getElementById("load-more-btn");

const cache = new Map();
let activeController = null;
let requestSequence = 0;
let requestMode = null;
let searchState = {
  query: "",
  page: 0,
  results: [],
  hasNextPage: false,
};

const setBusy = (isBusy, mode = null) => {
  requestMode = isBusy ? mode : null;
  animeList.setAttribute("aria-busy", String(isBusy));
  searchButton.disabled = isBusy && mode === "search";
  searchButton.textContent = isBusy && mode === "search" ? "Searching…" : "Search";
  loadMoreButton.disabled = isBusy;
  loadMoreButton.textContent = isBusy && mode === "more" ? "Loading…" : "Load more";
};

const setStatus = (message) => {
  searchStatus.textContent = message;
};

const updateLoadMore = () => {
  const shouldShow =
    searchState.results.length > 0 && searchState.hasNextPage && requestMode !== "search";

  loadMoreRow.hidden = !shouldShow;
};

const formatNumber = (value) =>
  typeof value === "number" ? new Intl.NumberFormat("en").format(value) : null;

const createElement = (tag, className, text) => {
  const element = document.createElement(tag);

  if (className) {
    element.className = className;
  }

  if (text !== undefined) {
    element.textContent = text;
  }

  return element;
};

const createMetaPill = (text) => createElement("span", "meta-pill", text);

const createAnimeCard = (anime) => {
  const card = createElement("article", "anime-card");
  const preferredTitle = titleForAnime(anime);
  const malUrl = safeMyAnimeListUrl(anime.url);

  const posterContainer = malUrl
    ? createElement("a", "poster-link")
    : createElement("div", "poster-link");

  if (malUrl) {
    posterContainer.href = malUrl;
    posterContainer.target = "_blank";
    posterContainer.rel = "noopener noreferrer";
    posterContainer.setAttribute(
      "aria-label",
      `Open ${preferredTitle} on MyAnimeList`
    );
  }

  const image = createElement("img", "anime-poster");
  image.src = imageForAnime(anime);
  image.alt = `${preferredTitle} poster`;
  image.loading = "lazy";
  image.decoding = "async";
  image.addEventListener(
    "error",
    () => {
      image.src = "img/icon.png";
    },
    { once: true }
  );

  posterContainer.appendChild(image);
  card.appendChild(posterContainer);

  const body = createElement("div", "anime-card-body");
  const headingRow = createElement("div", "anime-heading-row");
  const headingBlock = createElement("div");
  const title = createElement("h3", "anime-title", preferredTitle);
  headingBlock.appendChild(title);

  if (anime.title_japanese && anime.title_japanese !== preferredTitle) {
    headingBlock.appendChild(
      createElement("p", "anime-alt-title", anime.title_japanese)
    );
  }

  headingRow.appendChild(headingBlock);

  const score = createElement(
    "span",
    "score-badge",
    typeof anime.score === "number" ? `★ ${anime.score.toFixed(1)}` : "★ —"
  );
  score.title = anime.scored_by
    ? `${formatNumber(anime.scored_by)} MyAnimeList scores`
    : "No score available";
  headingRow.appendChild(score);
  body.appendChild(headingRow);

  const meta = createElement("div", "anime-meta");
  const year = firstValue(anime.year, anime.aired?.prop?.from?.year);
  const metadata = [
    anime.type,
    anime.episodes
      ? `${anime.episodes} ep${anime.episodes === 1 ? "" : "s"}`
      : null,
    year ? String(year) : null,
    anime.status,
  ].filter(Boolean);

  metadata
    .slice(0, 4)
    .forEach((value) => meta.appendChild(createMetaPill(value)));
  body.appendChild(meta);

  body.appendChild(
    createElement(
      "p",
      "anime-synopsis",
      anime.synopsis || "No synopsis is available for this title yet."
    )
  );

  if (Array.isArray(anime.genres) && anime.genres.length > 0) {
    const genres = createElement("div", "genre-list");
    anime.genres.slice(0, 4).forEach((genre) => {
      if (genre?.name) {
        genres.appendChild(createElement("span", "genre-chip", genre.name));
      }
    });

    if (genres.childElementCount > 0) {
      body.appendChild(genres);
    }
  }

  const footer = createElement("div", "anime-card-footer");

  if (typeof anime.members === "number") {
    footer.appendChild(
      createElement(
        "span",
        "members",
        `${formatNumber(anime.members)} members`
      )
    );
  }

  if (malUrl) {
    const moreInfo = createElement("a", "anime-link", "More info ↗");
    moreInfo.href = malUrl;
    moreInfo.target = "_blank";
    moreInfo.rel = "noopener noreferrer";
    footer.appendChild(moreInfo);
  }

  body.appendChild(footer);
  card.appendChild(body);

  return card;
};

const renderMessage = (title, message) => {
  animeList.replaceChildren();
  resultCount.textContent = "";
  loadMoreRow.hidden = true;

  const state = createElement("div", "results-state");
  state.appendChild(createElement("strong", null, title));
  state.appendChild(createElement("p", null, message));
  animeList.appendChild(state);
};

const renderLoading = () => {
  animeList.replaceChildren();
  loadMoreRow.hidden = true;

  for (let index = 0; index < 6; index += 1) {
    const skeleton = createElement("div", "anime-card skeleton-card");
    skeleton.setAttribute("aria-hidden", "true");
    skeleton.appendChild(createElement("div", "skeleton-poster"));

    const body = createElement("div", "anime-card-body");
    body.appendChild(
      createElement("div", "skeleton-line skeleton-line-title")
    );
    body.appendChild(createElement("div", "skeleton-line"));
    body.appendChild(
      createElement("div", "skeleton-line skeleton-line-short")
    );
    skeleton.appendChild(body);
    animeList.appendChild(skeleton);
  }
};

const renderResults = () => {
  const { results, query, page } = searchState;
  animeList.replaceChildren();
  resultCount.textContent = `${results.length} shown · page ${page}`;

  if (results.length === 0) {
    renderMessage(
      "Nothing matched that title.",
      "Try a shorter title, an English/Japanese variation, or another keyword."
    );
    setStatus(`No results for ${query}.`);
    return;
  }

  const fragment = document.createDocumentFragment();
  results.forEach((anime) => fragment.appendChild(createAnimeCard(anime)));
  animeList.appendChild(fragment);
  setStatus(`Showing ${results.length} results for ${query}.`);
  updateLoadMore();
};

const rememberQueryInUrl = (query) => {
  const url = new URL(window.location.href);
  url.searchParams.set("q", query);
  window.history.replaceState(null, "", url);
};

const commitPage = (pageData, query, append) => {
  const results = append
    ? mergeAnimeResults(searchState.results, pageData.results)
    : pageData.results;

  searchState = {
    query,
    page: pageData.currentPage,
    results,
    hasNextPage: pageData.hasNextPage,
  };

  renderResults();
};

const searchAnime = async (rawQuery, { append = false } = {}) => {
  const query = normalizeQuery(rawQuery);

  if (!query) {
    searchInput.focus();
    setStatus("Type an anime title first.");
    return;
  }

  if (append && (query !== searchState.query || !searchState.hasNextPage)) {
    return;
  }

  const page = append ? searchState.page + 1 : 1;

  searchInput.value = query;
  rememberQueryInUrl(query);

  if (!append) {
    searchState = { query, page: 0, results: [], hasNextPage: false };
    resultCount.textContent = "";
  }

  if (activeController) {
    activeController.abort();
    activeController = null;
  }

  const requestId = ++requestSequence;
  const cacheKey = cacheKeyForSearch(query, page);
  const cachedPage = cache.get(cacheKey);

  if (cachedPage) {
    commitPage(cachedPage, query, append);
    setBusy(false);
    updateLoadMore();
    return;
  }

  const controller = new AbortController();
  activeController = controller;
  const mode = append ? "more" : "search";

  setBusy(true, mode);
  setStatus(append ? `Loading more ${query} results…` : `Searching for ${query}…`);

  if (!append) {
    renderLoading();
  }

  try {
    const response = await fetch(buildSearchUrl(query, page), {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });

    if (response.status === 429) {
      throw new Error("RATE_LIMITED");
    }

    if (!response.ok) {
      throw new Error(`HTTP_${response.status}`);
    }

    const pageData = parseSearchPayload(await response.json());

    if (requestId !== requestSequence) {
      return;
    }

    cache.set(cacheKey, pageData);
    commitPage(pageData, query, append);
  } catch (error) {
    if (error.name === "AbortError" || requestId !== requestSequence) {
      return;
    }

    if (append) {
      setStatus(
        error.message === "RATE_LIMITED"
          ? "Jikan is rate-limiting requests. Wait a moment before loading more."
          : "Could not load the next page. Your current results are still here."
      );
      return;
    }

    if (error.message === "RATE_LIMITED") {
      renderMessage(
        "Jikan is rate-limiting requests right now.",
        "Give it a moment and try the search again."
      );
      setStatus("Search temporarily rate-limited.");
    } else {
      renderMessage(
        "Could not reach the anime API.",
        "Check your connection and try again in a moment."
      );
      setStatus("Search failed. Please try again.");
    }
  } finally {
    if (requestId === requestSequence) {
      setBusy(false);
      activeController = null;
      updateLoadMore();
    }
  }
};

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  searchAnime(searchInput.value);
});

quickSearches.forEach((button) => {
  button.addEventListener("click", () => {
    searchAnime(button.dataset.query || "");
  });
});

loadMoreButton.addEventListener("click", () => {
  searchAnime(searchState.query, { append: true });
});

const initialQuery = normalizeQuery(
  new URL(window.location.href).searchParams.get("q")
);

if (initialQuery) {
  searchAnime(initialQuery);
} else {
  renderMessage(
    "Your next watch might be one search away.",
    "Try a title above or use one of the quick searches."
  );
}
