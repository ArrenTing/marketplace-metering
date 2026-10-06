import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';
import { handler, type HealthReport } from '../src/health';

const ddbMock = mockClient(DynamoDBDocumentClient);
const sqsMock = mockClient(SQSClient);

async function runHealth() {
  const result = await handler();
  return { statusCode: result.statusCode, report: JSON.parse(result.body) as HealthReport };
}

beforeEach(() => {
  ddbMock.reset();
  sqsMock.reset();
});

describe('health', () => {
  test('healthy when the database reads and the DLQ is empty', async () => {
    ddbMock.on(GetCommand).resolves({});
    sqsMock.on(GetQueueAttributesCommand).resolves({
      Attributes: { ApproximateNumberOfMessages: '0' },
    });

    const { statusCode, report } = await runHealth();

    expect(statusCode).toBe(200);
    expect(report.status).toBe('healthy');
    expect(report.checks.map((check) => check.status)).toEqual(['ok', 'ok']);
  });

  test('degraded when reports are waiting in the DLQ', async () => {
    ddbMock.on(GetCommand).resolves({});
    sqsMock.on(GetQueueAttributesCommand).resolves({
      Attributes: { ApproximateNumberOfMessages: '2' },
    });

    const { statusCode, report } = await runHealth();

    expect(statusCode).toBe(200);
    expect(report.status).toBe('degraded');
    expect(report.checks[1].detail).toContain('2 report(s)');
  });

  test('down with 503 when the database read fails', async () => {
    ddbMock.on(GetCommand).rejects(new Error('ResourceNotFoundException'));
    sqsMock.on(GetQueueAttributesCommand).resolves({ Attributes: {} });

    const { statusCode, report } = await runHealth();

    expect(statusCode).toBe(503);
    expect(report.status).toBe('down');
    expect(report.checks[0]).toMatchObject({ status: 'fail', detail: 'ResourceNotFoundException' });
  });
});
