import { isHealthReport, type ApiResult } from './api';
import type { HealthCheck } from './types';

type Props = {
  result: ApiResult | null;
  checking: boolean;
  onCheck: () => void;
};

type Overall = 'healthy' | 'degraded' | 'down' | 'unknown';

const OVERALL_LABEL: Record<Overall, { icon: string; label: string; summary: string }> = {
  healthy: { icon: '✓', label: 'Healthy', summary: 'All systems are responding normally.' },
  degraded: {
    icon: '!',
    label: 'Degraded',
    summary: 'The service is up, but something needs attention.',
  },
  down: { icon: '✕', label: 'Down', summary: 'The service is not responding correctly.' },
  unknown: { icon: '…', label: 'Checking', summary: 'Contacting AWS…' },
};

const CHECK_ICON: Record<HealthCheck['status'], string> = { ok: '✓', warn: '!', fail: '✕' };

export default function HealthPanel({ result, checking, onCheck }: Props) {
  const report = result && isHealthReport(result.body) ? result.body : null;
  const overall: Overall = !result ? 'unknown' : report ? report.status : 'down';
  const { icon, label, summary } = OVERALL_LABEL[overall];

  // Getting a health report back at all means API Gateway, the API key and
  // Lambda all worked, so the console shows that as the first check.
  const checks: HealthCheck[] = result
    ? [
        {
          name: 'API Gateway + Lambda',
          status: report ? 'ok' : 'fail',
          detail: report ? 'Request reached the server' : describeFailure(result),
          latencyMs: result.latencyMs,
        },
        ...(report?.checks ?? []),
      ]
    : [];

  return (
    <section className="panel health">
      <div className="panel-heading">
        <div className="health-overall">
          <span className={`health-badge ${overall}`} aria-hidden="true">
            {icon}
          </span>
          <div>
            <h2>
              Server health: <span className={`health-label ${overall}`}>{label}</span>
            </h2>
            <p className="hint">{summary}</p>
          </div>
        </div>
        <button type="button" onClick={onCheck} disabled={checking}>
          {checking ? 'Checking…' : 'Check health'}
        </button>
      </div>

      {result ? (
        <>
          <dl className="health-meta">
            <div>
              <dt>Region</dt>
              <dd>{report?.region ?? '—'}</dd>
            </div>
            <div>
              <dt>Round trip</dt>
              <dd>{result.latencyMs} ms</dd>
            </div>
            <div>
              <dt>Last checked</dt>
              <dd>{result.at.toLocaleTimeString()}</dd>
            </div>
          </dl>
          <ul className="health-checks">
            {checks.map((check) => (
              <li key={check.name}>
                <span className={`check-icon ${check.status}`} aria-hidden="true">
                  {CHECK_ICON[check.status]}
                </span>
                <span className="check-name">{check.name}</span>
                <span className="check-detail">{check.detail}</span>
                <span className="check-latency">{check.latencyMs} ms</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function describeFailure(result: ApiResult): string {
  if (result.status === 0) {
    return 'Could not reach AWS (network error)';
  }
  if (result.status === 403) {
    return 'Rejected (403): check the API key in console/.env.local';
  }
  return `Unexpected response (${result.status})`;
}
