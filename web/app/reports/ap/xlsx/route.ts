import { apiUser } from '@/lib/auth';
import { buildXlsx, xlsxResponse } from '@/lib/aging';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(req: Request) {
  const au = await apiUser('reports.read'); if (au instanceof Response) return au;
  const u = new URL(req.url).searchParams;
  const asof = u.get('asof') || undefined;
  return xlsxResponse(await buildXlsx('ap', { asof, contact: u.get('contact') || undefined, coa: u.get('coa') || undefined }), `ap-aging-${asof ?? 'today'}${u.get('coa') === '1' ? '-coa' : ''}`);
}
