import type { NutritionSuggestion } from '../../../api/types';
import {
  fetchSuggestionsWithCache,
  readSuggestionCache,
  clearSuggestionCache,
} from '../suggestionCache';

describe('nutrition suggestion cache', () => {
  beforeEach(() => {
    clearSuggestionCache();
  });

  const sampleSuggestion: NutritionSuggestion = {
    id: 'sample-1',
    name: 'Sample Food',
    source: 'Recent',
    serving: '1 serving',
    barcode: '000111222333',
    prefill: {
      calories: 120,
      carbs: 10,
      protein: 8,
      fats: 4,
      type: 'Food',
      barcode: '000111222333',
    },
  };

  it('caches successful requests and returns them from the reader', async () => {
    const fetcher = jest.fn(async () => [sampleSuggestion]);
    const result = await fetchSuggestionsWithCache('sample', fetcher, { forceRefresh: true });

    expect(result).toEqual([sampleSuggestion]);
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(1);

    const cached = readSuggestionCache('sample');
    expect(cached?.suggestions).toEqual([sampleSuggestion]);
    expect(cached?.isStale).toBe(false);
  });

  it('deduplicates concurrent fetches for the same query', async () => {
    let resolver: (value: NutritionSuggestion[]) => void = () => {};
    const fetcher = jest.fn(
      () =>
        new Promise<NutritionSuggestion[]>((resolve) => {
          resolver = resolve;
        })
    );

    const pendingA = fetchSuggestionsWithCache('banana', fetcher, { forceRefresh: true });
    const pendingB = fetchSuggestionsWithCache('banana', fetcher, { forceRefresh: true });
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(1);

    resolver([sampleSuggestion]);

    await expect(pendingA).resolves.toEqual([sampleSuggestion]);
    await expect(pendingB).resolves.toEqual([sampleSuggestion]);
  });

  it('returns null quickly when a request exceeds the timeout but fills the cache later', async () => {
    const delayedSuggestion: NutritionSuggestion = { ...sampleSuggestion, id: 'slow-1' };
    const fetcher = jest.fn(
      () =>
        new Promise<NutritionSuggestion[]>((resolve) => {
          setTimeout(() => resolve([delayedSuggestion]), 40);
        })
    );

    const result = await fetchSuggestionsWithCache('slow oats', fetcher, {
      timeoutMs: 5,
      ttlMs: 500,
      forceRefresh: true,
    });
    expect(result).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 60));
    const cached = readSuggestionCache('slow oats');
    expect(cached?.suggestions).toEqual([delayedSuggestion]);
    expect(cached?.isStale).toBe(false);
  });

  it('honors force refresh and reuses cached suggestions when refreshing fails', async () => {
    const firstFetcher = jest.fn(async () => [sampleSuggestion]);
    await fetchSuggestionsWithCache('protein bar', firstFetcher, { forceRefresh: true, ttlMs: 1000 });
    expect(firstFetcher).toHaveBeenCalledTimes(1);

    const refreshedSuggestion: NutritionSuggestion = { ...sampleSuggestion, id: 'protein-2' };
    const refreshFetcher = jest.fn(async () => [refreshedSuggestion]);
    const refreshed = await fetchSuggestionsWithCache('protein bar', refreshFetcher, {
      forceRefresh: true,
      ttlMs: 1000,
    });
    expect(refreshFetcher).toHaveBeenCalledTimes(1);
    expect(refreshed).toEqual([refreshedSuggestion]);
    const cached = readSuggestionCache('protein bar');
    expect(cached?.suggestions).toEqual([refreshedSuggestion]);
  });
});
