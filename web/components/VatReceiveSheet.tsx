'use client';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { bulkReceiveTaxInvoices } from '@/lib/actions';

export interface RecvRow { type: string; id: string; no: string; dateTxt: string; vendor: string; taxId: string; branch: string; amtTxt: string; vatTxt: string; invDate: string; invNo: string; form: string }
/** แผ่นงาน "ข้อมูลใบกำกับภาษีที่ได้รับ" (แบบ FA): กรอกเลขที่/วันที่ใบกำกับ แบบ ภ.พ.30/36 ของหลายเอกสารในหน้าเดียว แล้วบันทึกทีเดียว */
export function VatReceiveSheet({ rows: init }: { rows: RecvRow[] }) {
  const r = useRouter();
  const [rows, setRows] = useState(init); const [err, setErr] = useState<string | null>(null); const [p, start] = useTransition();
  const set = (i: number, v: Partial<RecvRow>) => setRows(a => a.map((x, k) => (k === i ? { ...x, ...v } : x)));
  const save = () => start(async () => {
    const x = await bulkReceiveTaxInvoices(rows.map(w => ({ type: w.type, id: w.id, invoice_no: w.invNo, invoice_date: w.invDate, vat_form: w.form, vendor_tax_id: w.taxId, branch: w.branch })));
    if (x.error) setErr(x.error); else { r.push('/tax/purchase-vat'); r.refresh(); } });
  return (
    <>
      <div className="top"><div><h1>ข้อมูลใบกำกับภาษีที่ได้รับ</h1><p className="sub">มีรายการทั้งหมด {rows.length} รายการ · ต้องระบุเลขที่ใบกำกับภาษีทุกรายการ</p></div>
        <div className="noprint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{err && <span className="err" role="alert">{err}</span>}
          <Link className="btn ghost" href="/tax/purchase-vat">ปิดหน้าต่าง</Link><button className="btn" disabled={p} onClick={save}>{p ? '...' : 'บันทึกแล้วปิด'}</button></div></div>
      <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
        <table><thead><tr><th>วันที่เอกสาร</th><th>เลขที่เอกสาร</th><th>ชื่อผู้จำหน่าย</th><th>เลขผู้เสียภาษี</th><th>สำนักงาน/สาขา</th><th className="num">มูลค่า / ภาษีมูลค่าเพิ่ม</th><th>วันที่ใบกำกับภาษี</th><th>เลขที่ใบกำกับภาษี</th><th>แบบฟอร์มภาษี</th></tr></thead>
          <tbody>{rows.map((w, i) => <tr key={w.type + w.id}>
            <td>{w.dateTxt}</td><td className="no">{w.no}</td><td>{w.vendor}</td>
            <td><input value={w.taxId} maxLength={13} onChange={e => set(i, { taxId: e.target.value })} aria-label="เลขผู้เสียภาษี" /></td>
            <td><input value={w.branch} placeholder="สำนักงานใหญ่" onChange={e => set(i, { branch: e.target.value })} aria-label="สำนักงาน/สาขา" /></td>
            <td className="num">{w.amtTxt}<div className="sub">{w.vatTxt}</div></td>
            <td><input type="date" value={w.invDate} onChange={e => set(i, { invDate: e.target.value })} aria-label="วันที่ใบกำกับภาษี" /></td>
            <td><input value={w.invNo} placeholder="กรุณาระบุเลขที่ใบกำกับภาษี" onChange={e => set(i, { invNo: e.target.value })} aria-label="เลขที่ใบกำกับภาษี" /></td>
            <td><select value={w.form} onChange={e => set(i, { form: e.target.value })} aria-label="แบบฟอร์มภาษี"><option value="PP30">ภ.พ.30</option><option value="PP36">ภ.พ.36</option></select></td></tr>)}</tbody></table>
      </div>
    </>
  );
}
