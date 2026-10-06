import { useEffect, useState } from 'react';
import { DIMENSION_LABEL, formatNumber, timeAgo, utcHour } from './format';
import type { BusEvent } from './types';

type Listener = {
  id: string;
  name: string;
  matches: (event: BusEvent) => boolean;
};

// Mirrors the rules on UsageBus in lib/marketplace-metering-stack.ts:
// RouteUsageRecorded (UsageRecorded -> SQS -> report-usage) and
// LogAllUsageEvents (everything -> CloudWatch Logs).
const LISTENERS: Listener[] = [
  {
    id: 'billing',
    name: 'Billing reporter',
    matches: (event) => event.detailType === 'UsageRecorded',
  },
  {
    id: 'audit',
    name: 'Audit log',
    matches: () => true,
  },
];

const EVENT_LABEL: Record<string, string> = {
  UsageRecorded: 'New usage',
  UsageReported: 'Reported',
};

type Props = {
  events: BusEvent[];
  error: string | null;
};

type UsageDetail = {
  customerId?: string;
  dimension?: string;
  quantity?: number;
  hour?: string;
};

export default function EventBridgePanel({ events, error }: Props) {
  const [listenerId, setListenerId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(timer);
  }, []);

  const listener = LISTENERS.find((candidate) => candidate.id === listenerId);
  const visible = listener ? events.filter(listener.matches) : events;
  const recordedAt = new Map<string, string>();
  for (const event of events) {
    if (event.detailType === 'UsageRecorded') {
      recordedAt.set(recordKey(event.detail as UsageDetail), event.time);
    }
  }

  const tabs = [
    { id: null, name: 'All events', count: events.length },
    ...LISTENERS.map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      count: events.filter(candidate.matches).length,
    })),
  ];

  return (
    <section className="panel">
      <h2>Events</h2>

      <div className="tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.name}
            type="button"
            role="tab"
            aria-selected={tab.id === listenerId}
            className={tab.id === listenerId ? 'tab active' : 'tab'}
            onClick={() => setListenerId(tab.id)}
          >
            {tab.name} <span className="tab-count">{tab.count}</span>
          </button>
        ))}
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      {visible.length === 0 ? (
        <p className="empty">No events yet.</p>
      ) : (
        <ol className="feed">
          {visible.map((event) => {
            const detail = (event.detail ?? {}) as UsageDetail;
            const startedAt =
              event.detailType === 'UsageReported' ? recordedAt.get(recordKey(detail)) : undefined;
            return (
              <li key={event.id}>
                <details>
                  <summary>
                    <span className={`event-type ${event.detailType}`}>
                      {EVENT_LABEL[event.detailType] ?? event.detailType}
                    </span>
                    <span className="event-summary">{describe(detail)}</span>
                    {startedAt ? (
                      <span className="event-took">{secondsBetween(startedAt, event.time)}</span>
                    ) : null}
                    <span className="event-time">{timeAgo(event.time, now)}</span>
                    <span className="event-targets">
                      {LISTENERS.filter((candidate) => candidate.matches(event)).map(
                        (candidate) => (
                          <span key={candidate.id} className="target-chip">
                            → {candidate.name}
                          </span>
                        ),
                      )}
                    </span>
                  </summary>
                  <pre>{JSON.stringify(event, null, 2)}</pre>
                </details>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function recordKey(detail: UsageDetail): string {
  return `${detail.customerId}|${detail.dimension}|${detail.hour}`;
}

function describe(detail: UsageDetail): string {
  const label = DIMENSION_LABEL[detail.dimension ?? '']?.name ?? detail.dimension;
  const quantity = typeof detail.quantity === 'number' ? formatNumber(detail.quantity) : '?';
  const hour = detail.hour ? utcHour(detail.hour) : '';
  return `${detail.customerId} · ${quantity} ${label} · ${hour}`;
}

function secondsBetween(from: string, to: string): string {
  const seconds = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000);
  return Number.isNaN(seconds) ? '' : `took ${Math.max(0, seconds)}s`;
}
