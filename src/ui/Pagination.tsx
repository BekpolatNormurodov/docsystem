import Link from 'next/link';

/** Windowed page list: 1 … (cur-1) cur (cur+1) … last, with `null` marking an ellipsis gap. */
function pageWindow(cur: number, total: number): (number | null)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const nums = new Set<number>([1, total, cur - 1, cur, cur + 1]);
  const sorted = [...nums].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out: (number | null)[] = [];
  let prev = 0;
  for (const n of sorted) {
    if (n - prev > 1) out.push(null);
    out.push(n);
    prev = n;
  }
  return out;
}

/**
 * Ideal shared pager: a "showing X–Y of N" range on the left, numbered window with ‹ › arrows on the
 * right. Server component — takes an `hrefFor` function (functions can't cross the RSC boundary).
 */
export function Pagination({
  page,
  pages,
  total,
  perPage,
  hrefFor,
  unit = 'natija',
}: {
  page: number;
  pages: number;
  total: number;
  perPage: number;
  hrefFor: (p: number) => string;
  /** Noun for the range summary, e.g. "mijoz". */
  unit?: string;
}) {
  if (pages <= 1) {
    return (
      <p className="mt-4 text-center text-xs text-muted">
        {total.toLocaleString('ru-RU')} {unit}
      </p>
    );
  }

  const from = (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);
  const arrow = 'grid h-9 min-w-9 place-items-center rounded-lg border px-2 text-sm transition';

  return (
    <nav className="mt-6 flex flex-col items-center justify-between gap-3 sm:flex-row" aria-label="Sahifalash">
      <p className="text-xs tabular-nums text-muted">
        <span className="font-semibold text-fg">{from.toLocaleString('ru-RU')}</span>–
        <span className="font-semibold text-fg">{to.toLocaleString('ru-RU')}</span> / {total.toLocaleString('ru-RU')} {unit}
      </p>

      <div className="flex items-center gap-1">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} aria-label="Oldingi" className={`${arrow} border-line hover:bg-surface-2`}>
            ‹
          </Link>
        ) : (
          <span className={`${arrow} pointer-events-none border-line opacity-40`}>‹</span>
        )}

        {pageWindow(page, pages).map((n, i) =>
          n === null ? (
            <span key={`gap-${i}`} className="px-1.5 text-muted">
              …
            </span>
          ) : (
            <Link
              key={n}
              href={hrefFor(n)}
              aria-current={n === page ? 'page' : undefined}
              className={`${arrow} tabular-nums ${
                n === page ? 'border-brand-600 bg-brand-600 font-semibold text-white' : 'border-line hover:bg-surface-2'
              }`}
            >
              {n}
            </Link>
          ),
        )}

        {page < pages ? (
          <Link href={hrefFor(page + 1)} aria-label="Keyingi" className={`${arrow} border-line hover:bg-surface-2`}>
            ›
          </Link>
        ) : (
          <span className={`${arrow} pointer-events-none border-line opacity-40`}>›</span>
        )}
      </div>
    </nav>
  );
}
