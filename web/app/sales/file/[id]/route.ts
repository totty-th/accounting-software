import { apiUser, canViewSalesDoc } from '@/lib/auth';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /sales/file/{fileId} → ดาวน์โหลดไฟล์แนบของเอกสารขาย (ต้องมีสิทธิ์ดูเอกสารนั้น)
export async function GET(_: Request, { params }: { params: { id: string } }) {
  const au = await apiUser(['sales.read', 'quote.own']); if (au instanceof Response) return au;
  if (!/^[0-9a-f-]{36}$/.test(params.id)) return Response.json({ error: 'ไม่พบไฟล์' }, { status: 404 });
  const f = (await (await getDb()).q<any>(`select doc_id, filename, mime, encode(data,'base64') b from sales_doc_files where id=$1`, [params.id]))[0];
  if (!f || !(await canViewSalesDoc(au, f.doc_id))) return Response.json({ error: 'ไม่พบไฟล์' }, { status: 404 });
  return new Response(Buffer.from(f.b, 'base64'), { headers: { 'content-type': f.mime,
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.filename)}`, 'cache-control': 'no-store' } });
}
