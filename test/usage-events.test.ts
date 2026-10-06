import { toUsageEvent, type StoredUsage } from '../src/usage-events';

const recorded: StoredUsage = {
  customerId: 'cust-acme',
  dimension: 'api_calls',
  quantity: 1200,
  hour: '2026-09-01T10:00:00.000Z',
  status: 'RECORDED',
};

const reported: StoredUsage = {
  ...recorded,
  status: 'REPORTED',
};

describe('toUsageEvent', () => {
  test('an INSERT becomes UsageRecorded', () => {
    expect(toUsageEvent('INSERT', recorded, null)).toEqual({
      source: 'marketplace.metering',
      detailType: 'UsageRecorded',
      detail: recorded,
    });
  });

  test('a MODIFY from RECORDED to REPORTED becomes UsageReported', () => {
    expect(toUsageEvent('MODIFY', reported, recorded)).toEqual({
      source: 'marketplace.metering',
      detailType: 'UsageReported',
      detail: reported,
    });
  });

  test('a MODIFY that does not move RECORDED to REPORTED is ignored', () => {
    expect(toUsageEvent('MODIFY', recorded, recorded)).toBeNull();
    expect(toUsageEvent('MODIFY', recorded, reported)).toBeNull();
  });

  test('a REMOVE is ignored', () => {
    expect(toUsageEvent('REMOVE', null, recorded)).toBeNull();
  });
});
