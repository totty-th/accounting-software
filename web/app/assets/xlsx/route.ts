import { apiUser } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { listAssets } from '@/lib/assets';
import { assetListXlsx } from '@/lib/assets-xlsx';
import { send } from '@/lib/fa-xlsx';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// GET /assets/xlsx?asof=… (ตัวกรองช่วงวันที่ไม่มีผลกับไฟล์ ตามต้นแบบ) → รายการสินทรัพย์ ณ วันที่
export async function GET(req: Request) {
  const au = await apiUser(['expenses.read']); if (au instanceof Response) return au;
  const q = new URL(req.url).searchParams;
  const asof = /^\d{4}-\d{2}-\d{2}$/.test(q.get('asof') ?? '') ? q.get('asof')! : today();
  const rows = await listAssets({ asof, status: q.get('status') || undefined, cat: q.get('cat') || undefined, q: q.get('q') || undefined });
  return send(await assetListXlsx(await getDb(), rows, asof, today()), 'รายการสินทรัพย์');
}
