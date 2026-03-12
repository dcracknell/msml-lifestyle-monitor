jest.mock('../services/nutrition-photo-analyzer', () => ({
  analyzeNutritionPhoto: jest.fn(),
  verifyNutritionPhotoModelSetup: jest.fn(),
}));

const request = require('supertest');
const createApp = require('../app');
const {
  analyzeNutritionPhoto,
  verifyNutritionPhotoModelSetup,
} = require('../services/nutrition-photo-analyzer');

let app;

beforeAll(() => {
  app = createApp();
});

beforeEach(() => {
  analyzeNutritionPhoto.mockReset();
  verifyNutritionPhotoModelSetup.mockReset();
});

async function loginAsCoach() {
  const response = await request(app).post('/api/login').send({
    email: 'coach@example.com',
    password: 'Password',
  });

  expect(response.status).toBe(200);
  return response.body;
}

describe('Nutrition photo logging', () => {
  it('previews a meal photo as editable detected items before logging', async () => {
    analyzeNutritionPhoto.mockResolvedValue({
      name: 'fish and chips',
      confidence: 0.82,
      isReliable: true,
      detectedFoods: [
        {
          name: 'fish and chips',
          confidence: 0.82,
          calories: 280,
          protein: 22,
          carbs: 18,
          fats: 12,
          weightAmount: 160,
          weightUnit: 'g',
        },
        {
          name: 'green peas',
          confidence: 0.44,
          calories: 84,
          protein: 5,
          carbs: 15,
          fats: 0,
          fiber: 5,
          weightAmount: 80,
          weightUnit: 'g',
        },
      ],
      mealAnalysis: {
        foodCount: 2,
        totalCalories: 364,
        totalProtein: 27,
        totalCarbs: 33,
        totalFats: 12,
        totalFiber: 5,
        totalWeightAmount: 240,
        weightUnit: 'g',
        items: [
          {
            name: 'fish and chips',
            confidence: 0.82,
            calories: 280,
            protein: 22,
            carbs: 18,
            fats: 12,
            weightAmount: 160,
            weightUnit: 'g',
          },
          {
            name: 'green peas',
            confidence: 0.44,
            calories: 84,
            protein: 5,
            carbs: 15,
            fats: 0,
            fiber: 5,
            weightAmount: 80,
            weightUnit: 'g',
          },
        ],
      },
    });

    const { token } = await loginAsCoach();
    const photoData = Buffer.from('editable-preview').toString('base64');

    const response = await request(app)
      .post('/api/nutrition/photo/analyze')
      .set('Authorization', `Bearer ${token}`)
      .send({ photoData, type: 'Food' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      requiresReview: false,
      photoAnalysis: {
        name: 'fish and chips',
        confidence: 0.82,
      },
      mealAnalysis: {
        foodCount: 2,
        totalCalories: 364,
      },
    });
    expect(response.body.suggestedItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'breaded fish fillet',
          calories: 280,
          protein: 22,
          carbs: 18,
          fats: 12,
        }),
        expect.objectContaining({
          name: 'green peas',
          calories: 84,
          protein: 5,
          carbs: 15,
          fiber: 5,
        }),
      ])
    );
  });

  it('returns an editable review payload for uncertain meal photos', async () => {
    analyzeNutritionPhoto.mockResolvedValue({
      name: 'toast',
      confidence: 0.67,
      isReliable: false,
      reliabilityThreshold: 0.78,
      reliabilityReason: 'Top prediction confidence 0.6700 is below required threshold 0.78.',
      topMatches: [
        { name: 'toast', confidence: 0.67 },
        { name: 'croissant', confidence: 0.1 },
      ],
    });

    const { token } = await loginAsCoach();
    const photoData = Buffer.from('uncertain-preview').toString('base64');

    const response = await request(app)
      .post('/api/nutrition/photo/analyze')
      .set('Authorization', `Bearer ${token}`)
      .send({ photoData, type: 'Food' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      requiresReview: true,
      photoAnalysis: {
        name: 'toast',
        confidence: 0.67,
        reliabilityThreshold: 0.78,
      },
    });
    expect(response.body.suggestedItems).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'toast', type: 'Food' })])
    );
  });

  it('reports NUT setup readiness through the health endpoint', async () => {
    verifyNutritionPhotoModelSetup.mockResolvedValue({
      ready: true,
      labelsCount: 103,
      clsHeadClasses: 103,
      segHeadClasses: 103,
      modelFileName: 'canet_NUT.pth',
      modelSha256: 'abc123',
    });

    const { token } = await loginAsCoach();
    const response = await request(app)
      .get('/api/nutrition/photo/health')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ready: true,
      setup: {
        labelsCount: 103,
        clsHeadClasses: 103,
        segHeadClasses: 103,
        modelFileName: 'canet_NUT.pth',
        modelSha256: 'abc123',
      },
    });
  });

  it('surfaces NUT setup failures through the health endpoint', async () => {
    const error = new Error('PyTorch is not installed.');
    error.status = 503;
    error.code = 'NUT_RUNTIME_MISSING';
    verifyNutritionPhotoModelSetup.mockRejectedValue(error);

    const { token } = await loginAsCoach();
    const response = await request(app)
      .get('/api/nutrition/photo/health')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      ready: false,
      message: 'PyTorch is not installed.',
      code: 'NUT_RUNTIME_MISSING',
    });
  });

  it('logs a food entry from a meal photo without manual fields', async () => {
    analyzeNutritionPhoto.mockResolvedValue({
      name: 'Banana',
      confidence: 0.91,
      calories: 105,
      protein: 1,
      carbs: 27,
      fats: 0,
      fiber: 3,
      topMatches: [{ name: 'Banana', confidence: 0.91 }],
    });

    const { token } = await loginAsCoach();
    const date = '2030-01-01';
    const photoData = Buffer.from('fake-meal-photo').toString('base64');

    const postResponse = await request(app)
      .post('/api/nutrition')
      .set('Authorization', `Bearer ${token}`)
      .send({ date, photoData });

    expect(postResponse.status).toBe(200);
    expect(postResponse.body.message).toContain('Banana');
    expect(postResponse.body.photoAnalysis).toMatchObject({
      name: 'Banana',
      confidence: 0.91,
    });

    const fetchResponse = await request(app)
      .get(`/api/nutrition?date=${date}`)
      .set('Authorization', `Bearer ${token}`);

    expect(fetchResponse.status).toBe(200);
    expect(
      fetchResponse.body.entries.some(
        (entry) =>
          entry.name === 'Banana' &&
          entry.calories === 105 &&
          entry.fiber === 3 &&
          typeof entry.photoData === 'string' &&
          entry.photoData.length > 0
      )
    ).toBe(true);
    expect(fetchResponse.body.dailyTotals).toMatchObject({
      calories: 105,
      protein: 1,
      carbs: 27,
      fats: 0,
      fiber: 3,
      count: 1,
    });
  });

  it('logs a full meal breakdown from one photo when the NUT model returns multiple foods', async () => {
    analyzeNutritionPhoto.mockResolvedValue({
      name: 'chicken duck',
      confidence: 0.1287,
      calories: 611,
      protein: 56,
      carbs: 60,
      fats: 5,
      fiber: 13,
      detectedFoods: [
        {
          name: 'chicken duck',
          confidence: 0.1287,
          calories: 404.68,
          protein: 45,
          carbs: 0,
          fats: 4,
          fiber: 0,
          weightAmount: 165.18,
          weightUnit: 'g',
        },
        {
          name: 'corn',
          confidence: 0.0585,
          calories: 42.02,
          protein: 3,
          carbs: 19,
          fats: 1,
          fiber: 3,
          weightAmount: 75.04,
          weightUnit: 'g',
        },
        {
          name: 'potato',
          confidence: 0.0542,
          calories: 114.48,
          protein: 2,
          carbs: 19,
          fats: 0,
          fiber: 2,
          weightAmount: 66.95,
          weightUnit: 'g',
        },
        {
          name: 'carrot',
          confidence: 0.0595,
          calories: 33.57,
          protein: 1,
          carbs: 8,
          fats: 0,
          fiber: 2,
          weightAmount: 76.3,
          weightUnit: 'g',
        },
        {
          name: 'broccoli',
          confidence: 0.1157,
          calories: 16.48,
          protein: 5,
          carbs: 14,
          fats: 0,
          fiber: 6,
          weightAmount: 68.67,
          weightUnit: 'g',
        },
      ],
      mealAnalysis: {
        foodCount: 5,
        totalCalories: 611.24,
        totalProtein: 56,
        totalCarbs: 60,
        totalFats: 5,
        totalFiber: 13,
        totalWeightAmount: 452.14,
        weightUnit: 'g',
        plateDetected: true,
        plateDiameterPx: 400,
        mmPerPixel: 0.675,
        items: [
          {
            name: 'chicken duck',
            confidence: 0.1287,
            calories: 404.68,
            protein: 45,
            carbs: 0,
            fats: 4,
            fiber: 0,
            weightAmount: 165.18,
            weightUnit: 'g',
          },
          {
            name: 'corn',
            confidence: 0.0585,
            calories: 42.02,
            protein: 3,
            carbs: 19,
            fats: 1,
            fiber: 3,
            weightAmount: 75.04,
            weightUnit: 'g',
          },
          {
            name: 'potato',
            confidence: 0.0542,
            calories: 114.48,
            protein: 2,
            carbs: 19,
            fats: 0,
            fiber: 2,
            weightAmount: 66.95,
            weightUnit: 'g',
          },
          {
            name: 'carrot',
            confidence: 0.0595,
            calories: 33.57,
            protein: 1,
            carbs: 8,
            fats: 0,
            fiber: 2,
            weightAmount: 76.3,
            weightUnit: 'g',
          },
          {
            name: 'broccoli',
            confidence: 0.1157,
            calories: 16.48,
            protein: 5,
            carbs: 14,
            fats: 0,
            fiber: 6,
            weightAmount: 68.67,
            weightUnit: 'g',
          },
        ],
      },
    });

    const { token } = await loginAsCoach();
    const date = '2030-01-06';
    const photoData = Buffer.from('fake-meal-photo').toString('base64');

    const postResponse = await request(app)
      .post('/api/nutrition')
      .set('Authorization', `Bearer ${token}`)
      .send({ date, photoData });

    expect(postResponse.status).toBe(200);
    expect(postResponse.body.entriesLogged).toHaveLength(5);
    expect(postResponse.body.entriesLogged.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(['chicken duck', 'corn', 'potato', 'carrot', 'broccoli'])
    );
    expect(postResponse.body.mealAnalysis).toMatchObject({
      foodCount: 5,
      totalCalories: 611.24,
      totalProtein: 56,
      totalCarbs: 60,
      totalFiber: 13,
      plateDiameterPx: 400,
      mmPerPixel: 0.675,
    });

    const fetchResponse = await request(app)
      .get(`/api/nutrition?date=${date}`)
      .set('Authorization', `Bearer ${token}`);

    expect(fetchResponse.status).toBe(200);
    expect(
      fetchResponse.body.entries.some((entry) => entry.name === 'chicken duck' && entry.calories === 405)
    ).toBe(true);
    expect(
      fetchResponse.body.entries.some(
        (entry) => entry.name === 'potato' && entry.calories === 114 && entry.fiber === 2
      )
    ).toBe(true);
    expect(fetchResponse.body.dailyTotals).toMatchObject({
      calories: 611,
      protein: 56,
      carbs: 60,
      fats: 5,
      fiber: 13,
      count: 5,
    });
  });

  it('uses quick-add fallback when photo analysis has no macro values', async () => {
    analyzeNutritionPhoto.mockResolvedValue({
      name: 'porridge',
      confidence: 0.88,
      calories: null,
      protein: null,
      carbs: null,
      fats: null,
      topMatches: [
        { name: 'porridge', confidence: 0.88 },
        { name: 'croissant', confidence: 0.05 },
      ],
    });

    const { token } = await loginAsCoach();
    const date = '2030-01-03';
    const photoData = Buffer.from('fake-meal-photo').toString('base64');

    const postResponse = await request(app)
      .post('/api/nutrition')
      .set('Authorization', `Bearer ${token}`)
      .send({ date, photoData });

    expect(postResponse.status).toBe(200);
    expect(postResponse.body.message).toContain('porridge');

    const fetchResponse = await request(app)
      .get(`/api/nutrition?date=${date}`)
      .set('Authorization', `Bearer ${token}`);

    expect(fetchResponse.status).toBe(200);
    expect(
      fetchResponse.body.entries.some(
        (entry) =>
          entry.name === 'porridge' &&
          entry.calories === 150 &&
          entry.protein === 6 &&
          entry.carbs === 27 &&
          entry.fats === 3
      )
    ).toBe(true);
  });

  it('rejects low-confidence photo guesses to avoid incorrect auto labels', async () => {
    analyzeNutritionPhoto.mockResolvedValue({
      name: 'toast',
      confidence: 0.67,
      isReliable: false,
      reliabilityThreshold: 0.78,
      reliabilityReason: 'Top prediction confidence 0.6700 is below required threshold 0.78.',
      topMatches: [
        { name: 'toast', confidence: 0.67 },
        { name: 'croissant', confidence: 0.1 },
      ],
    });

    const { token } = await loginAsCoach();
    const date = '2030-01-04';
    const photoData = Buffer.from('fake-meal-photo').toString('base64');

    const response = await request(app)
      .post('/api/nutrition')
      .set('Authorization', `Bearer ${token}`)
      .send({ date, photoData });

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      code: 'PHOTO_ANALYSIS_UNCERTAIN',
      photoAnalysis: {
        name: 'toast',
        confidence: 0.67,
        reliabilityThreshold: 0.78,
      },
    });
  });

  it('logs multiple food items from one photo when items[] is provided', async () => {
    const { token } = await loginAsCoach();
    const date = '2030-01-05';
    const photoData = Buffer.from('fake-meal-photo').toString('base64');

    const response = await request(app)
      .post('/api/nutrition')
      .set('Authorization', `Bearer ${token}`)
      .send({
        date,
        photoData,
        items: [
          { name: 'Fish', calories: 220, protein: 30, carbs: 0, fats: 9, weightAmount: 150, weightUnit: 'g' },
          { name: 'Peas', calories: 84, protein: 5, carbs: 15, fats: 0, weightAmount: 120, weightUnit: 'g' },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.entriesLogged).toHaveLength(2);
    expect(response.body.entriesLogged.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(['Fish', 'Peas'])
    );

    const fetchResponse = await request(app)
      .get(`/api/nutrition?date=${date}`)
      .set('Authorization', `Bearer ${token}`);

    expect(fetchResponse.status).toBe(200);
    expect(
      fetchResponse.body.entries.some(
        (entry) => entry.name === 'Fish' && entry.calories === 220 && typeof entry.photoData === 'string'
      )
    ).toBe(true);
    expect(
      fetchResponse.body.entries.some(
        (entry) => entry.name === 'Peas' && entry.calories === 84
      )
    ).toBe(true);
  });

  it('returns a clear model setup error when the NUT runtime is unavailable', async () => {
    const error = new Error('NUT model is not configured on the server.');
    error.status = 503;
    error.code = 'NUT_MODEL_NOT_CONFIGURED';
    analyzeNutritionPhoto.mockRejectedValue(error);

    const { token } = await loginAsCoach();
    const photoData = Buffer.from('fake-meal-photo').toString('base64');

    const response = await request(app)
      .post('/api/nutrition')
      .set('Authorization', `Bearer ${token}`)
      .send({ date: '2030-01-02', photoData });

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      message: 'NUT model is not configured on the server.',
      code: 'NUT_MODEL_NOT_CONFIGURED',
    });
  });
});
