// All usage hours are UTC, so format in UTC rather than the viewer's zone.
export function utcDate(iso: string): string {
  return iso.slice(0, 10);
}

export function utcTime(iso: string): string {
  return iso.slice(11, 16);
}

export function utcHour(iso: string): string {
  return `${utcDate(iso)} ${utcTime(iso)} UTC`;
}

export function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

export function timeAgo(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (Number.isNaN(seconds)) {
    return '';
  }
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ago`;
}

export const DIMENSION_LABEL: Record<string, { name: string; unit: string }> = {
  api_calls: { name: 'API calls', unit: 'calls' },
  gb_stored: { name: 'GB stored', unit: 'GB' },
};
