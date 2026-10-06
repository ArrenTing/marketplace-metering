import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import type { StoredUsage } from './usage-events.js';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const tableName = process.env.TABLE_NAME;
// Stand-in for the marketplace throttling us. A failed message goes back on
// the queue, is retried after the visibility timeout, and lands in the DLQ
// after maxReceiveCount attempts.
const failureRate = Number(process.env.REPORT_FAILURE_RATE ?? '0');

// The queue is fed by an EventBridge rule, so each body is the full event
// envelope; the usage record is in `detail`.
type UsageRecordedMessage = {
  'detail-type': string;
  detail: StoredUsage;
};

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const failures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    try {
      const message = JSON.parse(record.body) as UsageRecordedMessage;
      await reportUsage(message.detail);
    } catch (error) {
      console.error('report failed', {
        messageId: record.messageId,
        attempt: record.attributes.ApproximateReceiveCount,
        error: error instanceof Error ? error.message : String(error),
      });
      failures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures: failures };
}

async function reportUsage(usage: StoredUsage): Promise<void> {
  if (!usage?.customerId || !usage.dimension || !usage.hour) {
    throw new Error('Message is missing customerId, dimension or hour');
  }
  if (Math.random() < failureRate) {
    throw new Error('Simulated marketplace throttling');
  }

  try {
    await dynamo.send(
      new UpdateCommand({
        TableName: tableName,
        Key: {
          PK: `CUST#${usage.customerId}`,
          SK: `USAGE#${usage.dimension}#${usage.hour}`,
        },
        UpdateExpression: 'SET #status = :reported, reportedAt = :now',
        // Only flip RECORDED -> REPORTED. A redelivered message finds the row
        // already REPORTED, fails the condition, and is treated as success.
        ConditionExpression: '#status = :recorded',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':reported': 'REPORTED',
          ':recorded': 'RECORDED',
          ':now': new Date().toISOString(),
        },
      }),
    );
  } catch (error) {
    if (!isConditionalCheckFailed(error)) {
      throw error;
    }
  }
}

function isConditionalCheckFailed(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name: string }).name === 'ConditionalCheckFailedException'
  );
}
