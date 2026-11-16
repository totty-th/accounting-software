'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { savePayrollSettings } from '@/lib/actions';

type S = { enabled: boolean; bank_account_id: string | null; sso_enabled: boolean; sso_employer_no: string | null; sso_branch: string | null;
  pvd_enabled: boolean; wcf_office: string | null; wcf_phone: string | null; wcf_code: string | null; wcf_rate: string | null };

/** ตั้งค่าเงินเดือน (ตาม FA): บัญชีจ่ายเงินเดือน · ประกันสังคม · กองทุนสงเคราะห์ลูกจ้าง · กองทุนเงินทดแทน */
export function PayrollSettingsForm({ s, banks }: { s: S; banks: { id: string; label: string }[] }) {
  const r = useRouter();
  const [f, setF] = useState({ ...s, bank_account_id: s.bank_account_id ?? '', sso_employer_no: s.sso_employer_no ?? '', sso_branch: s.sso_branch ?? '',
    wcf_office: s.wcf_office ?? '', wcf_phone: s.wcf_phone ?? '', wcf_code: s.wcf_code ?? '', wcf_rate: s.wcf_rate ?? '' });
  const [msg, setMsg] = useState<{ ok?: boolean; t: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (k: string, v: unknown) => setF({ ...f, [k]: v });
  const save = () => start(async () => {
    const x = await savePayrollSettings({ ...f, enabled: true });
    setMsg(x.error ? { t: x.error } : { ok: true, t: 'บันทึกข้อมูลสำเร็จ' });
    if (!x.error) r.refresh();
  });
  return (
    <div className="panel" style={{ maxWidth: 760 }}>
      <h3>ข้อมูลการจ่ายเงินเดือน/ค่าจ้าง</h3>
      <label className="f">บัญชีเงินเดือน (บัญชีธนาคารที่ใช้โอนจ่าย)
        <select value={f.bank_account_id} onChange={e => set('bank_account_id', e.target.value)}>
          <option value="">โปรดระบุ</option>{banks.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}</select></label>
      <h3>ข้อมูลด้านประกันสังคม</h3>
      <div className="radios">
        <label><input type="radio" checked={f.sso_enabled} onChange={() => set('sso_enabled', true)} /> ขึ้นสิทธิ์</label>
        <label><input type="radio" checked={!f.sso_enabled} onChange={() => set('sso_enabled', false)} /> ไม่ขึ้นสิทธิ์</label></div>
      <div className="grid">
        <label className="f">เลขที่บัญชีนายจ้าง{f.sso_enabled && ' *'}<input value={f.sso_employer_no} disabled={!f.sso_enabled} onChange={e => set('sso_employer_no', e.target.value)} /></label>
        <label className="f">ลำดับที่สาขาในระบบ{f.sso_enabled && ' *'}<input value={f.sso_branch} disabled={!f.sso_enabled} onChange={e => set('sso_branch', e.target.value)} /></label></div>
      <p className="sub">หักประกันสังคม 5% ของค่าจ้าง (ฐานต่ำสุด 1,650 · เพดาน 17,500 บาท/เดือน = สูงสุด 875) นายจ้างสมทบเท่ากัน</p>
      <h3>ข้อมูลกองทุนสงเคราะห์ลูกจ้าง</h3>
      <div className="radios">
        <label><input type="radio" checked={f.pvd_enabled} onChange={() => set('pvd_enabled', true)} /> ขึ้นสิทธิ์</label>
        <label><input type="radio" checked={!f.pvd_enabled} onChange={() => set('pvd_enabled', false)} /> ไม่ขึ้นสิทธิ์</label></div>
      <p className="sub">ยังไม่คำนวณในรายการเงินเดือน (เริ่มหัก 0.25% ตั้งแต่ 1 ม.ค. 2027)</p>
      <h3>ข้อมูลกองทุนเงินทดแทน</h3>
      <div className="grid">
        <label className="f">สำนักงานประกันสังคม<input value={f.wcf_office} placeholder="เช่น ปทุมธานี" onChange={e => set('wcf_office', e.target.value)} /></label>
        <label className="f">เบอร์โทร<input value={f.wcf_phone} onChange={e => set('wcf_phone', e.target.value)} /></label>
        <label className="f">รหัสกิจการ<input value={f.wcf_code} onChange={e => set('wcf_code', e.target.value)} /></label>
        <label className="f">อัตราเงินสมทบ (%)<input type="number" step="0.01" min="0.1" max="3" value={f.wcf_rate} placeholder="0.10–3.00" onChange={e => set('wcf_rate', e.target.value)} /></label></div>
      {msg && <div className={msg.ok ? 'okmsg' : 'err'} role="alert">{msg.t}</div>}
      <button className="btn" disabled={pending} onClick={save}>บันทึกข้อมูล</button>
    </div>
  );
}
