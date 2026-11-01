import { can } from '@/lib/permissions';
import { requirePage } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { money, dateTh, partyName } from '@/lib/format';
import { WhtStatus } from '@/components/WhtStatus';
import { WhtForm, type WhtInit } from '@/components/WhtForm';
import * as A from '@/lib/actions';

const CATS: [string, string][] = [['1', '1. เงินเดือน ค่าจ้าง 40(1)'], ['2', '2. ค่านายหน้า 40(2)'], ['3', '3. ค่าลิขสิทธิ์ 40(3)'],
  ['4a', '4(ก) ดอกเบี้ย'], ['5', '5. ค่าจ้างทำของ ค่าเช่า ค่าบริการ ฯลฯ'], ['6', '6. อื่น ๆ']];
const FORM_TH: Record<string, string> = { PND3: 'ภงด 3', PND53: 'ภงด 53', PND1K: 'ภงด 1ก', PND1KS: 'ภงด 1ก (พิเศษ)', PND2: 'ภงด 2', PND2K: 'ภงด 2ก', PND3K: 'ภงด 3ก' };
const CONDS: [string, string][] = [['withhold', 'หัก ณ ที่จ่าย'], ['forever', 'ออกให้ตลอดไป'], ['once', 'ออกให้ครั้งเดียว'], ['other', 'อื่น ๆ']];

