const nutritionRouter = require('../routes/nutrition');

const {
  getRemoteSuggestions,
  clearRemoteSuggestionCache,
  REMOTE_SEARCH_TIMEOUT_MS,
} = nutritionRouter.__private__ || {};

describe('remote nutrition suggestions', () => {
  beforeEach(() => {
    if (typeof clearRemoteSuggestionCache === 'function') {
      clearRemoteSuggestionCache();
    }
  });

  it('caches successful remote lookups to avoid duplicate fetches', async () => {
    const payload = [{ id: 'remote-1', name: 'Recovery shake', source: 'OpenFoodFacts' }];
    const searchFn = jest.fn(async () => payload);

    const first = await getRemoteSuggestions('recovery', { searchFn, ttlMs: 1000 });
    expect(Array.isArray(first)).toBe(true);
    expect(first).toEqual(payload);
    expect(searchFn).toHaveBeenCalledTimes(1);

    const second = await getRemoteSuggestions('recovery', { searchFn, ttlMs: 1000 });
    expect(second).toEqual(payload);
    expect(searchFn).toHaveBeenCalledTimes(1);
  });

  it('falls back quickly when remote lookups are slow but reuses cached results once ready', async () => {
    const slowResult = [{ id: 'slow-1', name: 'Slow match', source: 'OpenFoodFacts' }];
    const timeoutBudget = (REMOTE_SEARCH_TIMEOUT_MS || 50) + 20;
    const searchFn = jest.fn(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(slowResult), timeoutBudget);
        })
    );

    const immediate = await getRemoteSuggestions('slow oats', {
      searchFn,
      timeoutMs: 15,
      ttlMs: 1000,
    });
    expect(immediate).toEqual([]);
    expect(searchFn).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 80));

    const cached = await getRemoteSuggestions('slow oats', { searchFn, ttlMs: 1000 });
    expect(cached).toEqual(slowResult);
    expect(searchFn).toHaveBeenCalledTimes(1);
  });
});
