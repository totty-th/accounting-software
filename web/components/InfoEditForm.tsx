'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateSalesDoc } from '@/lib/actions';

/** เอกสารมีเอกสารอื่นผูกอยู่ (ใบเสร็จ/ใบวางบิล/CN/DN ฯลฯ): แก้ได้เฉพาะข้อมูลทั่วไป ตาม FA */
export function InfoEditForm({ id, init }: { id: string; init: { ref_no: string; description: string; project: string; note: string; internal_note: string } }) {
  const router = useRouter();
  const [h, setH] = useState(init);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof init) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setH(v => ({ ...v, [k]: e.target.value }));
  const save = () => start(async () => {
    setErr(null);
    const r = await updateSalesDoc(id, h, []);
    if (r.error) return setErr(r.error);
    router.push(`/sales/${id}`); router.refresh();
  });
  return (
    <section className="panel" style={{ display: 'grid', gap: 10, maxWidth: 640 }}>
      <label className="f">เลขที่อ้างอิง<input value={h.ref_no} onChange={set('ref_no')} /></label>
      <label className="f">โปรเจ็ค<input value={h.project} onChange={set('project')} /></label>
      <label className="f">รายละเอียด<input value={h.description} onChange={set('description')} /></label>
      <label className="f">หมายเหตุ (แสดงในเอกสาร)<textarea rows={3} value={h.note} onChange={set('note')} /></label>
      <label className="f">โน้ตภายใน<textarea rows={2} value={h.internal_note} onChange={set('internal_note')} /></label>
      {err && <p className="err" role="alert">{err}</p>}
      <div><button className="btn" disabled={pending} onClick={save}>บันทึก</button></div>
    </section>
  );
}
