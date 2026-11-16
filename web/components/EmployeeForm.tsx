'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveEmployee } from '@/lib/actions';
import { BANKS, EMP_STATUS, taxBreakdown, thaiIdValid } from '@/lib/payroll';

const m = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const addDays = (d: string, n: number) => { if (!d) return ''; const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

/** ฟอร์มพนักงาน (ตาม FA): ข้อมูลพื้นฐาน · ติดต่อ · การจ้างงาน · เงินเดือน/ค่าจ้าง (ประกันสังคม/ภาษีอัตโนมัติ) · การรับเงิน */
export function EmployeeForm({ id, init, today }: { id: string | null; init: Record<string, any> | null; today: string }) {
  const r = useRouter();
  const [f, setF] = useState<Record<string, any>>({
    code: '', title: 'นาย', first_name: '', last_name: '', nickname: '', first_name_en: '', last_name_en: '', nationality: 'ไทย', national_id: '',
    passport_no: '', phone: '', email: '', line_id: '', address: '', emergency_name: '', emergency_phone: '', department: '', position: '',
    hire_date: today, probation_days: 90, status: 'probation', birth_date: '', note: '', pay_type: 'monthly', salary: '', sso: true, auto_tax: true,
    pay_method: 'transfer', bank_name: '', bank_account_no: '', bank_account_type: 'savings', bank_branch: '', ...(init ?? {}) });
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: string, v: unknown) => setF(p => ({ ...p, [k]: v }));
  const T = (k: string, label: string, req = false, type = 'text') =>
    <label className="f">{label}{req && ' *'}<input type={type} value={f[k] ?? ''} onChange={e => set(k, e.target.value)} /></label>;
  const sal = Number(f.salary) || 0;
  const tb = taxBreakdown(sal, f.sso);
  const idBad = f.national_id && !thaiIdValid(String(f.national_id).replace(/\D/g, ''));
  const save = () => start(async () => {
    const x = await saveEmployee(id, { ...f, salary: sal });
    if (x.error) { setErr(x.error); return; }
    r.push('/payroll/employees'); r.refresh();
  });
  return (
    <div className="panel wide">
      <h3>ข้อมูลพนักงานพื้นฐาน</h3>
      <div className="grid">
        {T('code', 'รหัสพนักงาน', true)}
        <label className="f">คำนำหน้า<select value={f.title} onChange={e => set('title', e.target.value)}>{['นาย', 'นาง', 'นางสาว'].map(t => <option key={t}>{t}</option>)}</select></label>
        {T('first_name', 'ชื่อ', true)}{T('last_name', 'นามสกุล', true)}{T('nickname', 'ชื่อเล่น')}
        {T('first_name_en', 'ชื่อ (EN)')}{T('last_name_en', 'นามสกุล (EN)')}{T('nationality', 'สัญชาติ', true)}
        <label className="f">เลขบัตรประชาชน{f.nationality === 'ไทย' && ' *'}<input inputMode="numeric" maxLength={17} value={f.national_id ?? ''} onChange={e => set('national_id', e.target.value)} />
          {idBad && <span className="err">เลขบัตรประชาชนไม่ถูกต้อง</span>}</label>
        {T('passport_no', 'เลขหนังสือเดินทาง')}</div>
      <h3>ข้อมูลการติดต่อ</h3>
      <div className="grid">{T('phone', 'เบอร์มือถือ')}{T('email', 'อีเมล', false, 'email')}{T('line_id', 'Line ID')}{T('address', 'ที่อยู่พนักงาน')}
        {T('emergency_name', 'ชื่อผู้ติดต่อฉุกเฉิน')}{T('emergency_phone', 'เบอร์ผู้ติดต่อฉุกเฉิน')}</div>
      <h3>ข้อมูลการจ้างงาน</h3>
      <div className="grid">{T('department', 'แผนก')}{T('position', 'ตำแหน่ง')}{T('hire_date', 'วันที่จ้างงาน', true, 'date')}
        <label className="f">ระยะเวลาทดลองงาน (วัน)<input type="number" min="0" value={f.probation_days} onChange={e => set('probation_days', e.target.value)} />
          <span className="sub">ผ่านทดลองงาน {addDays(f.hire_date, Number(f.probation_days) || 0) || '-'}</span></label>
        <label className="f">สถานะ<select value={f.status} onChange={e => set('status', e.target.value)}>{Object.entries(EMP_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
        {T('birth_date', 'วันเกิด', false, 'date')}{T('note', 'โน้ต')}</div>
      <h3>ข้อมูลเงินเดือน/ค่าจ้าง</h3>
      <div className="grid">
        <label className="f">ประเภทพนักงาน<select value={f.pay_type} onChange={e => set('pay_type', e.target.value)}>
          <option value="monthly">พนักงานรายเดือน</option><option value="daily">พนักงานรายวัน</option></select></label>
        <label className="f">{f.pay_type === 'daily' ? 'ค่าจ้างต่อวัน' : 'เงินเดือน'} *<input type="number" min="0" step="0.01" value={f.salary} onChange={e => set('salary', e.target.value)} /></label></div>
      <div className="radios"><b style={{ fontSize: 13 }}>ประกันสังคม:</b>
        <label><input type="radio" checked={f.sso} onChange={() => set('sso', true)} /> ขึ้นสิทธิ์</label>
        <label><input type="radio" checked={!f.sso} onChange={() => set('sso', false)} /> ไม่ขึ้นสิทธิ์</label>
        {f.pay_type === 'monthly' && <label><input type="checkbox" checked={f.auto_tax} onChange={e => set('auto_tax', e.target.checked)} /> คำนวณภาษีหัก ณ ที่จ่ายอัตโนมัติ (40(1))</label>}</div>
      {f.pay_type === 'monthly' && sal > 0 && (
        <div className="taxbox">
          <div><span>ประกันสังคม/เดือน</span><b>{m(tb.ssoMonth)}</b></div>
          {f.auto_tax && <>
            <div><span>เงินเดือนทั้งปี</span><b>{m(tb.annual)}</b></div>
            <div><span>หักค่าใช้จ่ายตามกฎหมาย</span><b>({m(tb.expense)})</b></div>
            <div><span>หักค่าลดหย่อนตัวเอง</span><b>({m(tb.personal)})</b></div>
            <div><span>หักค่าประกันสังคม</span><b>({m(tb.ssoYear)})</b></div>
            <div><span>รายได้สุทธิ</span><b>{m(tb.net)}</b></div>
            <div><span>ภาษีที่คำนวณได้ทั้งปี</span><b>{m(tb.year)}</b></div>
            <div><span>ภาษีหัก ณ ที่จ่ายต่อเดือน</span><b>{m(tb.month)}</b></div></>}
        </div>)}
      {f.pay_type === 'daily' && <p className="sub">พนักงานรายวัน: กรอกภาษีหัก ณ ที่จ่ายเองในรายการค่าจ้าง (ไม่มีคำนวณอัตโนมัติ ตาม FA)</p>}
      <h3>ข้อมูลการชำระเงินเดือน/ค่าจ้าง</h3>
      <div className="grid">
        <label className="f">ช่องทางการรับชำระ<select value={f.pay_method} onChange={e => set('pay_method', e.target.value)}>
          <option value="cash">เงินสด</option><option value="transfer">โอนเงิน</option></select></label>
        {f.pay_method === 'transfer' && <>
          <label className="f">ธนาคาร *<select value={f.bank_name ?? ''} onChange={e => set('bank_name', e.target.value)}>
            <option value="">-- กรุณาเลือกธนาคาร --</option>{BANKS.map(b => <option key={b}>{b}</option>)}</select></label>
          {T('bank_account_no', 'เลขที่บัญชี', true)}
          <label className="f">ประเภทบัญชี<select value={f.bank_account_type} onChange={e => set('bank_account_type', e.target.value)}>
            <option value="savings">บัญชีออมทรัพย์</option><option value="current">บัญชีกระแสรายวัน</option></select></label>
          {T('bank_branch', 'สาขาธนาคาร')}</>}</div>
      {err && <div className="err" role="alert">{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn" disabled={pending} onClick={save}>บันทึกและปิด</button>
        <button className="btn ghost" type="button" onClick={() => r.back()}>ปิดหน้าต่าง</button></div>
    </div>
  );
}
