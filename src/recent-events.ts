import {
  CloudWatchLogsClient,
  FilterLogEventsCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import type { APIGatewayProxyResult } from 'aws-lambda';

const logs = new CloudWatchLogsClient({});
const logGroupName = process.env.EVENT_LOG_GROUP_NAME;
const WINDOW_MS = 30 * 60 * 1000;
const MAX_EVENTS = 50;

export type BusEvent = {
  id: string;
  time: string;
  detailType: string;
  detail: unknown;
};

// The debug rule writes every bus event to a log group as its raw JSON, so
// reading the log group back is a cheap way to show the console what flowed.
export async function handler(): Promise<APIGatewayProxyResult> {
  const result = await logs.send(
    new FilterLogEventsCommand({
      logGroupName,
      startTime: Date.now() - WINDOW_MS,
    }),
  );

  // Event `time` only has second precision, so order by the log timestamp.
  const items = [...(result.events ?? [])]
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
    .map((entry) => parseBusEvent(entry.message))
    .filter((item): item is BusEvent => item !== null)
    .slice(0, MAX_EVENTS);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': 'http://localhost:5173',
    },
    body: JSON.stringify({ items }),
  };
}

export function parseBusEvent(message: string | undefined): BusEvent | null {
  if (!message) {
    return null;
  }
  try {
    const event = JSON.parse(message) as Record<string, unknown>;
    if (typeof event.id !== 'string' || typeof event['detail-type'] !== 'string') {
      return null;
    }
    return {
      id: event.id,
      time: String(event.time ?? ''),
      detailType: event['detail-type'],
      detail: event.detail,
    };
  } catch {
    return null;
  }
}
