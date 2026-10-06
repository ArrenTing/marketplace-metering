import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../src/handler';

const ddbMock = mockClient(DynamoDBDocumentClient);

const validPayload = {
  customerId: 'cust-acme',
  dimension: 'api_calls',
  timestamp: '2026-09-01T10:37:00.000Z',
  quantity: 1200,
};

const recordedItem = {
  PK: 'CUST#cust-acme',
  SK: 'USAGE#api_calls#2026-09-01T10:00:00.000Z',
  hour: '2026-09-01T10:00:00.000Z',
  customerId: 'cust-acme',
  dimension: 'api_calls',
  quantity: 1200,
  status: 'RECORDED',
};

function apiEvent(
  overrides: Partial<APIGatewayProxyEvent>,
): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: '/',
    body: null,
    pathParameters: null,
    queryStringParameters: null,
    headers: {},
    multiValueHeaders: {},
    isBase64Encoded: false,
    resource: '/',
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent['requestContext'],
    multiValueQueryStringParameters: null,
    ...overrides,
  };
}

function parseBody(result: { body: string }) {
  return JSON.parse(result.body);
}

function conditionalCheckFailed() {
  const error = new Error('The conditional request failed');
  error.name = 'ConditionalCheckFailedException';
  return error;
}

beforeEach(() => {
  ddbMock.reset();
});

describe('handler routing', () => {
  test('returns 404 for an unknown route', async () => {
    const result = await handler(apiEvent({ httpMethod: 'GET', path: '/nope' }));
    expect(result.statusCode).toBe(404);
    expect(ddbMock.calls()).toHaveLength(0);
  });

  test('GET /customers/cust-acme/usage returns that customer\'s records', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [recordedItem] });

    const result = await handler(
      apiEvent({
        httpMethod: 'GET',
        path: '/customers/cust-acme/usage',
        pathParameters: { customerId: 'cust-acme' },
      }),
    );

    expect(result.statusCode).toBe(200);
    expect(parseBody(result).items).toEqual([
      {
        customerId: 'cust-acme',
        dimension: 'api_calls',
        quantity: 1200,
        hour: '2026-09-01T10:00:00.000Z',
        status: 'RECORDED',
      },
    ]);
  });

  test('POST /customers/cust-acme/usage is a 404', async () => {
    const result = await handler(
      apiEvent({
        httpMethod: 'POST',
        path: '/customers/cust-acme/usage',
        body: JSON.stringify(validPayload),
      }),
    );

    expect(result.statusCode).toBe(404);
    expect(ddbMock.calls()).toHaveLength(0);
  });
});

