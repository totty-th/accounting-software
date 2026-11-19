import { apiUser } from '@/lib/auth';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /expenses/scan/file/{scanId}[?inline=1] → ไฟล์รูปบิล/PDF ที่อัปโหลด (M71)
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const au = await apiUser(['expenses.read', 'expenses.write']); if (au instanceof Response) return au;
  if (!/^[0-9a-f-]{36}$/.test(params.id)) return Response.json({ error: 'ไม่พบไฟล์' }, { status: 404 });
  const f = (await (await getDb()).q<any>(`select filename, mime, encode(data,'base64') b from doc_scans where id=$1`, [params.id]))[0];
  if (!f) return Response.json({ error: 'ไม่พบไฟล์' }, { status: 404 });
  const inline = new URL(req.url).searchParams.has('inline');
  return new Response(Buffer.from(f.b, 'base64'), { headers: { 'content-type': f.mime, 'x-content-type-options': 'nosniff',
    'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.filename)}`, 'cache-control': 'private, max-age=300' } });
}
