// Position history of a competitor and of you for one keyword, over the competition checks (top 20).
import { formatDate } from '../shared/metrics';

const WIDTH = 700;
const HEIGHT = 220;
const PAD = { left: 40, right: 16, top: 12, bottom: 28 };
const WORST = 20;

export interface ChartSeries {
  label: string;
  className: string;
  /** date -> position, missing = not in the top 20. */
  points: Record<string, number>;
}

export function CompetitorChart({ dates, series }: { dates: string[]; series: ChartSeries[] }) {
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (dates.length > 1 ? (i / (dates.length - 1)) * plotW : plotW / 2);
  const y = (position: number) => PAD.top + ((position - 1) / (WORST - 1)) * plotH;
  const labelEvery = Math.max(1, Math.ceil(dates.length / 6));

  if (dates.length === 0) return <p className="muted">No checks yet.</p>;

  return (
    <div className="chart">
      <div className="row chart-legend">
        {series.map((s) => (
          <span key={s.label} className={`legend ${s.className}`}>
            {s.label}
          </span>
        ))}
        <span className="hint">Missing points: not in the top 20.</span>
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="chart-svg">
        {[1, 5, 10, 15, 20].map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(t)} y2={y(t)} className="grid" />
            <text x={PAD.left - 8} y={y(t) + 4} className="axis" textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {dates.map((date, i) =>
          i % labelEvery === 0 ? (
            <text key={date} x={x(i)} y={HEIGHT - 8} className="axis" textAnchor="middle">
              {formatDate(date)}
            </text>
          ) : null,
        )}
        {series.map((s) => {
          let path = '';
          let inRun = false;
          dates.forEach((date, i) => {
            const position = s.points[date];
            if (position === undefined) {
              inRun = false;
              return;
            }
            path += `${inRun ? 'L' : 'M'}${x(i).toFixed(1)},${y(position).toFixed(1)}`;
            inRun = true;
          });
          return (
            <g key={s.label} className={s.className}>
              <path d={path} className="series-line" />
              {dates.map((date, i) => {
                const position = s.points[date];
                return position === undefined ? null : (
                  <circle key={date} cx={x(i)} cy={y(position)} r={3.5} className="series-dot">
                    <title>{`${s.label} · ${formatDate(date)}: #${position}`}</title>
                  </circle>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
