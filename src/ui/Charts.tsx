import React from 'react';

/**
 * Pure-SVG charts — server-rendered, no chart library, no client JS.
 * Follows ui-ux-pro-max §10: legend always visible, colour is never the only cue
 * (every series/slice carries a label + value), subtle gridlines, tabular figures,
 * an aria summary for screen readers, and explicit empty states.
 */

const fmt = (n: number) => new Intl.NumberFormat('uz').format(n);

function ChartCard({
  title,
  subtitle,
  summary,
  children,
  empty,
}: {
  title: string;
  subtitle?: string;
  summary: string;
  children: React.ReactNode;
  empty?: boolean;
}) {
  return (
    <section className="card p-5">
      <header className="mb-4">
        <h3 className="text-sm font-semibold">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </header>
      {empty ? (
        <p className="py-10 text-center text-sm text-muted">Bu davr uchun maʼlumot yoʻq</p>
      ) : (
        <figure role="img" aria-label={summary}>
          {children}
        </figure>
      )}
    </section>
  );
}

export interface Series {
  label: string;
  color: string; // hex — SVG needs a real value, not a Tailwind class
  values: number[];
}

/** Grouped vertical bars — monthly trend (issued vs signed). */
export function BarChart({
  title,
  subtitle,
  categories,
  series,
}: {
  title: string;
  subtitle?: string;
  categories: string[];
  series: Series[];
}) {
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const W = 720;
  const H = 240;
  const padL = 34;
  const padB = 26;
  const innerW = W - padL - 8;
  const innerH = H - padB - 10;
  const groupW = innerW / Math.max(1, categories.length);
  const barW = Math.max(3, (groupW - 8) / series.length);

  // 4 subtle gridlines + axis ticks
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(max * t));
  const total = series.reduce((a, s) => a + s.values.reduce((x, y) => x + y, 0), 0);

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      empty={total === 0}
      summary={`${title}. ${series.map((s) => `${s.label}: ${fmt(s.values.reduce((a, b) => a + b, 0))}`).join(', ')}.`}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        {ticks.map((t, i) => {
          const y = 10 + innerH - (t / max) * innerH;
          return (
            <g key={i}>
              <line x1={padL} y1={y} x2={W - 8} y2={y} stroke="currentColor" strokeWidth={1} className="text-line" opacity={0.5} />
              <text x={padL - 6} y={y + 3} textAnchor="end" className="fill-current text-muted" fontSize={9}>{fmt(t)}</text>
            </g>
          );
        })}

        {categories.map((c, ci) => (
          <g key={c}>
            {series.map((s, si) => {
              const v = s.values[ci] ?? 0;
              const h = (v / max) * innerH;
              const x = padL + ci * groupW + 4 + si * barW;
              const y = 10 + innerH - h;
              return (
                <g key={s.label}>
                  <rect x={x} y={y} width={barW - 2} height={Math.max(v > 0 ? 2 : 0, h)} rx={2} fill={s.color}>
                    <title>{`${c} · ${s.label}: ${fmt(v)}`}</title>
                  </rect>
                  {v > 0 && (
                    <text x={x + (barW - 2) / 2} y={y - 3} textAnchor="middle" className="fill-current text-muted" fontSize={8}>
                      {fmt(v)}
                    </text>
                  )}
                </g>
              );
            })}
            <text x={padL + ci * groupW + groupW / 2} y={H - 8} textAnchor="middle" className="fill-current text-muted" fontSize={9}>
              {c}
            </text>
          </g>
        ))}
      </svg>

      <figcaption className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 text-xs text-muted">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label} <span className="font-semibold tabular-nums text-fg">{fmt(s.values.reduce((a, b) => a + b, 0))}</span>
          </span>
        ))}
      </figcaption>
    </ChartCard>
  );
}

export interface Slice {
  label: string;
  value: number;
  color: string;
}

/** Donut — status proportion. Max 4 statuses, so well inside the ≤5 rule. */
export function DonutChart({ title, subtitle, slices }: { title: string; subtitle?: string; slices: Slice[] }) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  const R = 60;
  const SW = 22;
  const C = 2 * Math.PI * R;
  let offset = 0;

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      empty={total === 0}
      summary={`${title}. Jami ${fmt(total)}. ${slices.map((s) => `${s.label}: ${fmt(s.value)}`).join(', ')}.`}
    >
      <div className="flex items-center gap-5">
        <svg viewBox="0 0 160 160" className="h-[150px] w-[150px] shrink-0 -rotate-90">
          <circle cx={80} cy={80} r={R} fill="none" stroke="currentColor" strokeWidth={SW} className="text-line" opacity={0.4} />
          {slices.map((s) => {
            if (s.value === 0) return null;
            const len = (s.value / total) * C;
            const el = (
              <circle
                key={s.label}
                cx={80} cy={80} r={R}
                fill="none"
                stroke={s.color}
                strokeWidth={SW}
                strokeDasharray={`${len} ${C - len}`}
                strokeDashoffset={-offset}
              >
                <title>{`${s.label}: ${fmt(s.value)} (${Math.round((s.value / total) * 100)}%)`}</title>
              </circle>
            );
            offset += len;
            return el;
          })}
        </svg>

        <ul className="min-w-0 flex-1 space-y-2">
          {slices.map((s) => (
            <li key={s.label} className="flex items-center gap-2 text-xs">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
              <span className="min-w-0 flex-1 truncate text-muted">{s.label}</span>
              <span className="font-semibold tabular-nums">{fmt(s.value)}</span>
              <span className="w-9 text-right tabular-nums text-muted">
                {total ? Math.round((s.value / total) * 100) : 0}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </ChartCard>
  );
}

/** Horizontal bars — comparison by firm (labels are long, so horizontal reads better). */
export function HBarChart({
  title,
  subtitle,
  rows,
  color = '#2563eb',
}: {
  title: string;
  subtitle?: string;
  rows: { label: string; value: number }[];
  color?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const total = rows.reduce((a, r) => a + r.value, 0);

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      empty={total === 0}
      summary={`${title}. ${rows.map((r) => `${r.label}: ${fmt(r.value)}`).join(', ')}.`}
    >
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.label}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
              <span className="min-w-0 truncate text-muted" title={r.label}>{r.label}</span>
              <span className="shrink-0 font-semibold tabular-nums">{fmt(r.value)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${Math.max(r.value > 0 ? 3 : 0, (r.value / max) * 100)}%`, background: color }}
              />
            </div>
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}
