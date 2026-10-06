import type { Dimension, UsageInput } from './types';

export const DEPARTMENTS = ['engineering', 'marketing', 'finance'] as const;
const DIMENSIONS: readonly Dimension[] = ['api_calls', 'gb_stored'];

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

const HOUR_MS = 60 * 60 * 1000;
// Spread over the last 30 days rather than "this month": early in a month
// there are only a few days of hours, so repeat batches would keep landing on
// hours that already exist and come back as 409 conflicts.
const SPREAD_HOURS = 30 * 24;

export function buildFakeBatch(now = new Date(), count = 10): UsageInput[] {
  const currentHour = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
  const used = new Set<string>();
  const records: UsageInput[] = [];

  while (records.length < count) {
    const customerId = DEPARTMENTS[randomInt(0, DEPARTMENTS.length - 1)];
    const dimension = DIMENSIONS[randomInt(0, DIMENSIONS.length - 1)];
    if (!customerId || !dimension) {
      continue;
    }
    const hoursAgo = randomInt(0, SPREAD_HOURS - 1);
    const timestamp = new Date(currentHour - hoursAgo * HOUR_MS).toISOString();
    const key = `${customerId}|${dimension}|${timestamp}`;
    if (used.has(key)) {
      continue;
    }
    used.add(key);
    records.push({
      customerId,
      dimension,
      timestamp,
      quantity: dimension === 'api_calls' ? randomInt(100, 5000) : randomInt(1, 80),
    });
  }

  return records;
}
