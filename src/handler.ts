import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { buildUsageKeys, validateUsageBody } from "./usage.js";

// Create the client once, outside the handler. On a warm Lambda the same
// process is reused; constructing SDK clients per request is wasted work.
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const tableName = process.env.TABLE_NAME;

function respond(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "http://localhost:5173",
    },
    body: JSON.stringify(body),
  };
}

function isPostUsage(event: APIGatewayProxyEvent): boolean {
  return event.httpMethod === "POST" && event.path === "/usage";
}

function isGetCustomerUsage(event: APIGatewayProxyEvent): boolean {
  return (
    event.httpMethod === "GET" &&
    /^\/customers\/[^/]+\/usage$/.test(event.path)
  );
}

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  if (isPostUsage(event)) {
    return handlePostUsage(event);
  }
  if (isGetCustomerUsage(event)) {
    return handleGetUsage(event);
  }
  return respond(404, { message: "Not found" });
}

async function handlePostUsage(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const body = event.body as string;
  if (!body) {
    return respond(400, { message: "Body is required" });
  }
  let input;
  try {
    const parsedBody = JSON.parse(body);
    if (
      typeof parsedBody !== "object" ||
      parsedBody === null ||
      Array.isArray(parsedBody)
    ) {
      return respond(400, { message: "Body must be a JSON object" });
    }
    input = validateUsageBody(parsedBody);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid usage record";
    return respond(400, { message });
  }
  const keys = buildUsageKeys(input);
  const item = {
    ...keys,
    customerId: input.customerId,
    dimension: input.dimension,
    quantity: input.quantity,
    status: "RECORDED" as const,
  };
  try {
    await dynamo.send(
      new PutCommand({
        TableName: tableName,
        Item: item,
        ConditionExpression: "attribute_not_exists(PK)",
      }),
    );
    return respond(200, { item });
  } catch (error) {
    if (!isConditionalCheckFailed(error)) {
      throw error;
    }
  }

  const getResult = await dynamo.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: keys.PK, SK: keys.SK },
    }),
  );
  if (getResult.Item && getResult.Item.quantity === input.quantity) {
    return respond(200, { item: getResult.Item });
  }
  return respond(409, { message: "Conflicting quantity for this usage key" });
}

function isConditionalCheckFailed(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name: string }).name === "ConditionalCheckFailedException"
  );
}

async function handleGetUsage(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const customerId = event.pathParameters?.customerId;
  if (!customerId) {
    return respond(400, { message: "Customer ID is required" });
  }
  const queryResult = await dynamo.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": `CUST#${customerId}`,
        ":sk": "USAGE#",
      },
    }),
  );
  const items = (queryResult.Items ?? []).map((item) => ({
    customerId,
    dimension: item.dimension,
    quantity: item.quantity,
    hour: item.hour,
    status: item.status,
  }));
  return respond(200, { items });
}
