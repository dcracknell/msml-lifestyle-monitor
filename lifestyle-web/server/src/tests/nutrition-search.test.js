const nutritionRouter = require('../routes/nutrition');

const {
  getRemoteSuggestions,
  clearRemoteSuggestionCache,
  REMOTE_SEARCH_TIMEOUT_MS,
  lookupQuickAddByQuery,
  mapUsdaFoodToSuggestion,
  getCombinedSuggestions,
  rankNutritionSuggestions,
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

describe('multi-source nutrition ranking', () => {
  it('maps USDA foundation foods to 100 g suggestions with fiber', () => {
    const suggestion = mapUsdaFoodToSuggestion({
      fdcId: 1,
      description: 'Bananas, ripe and slightly ripe, raw',
      dataType: 'Foundation',
      foodNutrients: [
        { nutrientId: 1008, nutrientName: 'Energy', nutrientNumber: '208', unitName: 'KCAL', value: 97 },
        { nutrientId: 1003, nutrientName: 'Protein', nutrientNumber: '203', unitName: 'G', value: 0.74 },
        { nutrientId: 1005, nutrientName: 'Carbohydrate, by difference', nutrientNumber: '205', unitName: 'G', value: 23.0 },
        { nutrientId: 1004, nutrientName: 'Total lipid (fat)', nutrientNumber: '204', unitName: 'G', value: 0.29 },
        { nutrientId: 1079, nutrientName: 'Fiber, total dietary', nutrientNumber: '291', unitName: 'G', value: 1.7 },
      ],
    });

    expect(suggestion).toEqual(
      expect.objectContaining({
        name: 'Bananas, ripe and slightly ripe, raw',
        source: 'USDA Foundation',
        serving: '100 g',
        sourceType: 'usda_foundation',
        prefill: expect.objectContaining({
          calories: 97,
          protein: 0.7,
          carbs: 23,
          fats: 0.3,
          fiber: 1.7,
          weightAmount: 100,
          weightUnit: 'g',
        }),
      })
    );
  });

  it('maps USDA branded foods to serving-sized suggestions with barcode and fiber', () => {
    const suggestion = mapUsdaFoodToSuggestion({
      fdcId: 2,
      description: 'GREEK YOGURT',
      dataType: 'Branded',
      brandName: "TRADER JOE'S",
      gtinUpc: '00772914',
      servingSize: 227,
      servingSizeUnit: 'g',
      householdServingFullText: '1 CONTAINER',
      foodNutrients: [
        { nutrientId: 1008, nutrientName: 'Energy', nutrientNumber: '208', unitName: 'KCAL', value: 132 },
        { nutrientId: 1003, nutrientName: 'Protein', nutrientNumber: '203', unitName: 'G', value: 4.85 },
        { nutrientId: 1005, nutrientName: 'Carbohydrate, by difference', nutrientNumber: '205', unitName: 'G', value: 12.3 },
        { nutrientId: 1004, nutrientName: 'Total lipid (fat)', nutrientNumber: '204', unitName: 'G', value: 7.05 },
        { nutrientId: 1079, nutrientName: 'Fiber, total dietary', nutrientNumber: '291', unitName: 'G', value: 0 },
      ],
    });

    expect(suggestion).toEqual(
      expect.objectContaining({
        source: "TRADER JOE'S · USDA Branded",
        barcode: '00772914',
        serving: '1 CONTAINER',
        sourceType: 'usda_branded',
        prefill: expect.objectContaining({
          calories: 132,
          protein: 4.9,
          carbs: 12.3,
          fats: 7.1,
          fiber: 0,
          weightAmount: 227,
          weightUnit: 'g',
          barcode: '00772914',
        }),
      })
    );
  });

  it('ranks generic USDA foods above branded false positives for broad queries', () => {
    const ranked = rankNutritionSuggestions(
      [
        {
          id: 'branded-greek',
          name: 'GREEK YOGURT',
          source: 'OCEAN SPRAY · USDA Branded',
          sourceType: 'usda_branded',
          brandName: 'OCEAN SPRAY',
          isBranded: true,
          isGeneric: false,
          prefill: { calories: 467, protein: 3.3, carbs: 70, fats: 20, fiber: 3.3, weightAmount: 30, weightUnit: 'g' },
        },
        {
          id: 'generic-greek',
          name: 'Yogurt, Greek, plain, nonfat',
          source: 'USDA Foundation',
          sourceType: 'usda_foundation',
          isBranded: false,
          isGeneric: true,
          prefill: { calories: 61, protein: 10.3, carbs: 3.6, fats: 0.4, fiber: 0, weightAmount: 100, weightUnit: 'g' },
        },
      ],
      'greek yogurt',
      { limit: 2, maxScore: 2 }
    );

    expect(ranked[0]).toEqual(expect.objectContaining({ sourceType: 'usda_foundation' }));
    expect(ranked[1]).toEqual(expect.objectContaining({ sourceType: 'usda_branded' }));
  });

  it('prefers real provider matches over quick adds when both are available', async () => {
    const suggestions = await getCombinedSuggestions(1, 'banana', {
      localSuggestions: [],
      remoteSuggestions: [
        {
          id: 'usda-banana',
          name: 'Bananas, ripe and slightly ripe, raw',
          source: 'USDA Foundation',
          sourceType: 'usda_foundation',
          isBranded: false,
          isGeneric: true,
          prefill: { calories: 97, protein: 0.7, carbs: 23, fats: 0.3, fiber: 1.7, weightAmount: 100, weightUnit: 'g' },
        },
      ],
      quickSuggestions: [
        {
          id: 'quick-banana',
          name: 'Banana (1 medium)',
          source: 'Quick Add',
          sourceType: 'quick_add',
          isBranded: false,
          isGeneric: true,
          prefill: { calories: 105, protein: 1.3, carbs: 27, fats: 0.3, fiber: 3.1, weightAmount: 120, weightUnit: 'g' },
          score: 0.05,
        },
      ],
      limit: 2,
      maxScore: 2,
    });

    expect(suggestions[0]).toEqual(expect.objectContaining({ sourceType: 'usda_foundation' }));
    expect(suggestions[1]).toEqual(expect.objectContaining({ sourceType: 'quick_add' }));
  });

  it('still falls back to quick adds when provider results are unavailable', async () => {
    const suggestions = await getCombinedSuggestions(1, 'porridge', {
      localSuggestions: [],
      remoteSuggestions: [],
      quickSuggestions: [
        {
          id: 'quick-porridge',
          name: 'Oatmeal (cooked)',
          source: 'Quick Add',
          sourceType: 'quick_add',
          isBranded: false,
          isGeneric: true,
          prefill: { calories: 150, protein: 6, carbs: 27, fats: 3, fiber: 4, weightAmount: 240, weightUnit: 'g' },
          score: 0.02,
        },
      ],
      limit: 2,
      maxScore: 2,
    });

    expect(suggestions[0]).toEqual(expect.objectContaining({ sourceType: 'quick_add' }));
  });
});
