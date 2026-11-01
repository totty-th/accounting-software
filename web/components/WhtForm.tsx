'use client';
import { useState, useTransition } from 'react';
import { createStandaloneWht } from '@/lib/actions';

const FORMS: [string, string][] = [['PND53', 'ภ.ง.ด.53'], ['PND3', 'ภ.ง.ด.3'], ['PND1K', 'ภ.ง.ด.1ก'], ['PND1KS', 'ภ.ง.ด.1ก (พิเศษ)'], ['PND2', 'ภ.ง.ด.2'], ['PND2K', 'ภ.ง.ด.2ก'], ['PND3K', 'ภ.ง.ด.3ก']];
export const INCOME_TYPES = ['1. เงินเดือน ค่าจ้าง เบี้ยเลี้ยง โบนัส ฯลฯ ตามมาตรา 40 (1)', '2. ค่าธรรมเนียม ค่านายหน้า ฯลฯ ตามมาตรา 40 (2)', '3. ค่าแห่งลิขสิทธิ์ ฯลฯ ตามมาตรา 40(3)',
  '4. (ก) ค่าดอกเบี้ย ฯลฯ ตามมาตรา 40(4) (ก)', '4. (ข)(1.1) กิจการที่ต้องเสียภาษีเงินได้นิติบุคคลในอัตราร้อยละ 25 ของกำไรสุทธิ', '4. (ข)(1.2) กิจการที่ต้องเสียภาษีเงินได้นิติบุคคลในอัตราร้อยละ 20 ของกำไรสุทธิ',
  '4. (ข)(1.3) กิจการที่ต้องเสียภาษีเงินได้นิติบุคคลในอัตราอื่น ของกำไรสุทธิ (กรุณาระบุ)', '4. (ข)(2.1) กำไรสุทธิของกิจการที่ได้รับยกเว้นเงินได้นิติบุคคล', '4. (ข)(2.2) เงินปันผลหรือเงินส่วนแบ่งของกำไรที่ได้รับยกเว้น...',
  '4. (ข)(2.3) กำไรสุทธิส่วนที่ได้หักผลขาดทุนสิทธิยกมาไม่เกิน 5 ปี...', '4. (ข)(2.4) กำไรที่รับรู้ทางบัญชีโดยวิธีส่วนได้เสีย (equity method)', '4. (ข)(2.5) อื่นๆ (กรุณาระบุ)',
  '5. การจ่ายเงินได้ที่ต้องหักภาษี ณ ที่จ่ายตามคำสั่งกรมสรรพากร....', '6. อื่นๆ (กรุณาระบุ)'];
const RATES = ['0.5', '0.75', '1', '1.5', '2', '3', '5', '10', '15'];
type L = { income_type: string; rate: string; amount: string; vat_mode: string; wht: string };
const blank = (): L => ({ income_type: '', rate: '3', amount: '', vat_mode: 'none', wht: '' });

