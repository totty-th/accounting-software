'use client';
import { useState } from 'react';
import { PayForm, type Opt } from './PayForm';
import { payPaymentSlipVendor } from '@/lib/actions';
import { useRouter } from 'next/navigation';

/** ชำระเงินต่อผู้จำหน่าย + หัก ณ ที่จ่าย (เฉพาะใบรับสินค้า) พร้อมตัวเลือกสร้างใบหัก ณ ที่จ่ายอัตโนมัติ */
export function SlipPay({ slip, contact, net, hasRi, banks, cards, petties }: { slip: string; contact: string; net: number; hasRi: boolean; banks: Opt[]; cards: Opt[]; petties: Opt[] }) {
  const router = useRouter(); const [on, setOn] = useState(false); const [amt, setAmt] = useState(''); const [cert, setCert] = useState(true);
  const w = on ? Math.max(0, Number(amt) || 0) : 0; const due = Math.round((net - w) * 100) / 100;
  return <>
    {hasRi && <div className="panel" style={{ marginTop: 6 }}>
      <label><input type="checkbox" checked={on} onChange={e => setOn(e.target.checked)} /> หัก ณ ที่จ่าย</label>
      {on && <> <input aria-label="ยอดหัก ณ ที่จ่าย" inputMode="decimal" value={amt} onChange={e => setAmt(e.target.value)} style={{ width: 120 }} />
        <label style={{ marginLeft: 12 }}><input type="checkbox" checked={cert} onChange={e => setCert(e.target.checked)} /> สร้างใบหัก ณ ที่จ่ายอัตโนมัติ (ภ.ง.ด.53 · ฐานก่อน VAT)</label>
        <span className="sub"> ยอดจ่าย {due.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></>}</div>}
    <PayForm key={due} net={due} banks={banks} cards={cards} petties={petties}
      onPay={async p => { const r = await payPaymentSlipVendor(slip, contact, p, w, cert); if (!r.error) router.refresh(); return r; }} />
  </>;
}
