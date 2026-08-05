import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const token = req.cookies.get('docsystem_session')?.value;
  const isLogin = req.nextUrl.pathname.startsWith('/login');
  const isAuthApi = req.nextUrl.pathname.startsWith('/api/auth');
  if (!token && !isLogin && !isAuthApi) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
