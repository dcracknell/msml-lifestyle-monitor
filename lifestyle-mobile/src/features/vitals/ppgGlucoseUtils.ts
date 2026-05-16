import type { PpgPredictionPayload, PpgStatusResponse } from '../../api/types';
import { colors } from '../../theme';

export const PPG_ZONE_ORDER = ['low', 'elevated', 'hyper'] as const;
type PpgZoneKey = (typeof PPG_ZONE_ORDER)[number];

const PPG_ZONE_META: Record<PpgZoneKey | 'muted', { label: string; rangeLabel: string; color: string }> = {
  low: {
    label: 'Low',
    rangeLabel: '0-140 mg/dL',
    color: colors.success,
  },
  elevated: {
    label: 'Elevated',
    rangeLabel: '141-180 mg/dL',
    color: colors.warning,
  },
  hyper: {
    label: 'Hyper',
    rangeLabel: '>180 mg/dL',
    color: colors.danger,
  },
  muted: {
    label: 'Unknown',
    rangeLabel: 'Range unavailable',
    color: colors.muted,
  },
} as const;

export interface PpgProbabilityEntry {
  key: string;
  label: string;
  rangeLabel: string;
  value: number;
  isPredicted: boolean;
  color: string;
}

export function formatPpgZoneLabel(value: string | null | undefined) {
  const normalized = normalizeZoneKey(value);
  if (normalized) {
    return PPG_ZONE_META[normalized].label;
  }
  if (!value) {
    return 'Unknown';
  }
  return value
    .trim()
    .split(/[\s_-]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function getPpgZoneRangeLabel(value: string | null | undefined) {
  const normalized = normalizeZoneKey(value);
  return normalized ? PPG_ZONE_META[normalized].rangeLabel : PPG_ZONE_META.muted.rangeLabel;
}

export function formatPpgPercent(value: number | null | undefined) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${Math.round(numeric * 100)}%` : '--';
}

export function buildPpgProbabilityEntries(prediction: PpgPredictionPayload | null | undefined) {
  const probabilities = prediction?.prediction?.probabilities || {};
  const predictedLabel = normalizeZoneKey(prediction?.prediction?.label);
  const orderedKeys = [
    ...PPG_ZONE_ORDER,
    ...Object.keys(probabilities).filter((key) => {
      const normalized = normalizeZoneKey(key);
      return !normalized || !PPG_ZONE_ORDER.includes(normalized);
    }),
  ];

  return orderedKeys
    .map((key) => {
      const numeric = Number(probabilities[key]);
      if (!Number.isFinite(numeric)) {
        return null;
      }
      const normalizedKey = normalizeZoneKey(key);
      const meta = normalizedKey ? PPG_ZONE_META[normalizedKey] : PPG_ZONE_META.muted;
      return {
        key,
        label: meta.label,
        rangeLabel: meta.rangeLabel,
        value: numeric,
        isPredicted: normalizedKey === predictedLabel,
        color: meta.color,
      } satisfies PpgProbabilityEntry;
    })
    .filter((entry): entry is PpgProbabilityEntry => Boolean(entry));
}

export function getPpgBlockingMessage(status: PpgStatusResponse | null | undefined) {
  if (status?.runtime?.ready === false) {
    return status.runtime.message;
  }
  if (status?.bundle?.ready === false) {
    return status.bundle.message;
  }
  return '';
}

export function canRunPpgDemo(status: PpgStatusResponse | null | undefined) {
  return Boolean(status) && !getPpgBlockingMessage(status) && status?.demoInput?.ready !== false;
}

export function canRunPpgLive(status: PpgStatusResponse | null | undefined) {
  return (
    Boolean(status) &&
    !getPpgBlockingMessage(status) &&
    status?.profile?.ready === true &&
    status?.liveInput?.ready === true
  );
}

export function getPpgIdleMessage(status: PpgStatusResponse | null | undefined) {
  const blocking = getPpgBlockingMessage(status);
  if (blocking) {
    return blocking;
  }
  if (status?.profile?.ready === false) {
    return status.profile.message;
  }
  if (status?.liveInput?.ready === true) {
    return 'No inference run yet. Run the latest PPG window or the bundled demo.';
  }
  return (
    status?.liveInput?.message ||
    'No inference run yet. Stream a 15-minute ppg.raw window or run the bundled demo.'
  );
}

export function getPpgRunModeLabel(mode: string | null | undefined, isDemo?: boolean | null) {
  if (mode === 'demo' || isDemo) {
    return 'demo';
  }
  return 'live';
}

function normalizeZoneKey(value: string | null | undefined) {
  const normalized = String(value || '').trim().toLowerCase();
  if (PPG_ZONE_ORDER.includes(normalized as PpgZoneKey)) {
    return normalized as PpgZoneKey;
  }
  return null;
}