type SP = { q?: string; status?: string; dup?: string };
const STAT: [string, string][] = [['', 'แสดงทั้งหมด'], ['active', 'ดำเนินการแล้ว'], ['pending', 'รอดำเนินการ'], ['cancelled', 'ยกเลิก']];
export default async function Wht({ searchParams }: { searchParams: SP }) {
  const user = await requirePage('wht.read');
  const W = can(user.role, 'wht.write');
  const db = await getDb();
  const q = (searchParams.q ?? '').trim().toLowerCase(), st = searchParams.status ?? '';
  const all = await db.q(`select w.*, e.exp_no, c.id contact_id, c.business_name, c.contact_name, c.tax_id, c.address, c.person_kind,
      (select d->'missing' from (select wht_cert_data(w.id) d where w.status='active') x) missing
    from wht_certs w left join expenses e on e.id=w.expense_id join contacts c on c.id=w.contact_id
    order by w.pay_date desc, w.cert_no desc`);
  const rows = all.filter(r => (!st || r.status === st) && (!q || `${r.cert_no} ${partyName(r)} ${r.exp_no ?? ''}`.toLowerCase().includes(q)));
  const lineRows = await db.q(`select cert_id, income_type, rate, wht, count(*) over (partition by cert_id) n, row_number() over (partition by cert_id order by line_no) rn from wht_cert_lines`);
  const rateOf = (id: string) => { const ls = lineRows.filter(l => l.cert_id === id); return ls.length === 0 ? '' : ls.length > 1 ? 'หลายอัตรา' : ls[0].rate != null ? `${+ls[0].rate}%` : money(ls[0].wht); };
  let init: WhtInit | undefined;
  if (searchParams.dup) {
    const d = all.find(r => r.id === searchParams.dup);
    if (d) { const ls = await db.q(`select * from wht_cert_lines where cert_id=$1 order by line_no`, [d.id]);
      init = { contact: d.contact_id, form: d.form_code, lines: ls.map(l => ({ income_type: l.income_type, rate: l.rate != null ? String(+l.rate) : 'fixed', amount: String(+l.amount), vat_mode: l.vat_mode, wht: String(+l.wht) })) }; }
  }
  const vendors = (await db.q(`select id, business_name, contact_name, tax_id, address from contacts where not is_cash_default order by business_name nulls last, contact_name`)).map(c => ({ id: c.id as string, label: partyName(c), tax_id: c.tax_id as string | null, address: c.address as string | null }));
  const company = (await db.q('select * from company_profile'))[0];
  return (
    <>
      <div className="top"><div><h1>หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ)</h1>
        <p className="sub">ออกอัตโนมัติเมื่อจ่ายเงิน พิมพ์ลงแบบมาตรฐานกรมสรรพากร · ต้องมีข้อมูลบริษัทและผู้ถูกหักครบจึงออก PDF ได้</p></div>
        <a className="btn ghost" href="/settings/company">{company ? 'ข้อมูลบริษัทผู้จ่าย' : '⚠ ตั้งค่าข้อมูลบริษัท'}</a></div>
      {W && <WhtForm today={today()} vendors={vendors} init={init} key={searchParams.dup ?? 'new'} />}
      <form className="noprint" style={{ display: 'flex', gap: 8, margin: '10px 0', flexWrap: 'wrap', alignItems: 'center' }}>
        <input name="q" defaultValue={searchParams.q ?? ''} placeholder="ค้นหาเลขที่ / ผู้ถูกหัก" style={{ maxWidth: 260 }} />
        <select name="status" defaultValue={st} style={{ width: 'auto' }}>{STAT.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <button className="btn sm">ค้นหา</button>{(q || st) && <a className="btn sm ghost" href="/wht">ล้าง</a>}
        <span className="sub">{rows.length} รายการ · ภาษีที่หักรวม (ไม่นับที่ยกเลิก) {money(rows.filter(r => r.status === 'active').reduce((a, r) => a + Number(r.wht_amount), 0))}</span>
      </form>
      {rows.length === 0 && <div className="panel empty">{all.length ? 'ไม่พบรายการตามตัวกรอง' : 'ยังไม่มีหนังสือรับรอง (จ่ายค่าใช้จ่ายที่มีหัก ณ ที่จ่ายแล้วจะขึ้นที่นี่ หรือสร้างใบอิสระด้านบน)'}</div>}
      {rows.length > 0 && <form action="/wht/pdf" method="get" target="_blank" className="panel" style={{ padding: 0, overflowX: 'auto' }}>
        <div className="noprint" style={{ padding: 8 }}><button className="btn sm ghost" title="เลือกแถวแล้วกด เพื่อรวม 50 ทวิ เป็น PDF ไฟล์เดียว (เฉพาะสถานะดำเนินการแล้ว)">พิมพ์ / ดาวน์โหลด PDF รวมที่เลือก</button></div>
        <table><thead><tr><th style={{ width: 28 }} /><th>วันที่</th><th>เลขที่เอกสาร</th><th>ผู้ถูกหัก ณ ที่จ่าย</th><th>แบบฟอร์ม / อัตรา</th><th className="num">ฐานภาษี / ภาษีที่หัก</th><th>สถานะ</th><th /></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.id} style={r.status === 'cancelled' ? { opacity: 0.5 } : undefined}>
              <td><input type="checkbox" name="ids" value={r.id} style={{ width: 'auto' }} aria-label={`เลือก ${r.cert_no}`} /></td><td>{dateTh(r.pay_date)}</td><td className="no">{r.cert_no}{r.exp_no && <div className="sub">{r.exp_no}</div>}</td><td>{partyName(r)}</td>
              <td>{FORM_TH[r.form_code] ?? r.form_code}<div className="sub">{rateOf(r.id)}</div></td>
              <td className="num">{money(r.base_amount)}<div className="sub">{money(r.wht_amount)}</div></td>
              <td><WhtStatus id={r.id} status={r.status} linked={!!r.expense_id} canWrite={W} />{r.status === 'active' && r.missing?.length ? <div><span title={r.missing.join(' · ')} style={{ color: 'var(--orange)' }}>⚠ ข้อมูลไม่ครบ ({r.missing.length})</span></div> : null}</td>
              <td className="noprint"><details style={{ position: 'relative' }}><summary className="btn sm ghost" style={{ listStyle: 'none', cursor: 'pointer' }}>⋯</summary>
                <div className="panel" style={{ position: 'absolute', right: 0, zIndex: 5, minWidth: 190, padding: 6, display: 'grid', gap: 4 }}>
                  {r.status === 'active' && !r.missing?.length && <a className="btn sm ghost" href={`/wht/${r.id}/pdf`} target="_blank">พิมพ์ / ดาวน์โหลด PDF 50 ทวิ</a>}
                  {r.status === 'active' && <a className="btn sm ghost" href={`#d-${r.id}`}>แก้ไขรายละเอียดในแบบ</a>}
                  {W && <a className="btn sm ghost" href={`/wht?dup=${r.id}`}>สร้างซ้ำ</a>}
                </div></details></td></tr>))}</tbody></table></form>}
      {[0].map(() => {
        const rs = rows.filter(r => r.status === 'active');
        return (
          <div key="d">
            {rs.map(r => (
              <details key={r.id} id={`d-${r.id}`} className="panel" style={{ margin: '8px 0', padding: 12 }}>
                <summary>{r.cert_no} · รายละเอียดในแบบ{r.missing?.length ? ` · ขาด: ${r.missing.join(', ')}` : ''}</summary>
                <form action={A.saveContactTax}><fieldset disabled={!W} style={{ display: 'grid', gap: 6, margin: '10px 0', border: 0, padding: 0, minWidth: 0 }}>
                  <b>ผู้ถูกหัก: {partyName(r)}</b><input type="hidden" name="id" value={r.contact_id} />
                  <label>เลขประจำตัวผู้เสียภาษี 13 หลัก <input name="tax_id" defaultValue={r.tax_id ?? ''} pattern="[0-9]{13}" /></label>
                  <label>ที่อยู่ <input name="address" defaultValue={r.address ?? ''} /></label>
                  <label>ประเภทบุคคล <select name="person_kind" defaultValue={r.person_kind ?? ''}><option value="">-</option>
                    <option value="juristic">นิติบุคคล</option><option value="individual">บุคคลธรรมดา</option></select></label>
                  {W && <button className="btn">บันทึกข้อมูลผู้ถูกหัก</button>}
                </fieldset></form>
                <form action={A.saveCertDetails}><fieldset disabled={!W} style={{ display: 'grid', gap: 6, border: 0, padding: 0, minWidth: 0 }}>
                  <input type="hidden" name="id" value={r.id} />
                  <label>เล่มที่ <input name="book_no" defaultValue={r.book_no ?? ''} /></label>
                  <label>เลขที่ในเล่ม <input name="run_no" defaultValue={r.run_no ?? ''} /></label>
                  <label>ลำดับที่ในแบบยื่น <input name="seq_in_form" type="number" min="1" defaultValue={r.seq_in_form ?? ''} /></label>
                  <label>ประเภทเงินได้ <select name="income_category" defaultValue={r.income_category}>{CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                  <label>ผู้จ่ายเงิน <select name="payer_condition" defaultValue={r.payer_condition}>{CONDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                  <label>เงินสมทบประกันสังคม <input name="fund_sso" type="number" step="0.01" min="0" defaultValue={+r.fund_sso || ''} /></label>
                  {W && <button className="btn">บันทึกรายละเอียดในแบบ</button>}
                </fieldset></form>
              </details>))}
          </div>);
      })}
    </>
  );
}
