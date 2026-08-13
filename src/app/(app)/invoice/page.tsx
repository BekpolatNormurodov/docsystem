import { redirect } from 'next/navigation';

// Invoice (buxgalteriya) is no longer a standalone step — it moved INTO Sud as a tab.
// Keep the old /invoice URL working by redirecting to /sud.
export default function InvoiceRedirect() {
  redirect('/sud');
}
