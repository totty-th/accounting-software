'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createCreditCard, createPettyFund } from '@/lib/actions';

// ตั้งค่าบัตรเครดิตจ่าย (เปิดบัญชีเจ้าหนี้บัตร 21379.NN ให้อัตโนมัติ)
export function CardForm() {
  const router = useRouter();
  const [v, setV] = useState({ bank: '', last4: '', holder: '', name: '', limit: '', statementDay: '0', dueDay: '1' });
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV(o => ({ ...o, [k]: e.target.value }));
  const save = () => start(async () => {
    const r = await createCreditCard({ bank: v.bank, last4: v.last4, holder: v.holder, name: v.name, limit: Number(v.limit),
      statementDay: Number(v.statementDay), dueDay: Number(v.dueDay) });
    if (!r.error) { setV({ bank: '', last4: '', holder: '', name: '', limit: '', statementDay: '0', dueDay: '1' }); router.refresh(); }
    setMsg(r.error ?? 'บันทึกบัตรแล้ว');
  });
  return (
    <details className="panel"><summary>+ เพิ่มบัตรเครดิตจ่าย</summary>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 6, marginTop: 8 }}>
        <input aria-label="ธนาคาร" placeholder="ธนาคาร" value={v.bank} onChange={set('bank')} />
        <input aria-label="เลข 4 ตัวท้าย" placeholder="เลข 4 ตัวท้าย" maxLength={4} value={v.last4} onChange={set('last4')} />
        <input aria-label="ชื่อผู้ถือบัตร" placeholder="ชื่อผู้ถือบัตร" value={v.holder} onChange={set('holder')} />
        <input aria-label="ชื่อบัตร" placeholder="ชื่อบัตร" value={v.name} onChange={set('name')} />
        <input aria-label="วงเงิน" placeholder="วงเงิน" inputMode="decimal" value={v.limit} onChange={set('limit')} />
        <input aria-label="วันสรุปยอด (0=สิ้นเดือน)" placeholder="วันสรุปยอด (0=สิ้นเดือน)" value={v.statementDay} onChange={set('statementDay')} />
        <input aria-label="วันครบกำหนดชำระ" placeholder="วันครบกำหนด" value={v.dueDay} onChange={set('dueDay')} />
        <button type="button" className="btn sm" disabled={pending} onClick={save}>{pending ? '...' : 'บันทึกบัตร'}</button>
      </div>
      {msg && <p className="sub" role="status">{msg}</p>}
    </details>
  );
}

// ตั้งค่าวงเงินสดย่อย (เปิดบัญชี 11149.NN ให้อัตโนมัติ)
export function PettyForm() {
  const [v, setV] = useState({ name: '', limit: '', responsible: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV(o => ({ ...o, [k]: e.target.value }));
  const save = () => start(async () => {
    const r = await createPettyFund({ name: v.name, limit: Number(v.limit), responsible: v.responsible });
    setMsg(r.error ?? 'บันทึกวงเงินสดย่อยแล้ว');
  });
  return (
    <details className="panel"><summary>+ เพิ่มวงเงินสดย่อย</summary>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 6, marginTop: 8 }}>
        <input aria-label="ชื่อวงเงินสดย่อย" placeholder="ชื่อวงเงินสดย่อย" value={v.name} onChange={set('name')} />
        <input aria-label="วงเงินสดย่อย" placeholder="วงเงิน" inputMode="decimal" value={v.limit} onChange={set('limit')} />
        <input aria-label="ผู้รับผิดชอบ" placeholder="ผู้รับผิดชอบ" value={v.responsible} onChange={set('responsible')} />
        <button type="button" className="btn sm" disabled={pending} onClick={save}>{pending ? '...' : 'บันทึกวงเงิน'}</button>
      </div>
      {msg && <p className="sub" role="status">{msg}</p>}
    </details>
  );
}
