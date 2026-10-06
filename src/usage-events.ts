export const USAGE_EVENT_SOURCE = 'marketplace.metering';

export type StoredUsage = {
  customerId: string;
  dimension: string;
  quantity: number;
  hour: string;
  status: string;
};

export type UsageChangeEvent = {
  source: typeof USAGE_EVENT_SOURCE;
  detailType: 'UsageRecorded' | 'UsageReported';
  detail: StoredUsage;
};

export function toUsageEvent(
  eventName: string,
  newImage: StoredUsage | null,
  oldImage: StoredUsage | null,
): UsageChangeEvent | null {
  if (eventName === 'INSERT' && newImage) {
    return changeEvent(newImage, 'UsageRecorded');
  }
  if (
    eventName === 'MODIFY' &&
    oldImage?.status === 'RECORDED' &&
    newImage?.status === 'REPORTED'
  ) {
    return changeEvent(newImage, 'UsageReported');
  }
  return null;
}

function changeEvent(
  item: StoredUsage,
  detailType: UsageChangeEvent['detailType'],
): UsageChangeEvent {
  return {
    source: USAGE_EVENT_SOURCE,
    detailType,
    detail: {
      customerId: item.customerId,
      dimension: item.dimension,
      quantity: item.quantity,
      hour: item.hour,
      status: item.status,
    },
  };
}
