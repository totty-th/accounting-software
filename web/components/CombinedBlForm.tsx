'use client';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { combinedCandidates, saveCombinedBilling } from '@/lib/actions';

type Cand = Awaited<ReturnType<typeof combinedCandidates>>[number];
type Cust = { id: string; name: string; credit_days: number };
export type CombinedInit = { id: string; doc_no: string; contact: string; date: string; credit_days: number; project: string; description: string; ref_no: string; note: string; invoices: string[] };

const m = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const th = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${+iso.slice(0, 4) + 543}` : '-');

/** ฟอร์มใบวางบิลรวม (M65): เลือกลูกค้า → ติ๊กใบแจ้งหนี้ที่ค้าง · ใบลด/เพิ่มหนี้ของใบที่เลือกรวมให้อัตโนมัติ */
export function CombinedBlForm({ customers, today, init, preselect }: { customers: Cust[]; today: string; init?: CombinedInit; preselect?: { contact: string; inv: string } }) {
  const router = useRouter();
  const [contact, setContact] = useState(init?.contact ?? preselect?.contact ?? '');
  const [date, setDate] = useState(init?.date ?? today);
  const [days, setDays] = useState(String(init?.credit_days ?? customers.find(c => c.id === (preselect?.contact ?? ''))?.credit_days ?? 0));
  const [project, setProject] = useState(init?.project ?? '');
  const [desc, setDesc] = useState(init?.description ?? '');
  const [refNo, setRefNo] = useState(init?.ref_no ?? '');
  const [note, setNote] = useState(init?.note ?? '');
  const [cands, setCands] = useState<Cand[]>([]);
  const [sel, setSel] = useState<string[]>(init?.invoices ?? (preselect?.inv ? [preselect.inv] : []));
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [busy, start] = useTransition();

  useEffect(() => {
    if (!contact) { setCands([]); return; }
    let live = true;
    combinedCandidates(contact, init?.id ?? null).then(r => { if (live) setCands(r); });
    return () => { live = false; };
  }, [contact, init?.id]);

  const chosen = useMemo(() => cands.filter(c => sel.includes(c.id)), [cands, sel]);
  const total = chosen.reduce((a, c) => a + c.outstanding, 0);
  const shown = cands.filter(c => !q || c.doc_no.toLowerCase().includes(q.toLowerCase()));
  const due = (() => { const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + (Number(days) || 0)); return d.toISOString().slice(0, 10); })();
  const toggle = (id: string) => setSel(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));

  const save = () => start(async () => {
    setErr('');
    const r = await saveCombinedBilling(init?.id ?? null, { date, contact, credit_days: Number(days) || 0, project, description: desc, ref_no: refNo, note },
      chosen.map(c => c.id));
    if (r.error) setErr(r.error); else router.push(`/sales/${encodeURIComponent(r.no ?? init?.doc_no ?? '')}`);
  });

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <section className="panel" style={{ display: 'grid', gap: 10 }}>
        <div className="row-inline" style={{ flexWrap: 'wrap' }}>
          <label className="f" style={{ minWidth: 260, flex: 2 }}>ลูกค้า
            <select value={contact} disabled={!!init} onChange={e => { setContact(e.target.value); setSel([]); setDays(String(customers.find(c => c.id === e.target.value)?.credit_days ?? 0)); }}>
              <option value="">— เลือกลูกค้า —</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></label>
          <label className="f">วันที่<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
          <label className="f" style={{ maxWidth: 120 }}>เครดิต (วัน)<input type="number" min={0} value={days} onChange={e => setDays(e.target.value)} /></label>
          <label className="f">ครบกำหนด<input value={th(due)} readOnly /></label>
        </div>
        <div className="row-inline" style={{ flexWrap: 'wrap' }}>
          <label className="f" style={{ flex: 1 }}>โปรเจ็ค<input value={project} onChange={e => setProject(e.target.value)} /></label>
          <label className="f" style={{ flex: 2 }}>รายละเอียด<input value={desc} onChange={e => setDesc(e.target.value)} /></label>
          <label className="f" style={{ flex: 1 }}>เลขที่อ้างอิง<input value={refNo} onChange={e => setRefNo(e.target.value)} /></label>
        </div>
      </section>

      <section className="panel" style={{ padding: 0 }}>
        <div className="row-inline" style={{ padding: '10px 12px', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <b>ใบแจ้งหนี้ที่ค้างของลูกค้า</b>
          <input placeholder="ค้นหาเลขที่เอกสาร" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 220 }} />
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table><thead><tr><th /><th>เลขที่เอกสาร</th><th>วันที่เอกสาร</th><th>วันครบกำหนด</th><th>ใบลด/เพิ่มหนี้</th><th className="num">ยอดรวมตามเอกสาร</th><th className="num">ยอดค้างที่วางบิล</th></tr></thead>
            <tbody>
              {!contact && <tr><td colSpan={7} className="sub">เลือกลูกค้าก่อน</td></tr>}
              {contact && !cands.length && <tr><td colSpan={7} className="sub">ลูกค้านี้ไม่มีใบแจ้งหนี้ค้างที่ยังไม่อยู่ในใบวางบิลรวมอื่น</td></tr>}
              {shown.map(c => (
                <tr key={c.id} onClick={() => toggle(c.id)} style={{ cursor: 'pointer' }}>
                  <td><input type="checkbox" checked={sel.includes(c.id)} onChange={() => toggle(c.id)} onClick={e => e.stopPropagation()} aria-label={`เลือก ${c.doc_no}`} /></td>
                  <td className="no">{c.doc_no}</td><td>{th(c.doc_date)}</td><td>{th(c.due_date)}</td><td className="sub">{c.adj ?? ''}</td>
                  <td className="num">{m(c.total)}</td><td className="num">{m(c.outstanding)}</td>
                </tr>))}
            </tbody></table>
        </div>
        <div className="row-inline" style={{ padding: '10px 12px', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <span className="sub">เลือก {chosen.length} รายการ · ใบลดหนี้/ใบเพิ่มหนี้ของใบที่เลือกรวมให้อัตโนมัติ · หัก ณ ที่จ่ายคำนวณตอนบันทึก</span>
          <b>ยอดรวม {m(total)} บาท</b>
        </div>
      </section>

      <section className="panel">
        <label className="f">หมายเหตุ<textarea rows={2} value={note} onChange={e => setNote(e.target.value)} /></label>
      </section>
      {err && <div className="notice err" role="alert">{err}</div>}
      <div className="acts" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn ghost" onClick={() => router.back()}>ยกเลิก</button>
        <button type="button" className="btn" disabled={busy || !contact || !chosen.length} onClick={save}>{busy ? 'กำลังบันทึก…' : init ? 'บันทึกการแก้ไข' : 'บันทึกใบวางบิลรวม'}</button>
      </div>
    </div>
  );
}
