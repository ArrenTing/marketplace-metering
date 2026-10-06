import { useEffect, useState } from 'react';
import { isHealthReport, type ApiResult } from './api';

export type LogEntry = {
  id: number;
  label: string;
  result: ApiResult;
};

type Level = 'INFO' | 'WARN' | 'ERROR';
type AlarmState = 'OK' | 'ALARM' | 'INSUFFICIENT_DATA';

type Alarm = {
  id: string;
  name: string;
  condition: string;
  state: AlarmState;
  reason: string;
};

type Props = {
  entries: LogEntry[];
  health: ApiResult | null;
};

const WINDOW_MS = 5 * 60 * 1000;
const REJECTED_THRESHOLD = 3;

export default function LogPanel({ entries, health }: Props) {
  const [filter, setFilter] = useState('');
  const [level, setLevel] = useState<Level | 'ALL'>('ALL');
  const [now, setNow] = useState(() => Date.now());

  // Re-evaluate the 5-minute alarm window as time passes.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  const recent = entries.filter((entry) => now - entry.result.at.getTime() <= WINDOW_MS);
  const alarms = evaluateAlarms(recent, health);
  const firing = alarms.filter((alarm) => alarm.state === 'ALARM');
  const errors = recent.filter((entry) => levelOf(entry.result) === 'ERROR').length;
  const avgLatency = recent.length
    ? Math.round(recent.reduce((sum, entry) => sum + entry.result.latencyMs, 0) / recent.length)
    : 0;

  const needle = filter.trim().toLowerCase();
  const visible = entries.filter((entry) => {
    if (level !== 'ALL' && levelOf(entry.result) !== level) {
      return false;
    }
    return !needle || messageOf(entry).toLowerCase().includes(needle);
  });

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Request log &amp; alarms</h2>
          <p className="hint">
            Every request this console sent to AWS and what came back, in the style of
            CloudWatch. Background refreshes are only logged when they fail.
          </p>
        </div>
      </div>

      {firing.length > 0 ? (
        <div className="alarm-banner" role="alert">
          <strong>
            {firing.length} alarm{firing.length === 1 ? '' : 's'} firing
          </strong>
          : {firing.map((alarm) => alarm.name).join(', ')}
        </div>
      ) : null}

      <div className="alarms">
        {alarms.map((alarm) => (
          <div key={alarm.id} className={`alarm ${alarm.state}`}>
            <span className="alarm-state">
              {alarm.state === 'OK' ? '✓ ' : alarm.state === 'ALARM' ? '▲ ' : '– '}
              {alarm.state === 'INSUFFICIENT_DATA' ? 'Insufficient data' : alarm.state}
            </span>
            <strong>{alarm.name}</strong>
            <span className="alarm-condition">{alarm.condition}</span>
            <span className="alarm-reason">{alarm.reason}</span>
          </div>
        ))}
      </div>

      <div className="metrics">
        <div>
          <span className="metric-value">{recent.length}</span>
          <span className="metric-label">Requests (5 min)</span>
        </div>
        <div>
          <span className="metric-value">{errors}</span>
          <span className="metric-label">Errors (5 min)</span>
        </div>
        <div>
          <span className="metric-value">{avgLatency} ms</span>
          <span className="metric-label">Avg latency (5 min)</span>
        </div>
      </div>

      <div className="logs">
        <div className="logs-toolbar">
          <span className="logs-group">/marketplace-metering/console-requests</span>
          <input
            className="logs-filter"
            placeholder="Filter events"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <select
            className="logs-level"
            value={level}
            onChange={(event) => setLevel(event.target.value as Level | 'ALL')}
            aria-label="Log level"
          >
            <option value="ALL">All levels</option>
            <option value="INFO">INFO</option>
            <option value="WARN">WARN</option>
            <option value="ERROR">ERROR</option>
          </select>
        </div>
        {visible.length === 0 ? (
          <p className="logs-empty">
            {entries.length === 0 ? 'No log events yet.' : 'No events match the filter.'}
          </p>
        ) : (
          <ol className="logs-list">
            {visible.map((entry) => {
              const entryLevel = levelOf(entry.result);
              return (
                <li key={entry.id}>
                  <details>
                    <summary>
                      <span className="log-ts">{entry.result.at.toISOString()}</span>
                      <span className={`log-level ${entryLevel}`}>{entryLevel}</span>
                      <span className="log-msg">{messageOf(entry)}</span>
                    </summary>
                    <pre>{JSON.stringify(entry.result.body, null, 2)}</pre>
                  </details>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}

function levelOf(result: ApiResult): Level {
  if (result.status === 0 || result.status >= 500) {
    return 'ERROR';
  }
  if (result.status >= 400) {
    return 'WARN';
  }
  return 'INFO';
}

function messageOf(entry: LogEntry): string {
  const { method, path, status, latencyMs } = entry.result;
  return `[${entry.label}] ${method} ${path} → ${status || 'network error'} (${latencyMs} ms)`;
}

function evaluateAlarms(recent: LogEntry[], health: ApiResult | null): Alarm[] {
  const serverErrors = recent.filter((entry) => levelOf(entry.result) === 'ERROR').length;
  const rejected = recent.filter((entry) => levelOf(entry.result) === 'WARN').length;
  const report = health && isHealthReport(health.body) ? health.body : null;
  const dlq = report?.checks.find((check) => check.name.includes('dead-letter'));

  const serverState: AlarmState = serverErrors > 0 ? 'ALARM' : 'OK';
  const rejectedState: AlarmState = rejected >= REJECTED_THRESHOLD ? 'ALARM' : 'OK';
  const healthState: AlarmState = !health
    ? 'INSUFFICIENT_DATA'
    : report && report.status !== 'down'
      ? 'OK'
      : 'ALARM';
  const dlqState: AlarmState = !dlq ? 'INSUFFICIENT_DATA' : dlq.status === 'ok' ? 'OK' : 'ALARM';

  return [
    {
      id: 'server-errors',
      name: alarmName(serverState, {
        OK: 'No errors detected',
        ALARM: 'Errors detected',
      }),
      condition: 'Any 5xx or network error in 5 min',
      state: serverState,
      reason: `${serverErrors} in the last 5 minutes`,
    },
    {
      id: 'rejected-requests',
      name: alarmName(rejectedState, {
        OK: 'No rejected requests',
        ALARM: 'Requests being rejected',
      }),
      condition: `${REJECTED_THRESHOLD}+ rejected (4xx) in 5 min`,
      state: rejectedState,
      reason: `${rejected} in the last 5 minutes`,
    },
    {
      id: 'health',
      name: alarmName(healthState, {
        OK: 'Healthy',
        ALARM: 'Unhealthy',
        INSUFFICIENT_DATA: 'Health not checked yet',
      }),
      condition: 'Server health is not Down',
      state: healthState,
      reason: !health ? 'Waiting for first check' : `Last check: ${report?.status ?? 'no response'}`,
    },
    {
      id: 'failed-reports',
      name: alarmName(dlqState, {
        OK: 'No failed reports',
        ALARM: 'Failed reports',
        INSUFFICIENT_DATA: 'Failed reports unknown',
      }),
      condition: 'Dead-letter queue is empty',
      state: dlqState,
      reason: dlq ? dlq.detail : 'Comes from the latest health check',
    },
  ];
}

function alarmName(
  state: AlarmState,
  names: { OK: string; ALARM: string; INSUFFICIENT_DATA?: string },
): string {
  return names[state] ?? names.OK;
}
