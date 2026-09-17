export const API_URL = "https://api.jikan.moe/v4/anime";
export const RESULT_LIMIT = 18;

export const normalizeQuery = (value) => String(value ?? "").trim();

export const cacheKeyForSearch = (query, page = 1) =>
  `${normalizeQuery(query).toLocaleLowerCase()}::${page}`;

export const buildSearchUrl = (
  query,
  page = 1,
  { apiUrl = API_URL, limit = RESULT_LIMIT } = {}
) => {
  const url = new URL(apiUrl);
  url.searchParams.set("q", normalizeQuery(query));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("page", String(page));
  url.searchParams.set("sfw", "true");
  return url;
};

export const parseSearchPayload = (payload) => {
  const results = Array.isArray(payload?.data) ? payload.data : [];
  const pagination = payload?.pagination ?? {};
  const currentPage = Number(pagination.current_page) || 1;

  return {
    results,
    currentPage,
    hasNextPage: Boolean(pagination.has_next_page),
  };
};

export const mergeAnimeResults = (current, incoming) => {
  const merged = new Map();

  [...current, ...incoming].forEach((anime, index) => {
    if (!anime || typeof anime !== "object") {
      return;
    }

    const identity = anime.mal_id
      ? `mal:${anime.mal_id}`
      : anime.url
        ? `url:${anime.url}`
        : `fallback:${anime.title ?? "untitled"}:${index}`;

    merged.set(identity, anime);
  });

  return [...merged.values()];
};

export const safeHttpsUrl = (value, { hosts } = {}) => {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);

    if (url.protocol !== "https:") {
      return null;
    }

    if (
      hosts &&
      !hosts.some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`)
      )
    ) {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
};

export const safeMyAnimeListUrl = (value) =>
  safeHttpsUrl(value, { hosts: ["myanimelist.net"] });

export const firstValue = (...values) =>
  values.find(
    (value) => value !== null && value !== undefined && value !== ""
  );

export const titleForAnime = (anime) =>
  firstValue(
    anime?.title_english,
    anime?.title,
    anime?.title_japanese,
    "Untitled anime"
  );

export const imageForAnime = (anime, fallback = "img/icon.png") => {
  const candidates = [
    anime?.images?.webp?.large_image_url,
    anime?.images?.jpg?.large_image_url,
    anime?.images?.webp?.image_url,
    anime?.images?.jpg?.image_url,
  ];

  return candidates.map((value) => safeHttpsUrl(value)).find(Boolean) ?? fallback;
};
