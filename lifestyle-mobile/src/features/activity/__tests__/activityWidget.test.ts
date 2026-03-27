jest.mock('react-native', () => ({
  Platform: {
    OS: 'ios',
  },
}));

import { createActivityProgressWidgetSnapshot } from '../activityWidget';

describe('createActivityProgressWidgetSnapshot', () => {
  it('builds progress and summary labels from weekly activity totals', () => {
    const snapshot = createActivityProgressWidgetSnapshot({
      athleteName: 'Dylan',
      weeklyDistanceKm: 12.4,
      weeklyDurationMin: 96,
      goalDistanceKm: 20,
      goalDurationMin: 120,
      weeklyTrainingLoad: 245,
      statusLabel: 'On track',
    });

    expect(snapshot.athleteName).toBe('Dylan');
    expect(snapshot.distancePercent).toBe(62);
    expect(snapshot.durationPercent).toBe(80);
    expect(snapshot.overallPercent).toBe(71);
    expect(snapshot.distanceSummary).toBe('12.4/20 km');
    expect(snapshot.durationSummary).toBe('96/120 min');
    expect(snapshot.trainingLoadSummary).toBe('245 pts');
  });

  it('falls back to safe defaults when data is missing', () => {
    const snapshot = createActivityProgressWidgetSnapshot({
      weeklyDistanceKm: null,
      weeklyDurationMin: undefined,
      goalDistanceKm: 0,
      goalDurationMin: 0,
      weeklyTrainingLoad: null,
      statusLabel: 'No data',
    });

    expect(snapshot.athleteName).toBe('Weekly activity');
    expect(snapshot.overallPercent).toBe(0);
    expect(snapshot.distanceSummary).toBe('0/1 km');
    expect(snapshot.durationSummary).toBe('0/1 min');
    expect(snapshot.trainingLoadSummary).toBe('0 pts');
  });
});
