import Link from 'next/link';

/**
 * Server component on purpose: it takes an `hrefFor` function, and functions
 * cannot cross the RSC boundary into a client component.
 */
export function Pagination({
  page,
  pages,
  total,
  perPage,
  hrefFor,
}: {
  page: number;
  pages: number;
  total: number;
  perPage: number;
  hrefFor: (p: number) => string;
}) {
  if (pages <= 1) return null;
  return (
    <nav className="mt-4 flex items-center justify-between gap-3" aria-label="Sahifalash">
      <p className="text-xs tabular-nums text-muted">
        {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} / {total}
      </p>
      <div className="flex items-center gap-1">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} className="btn-ghost px-3 py-1.5 text-xs">← Oldingi</Link>
        ) : (
          <span className="btn-ghost pointer-events-none px-3 py-1.5 text-xs opacity-40">← Oldingi</span>
        )}
        <span className="px-3 text-xs tabular-nums text-muted">{page} / {pages}</span>
        {page < pages ? (
          <Link href={hrefFor(page + 1)} className="btn-ghost px-3 py-1.5 text-xs">Keyingi →</Link>
        ) : (
          <span className="btn-ghost pointer-events-none px-3 py-1.5 text-xs opacity-40">Keyingi →</span>
        )}
      </div>
    </nav>
  );
}
