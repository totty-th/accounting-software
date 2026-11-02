import { apiUser } from '@/lib/auth';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /assets/file/{fileId} → ไฟล์แนบ/รูปของสินทรัพย์ (ต้องมีสิทธิ์ดูค่าใช้จ่าย) · ?dl=1 = ดาวน์โหลด ไม่ใส่ = แสดงรูปในหน้า
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const au = await apiUser(['expenses.read']); if (au instanceof Response) return au;
  if (!/^[0-9a-f-]{36}$/.test(params.id)) return Response.json({ error: 'ไม่พบไฟล์' }, { status: 404 });
  const f = (await (await getDb()).q<any>(`select filename, mime, encode(data,'base64') b from fixed_asset_files where id=$1`, [params.id]))[0];
  if (!f) return Response.json({ error: 'ไม่พบไฟล์' }, { status: 404 });
  const img = /^image\/(png|jpe?g|gif|webp)$/.test(f.mime) && !new URL(req.url).searchParams.get('dl');
  return new Response(Buffer.from(f.b, 'base64'), { headers: { 'content-type': img ? f.mime : 'application/octet-stream',
    'content-disposition': `${img ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.filename)}`, 'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store' } });
}
