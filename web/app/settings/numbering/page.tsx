import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getDb } from '@/lib/db';
import { SForm } from '@/components/SForm';
import { saveDocNumberFormat, resetDocNumberFormat } from '@/lib/actions';

export const dynamic = 'force-dynamic';
// ชนิดเอกสารที่ออกเลขผ่านตัวนับกลาง → [รหัสภายใน, ชื่อ, ออกเลขรายวันตั้งต้นไหม]
const TYPES: [string, string, boolean][] = [['QT', 'ใบเสนอราคา', true], ['INV', 'ใบแจ้งหนี้/ใบกำกับภาษี', true], ['CA', 'ขายเงินสด', true], ['BL', 'ใบวางบิล', true],
  ['CN', 'ใบลดหนี้', true], ['DN', 'ใบเพิ่มหนี้', true], ['PO', 'ใบสั่งซื้อ', true], ['RI', 'ใบรับสินค้า', true], ['EXP', 'ค่าใช้จ่าย', true],
  ['PAY', 'ใบเตรียมจ่าย', true], ['WT', 'หนังสือรับรองหัก ณ ที่จ่าย', true], ['TF', 'โอนสินค้า', true], ['ADJ', 'ปรับสต็อก', true], ['JV', 'สมุดรายวัน', false], ['AS', 'สินทรัพย์', false]];
const DATE: [string, string][] = [['YYYYMMDD', 'ปีเดือนวัน (20261103)'], ['YYYYMM', 'ปีเดือน (202611)'], ['YYYY', 'ปี (2026)'], ['none', 'ไม่แสดงวันที่']];
const RESET: [string, string][] = [['daily', 'รีเซ็ตทุกวัน'], ['monthly', 'รีเซ็ตทุกเดือน'], ['yearly', 'รีเซ็ตทุกปี'], ['never', 'ไม่รีเซ็ต (ต่อเนื่อง)']];

export default async function Numbering() {
  const user = await requirePage('settings.company');
  const w = can(user.role, 'settings.company');
  const rows = await (await getDb()).q<any>('select * from doc_number_formats');
  const by = Object.fromEntries(rows.map(r => [r.prefix, r]));
  const ex = (c: string, d: string, l: number) => c + (d === 'none' ? '' : d === 'YYYY' ? '2026' : d === 'YYYYMM' ? '202611' : '20261103') + '1'.padStart(l, '0');
  return (
    <>
      <div className="top"><div><h1>ตั้งค่าเลขที่เอกสาร</h1>
        <p className="sub">เลขที่ = คำนำหน้า + วันที่ + ลำดับ · มีผลกับเอกสารที่ออกใหม่เท่านั้น เอกสารเดิมไม่เปลี่ยนเลข · วันที่ที่แสดงต้องไม่หยาบกว่าช่วงรีเซ็ต (กันเลขซ้ำ) · เลขที่ในลิงก์/พิมพ์เป็นเลขตามที่ตั้งไว้ตอนออกเอกสาร</p></div></div>
      <div style={{ display: 'grid', gap: 10, maxWidth: 720 }}>
        {TYPES.map(([code, name, daily]) => {
          const r = by[code]; const def = { custom_prefix: code, date_fmt: daily ? 'YYYYMMDD' : 'none', seq_len: 4, reset_mode: daily ? 'daily' : 'never' };
          const v = r ?? def;
          return (
            <div key={code} className="panel" style={{ padding: 12 }}>
              <SForm action={saveDocNumberFormat} className="" style={{ padding: 0, gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', alignItems: 'end' }} canWrite={w} label="บันทึก">
                <input type="hidden" name="prefix" value={code} />
                <div style={{ gridColumn: '1/-1' }}><b>{name}</b> <span className="sub">ตัวอย่าง: {ex(v.custom_prefix, v.date_fmt, v.seq_len)}{r ? '' : ' (ค่าตั้งต้น)'}</span></div>
                <label>คำนำหน้า <input name="custom" defaultValue={v.custom_prefix} maxLength={10} required /></label>
                <label>วันที่ <select name="date_fmt" defaultValue={v.date_fmt}>{DATE.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                <label>หลักลำดับ <input name="seq" type="number" min={1} max={8} defaultValue={v.seq_len} /></label>
                <label>เริ่มลำดับใหม่ <select name="reset" defaultValue={v.reset_mode}>{RESET.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              </SForm>
              {r && w && <SForm action={resetDocNumberFormat} className="" style={{ padding: 0, marginTop: 6 }} label="คืนค่าตั้งต้น" danger><input type="hidden" name="prefix" value={code} /></SForm>}
            </div>);
        })}
      </div>
    </>
  );
}