/** สร้างหนังสือรับรองหัก ณ ที่จ่ายแบบเอกสารอิสระ (ไม่ผูกค่าใช้จ่าย ไม่ลงบัญชี) */
export type WhtInit = { contact?: string; form?: string; lines?: L[] };
export function WhtForm({ today, vendors, init }: { today: string; vendors: { id: string; label: string; tax_id?: string | null; address?: string | null }[]; init?: WhtInit }) {
  const [date, setDate] = useState(today), [contact, setContact] = useState(init?.contact ?? ''), [form, setForm] = useState(init?.form ?? 'PND53');
  const [lines, setLines] = useState<L[]>(init?.lines?.length ? init.lines : [blank()]);
  const [err, setErr] = useState<string | null>(null); const [pending, start] = useTransition();
  const set = (i: number, k: keyof L, v: string) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const calc = (l: L) => { const a = Number(l.amount) || 0; const b = l.vat_mode === 'inclusive' ? Math.round(a * 10000 / 107) / 100 : a;
    return l.rate === 'fixed' ? Number(l.wht) || 0 : Math.round(b * Number(l.rate)) / 100; };
  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sums = lines.reduce((a, l) => { const x = Number(l.amount) || 0;
    if (l.vat_mode === 'none') a.free += x; else if (l.vat_mode === 'inclusive') { const b = Math.round(x * 10000 / 107) / 100; a.base += b; a.vat += Math.round((x - b) * 100) / 100; } else { a.base += x; a.vat += Math.round(x * 7) / 100; } return a; }, { free: 0, base: 0, vat: 0 });
  const total = lines.reduce((a, l) => a + calc(l), 0);
  const submit = () => start(async () => {
    setErr(null);
    if (!contact) { setErr('ไม่สามารถบันทึกได้ เนื่องจากข้อมูลไม่ถูกต้อง/ไม่ครบถ้วน — กรุณาเลือกผู้ติดต่อ'); return; }
    const r = await createStandaloneWht({ date, contact, form, category: '5', lines: lines.map(l => ({ income_type: l.income_type.trim(), amount: Number(l.amount),
      vat_mode: l.vat_mode, ...(l.rate === 'fixed' ? { rate: null, wht: Number(l.wht) } : { rate: Number(l.rate) }) })) });
    if (r.error) setErr(r.error); else { setLines([blank()]); setContact(''); }
  });
  return (
    <details className="panel" style={{ margin: '8px 0', padding: 12 }} open={!!init}>
      <summary className="btn">+ สร้างหนังสือรับรองหัก ณ ที่จ่ายใหม่</summary>
      <div style={{ display: 'grid', gap: 8, marginTop: 10, maxWidth: 760 }}>
        <label>วันที่จ่าย <input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        <label>ผู้ถูกหักภาษี <select value={contact} onChange={e => setContact(e.target.value)}><option value="">เลือก...</option>
          {vendors.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}</select></label>
        {vendors.find(v => v.id === contact) && (() => { const v = vendors.find(x => x.id === contact)!; return <div className="sub">เลขประจำตัวผู้เสียภาษี {v.tax_id || '— (ยังไม่กรอก)'} · ที่อยู่ {v.address || '— (ยังไม่กรอก)'}</div>; })()}
        <label>แบบยื่น <select value={form} onChange={e => setForm(e.target.value)}>{FORMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        {lines.map((l, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'end' }}>
            <label style={{ flex: '2 1 220px' }}>ประเภทเงินได้ที่จ่าย <select value={INCOME_TYPES.includes(l.income_type) ? l.income_type : l.income_type ? 'custom' : ''} onChange={e => set(i, 'income_type', e.target.value === 'custom' ? ' ' : e.target.value)}>
              <option value="">-- กรุณาเลือก --</option>{INCOME_TYPES.map(t => <option key={t} value={t}>{t}</option>)}<option value="custom">อื่น ๆ (พิมพ์เอง)</option></select>
              {!INCOME_TYPES.includes(l.income_type) && l.income_type !== '' && <input value={l.income_type.trim()} onChange={e => set(i, 'income_type', e.target.value || ' ')} placeholder="ระบุประเภทเงินได้" />}</label>
            <label>อัตรา <select value={l.rate} onChange={e => set(i, 'rate', e.target.value)}>{RATES.map(r => <option key={r} value={r}>{r}%</option>)}<option value="fixed">ระบุจำนวนเอง</option></select></label>
            <label>จำนวนเงิน <input type="number" step="0.01" min="0" value={l.amount} onChange={e => set(i, 'amount', e.target.value)} /></label>
            <label>VAT <select value={l.vat_mode} onChange={e => set(i, 'vat_mode', e.target.value)}><option value="none">ไม่มี/ยกเว้นภาษีมูลค่าเพิ่ม</option><option value="exclusive">ไม่รวมภาษีมูลค่าเพิ่ม</option><option value="inclusive">รวมภาษีมูลค่าเพิ่ม</option></select></label>
            {l.rate === 'fixed' && <label>ภาษีที่หัก <input type="number" step="0.01" min="0" value={l.wht} onChange={e => set(i, 'wht', e.target.value)} /></label>}
            <span className="num">{calc(l).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
            {lines.length > 1 && <button type="button" className="btn sm ghost" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}>ลบ</button>}
          </div>))}
        <div><button type="button" className="btn sm ghost" onClick={() => setLines(ls => [...ls, blank()])}>+ เพิ่มรายการ</button></div>
        <div className="panel" style={{ maxWidth: 360, justifySelf: 'end', width: '100%' }}>
          {[['ไม่มี/ยกเว้นภาษีมูลค่าเพิ่ม', sums.free], ['จำนวนเงินที่คำนวณภาษี', sums.base], ['ภาษีมูลค่าเพิ่ม 7%', sums.vat], ['จำนวนเงิน', sums.free + sums.base + sums.vat], ['ภาษีที่หัก', total], ['ยอดชำระ', sums.free + sums.base + sums.vat - total]].map(([k, v]) =>
            <div key={String(k)} style={{ display: 'flex', justifyContent: 'space-between' }}><span>{k}</span><span className="num">{fmt(Number(v))}</span></div>)}
        </div>
        {err && <div className="toast" role="alert" onClick={() => setErr(null)}>{err}</div>}
        <div><button type="button" className="btn" disabled={pending} onClick={submit}>{pending ? '...' : 'บันทึก'}</button></div>
      </div>
    </details>
  );
}
