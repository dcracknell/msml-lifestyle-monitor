import { parseIPhoneExportPayload } from '../iphoneImport';

describe('parseIPhoneExportPayload', () => {
  it('parses direct metric/value samples', () => {
    const payload = JSON.stringify({
      samples: [
        { metric: 'exercise.hr', ts: 1739836800000, value: 72 },
        { metric: 'exercise.hr', timestamp: '1739836860', value: '74' },
        { metric: 'activity.steps', timestamp: '2026-02-17T12:00:00Z', value: '1532' },
      ],
    });

    const result = parseIPhoneExportPayload(payload);

    expect(result.metricCount).toBe(2);
    expect(result.sampleCount).toBe(3);
    expect(result.batches.map((batch) => batch.metric).sort()).toEqual(['activity.steps', 'exercise.hr']);
    expect(result.batches.find((batch) => batch.metric === 'exercise.hr')?.samples).toEqual([
      { ts: 1739836800000, value: 72 },
      { ts: 1739836860000, value: 74 },
    ]);
  });

  it('maps common iPhone fields into normalized stream metrics', () => {
    const payload = JSON.stringify([
      {
        date: '2026-02-17T10:00:00Z',
        heartRate: 80,
        steps: 3200,
        sleepMinutes: 420,
      },
      {
        date: '2026-02-17T11:00:00Z',
        distanceMiles: 3.1,
        speedMps: 3.2,
        weightLbs: 154,
      },
    ]);

    const result = parseIPhoneExportPayload(payload);

    expect(result.metricCount).toBe(6);
    expect(result.sampleCount).toBe(6);
    expect(
      result.batches.find((batch) => batch.metric === 'exercise.distance')?.samples[0]?.value
    ).toBeCloseTo(4.988954, 5);
    expect(
      result.batches.find((batch) => batch.metric === 'exercise.pace')?.samples[0]?.value
    ).toBeCloseTo(312.5, 1);
    expect(
      result.batches.find((batch) => batch.metric === 'body.weight_kg')?.samples[0]?.value
    ).toBeCloseTo(69.853168, 5);
    expect(result.batches.find((batch) => batch.metric === 'sleep.total_hours')?.samples[0]?.value).toBe(7);
  });

  it('maps Apple Health quantity/workout records into normalized metrics', () => {
    const payload = JSON.stringify({
      records: [
        {
          type: 'HKQuantityTypeIdentifierHeartRate',
          startDate: '2026-02-17T10:00:00Z',
          unit: 'count/min',
          value: '81',
        },
        {
          type: 'HKQuantityTypeIdentifierRestingHeartRate',
          startDate: '2026-02-17T10:00:00Z',
          unit: 'count/min',
          value: '54',
        },
        {
          type: 'HKWorkoutTypeIdentifier',
          startDate: '2026-02-17T08:00:00Z',
          totalDistance: 10000,
          totalEnergyBurned: 680,
          duration: '00:42:30',
          averageHeartRate: 152,
        },
      ],
    });

    const result = parseIPhoneExportPayload(payload);

    expect(result.batches.find((batch) => batch.metric === 'exercise.hr')?.samples).toEqual(
      expect.arrayContaining([
        { ts: Date.parse('2026-02-17T10:00:00Z'), value: 81 },
        { ts: Date.parse('2026-02-17T08:00:00Z'), value: 152 },
      ])
    );
    expect(result.batches.find((batch) => batch.metric === 'vitals.resting_hr')?.samples[0]?.value).toBe(54);
    expect(result.batches.find((batch) => batch.metric === 'exercise.distance')?.samples[0]?.value).toBe(10);
    expect(result.batches.find((batch) => batch.metric === 'exercise.calories')?.samples[0]?.value).toBe(680);
    expect(result.batches.find((batch) => batch.metric === 'exercise.elapsed_time')?.samples[0]?.value).toBe(2550);
  });

  it('maps blood pressure, stress, readiness, and workout load metrics', () => {
    const payload = JSON.stringify({
      records: [
        {
          type: 'HKQuantityTypeIdentifierBloodPressureSystolic',
          startDate: '2026-02-17T09:00:00Z',
          value: 118,
        },
        {
          type: 'HKQuantityTypeIdentifierBloodPressureDiastolic',
          startDate: '2026-02-17T09:00:00Z',
          value: 76,
        },
        {
          date: '2026-02-17T09:00:00Z',
          stressScore: 33,
          readinessScore: 87,
          vo2max: 52.4,
          trainingLoad: 96.2,
          perceivedEffort: 7,
        },
      ],
    });

    const result = parseIPhoneExportPayload(payload);

    expect(result.batches.find((batch) => batch.metric === 'vitals.systolic_bp')?.samples[0]?.value).toBe(118);
    expect(result.batches.find((batch) => batch.metric === 'vitals.diastolic_bp')?.samples[0]?.value).toBe(76);
    expect(result.batches.find((batch) => batch.metric === 'vitals.stress_score')?.samples[0]?.value).toBe(33);
    expect(result.batches.find((batch) => batch.metric === 'vitals.readiness')?.samples[0]?.value).toBe(87);
    expect(result.batches.find((batch) => batch.metric === 'exercise.vo2max')?.samples[0]?.value).toBe(52.4);
    expect(result.batches.find((batch) => batch.metric === 'exercise.training_load')?.samples[0]?.value).toBe(96.2);
    expect(result.batches.find((batch) => batch.metric === 'exercise.perceived_effort')?.samples[0]?.value).toBe(7);
  });

  it('aggregates Apple sleep stage segments into daily stage totals', () => {
    const payload = JSON.stringify([
      {
        type: 'HKCategoryTypeIdentifierSleepAnalysis',
        value: 'HKCategoryValueSleepAnalysisAsleepDeep',
        startDate: '2026-02-16T23:00:00Z',
        endDate: '2026-02-17T00:00:00Z',
      },
      {
        type: 'HKCategoryTypeIdentifierSleepAnalysis',
        value: 'HKCategoryValueSleepAnalysisAsleepCore',
        startDate: '2026-02-17T00:00:00Z',
        endDate: '2026-02-17T02:00:00Z',
      },
      {
        type: 'HKCategoryTypeIdentifierSleepAnalysis',
        value: 'HKCategoryValueSleepAnalysisAsleepCore',
        startDate: '2026-02-17T02:30:00Z',
        endDate: '2026-02-17T03:30:00Z',
      },
      {
        type: 'HKCategoryTypeIdentifierSleepAnalysis',
        value: 'HKCategoryValueSleepAnalysisAsleepREM',
        startDate: '2026-02-17T03:30:00Z',
        endDate: '2026-02-17T04:30:00Z',
      },
      {
        type: 'HKCategoryTypeIdentifierSleepAnalysis',
        value: 'HKCategoryValueSleepAnalysisAwake',
        startDate: '2026-02-17T04:30:00Z',
        endDate: '2026-02-17T05:00:00Z',
      },
    ]);

    const result = parseIPhoneExportPayload(payload);

    expect(result.batches.find((batch) => batch.metric === 'sleep.deep_hours')?.samples[0]?.value).toBeCloseTo(1, 5);
    expect(result.batches.find((batch) => batch.metric === 'sleep.rem_hours')?.samples[0]?.value).toBeCloseTo(1, 5);
    expect(result.batches.find((batch) => batch.metric === 'sleep.light_hours')?.samples[0]?.value).toBeCloseTo(3, 5);
    expect(result.batches.find((batch) => batch.metric === 'sleep.awake_hours')?.samples[0]?.value).toBeCloseTo(0.5, 5);
    expect(result.batches.find((batch) => batch.metric === 'sleep.total_hours')?.samples[0]?.value).toBeCloseTo(5, 5);
  });

  it('uses parent keys as metric hints for value/time arrays', () => {
    const payload = JSON.stringify({
      heartRate: [
        { time: 1739836800, value: 72 },
        { time: 1739836860, value: 73 },
      ],
      stepCount: [{ time: '2026-02-17T10:15:00Z', value: 1200 }],
    });

    const result = parseIPhoneExportPayload(payload);

    expect(result.batches.find((batch) => batch.metric === 'exercise.hr')?.samples).toEqual([
      { ts: 1739836800000, value: 72 },
      { ts: 1739836860000, value: 73 },
    ]);
    expect(result.batches.find((batch) => batch.metric === 'activity.steps')?.samples).toEqual([
      { ts: Date.parse('2026-02-17T10:15:00Z'), value: 1200 },
    ]);
  });

  it('throws a clear error for invalid JSON', () => {
    expect(() => parseIPhoneExportPayload('not json')).toThrow('Import payload must be valid JSON.');
  });
});
