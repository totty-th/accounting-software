import { getDb } from './db';
import { dateIso } from './format';

export const ASSET_STATUS: Record<string, [string, string]> = {
  in_use: ['ใช้งานอยู่', 'green'], suspended: ['พักการใช้งาน', 'amber'], sold: ['ขาย', 'blue'], disposed: ['บริจาค/ทำลาย', 'grey'], void: ['ยกเลิก', 'grey'],
};
export const DISPOSE_TYPE: Record<string, string> = { sold: 'ขาย', donated: 'บริจาค', destroyed: 'ทำลาย' };

/** ระยะเวลาใช้งาน "N ปี M เดือน" (นับเต็มเดือน) */
export function usedText(start: string, end: string) {
  const s = new Date(start + 'T00:00:00Z'), e = new Date(end + 'T00:00:00Z');
  let m = (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + e.getUTCMonth() - s.getUTCMonth();
  if (e.getUTCDate() < s.getUTCDate()) m -= 1;
  m = Math.max(0, m);
  return `${Math.floor(m / 12)} ปี ${m % 12} เดือน`;
}

export interface AssetFilter { q?: string; status?: string; cat?: string; from?: string; to?: string; asof: string }
/** รายการสินทรัพย์พร้อมมูลค่าทางบัญชี ณ วันที่ asof (สินทรัพย์ที่เลิกใช้แล้วมูลค่าคงที่ ณ วันเลิกใช้) */
export async function listAssets(f: AssetFilter) {
  const db = await getDb();
  const rows = await db.q<any>(`select a.*, c.name cat_name, c.sort_no, asset_accum_at(a, $1::date) accum,
      a.cost - asset_accum_at(a, $1::date) book, e.exp_no
    from fixed_assets a join asset_categories c on c.id = a.category_id left join expenses e on e.id = a.expense_id
    where a.status <> 'void'
      and ($2::text is null or a.code ilike '%'||$2||'%' or a.name ilike '%'||$2||'%' or a.vendor ilike '%'||$2||'%' or a.serial_no ilike '%'||$2||'%')
      and ($3::text is null or ($3 = 'sold_group' and a.status in ('sold','disposed')) or a.status = $3)
      and ($4::uuid is null or a.category_id = $4)
      and ($5::date is null or a.start_date >= $5) and ($6::date is null or a.start_date <= $6)
    order by c.sort_no, a.start_date, a.code`,
    [f.asof, f.q?.trim() || null, f.status || null, f.cat || null, f.from || null, f.to || null]);
  return rows.map(r => ({ ...r, purchase: dateIso(r.purchase_date), start: dateIso(r.start_date), disp: r.disposed_date ? dateIso(r.disposed_date) : '' }));
}
export const assetCats = async () => (await getDb()).q<any>(`select * from asset_categories order by sort_no`);

/** ตารางคำนวณค่าเสื่อมของช่วง [from,to] (ปฏิทิน) · เฉพาะสินทรัพย์ที่เริ่มใช้งานก่อนสิ้นช่วง และยังไม่เลิกใช้ก่อนต้นช่วง */
export async function depRows(from: string, to: string) {
  const db = await getDb();
  const rows = await db.q<any>(`select a.*, c.name cat_name, c.sort_no,
      asset_accum_at(a, $1::date - 1) accum_in, a.cost - asset_accum_at(a, $1::date - 1) book_in,
      asset_dep_days(a, $1::date, $2::date) days, asset_dep_period(a, $1::date, $2::date) dep,
      asset_accum_at(a, $2::date) accum_out, a.cost - asset_accum_at(a, $2::date) book_out,
      asset_rate(a.life_years) rate, e.exp_no
    from fixed_assets a join asset_categories c on c.id = a.category_id left join expenses e on e.id = a.expense_id
    where a.status <> 'void' and a.depreciate and a.start_date <= $2::date and (a.disposed_date is null or a.disposed_date >= $1::date)
    order by c.sort_no, a.start_date, a.code`, [from, to]);
  return rows.map(r => ({ ...r, purchase: dateIso(r.purchase_date), start: dateIso(r.start_date), disp: r.disposed_date ? dateIso(r.disposed_date) : '' }));
}
export const num = (v: unknown) => Number(v ?? 0);
export const sum = (rs: any[], k: string) => Math.round(rs.reduce((s, r) => s + num(r[k]), 0) * 100) / 100;
export const dmy = (iso: string) => (iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : '');
