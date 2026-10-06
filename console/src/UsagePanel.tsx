import { useCallback, useRef, useState } from 'react';
import { formatNumber, utcDate, utcHour, utcTime } from './format';
import type { UsageRecord } from './types';

type Props = {
  departments: string[];
  department: string;
  onDepartmentChange: (department: string) => void;
  records: UsageRecord[];
  error: string | null;
};

// One slot per hour that has any usage; both tiers share these slots so the
// bars and the line stay aligned and scroll together.
type Slot = {
  hour: string;
  apiCalls?: UsageRecord;
  gbStored?: UsageRecord;
};

const MIN_SLOT_WIDTH = 76;
const Y_AXIS_WIDTH = 56;
const BAR_TIER_HEIGHT = 160;
const LINE_TIER_HEIGHT = 110;

export default function UsagePanel({
  departments,
  department,
  onDepartmentChange,
  records,
  error,
}: Props) {
  const [showTable, setShowTable] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [chartWidth, setChartWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);

  // Measure the chart so the hour slots stretch to the full panel width. A
  // callback ref, because the chart unmounts while the table view is shown.
  const chartRef = useCallback((node: HTMLDivElement | null) => {
    observer.current?.disconnect();
    if (!node) {
      return;
    }
    observer.current = new ResizeObserver(([entry]) => setChartWidth(entry.contentRect.width));
    observer.current.observe(node);
  }, []);

  const slots = buildSlots(records);
  const apiValues = slots.flatMap((slot) => (slot.apiCalls ? [slot.apiCalls.quantity] : []));
  const gbValues = slots.flatMap((slot) => (slot.gbStored ? [slot.gbStored.quantity] : []));
  const apiTicks = niceTicks(Math.max(0, ...apiValues));
  const gbTicks = niceTicks(Math.max(0, ...gbValues));
  const apiMax = apiTicks[apiTicks.length - 1] || 1;
  const gbMax = gbTicks[gbTicks.length - 1] || 1;
  const totalCalls = apiValues.reduce((sum, value) => sum + value, 0);
  const latestGb = [...slots].reverse().find((slot) => slot.gbStored)?.gbStored?.quantity;
  const pending = records.filter((record) => record.status !== 'REPORTED').length;

  const slotWidth = slots.length
    ? Math.max(MIN_SLOT_WIDTH, Math.floor((chartWidth - Y_AXIS_WIDTH) / slots.length))
    : MIN_SLOT_WIDTH;
  const plotWidth = slots.length * slotWidth;
  const gbPoints = slots.flatMap((slot, index) =>
    slot.gbStored
      ? [
          {
            slot,
            x: index * slotWidth + slotWidth / 2,
            y: LINE_TIER_HEIGHT - (slot.gbStored.quantity / gbMax) * LINE_TIER_HEIGHT,
          },
        ]
      : [],
  );

  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Usage</h2>
        <label>
          Department
          <select value={department} onChange={(event) => onDepartmentChange(event.target.value)}>
            {[department, ...departments.filter((id) => id !== department)].map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      <div className="usage-summary">
        <div className="stat">
          <span className="stat-label">API calls (total)</span>
          <span className="stat-value">{formatNumber(totalCalls)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">GB stored (latest)</span>
          <span className="stat-value">
            {latestGb === undefined ? '—' : formatNumber(latestGb)}
          </span>
        </div>
        <p className="hint">
          {slots.length} hour{slots.length === 1 ? '' : 's'} of usage for {department}
          {pending > 0 ? ` · ${pending} waiting to be reported` : ''}
        </p>
      </div>

      {slots.length === 0 ? (
        <p className="empty chart-empty">
          No usage recorded for {department} yet. Use “Send usage” to add some.
        </p>
      ) : (
        <>
          <div className="chart-head">
            <ul className="legend">
              <li>
                <span className="swatch reported" /> Reported to billing
              </li>
              <li>
                <span className="swatch recorded" /> Waiting to report
              </li>
            </ul>
            <button type="button" className="link" onClick={() => setShowTable(!showTable)}>
              {showTable ? 'Show chart' : 'Show as table'}
            </button>
          </div>

          {showTable ? (
            <table>
              <thead>
                <tr>
                  <th>Hour (UTC)</th>
                  <th className="num">API calls</th>
                  <th className="num">GB stored</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {slots.map((slot) => (
                  <tr key={slot.hour}>
                    <td>{utcHour(slot.hour)}</td>
                    <td className="num">{valueText(slot.apiCalls)}</td>
                    <td className="num">{valueText(slot.gbStored)}</td>
                    <td>{slotStatus(slot)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="chart-scroll" ref={chartRef}>
              <div className="tier-title">API calls</div>
              <div className="tier-row">
                <YAxis ticks={apiTicks} max={apiMax} height={BAR_TIER_HEIGHT} />
                <div className="plot" style={{ height: BAR_TIER_HEIGHT, width: plotWidth }}>
                  <Gridlines ticks={apiTicks} max={apiMax} />
                  {slots.map((slot, index) => (
                    <div
                      key={slot.hour}
                      className={hovered === slot.hour ? 'column hovered' : 'column'}
                      style={{ width: slotWidth }}
                      onMouseEnter={() => setHovered(slot.hour)}
                      onMouseLeave={() => setHovered(null)}
                    >
                      {slot.apiCalls ? (
                        <div
                          className={`bar ${statusClass(slot.apiCalls)}`}
                          style={{ height: `${(slot.apiCalls.quantity / apiMax) * 100}%` }}
                        />
                      ) : null}
                      {hovered === slot.hour ? (
                        <div
                          className="tooltip"
                          role="tooltip"
                          style={index >= slots.length / 2 ? { right: 'calc(100% + 4px)' } : { left: 'calc(100% + 4px)' }}
                        >
                          <strong>{utcHour(slot.hour)}</strong>
                          <span>API calls: {valueText(slot.apiCalls)}</span>
                          <span>GB stored: {valueText(slot.gbStored)}</span>
                          <span>{slotStatus(slot)}</span>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>

              <div className="tier-title">GB stored</div>
              <div className="tier-row">
                <YAxis ticks={gbTicks} max={gbMax} height={LINE_TIER_HEIGHT} />
                <div className="plot line-plot" style={{ height: LINE_TIER_HEIGHT, width: plotWidth }}>
                  <Gridlines ticks={gbTicks} max={gbMax} />
                  <svg
                    className="line-svg"
                    width={plotWidth}
                    height={LINE_TIER_HEIGHT}
                    viewBox={`0 0 ${plotWidth} ${LINE_TIER_HEIGHT}`}
                    aria-hidden="true"
                  >
                    <polyline
                      className="gb-line"
                      points={gbPoints.map((point) => `${point.x},${point.y}`).join(' ')}
                    />
                    {gbPoints.map((point) => (
                      <circle
                        key={point.slot.hour}
                        className={`gb-dot ${statusClass(point.slot.gbStored)}`}
                        cx={point.x}
                        cy={point.y}
                        r={hovered === point.slot.hour ? 6 : 4.5}
                      />
                    ))}
                  </svg>
                  {slots.map((slot) => (
                    <div
                      key={slot.hour}
                      className={hovered === slot.hour ? 'column hovered' : 'column'}
                      style={{ width: slotWidth }}
                      onMouseEnter={() => setHovered(slot.hour)}
                      onMouseLeave={() => setHovered(null)}
                    />
                  ))}
                </div>
              </div>

              <div className="tier-row">
                <div className="y-axis-spacer" />
                <div className="x-axis">
                  {slots.map((slot) => (
                    <div key={slot.hour} className="x-label" style={{ width: slotWidth }}>
                      <span>{utcDate(slot.hour)}</span>
                      <span className="x-time">{utcTime(slot.hour)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function YAxis({ ticks, max, height }: { ticks: number[]; max: number; height: number }) {
  return (
    <div className="y-axis" style={{ height }}>
      {ticks.map((tick) => (
        <span key={tick} style={{ bottom: `${(tick / max) * 100}%` }}>
          {formatNumber(tick)}
        </span>
      ))}
    </div>
  );
}

function Gridlines({ ticks, max }: { ticks: number[]; max: number }) {
  return (
    <>
      {ticks.map((tick) => (
        <div key={tick} className="gridline" style={{ bottom: `${(tick / max) * 100}%` }} />
      ))}
    </>
  );
}

function buildSlots(records: UsageRecord[]): Slot[] {
  const byHour = new Map<string, Slot>();
  for (const record of records) {
    const slot = byHour.get(record.hour) ?? { hour: record.hour };
    if (record.dimension === 'api_calls') {
      slot.apiCalls = record;
    } else if (record.dimension === 'gb_stored') {
      slot.gbStored = record;
    }
    byHour.set(record.hour, slot);
  }
  return [...byHour.values()].sort((a, b) => a.hour.localeCompare(b.hour));
}

function statusClass(record: UsageRecord | undefined): string {
  return record?.status === 'REPORTED' ? 'reported' : 'recorded';
}

function valueText(record: UsageRecord | undefined): string {
  return record ? formatNumber(record.quantity) : '—';
}

function slotStatus(slot: Slot): string {
  const present = [slot.apiCalls, slot.gbStored].filter((record) => record !== undefined);
  return present.every((record) => record.status === 'REPORTED')
    ? 'Reported to billing'
    : 'Waiting to report';
}

// Round the axis to clean steps (1, 2, 5 × 10^n) with about four intervals.
function niceTicks(max: number): number[] {
  if (max <= 0) {
    return [0];
  }
  const rough = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? rough;
  const ticks: number[] = [];
  for (let tick = 0; tick < max + step; tick += step) {
    ticks.push(tick);
  }
  return ticks;
}
