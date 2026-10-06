import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getEvents,
  getHealth,
  getUsage,
  isEventList,
  isUsageList,
  postUsage,
  type ApiResult,
} from './api';
import { buildFakeBatch, DEPARTMENTS } from './batch';
import EventBridgePanel from './EventBridgePanel';
import HealthPanel from './HealthPanel';
import LogPanel, { type LogEntry } from './LogPanel';
import SendUsageDialog from './SendUsageDialog';
import type { BusEvent, UsageInput, UsageRecord } from './types';
import UsagePanel from './UsagePanel';

const POLL_MS = 4000;
const MAX_LOG_ENTRIES = 200;

export default function App() {
  const [viewDepartment, setViewDepartment] = useState<string>(DEPARTMENTS[0]);
  const [records, setRecords] = useState<UsageRecord[]>([]);
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const [events, setEvents] = useState<BusEvent[]>([]);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [health, setHealth] = useState<ApiResult | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(true);
  const [lastInput, setLastInput] = useState<UsageInput | null>(null);
  const [lastOutcome, setLastOutcome] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const nextLogId = useRef(1);

  const pushLog = useCallback((label: string, result: ApiResult) => {
    const id = nextLogId.current;
    nextLogId.current += 1;
    setLog((entries) => [{ id, label, result }, ...entries].slice(0, MAX_LOG_ENTRIES));
  }, []);

  const applyRecords = useCallback(
    (result: ApiResult) => {
      if (isUsageList(result.body)) {
        setRecords(result.body.items);
        setRecordsError(null);
        return;
      }
      setRecordsError(`Could not load usage (${result.status || 'network error'}).`);
      pushLog('Refresh usage', result);
    },
    [pushLog],
  );

  const applyEvents = useCallback(
    (result: ApiResult) => {
      if (isEventList(result.body)) {
        setEvents(result.body.items);
        setEventsError(null);
        return;
      }
      setEventsError(`Could not load events (${result.status || 'network error'}).`);
      pushLog('Refresh events', result);
    },
    [pushLog],
  );

  const applyHealth = useCallback(
    (result: ApiResult) => {
      setHealth(result);
      pushLog('Health check', result);
      setCheckingHealth(false);
    },
    [pushLog],
  );

  // Check once on first load (checkingHealth starts true) so the console opens
  // with a known status.
  useEffect(() => {
    let cancelled = false;
    void getHealth().then((result) => {
      if (!cancelled) {
        applyHealth(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [applyHealth]);

  async function checkHealth() {
    setCheckingHealth(true);
    applyHealth(await getHealth());
  }

  // Always load once when the department changes, then keep polling if enabled
  // so the RECORDED -> REPORTED flip and its events appear without clicking.
  // Polling pauses while the tab is hidden to protect the daily API quota.
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const [usage, busEvents] = await Promise.all([getUsage(viewDepartment), getEvents()]);
      if (!cancelled) {
        applyRecords(usage);
        applyEvents(busEvents);
      }
    }
    void refresh();
    if (!autoRefresh) {
      return () => {
        cancelled = true;
      };
    }
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refresh();
      }
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [autoRefresh, viewDepartment, applyRecords, applyEvents]);

  async function refreshNow(customerId: string) {
    if (customerId !== viewDepartment) {
      setViewDepartment(customerId);
      return;
    }
    const [usage, busEvents] = await Promise.all([getUsage(customerId), getEvents()]);
    applyRecords(usage);
    applyEvents(busEvents);
  }

  async function send(input: UsageInput, label: string) {
    setBusy(true);
    const result = await postUsage(input);
    setLastInput(input);
    pushLog(label, result);
    setLastOutcome(describeOutcome(label, result));
    await refreshNow(input.customerId);
    setBusy(false);
  }

  async function sendRandomBatch() {
    setBusy(true);
    const batch = buildFakeBatch();
    const statuses: number[] = [];
    for (const input of batch) {
      const result = await postUsage(input);
      statuses.push(result.status);
      pushLog('Random batch', result);
    }
    setLastInput(batch[batch.length - 1] ?? null);
    const accepted = statuses.filter((status) => status >= 200 && status < 300).length;
    const conflicts = statuses.filter((status) => status === 409).length;
    setLastOutcome(
      `Random batch: ${accepted} of ${batch.length} records accepted.` +
        (conflicts > 0
          ? ` ${conflicts} landed on an hour that already had a different quantity (409).`
          : ''),
    );
    await refreshNow(viewDepartment);
    setBusy(false);
  }

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Marketplace metering · AWS demo</p>
          <h1>Vendor console</h1>
        </div>
        <div className="header-actions">
          <label className="toggle">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(event) => setAutoRefresh(event.target.checked)}
            />
            Live refresh ({POLL_MS / 1000}s)
          </label>
          <button type="button" onClick={() => setDialogOpen(true)}>
            Send usage
          </button>
        </div>
      </header>

      <HealthPanel result={health} checking={checkingHealth} onCheck={() => void checkHealth()} />

      <UsagePanel
        departments={[...DEPARTMENTS]}
        department={viewDepartment}
        onDepartmentChange={setViewDepartment}
        records={records}
        error={recordsError}
      />

      <EventBridgePanel events={events} error={eventsError} />

      <LogPanel entries={log} health={health} />

      <SendUsageDialog
        open={dialogOpen}
        busy={busy}
        departments={[...DEPARTMENTS]}
        lastInput={lastInput}
        lastOutcome={lastOutcome}
        onClose={() => setDialogOpen(false)}
        onGenerate={(input) => void send(input, 'Generate')}
        onRandomBatch={() => void sendRandomBatch()}
        onResend={() => {
          if (lastInput) {
            void send(lastInput, 'Resend last');
          }
        }}
        onConflict={() => {
          if (lastInput) {
            void send({ ...lastInput, quantity: lastInput.quantity + 1 }, 'Send conflict');
          }
        }}
      />
    </main>
  );
}

function describeOutcome(label: string, result: ApiResult): string {
  if (result.status === 409) {
    return `${label}: rejected with 409 Conflict. That hour already has a different quantity.`;
  }
  if (result.ok && label === 'Resend last') {
    return `${label}: accepted as a replay (${result.status}). Still stored only once.`;
  }
  if (result.ok) {
    return `${label}: accepted (${result.status}).`;
  }
  const message =
    typeof result.body === 'object' && result.body !== null && 'message' in result.body
      ? String(result.body.message)
      : 'request failed';
  return `${label}: failed (${result.status || 'network error'}): ${message}`;
}
