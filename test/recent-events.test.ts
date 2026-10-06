import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import {
  CloudWatchLogsClient,
  FilterLogEventsCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import { handler, parseBusEvent } from '../src/recent-events';

const logsMock = mockClient(CloudWatchLogsClient);

function busEventMessage(id: string, detailType: string): string {
  return JSON.stringify({
    id,
    time: '2026-09-01T10:00:00Z',
    source: 'marketplace.metering',
    'detail-type': detailType,
    detail: { customerId: 'cust-acme' },
  });
}

beforeEach(() => {
  logsMock.reset();
});

describe('recent-events', () => {
  test('returns bus events newest first and skips unparseable lines', async () => {
    logsMock.on(FilterLogEventsCommand).resolves({
      events: [
        { timestamp: 1, message: busEventMessage('older', 'UsageRecorded') },
        { timestamp: 3, message: 'not json' },
        { timestamp: 2, message: busEventMessage('newer', 'UsageReported') },
      ],
    });

    const result = await handler();
    const body = JSON.parse(result.body) as { items: { id: string }[] };

    expect(result.statusCode).toBe(200);
    expect(result.headers?.['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
    expect(body.items.map((item) => item.id)).toEqual(['newer', 'older']);
    expect(logsMock).toHaveReceivedCommandWith(FilterLogEventsCommand, {
      logGroupName: 'UsageBusDebugLogGroup',
    });
  });

  test('parseBusEvent maps detail-type and rejects non-events', () => {
    expect(parseBusEvent(busEventMessage('e1', 'UsageRecorded'))).toEqual({
      id: 'e1',
      time: '2026-09-01T10:00:00Z',
      detailType: 'UsageRecorded',
      detail: { customerId: 'cust-acme' },
    });
    expect(parseBusEvent('{"hello":"world"}')).toBeNull();
    expect(parseBusEvent(undefined)).toBeNull();
  });
});
