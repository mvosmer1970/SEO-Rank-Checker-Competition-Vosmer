// Line chart of the daily average position of one keyword (position 1 at the top).
import { useMemo, useState } from 'react';
import type { DayMetrics } from '../shared/types';
import { daysAgo, formatDate, isoDate, validDays } from '../shared/metrics';

const RANGES: [number, string][] = [
  [30, '30 days'],
  [90, '3 months'],
  [180, '6 months'],
  [486, '16 months'],
];

const WIDTH = 900;
const HEIGHT = 260;
const PAD = { left: 44, right: 16, top: 12, bottom: 28 };

interface Point {
  date: string;
  x: number;
  y: number;
  metrics: DayMetrics;
}

export function RankChart({ days: allDays }: { days: Record<string, DayMetrics> }) {
  const [range, setRange] = useState(90);
  const [hover, setHover] = useState<Point | undefined>();

  const chart = useMemo(() => {
    const days = validDays(allDays);
    const from = daysAgo(range - 1);
    const dates: string[] = [];
    for (let d = new Date(`${from}T00:00:00`), today = daysAgo(0); isoDate(d) <= today; d.setDate(d.getDate() + 1)) {
      dates.push(isoDate(d));
    }
    const values = dates.flatMap((date) => {
      const metrics = days[date];
      return metrics ? [metrics.position] : [];
    });
    const worst = Math.max(10, Math.ceil(Math.max(...values, 1) / 5) * 5);
    const plotW = WIDTH - PAD.left - PAD.right;
    const plotH = HEIGHT - PAD.top - PAD.bottom;
    const x = (i: number) => PAD.left + (dates.length > 1 ? (i / (dates.length - 1)) * plotW : plotW / 2);
    const y = (position: number) => PAD.top + ((position - 1) / (worst - 1)) * plotH;

    // One path segment per run of consecutive days with data; days without impressions are gaps.
    const points: Point[] = [];
    let path = '';
    let inRun = false;
    dates.forEach((date, i) => {
      const metrics = days[date];
      if (!metrics) {
        inRun = false;
        return;
      }
      const point = { date, x: x(i), y: y(metrics.position), metrics };
      points.push(point);
      path += `${inRun ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`;
      inRun = true;
    });

    const step = worst <= 10 ? 1 : worst <= 30 ? 5 : 10;
    const ticks = [1];
    for (let t = step; t <= worst; t += step) if (t !== 1) ticks.push(t);
    const labelEvery = Math.max(1, Math.ceil(dates.length / 6));
    const dateLabels = dates.flatMap((date, i) => (i % labelEvery === 0 ? [{ date, x: x(i) }] : []));
    return { points, path, ticks, y, dateLabels };
  }, [allDays, range]);

  return (
    <div className="chart">
      <div className="row chart-toolbar">
        {RANGES.map(([value, label]) => (
          <button key={value} className={`chip${range === value ? ' active' : ''}`} onClick={() => setRange(value)}>
            {label}
          </button>
        ))}
        <span className="hint chart-hover">
          {hover
            ? `${formatDate(hover.date)}: position ${hover.metrics.position.toFixed(1)} · ${hover.metrics.clicks} clicks · ${hover.metrics.impressions} impressions`
            : chart.points.length === 0
              ? 'No impressions in this period.'
              : 'Hover the line for details.'}
        </span>
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="chart-svg" onMouseLeave={() => setHover(undefined)}>
        {chart.ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={chart.y(t)} y2={chart.y(t)} className="grid" />
            <text x={PAD.left - 8} y={chart.y(t) + 4} className="axis" textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {chart.dateLabels.map((l) => (
          <text key={l.date} x={l.x} y={HEIGHT - 8} className="axis" textAnchor="middle">
            {formatDate(l.date)}
          </text>
        ))}
        <path d={chart.path} className="line" />
        {chart.points.map((p) => (
          <circle
            key={p.date}
            cx={p.x}
            cy={p.y}
            r={hover?.date === p.date ? 5 : chart.points.length > 120 ? 0 : 2.5}
            className="dot"
          />
        ))}
        {/* Invisible wide targets for hovering. */}
        {chart.points.map((p) => (
          <rect key={`h${p.date}`} x={p.x - 6} y={PAD.top} width={12} height={HEIGHT - PAD.top - PAD.bottom} fill="transparent" onMouseEnter={() => setHover(p)} />
        ))}
      </svg>
    </div>
  );
}
