import { parseAppleHealthPayload } from '../appleHealthImport';

describe('parseAppleHealthPayload', () => {
  it('maps Apple Health daily steps into activity.steps', () => {
    const result = parseAppleHealthPayload({
      dailyStepCountSamples: [
        {
          startDate: '2026-02-18T00:00:00Z',
          endDate: '2026-02-18T23:59:00Z',
          value: '4312',
        },
      ],
    });

    expect(result.metricCount).toBe(1);
    expect(result.sampleCount).toBe(1);
    expect(result.batches[0]).toEqual({
      metric: 'activity.steps',
      samples: [
        {
          ts: Date.parse('2026-02-18T23:59:00Z'),
          value: 4312,
        },
      ],
    });
  });

  it('maps heart-rate metrics and removes duplicate samples', () => {
    const result = parseAppleHealthPayload({
      heartRateSamples: [
        {
          startDate: '2026-02-18T10:00:00Z',
          value: 78,
        },
        {
          startDate: '2026-02-18T10:00:00Z',
          value: 78,
        },
      ],
      restingHeartRateSamples: [
        {
          startDate: '2026-02-18T07:00:00Z',
          value: '54',
        },
      ],
      bloodGlucoseSamples: [
        {
          startDate: '2026-02-18T06:30:00Z',
          value: 5.7,
        },
      ],
    });

    expect(result.metricCount).toBe(3);
    expect(result.sampleCount).toBe(3);
    expect(result.batches.find((batch) => batch.metric === 'exercise.hr')?.samples).toEqual([
      { ts: Date.parse('2026-02-18T10:00:00Z'), value: 78 },
    ]);
    expect(result.batches.find((batch) => batch.metric === 'vitals.resting_hr')?.samples).toEqual([
      { ts: Date.parse('2026-02-18T07:00:00Z'), value: 54 },
    ]);
    expect(result.batches.find((batch) => batch.metric === 'vitals.glucose')?.samples).toEqual([
      { ts: Date.parse('2026-02-18T06:30:00Z'), value: 102.7 },
    ]);
  });

  it('maps distance, active energy, and exercise time into exercise metrics', () => {
    const result = parseAppleHealthPayload({
      dailyDistanceWalkingRunningSamples: [
        {
          endDate: '2026-02-18T21:00:00Z',
          value: 8123.4,
        },
      ],
      activeEnergyBurnedSamples: [
        {
          endDate: '2026-02-18T21:00:00Z',
          value: 542.8,
        },
      ],
      appleExerciseTimeSamples: [
        {
          endDate: '2026-02-18T21:00:00Z',
          value: 2711.2,
        },
      ],
    });

    expect(result.batches.find((batch) => batch.metric === 'exercise.distance')?.samples).toEqual([
      { ts: Date.parse('2026-02-18T21:00:00Z'), value: 8.123 },
    ]);
    expect(result.batches.find((batch) => batch.metric === 'exercise.calories')?.samples).toEqual([
      { ts: Date.parse('2026-02-18T21:00:00Z'), value: 542.8 },
    ]);
    expect(result.batches.find((batch) => batch.metric === 'exercise.elapsed_time')?.samples).toEqual([
      { ts: Date.parse('2026-02-18T21:00:00Z'), value: 2711 },
    ]);
  });

  it('aggregates sleep segments per day and ignores awake entries', () => {
    const result = parseAppleHealthPayload({
      sleepSamples: [
        {
          startDate: '2026-02-17T23:00:00Z',
          endDate: '2026-02-18T01:00:00Z',
          value: 'ASLEEP',
        },
        {
          startDate: '2026-02-18T01:00:00Z',
          endDate: '2026-02-18T01:30:00Z',
          value: 'AWAKE',
        },
        {
          startDate: '2026-02-18T01:30:00Z',
          endDate: '2026-02-18T03:00:00Z',
          value: 'ASLEEP',
        },
      ],
    });

    expect(result.metricCount).toBe(1);
    expect(result.sampleCount).toBe(1);
    expect(result.batches[0]).toEqual({
      metric: 'sleep.total_hours',
      samples: [
        {
          ts: Date.parse('2026-02-18T03:00:00Z'),
          value: 3.5,
        },
      ],
    });
  });

  it('maps workout samples into session imports for the workouts endpoint', () => {
    const result = parseAppleHealthPayload({
      workoutSamples: [
        {
          id: 'wk-001',
          activityName: 'Running',
          distance: 3.1,
          calories: 421.2,
          duration: 1800,
          start: '2026-02-18T06:00:00Z',
          end: '2026-02-18T06:30:00Z',
        },
        {
          activityName: 'Walking',
          distance: 1.5,
          calories: 160,
          startDate: '2026-02-18T20:00:00Z',
          endDate: '2026-02-18T20:40:00Z',
        },
      ],
    });

    expect(result.workoutCount).toBe(2);
    expect(result.workouts[0]).toMatchObject({
      sourceId: 'apple-health:wk-001',
      name: 'Running',
      sportType: 'Run',
      startTime: '2026-02-18T06:00:00.000Z',
      endTime: '2026-02-18T06:30:00.000Z',
      movingTimeSeconds: 1800,
      elapsedTimeSeconds: 1800,
      calories: 421,
      distanceMeters: 4989,
    });
    expect(result.workouts[1]).toMatchObject({
      sportType: 'Walk',
      startTime: '2026-02-18T20:00:00.000Z',
      endTime: '2026-02-18T20:40:00.000Z',
      movingTimeSeconds: 2400,
      elapsedTimeSeconds: 2400,
      calories: 160,
      distanceMeters: 2414,
    });
  });

  it('supports alternate Apple workout payload fields and meter units', () => {
    const result = parseAppleHealthPayload({
      workoutSamples: [
        {
          id: 'wk-meter',
          activityType: 'Running',
          totalDistance: 5000,
          distanceUnit: 'm',
          totalEnergyBurned: 382.9,
          startTime: '2026-02-19T06:00:00Z',
          endTime: '2026-02-19T06:28:00Z',
        },
      ],
    });

    expect(result.workoutCount).toBe(1);
    expect(result.workouts[0]).toMatchObject({
      sourceId: 'apple-health:wk-meter',
      name: 'Running',
      sportType: 'Run',
      startTime: '2026-02-19T06:00:00.000Z',
      endTime: '2026-02-19T06:28:00.000Z',
      movingTimeSeconds: 1680,
      elapsedTimeSeconds: 1680,
      calories: 383,
      distanceMeters: 5000,
    });
  });

  it('treats large raw workout distances as meters when unit is missing', () => {
    const result = parseAppleHealthPayload({
      workoutSamples: [
        {
          id: 'wk-raw-meter',
          activityName: 'Walking',
          distance: 8123,
          calories: 314,
          start: '2026-02-20T18:00:00Z',
          end: '2026-02-20T19:00:00Z',
        },
      ],
    });

    expect(result.workoutCount).toBe(1);
    expect(result.workouts[0]).toMatchObject({
      sourceId: 'apple-health:wk-raw-meter',
      sportType: 'Walk',
      distanceMeters: 8123,
      calories: 314,
      movingTimeSeconds: 3600,
      elapsedTimeSeconds: 3600,
    });
  });
});
