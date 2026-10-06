import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type {
  DynamoDBBatchResponse,
  DynamoDBRecord,
  DynamoDBStreamEvent,
} from 'aws-lambda';
import {
  toUsageEvent,
  type StoredUsage,
} from './usage-events.js';

const events = new EventBridgeClient({});
const busName = process.env.EVENT_BUS_NAME;

export async function handler(
  event: DynamoDBStreamEvent,
): Promise<DynamoDBBatchResponse> {
  const failures: { itemIdentifier: string }[] = [];
  const pending: { eventId: string; entry: PutEventsEntry }[] = [];

  for (const record of event.Records) {
    const eventId = record.eventID;
    if (!eventId) {
      continue;
    }
    const change = toUsageEvent(
      record.eventName ?? '',
      readImage(record.dynamodb?.NewImage),
      readImage(record.dynamodb?.OldImage),
    );
    if (!change) {
      continue;
    }
    pending.push({
      eventId,
      entry: {
        EventBusName: busName,
        Source: change.source,
        DetailType: change.detailType,
        Detail: JSON.stringify(change.detail),
      },
    });
  }

  if (pending.length > 0) {
    const result = await events.send(
      new PutEventsCommand({
        Entries: pending.map((item) => item.entry),
      }),
    );
    result.Entries?.forEach((entry, index) => {
      if (entry.ErrorCode) {
        failures.push({ itemIdentifier: pending[index].eventId });
      }
    });
  }

  return { batchItemFailures: failures };
}

type StreamImage = NonNullable<
  NonNullable<DynamoDBRecord['dynamodb']>['NewImage']
>;

type PutEventsEntry = {
  EventBusName?: string;
  Source: string;
  DetailType: string;
  Detail: string;
};

function readImage(image: StreamImage | undefined): StoredUsage | null {
  if (!image) {
    return null;
  }
  const item = unmarshall(image as Record<string, AttributeValue>);
  return {
    customerId: String(item.customerId ?? ''),
    dimension: String(item.dimension ?? ''),
    quantity: Number(item.quantity),
    hour: String(item.hour ?? ''),
    status: String(item.status ?? ''),
  };
}
