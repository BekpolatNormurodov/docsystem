import { redirect } from 'next/navigation';

// «Partiyalar tarixi» now lives as a tab inside Amaliyotlar (/jurnal). Keep this route as a permanent
// redirect so old links / bookmarks still land in the right place.
export default function TarixPage() {
  redirect('/jurnal?tab=tarix');
}
