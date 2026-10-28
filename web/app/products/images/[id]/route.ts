import { apiUser } from '@/lib/auth';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /products/images/:id → ไฟล์รูปสินค้า (ต้องล็อกอินและมีสิทธิ์ดูสินค้า)
export async function GET(_: Request, { params }: { params: { id: string } }) {
  const au = await apiUser('master.read'); if (au instanceof Response) return au;
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return new Response('Not found', { status: 404 });
  const [r] = await (await getDb()).q<any>('select mime, data from product_images where id = $1', [params.id]);
  if (!r) return new Response('Not found', { status: 404 });
  return new Response(Buffer.from(r.data), { headers: { 'Content-Type': r.mime, 'Cache-Control': 'private, max-age=3600' } });
}
