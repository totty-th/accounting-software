'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createAccount, updateAccount } from '@/lib/actions';

type Acc = { id: string; code: string; name: string; description: string | null; is_active: boolean };
/** เพิ่ม/แก้บัญชี (แบบ FA "บริหารผังบัญชี"): รหัสและชนิดบัญชีแก้ไม่ได้ — ชนิดมาจากเลขหลักแรก */
export function AccountManager({ edit, onDone }: { edit?: Acc; onDone?: () => void }) {
  const r = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ code: edit?.code ?? '', name: edit?.name ?? '', description: edit?.description ?? '', active: edit?.is_active ?? true });
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = () => start(async () => {
    const x = edit ? await updateAccount({ id: edit.id, name: f.name, description: f.description, active: f.active }) : await createAccount({ code: f.code, name: f.name, description: f.description });
    if (x.error) return setErr(x.error);
    setErr(null); setOpen(false); if (!edit) setF({ code: '', name: '', description: '', active: true }); onDone?.(); r.refresh();
  });
  if (!open) return <button className={`btn ${edit ? 'sm ghost' : ''}`} onClick={() => setOpen(true)}>{edit ? 'แก้ไข' : 'เพิ่มบัญชี'}</button>;
  return (
    <div className="panel" style={{ minWidth: 280 }}>
      <b>{edit ? `แก้ไขบัญชี ${edit.code}` : 'เพิ่มบัญชีใหม่'}</b>
      <div className="grid">
        <label className="f">รหัสบัญชี *<input value={f.code} disabled={!!edit} placeholder="เช่น 53012" onChange={e => setF({ ...f, code: e.target.value })} /></label>
        <label className="f">ชื่อบัญชี *<input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></label></div>
      <label className="f">คำอธิบายบัญชี<input value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></label>
      {edit && <label><input type="checkbox" checked={f.active} onChange={e => setF({ ...f, active: e.target.checked })} /> เปิดใช้งาน</label>}
      {!edit && <p className="sub">ชนิดบัญชีดูจากเลขหลักแรก: 1 สินทรัพย์ · 2 หนี้สิน · 3 ส่วนของผู้ถือหุ้น · 4 รายได้ · 5 ค่าใช้จ่าย</p>}
      {err && <div className="err" role="alert">{err}</div>}
      <div style={{ display: 'flex', gap: 8 }}><button className="btn" disabled={pending} onClick={save}>บันทึกข้อมูล</button><button className="btn ghost" onClick={() => { setOpen(false); setErr(null); }}>ยกเลิก</button></div>
    </div>
  );
}
