import Link from 'next/link';
import { notFound } from 'next/navigation';
import { can } from '@/lib/permissions';
import { requirePage } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { money, dateTh, dateIso } from '@/lib/format';
import { ASSET_STATUS, DISPOSE_TYPE, assetCats, usedText } from '@/lib/assets';
import { AssetFiles } from '@/components/AssetFiles';
import { AssetForm, AssetStatusBtn, DisposePanel, ReopenBtn, DeleteAssetBtn, type AssetVal } from '@/components/AssetForm';

export default async function AssetPage({ params }: { params: { id: string } }) {
  const user = await requirePage('expenses.read');
  const W = can(user.role, 'expenses.write');
  if (!/^[0-9a-f-]{36}$/.test(params.id)) notFound();
  const db = await getDb(), t = today();
  const a = (await db.q<any>(`select a.*, c.name cat_name, asset_annual(a) annual, asset_accum_at(a, $2::date) accum, e.exp_no,
      v.voucher_no disp_no from fixed_assets a join asset_categories c on c.id = a.category_id left join expenses e on e.id = a.expense_id
      left join journal_vouchers v on v.id = a.disposal_voucher_id where a.id = $1`, [params.id, t]))[0];
  if (!a || a.status === 'void') notFound();
  const cats = (await assetCats()).filter(c => c.is_active || c.id === a.category_id).map(c => ({ id: c.id, name: c.name, depreciate: c.depreciate, life_years: c.life_years ? Number(c.life_years) : null }));
  const gone = ['sold', 'disposed'].includes(a.status);
  const end = gone ? dateIso(a.disposed_date) : t;
  const init: AssetVal = { id: a.id, code: a.code, name: a.name, description: a.description ?? '', ref_no: a.ref_no ?? '', category_id: a.category_id, qty: String(Number(a.qty)), unit: a.unit ?? '',
    purchase_date: dateIso(a.purchase_date), start_date: dateIso(a.start_date), cost: String(Number(a.cost)), depreciate: a.depreciate, salvage: String(Number(a.salvage)),
    life_years: a.life_years ? String(Number(a.life_years)) : '', hasOpen: Number(a.accum_open) > 0, accum_open: Number(a.accum_open) > 0 ? String(Number(a.accum_open)) : '', calc_start: dateIso(a.calc_start),
    vendor: a.vendor ?? '', serial_no: a.serial_no ?? '', warranty_end: a.warranty_end ? dateIso(a.warranty_end) : '', location: a.location ?? '', user_name: a.user_name ?? '', note: a.note ?? '' };
  const jv = await db.q<any>(`select distinct v.voucher_no, v.voucher_date, v.source_type from journal_vouchers v
    where v.source_type = 'ASSET_DISP' and v.source_id = $1 order by v.voucher_date`, [a.id]);
  const files = await db.q<any>('select id, filename, mime, size from fixed_asset_files where asset_id=$1 order by created_at', [a.id]);
  return (<>
    <div className="top"><div><h1>{gone ? 'สินทรัพย์ที่เลิกใช้งาน' : 'แก้ไขสินทรัพย์'} {a.code} <span className={`pill ${ASSET_STATUS[a.status][1]}`}>{ASSET_STATUS[a.status][0]}</span></h1>
      <p className="sub">{a.cat_name}{a.exp_no && <> · จากเอกสารค่าใช้จ่าย <Link href={`/expenses/${a.expense_id}`}>{a.exp_no}</Link></>}</p></div>
      <div className="acts"><Link className="btn sm ghost" href="/assets">กลับไปรายการ</Link>
        {W && !gone && <AssetStatusBtn id={a.id} status={a.status} />}{W && gone && <ReopenBtn id={a.id} />}{W && !gone && !a.expense_id && <DeleteAssetBtn id={a.id} />}</div></div>
    <div className="cards" style={{ marginBottom: 12 }}>
      <div className="card kpi" style={{ ['--c' as any]: 'var(--purple)' }}><span>ราคาซื้อ</span><b>{money(a.cost)}</b></div>
      <div className="card kpi" style={{ ['--c' as any]: 'var(--green)' }}><span>มูลค่าทางบัญชี{gone ? ' (ณ วันเลิกใช้)' : ' (ปัจจุบัน)'}</span><b>{money(Number(a.cost) - Number(a.accum))}</b></div>
      <div className="card kpi" style={{ ['--c' as any]: 'var(--blue)' }}><span>ระยะเวลาใช้งาน</span><b>{usedText(dateIso(a.start_date), end < dateIso(a.start_date) ? dateIso(a.start_date) : end)}</b></div>
      <div className="card kpi" style={{ ['--c' as any]: 'var(--orange)' }}><span>ค่าเสื่อมราคาสะสม</span><b>{money(a.accum)}</b></div>
    </div>
    {gone && <section className="panel" style={{ padding: 16, marginBottom: 12 }}>
      <b>{DISPOSE_TYPE[a.dispose_type]}เมื่อ {dateTh(a.disposed_date)}</b>{a.sale_price != null && <> · มูลค่าที่ขาย {money(a.sale_price)} · กำไร(ขาดทุน) {money(Number(a.sale_price) - (Number(a.cost) - Number(a.accum)))}</>}
      {a.disp_no && <> · ใบสำคัญ {a.disp_no}</>}{a.dispose_note && <p className="sub">{a.dispose_note}</p>}</section>}
    <AssetForm cats={cats} today={t} init={init} locked={!!a.expense_id} readOnly={gone || !W} />
    <section className="panel" style={{ padding: 16, marginTop: 12 }}><h3 style={{ marginTop: 0 }}>แนบเอกสาร/รูปภาพ</h3><AssetFiles id={a.id} files={files} canWrite={W} /></section>
    {W && !gone && <div style={{ marginTop: 12 }}><DisposePanel id={a.id} today={t} cost={Number(a.cost)} annual={Number(a.annual)} accumOpen={Number(a.accum_open)} calcStart={dateIso(a.calc_start)}
      startDate={dateIso(a.start_date)} depreciate={a.depreciate} salvage={Number(a.salvage)} /></div>}
    {jv.length > 0 && <p className="sub">ใบสำคัญที่เกี่ยวข้อง: {jv.map(j => j.voucher_no).join(', ')}</p>}
  </>);
}
