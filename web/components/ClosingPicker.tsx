'use client';
import { useRouter } from 'next/navigation';
import { CLOSING_PRESETS, closingRange } from '@/lib/closing';

const MTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const th = (d: string) => `${d.slice(8)} ${MTH[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
type V = { m: string; from: string; to: string; date: string; eq: string };
/** ตัวเลือกรอบปิดบัญชี: ปุ่มลัด + เลือกเดือน (‹ ›) / ช่วงวันที่ · เปลี่ยนแล้วโหลดยอดให้ทันที ไม่ต้องกด "แสดงข้อมูล" */
export function ClosingPicker({ v, today, eqs }: { v: V; today: string; eqs: { code: string; name: string }[] }) {
  const r = useRouter();
  const go = (n: Partial<V> & { month?: string }) => {
    const x = { ...v, ...n }; const q = new URLSearchParams({ m: x.m, from: x.from, to: x.to, date: x.date, eq: x.eq });
    if (x.m === 'pick') q.set('month', n.month ?? x.from.slice(0, 7));
    r.replace(`?${q}`);
  };
  const preset = (m: string) => { const c = closingRange({ m, month: v.from.slice(0, 7), from: v.from, to: v.to }, today); go({ m: c.m, from: c.from, to: c.to }); };
  const stepMonth = (d: number) => { let y = Number(v.from.slice(0, 4)), mo = Number(v.from.slice(5, 7)) + d; if (mo < 1) { mo = 12; y--; } if (mo > 12) { mo = 1; y++; } const month = `${y}-${String(mo).padStart(2, '0')}`; const c = closingRange({ m: 'pick', month }, today); go({ m: 'pick', from: c.from, to: c.to, month }); };
  const step = (d: number) => { const y = Number(v.from.slice(0, 4)) + d; go({ m: v.m, from: `${y}-01-01`, to: `${y}-12-31` }); };
  const isYear = v.m === 'ycur' || v.m === 'yprev';
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div><div className="sub" style={{ marginBottom: 6 }}>รอบปิดบัญชี</div>
        <div role="group" aria-label="รอบปิดบัญชี" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {CLOSING_PRESETS.map(([k, l]) => <button key={k} type="button" className={`btn sm${v.m === k ? '' : ' ghost'}`} aria-pressed={v.m === k} onClick={() => preset(k)}>{l}</button>)}</div></div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {v.m === 'pick' && <><button type="button" className="btn sm ghost" aria-label="เดือนก่อนหน้า" onClick={() => stepMonth(-1)}>‹</button>
          <input style={{ width: 170 }} type="month" value={v.from.slice(0, 7)} aria-label="เดือน" onChange={e => e.target.value && go({ ...closingRange({ m: 'pick', month: e.target.value }, today), month: e.target.value })} />
          <button type="button" className="btn sm ghost" aria-label="เดือนถัดไป" onClick={() => stepMonth(1)}>›</button></>}
        {isYear && <><button type="button" className="btn sm ghost" aria-label="ปีก่อนหน้า" onClick={() => step(-1)}>‹</button><b>{v.from.slice(0, 4)}</b><button type="button" className="btn sm ghost" aria-label="ปีถัดไป" onClick={() => step(1)}>›</button></>}
        {v.m === 'range' && <><input style={{ width: 170 }} type="date" value={v.from} aria-label="ตั้งแต่วันที่" onChange={e => e.target.value && go({ m: 'range', from: e.target.value, to: e.target.value > v.to ? e.target.value : v.to })} />
          <span>ถึง</span><input style={{ width: 170 }} type="date" value={v.to} aria-label="ถึงวันที่" min={v.from} onChange={e => e.target.value && go({ m: 'range', to: e.target.value })} /></>}
        <span style={{ marginLeft: 'auto', fontWeight: 600 }}>{th(v.from)} – {th(v.to)}</span></div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="f">วันที่ปิดบัญชี<input style={{ width: 170 }} type="date" value={v.date} onChange={e => e.target.value && go({ date: e.target.value })} /></label>
        {v.date !== v.to && <button type="button" className="btn sm ghost" onClick={() => go({ date: v.to })}>ใช้วันสิ้นสุดรอบ ({th(v.to)})</button>}
        <label className="f">บัญชีสำหรับบันทึกผลต่าง<select value={v.eq} onChange={e => go({ eq: e.target.value })}>{eqs.map(a => <option key={a.code} value={a.code}>{a.code} / {a.name}</option>)}</select></label></div>
    </div>
  );
}
