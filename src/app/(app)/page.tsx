import { redirect } from 'next/navigation';

// Kalendar boʻlimi olib tashlandi — bosh sahifa toʻgʻridan-toʻgʻri Hujjatlarga oʻtadi.
export default function Home() {
  redirect('/hujjatlar');
}
