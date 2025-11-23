import type { NutritionSuggestion } from '../../api/types';

export const SUGGESTION_CACHE_TTL_MS = 1000 * 60 * 2; // 2 minutes
export const SUGGESTION_CACHE_LIMIT = 50;
export const SUGGESTION_REQUEST_TIMEOUT_MS = 700;

type Fetcher = (query: string) => Promise<NutritionSuggestion[]>;

type CacheEntry = {
  data: NutritionSuggestion[];
  expiresAt: number;
  inflight: Promise<NutritionSuggestion[]> | null;
};

export type CachedSuggestionResult = {
  suggestions: NutritionSuggestion[];
  isStale: boolean;
};

const suggestionCache = new Map<string, CacheEntry>();

const normalizeQuery = (query: string) => query.trim().toLowerCase();

function trimCache(limit = SUGGESTION_CACHE_LIMIT) {
  while (suggestionCache.size > limit) {
    const oldestKey = suggestionCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    suggestionCache.delete(oldestKey);
  }
}

function startSuggestionFetch(
  key: string,
  query: string,
  fetcher: Fetcher,
  ttlMs: number,
  existing?: CacheEntry
) {
  const entry = existing || { data: [], expiresAt: Date.now() + ttlMs, inflight: null };
  entry.inflight = Promise.resolve()
    .then(() => fetcher(query))
    .then((results) => {
      const normalizedResults = Array.isArray(results) ? results : [];
      entry.data = normalizedResults;
      entry.expiresAt = Date.now() + ttlMs;
      entry.inflight = null;
      return normalizedResults;
    })
    .catch((error) => {
      entry.inflight = null;
      suggestionCache.delete(key);
      throw error;
    });
  suggestionCache.set(key, entry);
  if (!existing) {
    trimCache();
  }
  return entry;
}

type RaceOutcome<T> = { value: T } | { error: unknown } | { timedOut: true };

function raceWithTimeout<T>(promise: Promise<T>, timeoutMs?: number): Promise<RaceOutcome<T>> {
  if (!timeoutMs || timeoutMs <= 0) {
    return promise
      .then((value) => ({ value }))
      .catch((error) => ({ error }));
  }
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<{ timedOut: true }>((resolve) => {
    timeoutId = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
  });
  return Promise.race([
    promise
      .then((value) => ({ value }))
      .catch((error) => ({ error })),
    timeoutPromise,
  ]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

export function readSuggestionCache(query: string): CachedSuggestionResult | null {
  const key = normalizeQuery(query);
  if (!key) {
    return null;
  }
  const entry = suggestionCache.get(key);
  if (!entry) {
    return null;
  }
  const now = Date.now();
  const expired = entry.expiresAt <= now;
  if (expired && !entry.inflight) {
    suggestionCache.delete(key);
    return null;
  }
  return {
    suggestions: entry.data,
    isStale: expired,
  };
}

type FetchOptions = {
  ttlMs?: number;
  timeoutMs?: number;
  forceRefresh?: boolean;
};

export async function fetchSuggestionsWithCache(
  query: string,
  fetcher: Fetcher,
  options: FetchOptions = {}
): Promise<NutritionSuggestion[] | null> {
  const key = normalizeQuery(query);
  if (!key) {
    return fetcher(query);
  }
  const ttlMs =
    typeof options.ttlMs === 'number' && options.ttlMs > 0
      ? options.ttlMs
      : SUGGESTION_CACHE_TTL_MS;
  const timeoutMs =
    typeof options.timeoutMs === 'number' && options.timeoutMs > 0
      ? options.timeoutMs
      : SUGGESTION_REQUEST_TIMEOUT_MS;
  const forceRefresh = Boolean(options.forceRefresh);
  const now = Date.now();
  let entry = suggestionCache.get(key);
  if (entry && entry.expiresAt <= now && !entry.inflight) {
    suggestionCache.delete(key);
    entry = undefined;
  }

  if (!entry) {
    entry = startSuggestionFetch(key, query, fetcher, ttlMs);
  } else if (forceRefresh && !entry.inflight) {
    entry = startSuggestionFetch(key, query, fetcher, ttlMs, entry);
  } else if (!entry.inflight && entry.expiresAt <= now) {
    entry = startSuggestionFetch(key, query, fetcher, ttlMs, entry);
  }

  if (!entry) {
    return [];
  }

  if (!entry.inflight) {
    return entry.data;
  }

  const outcome = await raceWithTimeout(entry.inflight, timeoutMs);
  if ('timedOut' in outcome) {
    return null;
  }
  if ('error' in outcome) {
    throw outcome.error;
  }
  return outcome.value || [];
}

export function clearSuggestionCache() {
  suggestionCache.clear();
}
