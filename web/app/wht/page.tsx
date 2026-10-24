import { can } from '@/lib/permissions';
import { requirePage } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { money, dateTh, partyName } from '@/lib/format';
import { Pill } from '@/components/Pill';
import { Group } from '@/components/Board';
import * as A from '@/lib/actions';

const CATS: [string, string][] = [['1', '1. เงินเดือน ค่าจ้าง 40(1)'], ['2', '2. ค่านายหน้า 40(2)'], ['3', '3. ค่าลิขสิทธิ์ 40(3)'],
  ['4a', '4(ก) ดอกเบี้ย'], ['5', '5. ค่าจ้างทำของ ค่าเช่า ค่าบริการ ฯลฯ'], ['6', '6. อื่น ๆ']];
const CONDS: [string, string][] = [['withhold', 'หัก ณ ที่จ่าย'], ['forever', 'ออกให้ตลอดไป'], ['once', 'ออกให้ครั้งเดียว'], ['other', 'อื่น ๆ']];

export default async function Wht() {
  const user = await requirePage('wht.read');
  const W = can(user.role, 'wht.write');
  const db = await getDb();
  const rows = await db.q(`select w.*, e.exp_no, c.id contact_id, c.business_name, c.contact_name, c.tax_id, c.address, c.person_kind,
      (select d->'missing' from (select wht_cert_data(w.id) d where w.status='active') x) missing
    from wht_certs w join expenses e on e.id=w.expense_id join contacts c on c.id=e.contact_id
    order by w.created_at desc, w.cert_no desc`);
  const company = (await db.q('select * from company_profile'))[0];
  return (
    <>
      <div className="top"><div><h1>หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ)</h1>
        <p className="sub">ออกอัตโนมัติเมื่อจ่ายเงิน พิมพ์ลงแบบมาตรฐานกรมสรรพากร · ต้องมีข้อมูลบริษัทและผู้ถูกหักครบจึงออก PDF ได้</p></div>
        <a className="btn ghost" href="/settings/company">{company ? 'ข้อมูลบริษัทผู้จ่าย' : '⚠ ตั้งค่าข้อมูลบริษัท'}</a></div>
      {rows.length === 0 && <div className="panel empty">ยังไม่มีหนังสือรับรอง (จ่ายค่าใช้จ่ายที่มีหัก ณ ที่จ่ายแล้วจะขึ้นที่นี่)</div>}
      {[['active', 'ใช้งานอยู่', 'var(--green)'], ['cancelled', 'ยกเลิก', 'var(--grey)']].map(([s, title, color]) => {
        const rs = rows.filter(r => r.status === s); if (!rs.length) return null;
        return (
          <Group key={s} title={title} color={color} count={rs.length}>
            <table><thead><tr><th>เลขที่</th><th>ผู้ถูกหัก</th><th>ค่าใช้จ่าย</th><th>วันที่จ่าย</th><th className="num">ฐานภาษี</th><th className="num">ภาษีที่หัก</th><th>สถานะ</th><th /></tr></thead>
              <tbody>{rs.map(r => (
                <tr key={r.id}><td className="no">{r.cert_no}</td><td>{partyName(r)}</td><td>{r.exp_no}</td><td>{dateTh(r.pay_date)}</td>
                  <td className="num">{money(r.base_amount)}</td><td className="num">{money(r.wht_amount)}</td><td><Pill s={r.status === 'active' ? 'paid' : 'cancelled'} /></td>
                  <td>{r.status === 'active' && (r.missing?.length
                    ? <span title={r.missing.join(' · ')} style={{ color: 'var(--orange)' }}>⚠ ข้อมูลไม่ครบ ({r.missing.length})</span>
                    : <a className="btn" href={`/wht/${r.id}/pdf`} target="_blank">PDF 50 ทวิ</a>)}</td></tr>))}</tbody></table>
            {s === 'active' && rs.map(r => (
              <details key={r.id} className="panel" style={{ margin: '8px 0', padding: 12 }}>
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
          </Group>);
      })}
    </>
  );
}
