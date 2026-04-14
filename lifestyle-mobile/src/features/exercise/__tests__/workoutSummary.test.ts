import { buildStoredWorkoutMetrics } from '../workoutSummary';

describe('buildStoredWorkoutMetrics', () => {
  it('derives stored pace from total distance and moving time', () => {
    expect(
      buildStoredWorkoutMetrics({
        elapsedMilliseconds: 25 * 60 * 1000,
        distanceKm: 5,
      })
    ).toEqual({
      movingTimeSeconds: 1500,
      elapsedTimeSeconds: 1500,
      distanceMeters: 5000,
      averagePace: 300,
    });
  });

  it('returns no stored pace when distance is unavailable', () => {
    expect(
      buildStoredWorkoutMetrics({
        elapsedMilliseconds: 12 * 60 * 1000,
        distanceKm: null,
      })
    ).toEqual({
      movingTimeSeconds: 720,
      elapsedTimeSeconds: 720,
      distanceMeters: null,
      averagePace: null,
    });
  });
});
