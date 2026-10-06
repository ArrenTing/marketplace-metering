export const DIMENSIONS = ['api_calls', 'gb_stored'] as const;

export type Dimension = (typeof DIMENSIONS)[number];

export type UsageInput = {
  customerId: string;
  dimension: Dimension;
  timestamp: string;
  quantity: number;
};

export type UsageRecord = {
  customerId: string;
  dimension: string;
  quantity: number;
  hour: string;
  status: string;
};

export type BusEvent = {
  id: string;
  time: string;
  detailType: string;
  detail: unknown;
};

export type HealthCheck = {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
  latencyMs: number;
};

export type HealthReport = {
  status: 'healthy' | 'degraded' | 'down';
  region: string;
  checkedAt: string;
  checks: HealthCheck[];
};
