import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySession } from '@/core/session';

export async function getSession(): Promise<{ username: string } | null> {
  const token = cookies().get('docsystem_session')?.value;
  if (!token) return null;
  const payload = await verifySession(token);
  if (!payload) return null;
  return { username: payload.login };
}

export async function requireAdmin() {
  const s = await getSession();
  if (!s) redirect('/login');
  return s;
}
