jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

import {
  applyLocationPointToTrackingSnapshot,
  createExerciseTrackingSnapshot,
  type ExerciseTrackingSnapshot,
  getTrackingDistanceKm,
  pauseExerciseTrackingSnapshot,
  resumeExerciseTrackingSnapshot,
} from '../trackingState';

function buildPoint(distanceMeters: number, timestamp: number) {
  return {
    latitude: 51.5 + distanceMeters / 111111,
    longitude: -0.12,
    timestamp,
    altitude: 20,
    accuracy: 5,
    speed: null,
  };
}

describe('trackingState', () => {
  it('accumulates a 10k run across many valid GPS points', () => {
    let snapshot = createExerciseTrackingSnapshot({
      sportId: 'run',
      startedAt: 1_700_000_000_000,
      workoutSourceId: 'exercise:run:test-10k',
    });

    for (let index = 0; index <= 100; index += 1) {
      snapshot = applyLocationPointToTrackingSnapshot(
        snapshot,
        buildPoint(index * 100, snapshot.startedAt + index * 30_000)
      );
    }

    expect(getTrackingDistanceKm(snapshot)).toBeCloseTo(10, 1);
    expect(snapshot.phonePaceSeconds).toBeCloseTo(300, 0);
    expect(snapshot.kmSplits).toHaveLength(10);
    expect(snapshot.kmSplits[0]).toEqual({ km: 1, paceSeconds: 300 });
    expect(snapshot.kmSplits[9]).toEqual({ km: 10, paceSeconds: 300 });
  });

  it('auto-pauses on stationary points and resumes without losing the run', () => {
    let snapshot = createExerciseTrackingSnapshot({
      sportId: 'run',
      startedAt: 1_700_000_000_000,
      workoutSourceId: 'exercise:run:test-auto-pause',
    });

    snapshot = applyLocationPointToTrackingSnapshot(snapshot, buildPoint(0, snapshot.startedAt));
    snapshot = applyLocationPointToTrackingSnapshot(snapshot, buildPoint(100, snapshot.startedAt + 30_000));

    snapshot = applyLocationPointToTrackingSnapshot(snapshot, buildPoint(100, snapshot.startedAt + 31_000));
    snapshot = applyLocationPointToTrackingSnapshot(snapshot, buildPoint(100, snapshot.startedAt + 35_000));
    expect(snapshot.isAutoPaused).toBe(true);
    expect(getTrackingDistanceKm(snapshot)).toBeCloseTo(0.1, 2);

    snapshot = applyLocationPointToTrackingSnapshot(snapshot, buildPoint(200, snapshot.startedAt + 65_000));
    expect(snapshot.isAutoPaused).toBe(false);
    expect(getTrackingDistanceKm(snapshot)).toBeCloseTo(0.2, 2);
  });

  it('does not count travel that happens while a manual pause is active', () => {
    let snapshot = createExerciseTrackingSnapshot({
      sportId: 'run',
      startedAt: 1_700_000_000_000,
      workoutSourceId: 'exercise:run:test-manual-pause',
    });

    snapshot = applyLocationPointToTrackingSnapshot(snapshot, buildPoint(0, snapshot.startedAt));
    snapshot = applyLocationPointToTrackingSnapshot(snapshot, buildPoint(100, snapshot.startedAt + 30_000));

    const paused = pauseExerciseTrackingSnapshot(snapshot, snapshot.startedAt + 35_000);
    const resumed = resumeExerciseTrackingSnapshot(paused, snapshot.startedAt + 95_000);
    expect(resumed).not.toBeNull();

    let resumedSnapshot: ExerciseTrackingSnapshot = resumed!;
    resumedSnapshot = applyLocationPointToTrackingSnapshot(
      resumedSnapshot,
      buildPoint(300, snapshot.startedAt + 100_000)
    );
    expect(getTrackingDistanceKm(resumedSnapshot)).toBeCloseTo(0.1, 2);

    resumedSnapshot = applyLocationPointToTrackingSnapshot(
      resumedSnapshot,
      buildPoint(400, snapshot.startedAt + 130_000)
    );
    expect(getTrackingDistanceKm(resumedSnapshot)).toBeCloseTo(0.2, 2);
  });
});
