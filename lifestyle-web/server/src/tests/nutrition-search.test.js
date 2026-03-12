const nutritionRouter = require('../routes/nutrition');

const {
  getRemoteSuggestions,
  clearRemoteSuggestionCache,
  REMOTE_SEARCH_TIMEOUT_MS,
  lookupQuickAddByQuery,
  resolveQuickAddProductFromPhotoAnalysis,
  normalizeBarcodeValue,
  buildBarcodeCandidates,
  parseBarcodeListInput,
  BARCODE_BATCH_LOOKUP_MAX,
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

describe('barcode normalization', () => {
  it('normalizes scanned codes with separators into digits', () => {
    expect(normalizeBarcodeValue(' 0-49000 05010-3 ')).toBe('049000050103');
  });

  it('builds UPC/EAN candidate variants for lookups', () => {
    expect(buildBarcodeCandidates('049000050103')).toEqual(
      expect.arrayContaining(['049000050103', '0049000050103'])
    );
    expect(buildBarcodeCandidates('0049000050103')).toEqual(
      expect.arrayContaining(['0049000050103', '049000050103'])
    );
  });

  it('parses barcode arrays, normalizes values, and removes duplicates', () => {
    const outcome = parseBarcodeListInput([
      ' 5057753897247 ',
      '0-49000 05010-3',
      '5057753897247',
      '',
      null,
    ]);
    expect(outcome.truncated).toBe(0);
    expect(outcome.barcodes).toEqual(['5057753897247', '049000050103']);
  });

  it('caps barcode batch requests at the configured maximum', () => {
    const total = (BARCODE_BATCH_LOOKUP_MAX || 250) + 5;
    const payload = Array.from({ length: total }, (_, index) => `5000000000${index + 1000}`);
    const outcome = parseBarcodeListInput(payload);
    expect(outcome.barcodes.length).toBe(BARCODE_BATCH_LOOKUP_MAX);
    expect(outcome.truncated).toBe(5);
  });
});

describe('quick add lookup fallback', () => {
  it('maps recognized meal names to local nutrition data', () => {
    const product = lookupQuickAddByQuery('porridge');
    expect(product).toEqual(
      expect.objectContaining({
        name: 'Oatmeal (cooked)',
        calories: 150,
        protein: 6,
        carbs: 27,
        fats: 3,
        weightAmount: 240,
        weightUnit: 'g',
      })
    );
  });

  it('returns null for unrelated queries', () => {
    expect(lookupQuickAddByQuery('this is not real food text')).toBeNull();
  });

  it('reuses top matches from photo analysis when the primary label is weak', () => {
    const product = resolveQuickAddProductFromPhotoAnalysis({
      name: 'unknown blend',
      topMatches: [
        { name: 'croissant' },
        { name: 'porridge' },
      ],
    });
    expect(product).toEqual(
      expect.objectContaining({
        name: 'Oatmeal (cooked)',
        calories: 150,
      })
    );
  });

  it('maps fish-and-peas labels to local quick-add fallback foods', () => {
    const fish = resolveQuickAddProductFromPhotoAnalysis({
      name: 'fish and chips',
      topMatches: [{ name: 'green peas' }],
    });
    expect(fish).toEqual(
      expect.objectContaining({
        name: 'Breaded Fish Fillet (2 pieces)',
        calories: 280,
      })
    );

    const peas = lookupQuickAddByQuery('green peas');
    expect(peas).toEqual(
      expect.objectContaining({
        name: 'Green Peas (1/2 cup)',
        calories: 84,
      })
    );
  });
});
