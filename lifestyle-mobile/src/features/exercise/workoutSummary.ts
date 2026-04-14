export interface StoredWorkoutMetricsInput {
  elapsedMilliseconds: number;
  distanceKm: number | null;
}

export interface StoredWorkoutMetrics {
  movingTimeSeconds: number;
  elapsedTimeSeconds: number;
  distanceMeters: number | null;
  averagePace: number | null;
}

export function buildStoredWorkoutMetrics({
  elapsedMilliseconds,
  distanceKm,
}: StoredWorkoutMetricsInput): StoredWorkoutMetrics {
  const movingTimeSeconds = Math.max(1, Math.round(elapsedMilliseconds / 1000));
  const normalizedDistanceKm =
    distanceKm !== null && Number.isFinite(distanceKm) && distanceKm > 0 ? distanceKm : null;
  const distanceMeters =
    normalizedDistanceKm !== null ? Math.round(normalizedDistanceKm * 1000) : null;
  const averagePace =
    normalizedDistanceKm !== null && movingTimeSeconds > 0
      ? Math.round((movingTimeSeconds / normalizedDistanceKm) * 10) / 10
      : null;

  return {
    movingTimeSeconds,
    elapsedTimeSeconds: movingTimeSeconds,
    distanceMeters,
    averagePace,
  };
}
