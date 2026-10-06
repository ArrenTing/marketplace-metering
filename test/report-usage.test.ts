import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { SQSEvent, SQSRecord } from 'aws-lambda';
import { handler } from '../src/report-usage';

const ddbMock = mockClient(DynamoDBDocumentClient);

const detail = {
  customerId: 'cust-acme',
  dimension: 'api_calls',
  quantity: 1200,
  hour: '2026-09-01T10:00:00.000Z',
  status: 'RECORDED',
};

function sqsRecord(messageId: string, body: unknown): SQSRecord {
  return {
    messageId,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    attributes: { ApproximateReceiveCount: '1' },
  } as SQSRecord;
}

function sqsEvent(records: SQSRecord[]): SQSEvent {
  return { Records: records };
}

const usageRecordedEnvelope = {
  source: 'marketplace.metering',
  'detail-type': 'UsageRecorded',
  detail,
};

beforeEach(() => {
  ddbMock.reset();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('report-usage', () => {
  test('marks the record REPORTED only if it is still RECORDED', async () => {
    ddbMock.on(UpdateCommand).resolves({});

    const result = await handler(sqsEvent([sqsRecord('m1', usageRecordedEnvelope)]));

    expect(result.batchItemFailures).toEqual([]);
    expect(ddbMock).toHaveReceivedCommandWith(UpdateCommand, {
      TableName: 'UsageTable',
      Key: {
        PK: 'CUST#cust-acme',
        SK: 'USAGE#api_calls#2026-09-01T10:00:00.000Z',
      },
      ConditionExpression: '#status = :recorded',
      ExpressionAttributeValues: expect.objectContaining({
        ':reported': 'REPORTED',
        ':recorded': 'RECORDED',
      }),
    });
  });

  test('treats an already REPORTED record as success (redelivery)', async () => {
    ddbMock.on(UpdateCommand).rejects(
      Object.assign(new Error('condition failed'), {
        name: 'ConditionalCheckFailedException',
      }),
    );

    const result = await handler(sqsEvent([sqsRecord('m1', usageRecordedEnvelope)]));

    expect(result.batchItemFailures).toEqual([]);
  });

  test('reports only the failed messages so the rest of the batch is deleted', async () => {
    ddbMock
      .on(UpdateCommand)
      .resolvesOnce({})
      .rejectsOnce(new Error('throttled'));

    const result = await handler(
      sqsEvent([
        sqsRecord('ok', usageRecordedEnvelope),
        sqsRecord('fails', usageRecordedEnvelope),
        sqsRecord('bad-json', 'not json'),
      ]),
    );

    expect(result.batchItemFailures).toEqual([
      { itemIdentifier: 'fails' },
      { itemIdentifier: 'bad-json' },
    ]);
  });
});
