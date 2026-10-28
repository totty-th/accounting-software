import { apiUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { revalidatePath } from 'next/cache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const MAX_BYTES = 4 * 1024 * 1024;   // ข้อจำกัดของโฮสต์ (FA = 5 MB) · เบราว์เซอร์ย่อรูปก่อนส่งอยู่แล้ว

// POST /products/images/upload (multipart: product, file) → { id }
export async function POST(req: Request) {
  const au = await apiUser('master.write'); if (au instanceof Response) return au;
  const fd = await req.formData();
  const f = fd.get('file'); const product = String(fd.get('product') ?? '');
  if (!(f instanceof File)) return Response.json({ error: 'ไม่พบไฟล์รูป' }, { status: 400 });
  if (f.size > MAX_BYTES) return Response.json({ error: 'รูปใหญ่เกิน 4 MB' }, { status: 400 });
  const buf = Buffer.from(await f.arrayBuffer());
  try {
    const [r] = await (await getDb()).q<any>('select add_product_image($1, $2, $3, $4) id', [product, f.name, f.type, buf]);
    revalidatePath('/products'); revalidatePath(`/products/${product}`);
    return Response.json({ id: r.id });
  } catch (e: any) { return Response.json({ error: String(e?.message ?? e).replace(/^error:\s*/i, '') }, { status: 400 }); }
}
