const API_URL = "https://api.jikan.moe/v4/anime";
const RESULT_LIMIT = 18;

const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("search-input");
const searchButton = document.getElementById("search-btn");
const animeList = document.getElementById("anime");
const searchStatus = document.getElementById("search-status");
const resultCount = document.getElementById("result-count");
const quickSearches = document.querySelectorAll("[data-query]");

const cache = new Map();
let activeController = null;
let requestSequence = 0;

const setBusy = (isBusy) => {
  animeList.setAttribute("aria-busy", String(isBusy));
  searchButton.disabled = isBusy;
  searchButton.textContent = isBusy ? "Searching…" : "Search";
};

const setStatus = (message) => {
  searchStatus.textContent = message;
};

const formatNumber = (value) =>
  typeof value === "number" ? new Intl.NumberFormat("en").format(value) : null;

const firstValue = (...values) =>
  values.find(
    (value) => value !== null && value !== undefined && value !== ""
  );

const imageForAnime = (anime) =>
  firstValue(
    anime.images?.webp?.large_image_url,
    anime.images?.jpg?.large_image_url,
    anime.images?.webp?.image_url,
    anime.images?.jpg?.image_url,
    "img/icon.png"
  );

const titleForAnime = (anime) =>
  firstValue(
    anime.title_english,
    anime.title,
    anime.title_japanese,
    "Untitled anime"
  );

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

  const imageLink = createElement("a", "poster-link");
  imageLink.href = anime.url || "#";
  imageLink.target = "_blank";
  imageLink.rel = "noopener noreferrer";
  imageLink.setAttribute(
    "aria-label",
    `Open ${titleForAnime(anime)} on MyAnimeList`
  );

  const image = createElement("img", "anime-poster");
  image.src = imageForAnime(anime);
  image.alt = `${titleForAnime(anime)} poster`;
  image.loading = "lazy";
  image.decoding = "async";
  image.addEventListener(
    "error",
    () => {
      image.src = "img/icon.png";
    },
    { once: true }
  );

  imageLink.appendChild(image);
  card.appendChild(imageLink);

  const body = createElement("div", "anime-card-body");

  const headingRow = createElement("div", "anime-heading-row");
  const headingBlock = createElement("div");
  const title = createElement("h3", "anime-title", titleForAnime(anime));
  headingBlock.appendChild(title);

  if (anime.title_japanese && anime.title_japanese !== titleForAnime(anime)) {
    headingBlock.appendChild(
      createElement("p", "anime-alt-title", anime.title_japanese)
    );
  }

  headingRow.appendChild(headingBlock);

  const score = createElement(
    "span",
    "score-badge",
    anime.score ? `★ ${anime.score.toFixed(1)}` : "★ —"
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

  const synopsis = createElement(
    "p",
    "anime-synopsis",
    anime.synopsis || "No synopsis is available for this title yet."
  );
  body.appendChild(synopsis);

  if (Array.isArray(anime.genres) && anime.genres.length > 0) {
    const genres = createElement("div", "genre-list");
    anime.genres.slice(0, 4).forEach((genre) => {
      genres.appendChild(createElement("span", "genre-chip", genre.name));
    });
    body.appendChild(genres);
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

  const moreInfo = createElement("a", "anime-link", "More info ↗");
  moreInfo.href = anime.url || "#";
  moreInfo.target = "_blank";
  moreInfo.rel = "noopener noreferrer";
  footer.appendChild(moreInfo);

  body.appendChild(footer);
  card.appendChild(body);

  return card;
};

const renderMessage = (title, message) => {
  animeList.replaceChildren();

  const state = createElement("div", "results-state");
  state.appendChild(createElement("strong", null, title));
  state.appendChild(createElement("p", null, message));
  animeList.appendChild(state);
};

const renderLoading = () => {
  animeList.replaceChildren();

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

const renderResults = (results, query) => {
  animeList.replaceChildren();
  resultCount.textContent = `${results.length} result${
    results.length === 1 ? "" : "s"
  }`;

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
};

const buildSearchUrl = (query) => {
  const url = new URL(API_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(RESULT_LIMIT));
  url.searchParams.set("sfw", "true");
  return url;
};

const rememberQueryInUrl = (query) => {
  const url = new URL(window.location.href);
  url.searchParams.set("q", query);
  window.history.replaceState(null, "", url);
};

const searchAnime = async (rawQuery) => {
  const query = rawQuery.trim();

  if (!query) {
    searchInput.focus();
    setStatus("Type an anime title first.");
    return;
  }

  searchInput.value = query;
  rememberQueryInUrl(query);
  resultCount.textContent = "";

  if (activeController) {
    activeController.abort();
    activeController = null;
  }

  const requestId = ++requestSequence;
  const cacheKey = query.toLowerCase();

  if (cache.has(cacheKey)) {
    setBusy(false);
    renderResults(cache.get(cacheKey), query);
    return;
  }

  const controller = new AbortController();
  activeController = controller;

  setBusy(true);
  setStatus(`Searching for ${query}…`);
  renderLoading();

  try {
    const response = await fetch(buildSearchUrl(query), {
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

    const payload = await response.json();
    const results = Array.isArray(payload.data) ? payload.data : [];

    if (requestId !== requestSequence) {
      return;
    }

    cache.set(cacheKey, results);
    renderResults(results, query);
  } catch (error) {
    if (error.name === "AbortError") {
      return;
    }

    if (requestId !== requestSequence) {
      return;
    }

    resultCount.textContent = "";

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
    }
  }
};

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  searchAnime(searchInput.value);
});

quickSearches.forEach((button) => {
  button.addEventListener("click", () => {
    const query = button.dataset.query || "";
    searchAnime(query);
  });
});

const initialQuery = new URL(window.location.href).searchParams.get("q");

if (initialQuery) {
  searchAnime(initialQuery);
} else {
  renderMessage(
    "Your next watch might be one search away.",
    "Try a title above or use one of the quick searches."
  );
}
