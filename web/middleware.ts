import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE, verifySession } from '@/lib/session';

// ต้องล็อกอินทุกหน้า ยกเว้นหน้าล็อกอิน ตัวอ่าน PDF (worker) และลิงก์แชร์เอกสารของลูกค้า (/s/... และ /r/...)
export async function middleware(req: NextRequest) {
  const p = req.nextUrl.pathname;
  // ย้ายระบบแล้ว (ตั้ง MOVED_TO บนที่เก่า เช่น Vercel) → ส่งทุกหน้าไปที่อยู่ใหม่ กันคนบันทึกลงฐานเก่า
  const moved = process.env.MOVED_TO;
  if (moved) return NextResponse.redirect(new URL(p + req.nextUrl.search, moved), 307);
  if (p === '/login' || p === '/setup' || p === '/pdf.worker.min.mjs' || p.startsWith('/s/') || p.startsWith('/r/') || p.startsWith('/p/')) return NextResponse.next();
  if (await verifySession(req.cookies.get(COOKIE)?.value)) return NextResponse.next();
  const url = req.nextUrl.clone(); url.pathname = '/login'; url.search = '';
  const res = NextResponse.redirect(url);
  if (req.cookies.get(COOKIE)) res.cookies.delete(COOKIE);
  return res;
}
export const config = { matcher: ['/((?!_next/|favicon\\.ico|fonts/).*)'] };
