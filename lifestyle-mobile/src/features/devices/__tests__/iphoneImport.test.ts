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
