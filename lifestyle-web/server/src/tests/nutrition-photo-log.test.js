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
          typeof entry.photoData === 'string' &&
          entry.photoData.length > 0
      )
    ).toBe(true);
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