describe('POST /usage', () => {
  const postEvent = (body: unknown) =>
    apiEvent({
      httpMethod: 'POST',
      path: '/usage',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  test('returns 400 when the body is missing', async () => {
    const result = await handler(
      apiEvent({ httpMethod: 'POST', path: '/usage', body: null }),
    );
    expect(result.statusCode).toBe(400);
    expect(parseBody(result).message).toMatch(/body/i);
    expect(result.headers).toMatchObject({
      'Access-Control-Allow-Origin': 'http://localhost:5173',
    });
    expect(ddbMock.calls()).toHaveLength(0);
  });

  test('returns 400 when the body is not valid JSON', async () => {
    const result = await handler(postEvent('{'));

    expect(result.statusCode).toBe(400);
    expect(ddbMock.calls()).toHaveLength(0);
  });

  test('returns 400 when the body fails validation', async () => {
    const result = await handler(
      postEvent({ ...validPayload, dimension: 'storage' }),
    );

    expect(result.statusCode).toBe(400);
    expect(parseBody(result).message).toMatch(/dimension/i);
    expect(ddbMock.calls()).toHaveLength(0);
  });

  test('returns 200 when Put succeeds (new write path)', async () => {
    ddbMock.on(PutCommand).resolves({});

    const result = await handler(postEvent(validPayload));

    expect(result.statusCode).toBe(200);
    expect(parseBody(result).item).toMatchObject({
      PK: recordedItem.PK,
      SK: recordedItem.SK,
      quantity: 1200,
      status: 'RECORDED',
    });
    expect(ddbMock).toHaveReceivedCommandWith(PutCommand, {
      TableName: 'UsageTable',
      ConditionExpression: 'attribute_not_exists(PK)',
      Item: expect.objectContaining({
        PK: recordedItem.PK,
        SK: recordedItem.SK,
        quantity: 1200,
      }),
    });
    expect(ddbMock).not.toHaveReceivedCommand(GetCommand);
  });

  test('POST is idempotent: same record twice returns 200 both times', async () => {
    ddbMock.on(PutCommand).resolvesOnce({}).rejectsOnce(conditionalCheckFailed());
    ddbMock.on(GetCommand).resolves({ Item: recordedItem });

    const first = await handler(postEvent(validPayload));
    const second = await handler(postEvent(validPayload));

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(parseBody(second).item).toEqual(recordedItem);
    expect(ddbMock).toHaveReceivedCommandTimes(PutCommand, 2);
    expect(ddbMock).toHaveReceivedCommandTimes(GetCommand, 1);
  });

  test('POST is idempotent across timestamps in the same hour', async () => {
    ddbMock.on(PutCommand).rejects(conditionalCheckFailed());
    ddbMock.on(GetCommand).resolves({ Item: recordedItem });

    const result = await handler(
      postEvent({ ...validPayload, timestamp: '2026-09-01T10:39:00.000Z' }),
    );

    expect(result.statusCode).toBe(200);
    expect(ddbMock).toHaveReceivedCommandWith(PutCommand, {
      Item: expect.objectContaining({
        SK: recordedItem.SK,
        quantity: 1200,
      }),
    });
  });

  test('same key with a different quantity is a 409 conflict, not a replay', async () => {
    ddbMock.on(PutCommand).rejects(conditionalCheckFailed());
    ddbMock.on(GetCommand).resolves({ Item: recordedItem });

    const result = await handler(postEvent({ ...validPayload, quantity: 800 }));

    expect(result.statusCode).toBe(409);
    expect(parseBody(result).message).toMatch(/conflict/i);
    expect(result.headers).toMatchObject({
      'Access-Control-Allow-Origin': 'http://localhost:5173',
    });
  });
});

describe('GET /customers/{customerId}/usage', () => {
  const gbStoredItem = {
    ...recordedItem,
    SK: 'USAGE#gb_stored#2026-09-01T11:00:00.000Z',
    hour: '2026-09-01T11:00:00.000Z',
    dimension: 'gb_stored',
    quantity: 40,
  };

  const getEvent = (customerId = 'cust-acme') =>
    apiEvent({
      httpMethod: 'GET',
      path: `/customers/${customerId}/usage`,
      pathParameters: { customerId },
    });

  test('returns 400 when the customer id is missing', async () => {
    const result = await handler(
      apiEvent({
        httpMethod: 'GET',
        path: '/customers/cust-acme/usage',
        pathParameters: null,
      }),
    );

    expect(result.statusCode).toBe(400);
    expect(parseBody(result).message).toMatch(/customer id/i);
    expect(ddbMock.calls()).toHaveLength(0);
  });

  test('returns every record for the customer', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [recordedItem, gbStoredItem],
    });

    const result = await handler(getEvent());

    expect(result.statusCode).toBe(200);
    expect(parseBody(result).items).toEqual([
      {
        customerId: 'cust-acme',
        dimension: 'api_calls',
        quantity: 1200,
        hour: '2026-09-01T10:00:00.000Z',
        status: 'RECORDED',
      },
      {
        customerId: 'cust-acme',
        dimension: 'gb_stored',
        quantity: 40,
        hour: '2026-09-01T11:00:00.000Z',
        status: 'RECORDED',
      },
    ]);
    expect(ddbMock).toHaveReceivedCommandWith(QueryCommand, {
      TableName: 'UsageTable',
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': 'CUST#cust-acme',
        ':sk': 'USAGE#',
      },
    });
  });

  test('returns 200 and an empty list when the customer has no records', async () => {
    ddbMock.on(QueryCommand).resolves({});

    const result = await handler(getEvent());

    expect(result.statusCode).toBe(200);
    expect(parseBody(result).items).toEqual([]);
  });

  test('GET is idempotent: same request twice returns the same body', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [recordedItem] });

    const first = await handler(getEvent());
    const second = await handler(getEvent());

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.body).toBe(first.body);
    expect(ddbMock).toHaveReceivedCommandTimes(QueryCommand, 2);
    expect(ddbMock).not.toHaveReceivedCommand(PutCommand);
  });
});
