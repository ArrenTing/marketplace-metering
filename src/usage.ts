export const DIMENSIONS = ['api_calls', 'gb_stored'] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export type UsageInput = {
  customerId: string;
  dimension: Dimension;
  timestamp: string;
  quantity: number;
};

export type UsageKeys = {
  PK: string;
  SK: string;
  hour: string;
};

export function validateUsageBody(body: unknown): UsageInput {
  if (typeof body !== 'object' || body === null) {
    throw new Error('Body is not an object');
  }

  const parsedBody = body as Record<string, unknown>;
  const customerId = parsedBody.customerId;
  const dimension = parsedBody.dimension;
  const timestamp = parsedBody.timestamp;
  const quantity = parsedBody.quantity;

  if (typeof customerId !== 'string' || customerId.trim() === '') {
    throw new Error('Customer ID is required');
  }
  if (typeof dimension !== 'string' || !DIMENSIONS.includes(dimension as Dimension)) {
    throw new Error('Dimension is required and must be one of DIMENSIONS');
  }
  if (typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp))) {
    throw new Error('Timestamp is required and must be a valid ISO string');
  }
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0) {
    throw new Error('Quantity is required and must be a positive integer');
  }

  return {
    customerId: customerId.trim(),
    dimension: dimension as Dimension,
    timestamp,
    quantity,
  };
}

export function floorTimestampToHour(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Timestamp is not a valid ISO string or cannot be parsed');
  }
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

export function buildUsageKeys(input: UsageInput): UsageKeys {
  const hour = floorTimestampToHour(input.timestamp);
  return {
    PK: `CUST#${input.customerId}`,
    SK: `USAGE#${input.dimension}#${hour}`,
    hour,
  };
}
