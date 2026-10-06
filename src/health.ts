import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { APIGatewayProxyResult } from 'aws-lambda';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sqs = new SQSClient({});
const tableName = process.env.TABLE_NAME;
const dlqUrl = process.env.DLQ_URL;

export type CheckStatus = 'ok' | 'warn' | 'fail';

export type HealthCheck = {
  name: string;
  status: CheckStatus;
  detail: string;
  latencyMs: number;
};

export type HealthReport = {
  status: 'healthy' | 'degraded' | 'down';
  region: string;
  checkedAt: string;
  checks: HealthCheck[];
};

// Reaching this Lambda already proves API Gateway, the API key and Lambda are
// up. These checks cover what the request path depends on beyond that.
export async function handler(): Promise<APIGatewayProxyResult> {
  const checks = await Promise.all([checkDatabase(), checkFailedReports()]);
  const report: HealthReport = {
    status: overallStatus(checks),
    region: process.env.AWS_REGION ?? 'unknown',
    checkedAt: new Date().toISOString(),
    checks,
  };
  return {
    statusCode: report.status === 'down' ? 503 : 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': 'http://localhost:5173',
    },
    body: JSON.stringify(report),
  };
}

export function overallStatus(checks: HealthCheck[]): HealthReport['status'] {
  if (checks.some((check) => check.status === 'fail')) {
    return 'down';
  }
  if (checks.some((check) => check.status === 'warn')) {
    return 'degraded';
  }
  return 'healthy';
}

async function timed(
  name: string,
  run: () => Promise<{ status: CheckStatus; detail: string }>,
): Promise<HealthCheck> {
  const started = Date.now();
  try {
    const result = await run();
    return { name, ...result, latencyMs: Date.now() - started };
  } catch (error) {
    return {
      name,
      status: 'fail',
      detail: error instanceof Error ? error.message : 'Check failed',
      latencyMs: Date.now() - started,
    };
  }
}

function checkDatabase(): Promise<HealthCheck> {
  return timed('Database (DynamoDB)', async () => {
    await dynamo.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: 'HEALTH', SK: 'HEALTH' },
      }),
    );
    return { status: 'ok', detail: 'Read succeeded' };
  });
}

function checkFailedReports(): Promise<HealthCheck> {
  return timed('Failed reports (dead-letter queue)', async () => {
    const result = await sqs.send(
      new GetQueueAttributesCommand({
        QueueUrl: dlqUrl,
        AttributeNames: ['ApproximateNumberOfMessages'],
      }),
    );
    const waiting = Number(result.Attributes?.ApproximateNumberOfMessages ?? 0);
    return waiting === 0
      ? { status: 'ok', detail: 'No failed reports' }
      : { status: 'warn', detail: `${waiting} report(s) failed after all retries` };
  });
}
