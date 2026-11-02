import { notFound } from 'next/navigation';
import { can } from '@/lib/permissions';
import { requirePage } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { money, dateTh, partyName } from '@/lib/format';
import { WhtStatus } from '@/components/WhtStatus';
import * as A from '@/lib/actions';

export const dynamic = 'force-dynamic';
const CATS: Record<string, string> = { '1': '1. เงินเดือน ค่าจ้าง 40(1)', '2': '2. ค่านายหน้า 40(2)', '3': '3. ค่าลิขสิทธิ์ 40(3)', '4a': '4(ก) ดอกเบี้ย', '5': '5. ค่าจ้างทำของ ค่าเช่า ค่าบริการ ฯลฯ', '6': '6. อื่น ๆ' };
const FORM_TH: Record<string, string> = { PND3: 'ภงด 3', PND53: 'ภงด 53', PND1K: 'ภงด 1ก', PND1KS: 'ภงด 1ก (พิเศษ)', PND2: 'ภงด 2', PND2K: 'ภงด 2ก', PND3K: 'ภงด 3ก' };
const COND: Record<string, string> = { withhold: 'หัก ณ ที่จ่าย', forever: 'ออกให้ตลอดไป', once: 'ออกให้ครั้งเดียว', other: 'อื่น ๆ' };
const VAT_TH: Record<string, string> = { none: 'ไม่มี/ยกเว้น VAT', exclusive: 'ไม่รวม VAT', inclusive: 'รวม VAT' };

