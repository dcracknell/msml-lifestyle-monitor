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
  getTrackingElapsedMs,
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

  it('ignores low-confidence GPS points so they do not inflate run distance', () => {
    const startedAt = 1_700_000_000_000;
    let snapshot = createExerciseTrackingSnapshot({
      sportId: 'run',
      startedAt,
      workoutSourceId: 'exercise:run:test-gps-accuracy',
    });

    snapshot = applyLocationPointToTrackingSnapshot(snapshot, buildPoint(0, startedAt));
    snapshot = applyLocationPointToTrackingSnapshot(snapshot, buildPoint(100, startedAt + 30_000));

    snapshot = applyLocationPointToTrackingSnapshot(snapshot, {
      ...buildPoint(250, startedAt + 60_000),
      accuracy: 180,
    });

    expect(getTrackingDistanceKm(snapshot)).toBeCloseTo(0.1, 2);
    expect(snapshot.routePoints).toHaveLength(2);
    expect(snapshot.gpsAccuracyMeters).toBe(180);

    snapshot = applyLocationPointToTrackingSnapshot(snapshot, buildPoint(200, startedAt + 90_000));

    expect(getTrackingDistanceKm(snapshot)).toBeCloseTo(0.2, 2);
    expect(snapshot.routePoints).toHaveLength(3);
    expect(snapshot.phonePaceSeconds).toBeCloseTo(450, 0);
  });

  it('keeps delayed background points when the implied movement is still plausible', () => {
    const startedAt = 1_700_000_000_000;
    let snapshot = createExerciseTrackingSnapshot({
      sportId: 'run',
      startedAt,
      workoutSourceId: 'exercise:run:test-delayed-background-point',
    });

    snapshot = applyLocationPointToTrackingSnapshot(snapshot, buildPoint(0, startedAt));
    snapshot = applyLocationPointToTrackingSnapshot(snapshot, buildPoint(100, startedAt + 30_000));

    snapshot = applyLocationPointToTrackingSnapshot(snapshot, buildPoint(700, startedAt + 210_000));

    expect(getTrackingDistanceKm(snapshot)).toBeCloseTo(0.7, 2);
    expect(snapshot.routePoints).toHaveLength(3);
    expect(snapshot.phonePaceSeconds).toBeCloseTo(300, 0);
    expect(snapshot.kmSplits).toHaveLength(0);
  });

  it('background auto-pause does not reduce elapsed time seen by the live timer', () => {
    // Simulate: user starts a run, locks the phone. While locked, GPS drifts and the
    // background task records an auto-pause, reducing elapsedBeforePauseMs in storage.
    // When the app returns to foreground, the live refs (elapsedBeforePauseRef +
    // sessionStartRef) represent more elapsed time than the stored snapshot. The merge
    // logic in restorePersistedTrackingSnapshot must preserve live elapsed accounting.

    const T0 = 1_700_000_000_000;

    // Foreground session ran for 10 minutes before locking (100 m steps, within filter limits)
    let snapshot = createExerciseTrackingSnapshot({
      sportId: 'run',
      startedAt: T0,
      workoutSourceId: 'exercise:run:test-bg',
    });
    for (let i = 0; i <= 10; i += 1) {
      snapshot = applyLocationPointToTrackingSnapshot(snapshot, buildPoint(i * 100, T0 + i * 60_000));
    }

    // At lock time the live timer had 10 minutes on it
    const liveElapsedBeforePause = 10 * 60_000;
    const liveSessionStart = T0 + 10 * 60_000;

    // Background task runs while locked; GPS drift causes auto-pause at 11 min mark.
    // The stored snapshot now thinks elapsed = 11 minutes but status=recording,isAutoPaused=true,
    // sessionStartTs=null — getTrackingElapsedMs returns only elapsedBeforePauseMs.
    const bgSnapshot: ExerciseTrackingSnapshot = {
      ...snapshot,
      isAutoPaused: true,
      sessionStartTs: null,
      elapsedBeforePauseMs: 11 * 60_000, // background "helpfully" added 1 min
      updatedAt: T0 + 11 * 60_000,
    };

    // The merge logic: liveElapsedMs = liveElapsedBeforePause + (now - liveSessionStart)
    // Simulate "now" = T0 + 12 min (2 minutes have passed since lock)
    const now = T0 + 12 * 60_000;
    const liveElapsedMs = liveElapsedBeforePause + (now - liveSessionStart);
    // liveElapsedMs = 10min + 2min = 12 min
    const storedElapsedMs = getTrackingElapsedMs(bgSnapshot);
    // storedElapsedMs = 11 min (auto-paused, no running clock)

    expect(liveElapsedMs).toBe(12 * 60_000);
    expect(storedElapsedMs).toBe(11 * 60_000);
    expect(liveElapsedMs).toBeGreaterThan(storedElapsedMs);

    // Apply the merge (mirrors the logic in restorePersistedTrackingSnapshot)
    const merged: ExerciseTrackingSnapshot = {
      ...bgSnapshot,
      elapsedBeforePauseMs: liveElapsedBeforePause,
      sessionStartTs: liveSessionStart,
      isAutoPaused: false,
      stationarySinceTs: null,
    };

    // Merged elapsed must equal liveElapsedMs, not the reduced stored value
    expect(getTrackingElapsedMs(merged, now)).toBe(12 * 60_000);
    // Distance from background must still be present
    expect(getTrackingDistanceKm(merged)).toBeCloseTo(1.0, 1);
  });

  it('counts a legitimate delayed background GPS point that exceeds the fixed per-point cap', () => {
    // When the OS batches background GPS updates, a single delivery can represent
    // 60–120 s of movement. At ~14 km/h that is ~350 m — above the old 300 m hard
    // cap but well within the speed limit. The time-aware cap must accept it.
    const startedAt = 1_700_000_000_000;
    let snapshot = createExerciseTrackingSnapshot({
      sportId: 'run',
      startedAt,
      workoutSourceId: 'exercise:run:test-delayed-bg-point',
    });

    snapshot = applyLocationPointToTrackingSnapshot(snapshot, buildPoint(0, startedAt));
    snapshot = applyLocationPointToTrackingSnapshot(snapshot, buildPoint(100, startedAt + 30_000));

    // 350 m in 90 s ≈ 3.9 m/s (≈ 14 km/h) — valid movement, OS-delayed delivery.
    // Old code: 350 > 300 fixed cap → dropped. New code: speed ≤ 40 m/s → accepted.
    snapshot = applyLocationPointToTrackingSnapshot(snapshot, buildPoint(450, startedAt + 120_000));

    expect(getTrackingDistanceKm(snapshot)).toBeCloseTo(0.45, 2);
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
