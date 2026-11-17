// The path prefix the app is served under — '' at a domain root, '/yurist' behind a front proxy that
// gives each service its own path on one domain (mko-crm.uz/yurist).
//
// It is NEXT_PUBLIC_BASE_PATH, read by next.config.js (`basePath`) AND inlined into the client bundles
// at build time, so the two cannot disagree. Next adds it to <Link>, router.push/replace/prefetch and
// redirect() by itself; it does NOT add it to a plain <a href>, <img src>, fetch(), EventSource,
// window.location, a Response/NextResponse redirect or a cookie Path — those go through BASE_PATH / withBase().
function clean(raw: string | undefined): string {
  const v = (raw ?? '').trim().replace(/\/+$/, '');
  return v && !v.startsWith('/') ? `/${v}` : v;
}

export const BASE_PATH = clean(process.env.NEXT_PUBLIC_BASE_PATH);

/** An app-absolute path ('/api/x?y=1') with the base path in front; anything else is returned as it is. */
export function withBase(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  // Idempotent: a wrapper (fetch helper, KeyPicker, ExcelButton) may be handed a path that already carries it.
  if (BASE_PATH && (path === BASE_PATH || path.startsWith(`${BASE_PATH}/`) || path.startsWith(`${BASE_PATH}?`))) return path;
  return `${BASE_PATH}${path}`;
}

/** The path without the base prefix ('/yurist/login' → '/login'); unchanged when it has none. */
export function stripBase(path: string): string {
  if (!BASE_PATH) return path;
  if (path === BASE_PATH) return '/';
  return path.startsWith(`${BASE_PATH}/`) || path.startsWith(`${BASE_PATH}?`) ? path.slice(BASE_PATH.length) : path;
}
