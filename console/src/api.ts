import type { BusEvent, HealthReport, UsageInput, UsageRecord } from './types';

export type ApiResult = {
  ok: boolean;
  status: number;
  body: unknown;
  method: string;
  path: string;
  latencyMs: number;
  at: Date;
};

// Same-origin path; the Vite dev server proxies /api to API Gateway and
// attaches the API key (see vite.config.ts).
const API_BASE = '/api';

async function request(path: string, init: RequestInit): Promise<ApiResult> {
  const method = init.method ?? 'GET';
  const at = new Date();
  const started = performance.now();
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json' },
    });
    const text = await response.text();
    let body: unknown = text;
    if (text) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = text;
      }
    }
    return {
      ok: response.ok,
      status: response.status,
      body,
      method,
      path,
      latencyMs: Math.round(performance.now() - started),
      at,
    };
  } catch (error) {
    // Network failure: no HTTP status at all. Reported as status 0.
    return {
      ok: false,
      status: 0,
      body: { message: error instanceof Error ? error.message : 'Request failed' },
      method,
      path,
      latencyMs: Math.round(performance.now() - started),
      at,
    };
  }
}

export function postUsage(input: UsageInput): Promise<ApiResult> {
  return request('/usage', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getUsage(customerId: string): Promise<ApiResult> {
  return request(`/customers/${encodeURIComponent(customerId)}/usage`, {
    method: 'GET',
  });
}

export function getEvents(): Promise<ApiResult> {
  return request('/events', { method: 'GET' });
}

export function getHealth(): Promise<ApiResult> {
  return request('/health', { method: 'GET' });
}

function hasItemsArray(body: unknown): body is { items: unknown[] } {
  if (typeof body !== 'object' || body === null || !('items' in body)) {
    return false;
  }
  return Array.isArray(body.items);
}

export function isUsageList(body: unknown): body is { items: UsageRecord[] } {
  return hasItemsArray(body);
}

export function isEventList(body: unknown): body is { items: BusEvent[] } {
  return hasItemsArray(body);
}

export function isHealthReport(body: unknown): body is HealthReport {
  return (
    typeof body === 'object' &&
    body !== null &&
    'status' in body &&
    'checks' in body &&
    Array.isArray(body.checks)
  );
}
