import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE, verifySession } from '@/lib/session';

// ต้องล็อกอินทุกหน้า ยกเว้นหน้าล็อกอินและลิงก์แชร์เอกสารของลูกค้า (/s/... และ /r/...)
export async function middleware(req: NextRequest) {
  const p = req.nextUrl.pathname;
  if (p === '/login' || p.startsWith('/s/') || p.startsWith('/r/') || p.startsWith('/p/')) return NextResponse.next();
  if (await verifySession(req.cookies.get(COOKIE)?.value)) return NextResponse.next();
  const url = req.nextUrl.clone(); url.pathname = '/login'; url.search = '';
  const res = NextResponse.redirect(url);
  if (req.cookies.get(COOKIE)) res.cookies.delete(COOKIE);
  return res;
}
export const config = { matcher: ['/((?!_next/|favicon\\.ico|fonts/).*)'] };
