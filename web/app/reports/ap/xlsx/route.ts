import { buildXlsx, xlsxResponse } from '@/lib/aging';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  const asof = u.get('asof') || undefined;
  return xlsxResponse(await buildXlsx('ap', { asof, contact: u.get('contact') || undefined }), `ap-aging-${asof ?? 'today'}`);
}
