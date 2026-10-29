'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createProject, updateProject, deleteProject } from '@/lib/actions';

type Contact = { id: string; name: string };
/** สร้าง/แก้ไข/ลบโปรเจ็ค — ผูกเอกสารด้วยชื่อโปรเจ็คในช่อง "โปรเจ็ค" ของเอกสาร */
export function ProjectManager({ edit, contacts }: { edit?: { id: string; name: string; contact_id: string | null }; contacts: Contact[] }) {
  const r = useRouter(); const [open, setOpen] = useState(false);
  const [name, setName] = useState(edit?.name ?? ''); const [c, setC] = useState(edit?.contact_id ?? '');
  const [err, setErr] = useState<string | null>(null); const [p, start] = useTransition();
  const save = () => start(async () => { const x = edit ? await updateProject(edit.id, name, c) : await createProject(name, c);
    if (x.error) return setErr(x.error); setErr(null); setOpen(false); if (!edit) { setName(''); setC(''); } r.refresh(); });
  const del = () => start(async () => { const x = await deleteProject(edit!.id); if (x.error) setErr(x.error); else r.refresh(); });
  if (!open) return <span style={{ display: 'inline-flex', gap: 6 }}><button className={`btn ${edit ? 'sm ghost' : ''}`} onClick={() => setOpen(true)}>{edit ? 'แก้ไข' : 'สร้างโปรเจ็ค'}</button>
    {edit && <button className="btn sm ghost" disabled={p} onClick={del}>ลบ</button>}{err && <span className="err" role="alert">{err}</span>}</span>;
  return (
    <div className="panel" style={{ minWidth: 280 }}>
      <b>{edit ? 'แก้ไขโปรเจ็ค' : 'สร้างโปรเจ็ค'}</b>
      <label className="f">ชื่อโปรเจ็ค *<input value={name} onChange={e => setName(e.target.value)} /></label>
      <label className="f">ชื่อลูกค้า/ผู้จำหน่าย<select value={c} onChange={e => setC(e.target.value)}><option value="">—</option>{contacts.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      {err && <div className="err" role="alert">{err}</div>}
      <div style={{ display: 'flex', gap: 8 }}><button className="btn" disabled={p} onClick={save}>บันทึก</button><button className="btn ghost" onClick={() => { setOpen(false); setErr(null); }}>ยกเลิก</button></div>
    </div>
  );
}