// หน้ารายละเอียดใบหัก ณ ที่จ่าย: ตัวเลขใหญ่ (ฐานภาษี/ภาษีที่หัก) · ผู้ถูกหัก · รายการ · สรุปยอดถึงยอดชำระ · ผู้จ่ายเงิน · ข้อมูลที่ต้องกรอกในแบบ · ที่มาของเอกสาร
export default async function WhtDetail({ params }: { params: { id: string } }) {
  const user = await requirePage('wht.read');
  const W = can(user.role, 'wht.write');
  const db = await getDb();
  const c = (await db.q<any>(`select w.*, c.id contact_id, c.business_name, c.contact_name, c.tax_id, c.address, c.person_kind, c.branch_code, c.branch_name,
      e.exp_no, g.ri_no, (select d->'missing' from (select wht_cert_data(w.id) d where w.status='active') x) missing
    from wht_certs w join contacts c on c.id=w.contact_id left join expenses e on e.id=w.expense_id left join goods_receipts g on g.id=w.ri_id where w.id=$1`, [params.id]))[0];
  if (!c) notFound();
  let lines = await db.q<any>('select * from wht_cert_lines where cert_id=$1 order by line_no', [c.id]);
  if (!lines.length) lines = [{ line_no: 1, income_type: c.income_type ?? CATS[c.income_category], rate: c.base_amount > 0 ? (Number(c.wht_amount) * 100 / Number(c.base_amount)) : null, vat_mode: 'none', amount: c.base_amount, base: c.base_amount, wht: c.wht_amount }];
  const sum = (m: (l: any) => boolean) => lines.filter(m).reduce((a, l) => a + Number(l.base), 0);
  const noVat = sum(l => l.vat_mode === 'none'), calc = sum(l => l.vat_mode !== 'none');
  const vat = Math.round(calc * 7) / 100, total = noVat + calc + vat, wht = lines.reduce((a, l) => a + Number(l.wht), 0);
  const branch = c.branch_code ? `สาขา ${c.branch_code}${c.branch_name ? ' ' + c.branch_name : ''}` : 'สำนักงานใหญ่';
  const editable = W && c.status === 'active';
  const src = c.exp_no ? `ค่าใช้จ่าย ${c.exp_no}` : c.ri_no ? `ใบรับสินค้า ${c.ri_no}` : null;
  const missing: string[] = c.missing ?? [];
  const row = (k: string, v: React.ReactNode, b = false) => <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '5px 0', borderBottom: '1px solid var(--line, #eee)' }}><span className="sub">{k}</span><span className="num" style={b ? { fontWeight: 700 } : undefined}>{v}</span></div>;
  return (
    <>
      <div className="top"><div>
        <h1>{c.status === 'cancelled' ? 'หัก ณ ที่จ่าย' : 'แก้ไขหัก ณ ที่จ่าย'} <span className="no">{c.cert_no}</span></h1>
        <p className="sub"><a href="/wht">← กลับรายการ</a> · วันที่ {dateTh(c.pay_date)} · {FORM_TH[c.form_code] ?? c.form_code}{src && <> · มาจาก {src}</>}</p></div>
        <div className="acts" style={{ gap: 8 }}>
          {c.status === 'active' && !missing.length && <a className="btn" href={`/wht/${c.id}/pdf`} target="_blank">พิมพ์ / ดาวน์โหลด PDF 50 ทวิ</a>}
          {W && <a className="btn ghost" href={`/wht?dup=${c.id}`}>สร้างซ้ำ</a>}
          <WhtStatus id={c.id} status={c.status} linked={!!(c.expense_id || c.ri_id)} canWrite={W} />
        </div></div>
      {c.status === 'active' && missing.length > 0 && <div className="panel" style={{ borderLeft: '4px solid var(--orange)', marginBottom: 12 }}>
        ⚠ ยังพิมพ์ 50 ทวิ ไม่ได้ ขาดข้อมูล: <b>{missing.join(' · ')}</b> — กรอกในส่วน "ข้อมูลที่ต้องกรอกในแบบ" ด้านล่าง</div>}
      <div className="cards">
        <div className="card" style={{ ['--c' as string]: 'var(--brand)' }}><span>จำนวนเงิน (ไม่รวมภาษี)</span><b>{money(c.base_amount)}</b></div>
        <div className="card" style={{ ['--c' as string]: 'var(--orange)' }}><span>ภาษีที่หัก</span><b>{money(c.wht_amount)}</b></div>
        <div className="card" style={{ ['--c' as string]: 'var(--green)' }}><span>ยอดชำระ (หลังหักภาษี)</span><b>{money(total - wht)}</b></div>
      </div>
      <div className="grid">
        <div className="panel"><b>ผู้ถูกหัก ณ ที่จ่าย</b>
          <p style={{ margin: '6px 0' }}><a href={`/contacts/${c.contact_id}`}>{partyName(c)}</a></p>
          <p className="sub" style={{ margin: 0 }}>{c.address || <span style={{ color: 'var(--orange)' }}>ยังไม่มีที่อยู่</span>}</p>
          <p className="sub" style={{ margin: '4px 0 0' }}>เลขประจำตัวผู้เสียภาษี {c.tax_id || <span style={{ color: 'var(--orange)' }}>ยังไม่มี</span>} · {branch} · {c.person_kind === 'juristic' ? 'นิติบุคคล' : c.person_kind === 'individual' ? 'บุคคลธรรมดา' : 'ไม่ระบุประเภท'}</p></div>
        <div className="panel"><b>ข้อมูลเอกสาร</b>
          <div>
            {row('เลขที่เอกสาร', c.cert_no)}{row('วันที่จ่าย', dateTh(c.pay_date))}{row('แบบฟอร์ม', FORM_TH[c.form_code] ?? c.form_code)}
            {row('ประเภทเงินได้', CATS[c.income_category] ?? c.income_category)}{row('ผู้จ่ายเงิน', COND[c.payer_condition] + (c.payer_condition_note ? ` (${c.payer_condition_note})` : ''))}
            {c.book_no || c.run_no ? row('เล่มที่ / เลขที่', `${c.book_no ?? '-'} / ${c.run_no ?? '-'}`) : null}{c.seq_in_form ? row('ลำดับที่ในแบบยื่น', c.seq_in_form) : null}
            {Number(c.fund_sso) > 0 ? row('เงินสมทบประกันสังคม', money(c.fund_sso)) : null}
            {row('สร้างเมื่อ', dateTh(c.created_at))}
          </div></div>
      </div>
      <div className="panel" style={{ padding: 0, overflowX: 'auto', marginBottom: 12 }}>
        <table><thead><tr><th>ลำดับ</th><th>ประเภทเงินได้ที่จ่าย</th><th className="num">อัตรา</th><th className="num">จำนวนเงิน</th><th>ภาษีมูลค่าเพิ่ม</th><th className="num">ฐานภาษี</th><th className="num">ภาษีที่หัก</th></tr></thead>
          <tbody>{lines.map(l => <tr key={l.line_no}><td>{l.line_no}</td><td>{l.income_type}</td><td className="num">{l.rate != null ? `${+l.rate}%` : 'ระบุเอง'}</td><td className="num">{money(l.amount)}</td><td>{VAT_TH[l.vat_mode] ?? l.vat_mode}</td><td className="num">{money(l.base)}</td><td className="num">{money(l.wht)}</td></tr>)}</tbody></table></div>
      <div className="panel" style={{ maxWidth: 420, marginLeft: 'auto', marginBottom: 12 }}>
        <div>
          {row('จำนวนเงินที่ไม่มี/ยกเว้นภาษี', money(noVat))}{row('จำนวนเงินที่คำนวณภาษี', money(calc))}{row('ภาษีมูลค่าเพิ่ม 7%', money(vat))}
          {row('จำนวนเงิน', money(total), true)}{row('ภาษีที่หัก', money(wht))}{row('ยอดชำระ', money(total - wht), true)}
        </div>
        <p className="sub" style={{ margin: '6px 0 0' }}>ฐานภาษีหัก ณ ที่จ่ายคิดจากยอดก่อน VAT · เอกสารนี้ไม่ลงบัญชีเอง{src ? ' (บัญชีบันทึกที่เอกสารต้นทาง)' : ''}</p></div>
      {c.status === 'active' && <>
        <h2 style={{ fontSize: 16 }}>ข้อมูลที่ต้องกรอกในแบบ</h2>
        <div className="grid">
          <form action={A.saveContactTax} className="panel"><fieldset disabled={!W} style={{ display: 'grid', gap: 6, border: 0, padding: 0, minWidth: 0 }}>
            <b>ผู้ถูกหัก: {partyName(c)}</b><input type="hidden" name="id" value={c.contact_id} />
            <label>เลขประจำตัวผู้เสียภาษี 13 หลัก <input name="tax_id" defaultValue={c.tax_id ?? ''} pattern="[0-9]{13}" /></label>
            <label>ที่อยู่ <input name="address" defaultValue={c.address ?? ''} /></label>
            <label>ประเภทบุคคล <select name="person_kind" defaultValue={c.person_kind ?? ''}><option value="">-</option>
              <option value="juristic">นิติบุคคล</option><option value="individual">บุคคลธรรมดา</option></select></label>
            {W && <button className="btn">บันทึกข้อมูลผู้ถูกหัก</button>}</fieldset></form>
          <form action={A.saveCertDetails} className="panel"><fieldset disabled={!editable} style={{ display: 'grid', gap: 6, border: 0, padding: 0, minWidth: 0 }}>
            <input type="hidden" name="id" value={c.id} />
            <label>เล่มที่ <input name="book_no" defaultValue={c.book_no ?? ''} /></label>
            <label>เลขที่ในเล่ม <input name="run_no" defaultValue={c.run_no ?? ''} /></label>
            <label>ลำดับที่ในแบบยื่น <input name="seq_in_form" type="number" min="1" defaultValue={c.seq_in_form ?? ''} /></label>
            <label>ประเภทเงินได้ <select name="income_category" defaultValue={c.income_category}>{Object.entries(CATS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label>ผู้จ่ายเงิน <select name="payer_condition" defaultValue={c.payer_condition}>{Object.entries(COND).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label>เงินสมทบประกันสังคม <input name="fund_sso" type="number" step="0.01" min="0" defaultValue={+c.fund_sso || ''} /></label>
            {editable && <button className="btn">บันทึกรายละเอียดในแบบ</button>}</fieldset></form>
        </div></>}
    </>
  );
}
