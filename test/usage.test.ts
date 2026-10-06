import {
  buildUsageKeys,
  floorTimestampToHour,
  validateUsageBody,
} from '../src/usage';

const validBody = {
  customerId: 'cust-acme',
  dimension: 'api_calls' as const,
  timestamp: '2026-09-01T10:37:00.000Z',
  quantity: 1200,
};

describe('floorTimestampToHour', () => {
  test('floors minutes, seconds, and ms to the UTC hour', () => {
    expect(floorTimestampToHour('2026-09-01T10:37:45.123Z')).toBe(
      '2026-09-01T10:00:00.000Z',
    );
  });

  test('leaves an exact hour unchanged', () => {
    expect(floorTimestampToHour('2026-09-01T10:00:00.000Z')).toBe(
      '2026-09-01T10:00:00.000Z',
    );
  });

  test('rejects an unparseable timestamp', () => {
    expect(() => floorTimestampToHour('not-a-date')).toThrow();
  });
});

describe('buildUsageKeys', () => {
  test('builds PK and SK from customer, dimension, and floored hour', () => {
    expect(buildUsageKeys(validBody)).toEqual({
      PK: 'CUST#cust-acme',
      SK: 'USAGE#api_calls#2026-09-01T10:00:00.000Z',
      hour: '2026-09-01T10:00:00.000Z',
    });
  });

  test('uses gb_stored in SK when that is the dimension', () => {
    expect(
      buildUsageKeys({ ...validBody, dimension: 'gb_stored' }).SK,
    ).toBe('USAGE#gb_stored#2026-09-01T10:00:00.000Z');
  });
});

describe('validateUsageBody', () => {
  test('accepts a valid already-parsed body', () => {
    expect(validateUsageBody(validBody)).toEqual(validBody);
  });

  test('trims customerId', () => {
    expect(
      validateUsageBody({ ...validBody, customerId: '  cust-acme  ' }),
    ).toEqual(validBody);
  });

  test('rejects a missing customerId', () => {
    expect(() =>
      validateUsageBody({ ...validBody, customerId: '  ' }),
    ).toThrow();
  });

  test('rejects an unknown dimension', () => {
    expect(() =>
      validateUsageBody({ ...validBody, dimension: 'storage' }),
    ).toThrow();
  });

  test('rejects a non-positive or non-integer quantity', () => {
    expect(() => validateUsageBody({ ...validBody, quantity: 0 })).toThrow();
    expect(() => validateUsageBody({ ...validBody, quantity: -1 })).toThrow();
    expect(() => validateUsageBody({ ...validBody, quantity: 1.5 })).toThrow();
  });

  test('rejects a raw JSON string (parse that in the Lambda)', () => {
    expect(() => validateUsageBody(JSON.stringify(validBody))).toThrow();
  });
});
