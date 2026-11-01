import { apiUser } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { depRows } from '@/lib/assets';
import { depXlsx } from '@/lib/assets-xlsx';
import { send } from '@/lib/fa-xlsx';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(req: Request) {
  const au = await apiUser(['expenses.read']); if (au instanceof Response) return au;
  const y = Number(new URL(req.url).searchParams.get('year')) || Number(today().slice(0, 4));
  const rows = await depRows(`${y}-01-01`, `${y}-12-31`);
  return send(await depXlsx(await getDb(), rows, y, today()), 'ตารางคำนวณค่าเสื่อมราคา');
}
