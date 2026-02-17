import dayjs from 'dayjs';

export function formatNumber(value: number | null | undefined, options: { suffix?: string; prefix?: string } = {}) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '--';
  }
  const formatted = Math.round(value).toLocaleString();
  return `${options.prefix || ''}${formatted}${options.suffix || ''}`;
}

export function formatDecimal(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '--';
  }
  return Number(value).toFixed(digits);
}

export function formatDistance(meters?: number | null) {
  if (!meters && meters !== 0) return '--';
  const km = meters / 1000;
  return `${km.toFixed(1)} km`;
}

export function formatMinutes(seconds?: number | null) {
  if (!seconds && seconds !== 0) return '--';
  const minutes = Math.round(seconds / 60);
  return `${minutes} min`;
}

export function formatPace(seconds?: number | null) {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) {
    return '--';
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${mins}:${secs} /km`;
}

export function formatDate(iso?: string | null, fmt = 'MMM D') {
  if (!iso) return '--';
  return dayjs(iso).format(fmt);
}

export function formatDateTime(iso?: string | null, fmt = 'MMM D, HH:mm') {
  if (!iso) return '--';
  return dayjs(iso).format(fmt);
}

export function titleCase(value: string) {
  return value
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}
