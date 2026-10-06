import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import type { DynamoDBStreamEvent } from 'aws-lambda';
import { handler } from '../src/publish-events';

const eventsMock = mockClient(EventBridgeClient);

const recordedImage = {
  customerId: { S: 'cust-acme' },
  dimension: { S: 'api_calls' },
  quantity: { N: '1200' },
  hour: { S: '2026-09-01T10:00:00.000Z' },
  status: { S: 'RECORDED' },
};

function streamEvent(
  records: DynamoDBStreamEvent['Records'],
): DynamoDBStreamEvent {
  return { Records: records };
}

beforeEach(() => {
  eventsMock.reset();
});

describe('publish-events', () => {
  test('publishes UsageRecorded for an INSERT and skips a REMOVE', async () => {
    eventsMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{}] });

    const result = await handler(
      streamEvent([
        {
          eventID: 'insert-1',
          eventName: 'INSERT',
          dynamodb: { NewImage: recordedImage },
        },
        {
          eventID: 'remove-1',
          eventName: 'REMOVE',
          dynamodb: { OldImage: recordedImage },
        },
      ]),
    );

    expect(result.batchItemFailures).toEqual([]);
    expect(eventsMock).toHaveReceivedCommandWith(PutEventsCommand, {
      Entries: [
        expect.objectContaining({
          EventBusName: 'UsageBus',
          Source: 'marketplace.metering',
          DetailType: 'UsageRecorded',
          Detail: JSON.stringify({
            customerId: 'cust-acme',
            dimension: 'api_calls',
            quantity: 1200,
            hour: '2026-09-01T10:00:00.000Z',
            status: 'RECORDED',
          }),
        }),
      ],
    });
  });

  test('returns the stream event id when PutEvents rejects that entry', async () => {
    eventsMock.on(PutEventsCommand).resolves({
      FailedEntryCount: 1,
      Entries: [{ ErrorCode: 'InternalFailure', ErrorMessage: 'boom' }],
    });

    const result = await handler(
      streamEvent([
        {
          eventID: 'insert-1',
          eventName: 'INSERT',
          dynamodb: { NewImage: recordedImage },
        },
      ]),
    );

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'insert-1' }]);
  });
});
