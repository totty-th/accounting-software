'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { bankMatch, bankMatchDiff } from '@/lib/actions';
import { money, dateTh } from '@/lib/format';
import { proposePairs, rankItems, type Proposal, type SLine, type SItem } from '@/lib/bank-suggest';

// M13.5 มุมมอง "จับคู่ให้" (แบบ FA): หนึ่งแถว = รายการธนาคาร ↔ เอกสารที่เสนอ พร้อมป้ายเหตุผล
// ยืนยัน / × ไม่ใช้คู่นี้ / เปลี่ยนคู่ (เลือกจากรายการที่เป็นไปได้ + ค้นหา + สร้าง JV) · ติ๊กหลายคู่แล้วยืนยันทีเดียว
type Acct = { code: string; label: string; type: string };
const r2 = (n: number) => Math.round(n * 100) / 100;
const TAGS_UP: [string, string][] = [['ดอกเบี้ยรับ', '49010'], ['รายได้อื่น', '49990']];
const TAGS_DOWN: [string, string][] = [['ค่าธรรมเนียมธนาคาร', '53211'], ['ค่าใช้จ่ายเบ็ดเตล็ด', '59910']];

export function PairBoard({ lines, items, accounts, readOnly, onCompare }: {
  lines: SLine[]; items: SItem[]; accounts: Acct[]; readOnly: boolean;
  onCompare: (lineIds: string[], itemIds: string[]) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [override, setOverride] = useState<Record<string, string[]>>({});   // key → เอกสารที่ผู้ใช้เลือกเอง
  const [tab, setTab] = useState<'all' | 'ok' | 'note' | 'none'>('all');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [jv, setJv] = useState<{ acc: string; memo: string; date: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [at, setAt] = useState(() => new Date());

  const base = useMemo(() => proposePairs(lines, items, dismissed), [lines, items, dismissed]);
  const props: Proposal[] = useMemo(() => base.map(p => override[p.key] ? { ...p, itemIds: override[p.key],
    status: override[p.key].length ? 'ok' : 'none', chips: [override[p.key].length ? { t: 'เลือกเอง', warn: false } : { t: 'ยังไม่ได้เลือกเอกสาร', warn: true }] } : p), [base, override]);
  const lineOf = (id: string) => lines.find(l => l.id === id)!;
  const itemOf = (id: string) => items.find(i => i.id === id)!;
  const sumL = (p: Proposal) => r2(p.lineIds.reduce((s, id) => s + lineOf(id).amount, 0));
  const sumI = (p: Proposal) => r2(p.itemIds.reduce((s, id) => s + itemOf(id).amount, 0));
  const ready = (p: Proposal) => p.itemIds.length > 0 && sumL(p) === sumI(p);
  const n = { all: props.length, ok: props.filter(p => p.status === 'ok').length, note: props.filter(p => p.status === 'note').length, none: props.filter(p => p.status === 'none').length };
  const shown = props.filter(p => tab === 'all' || p.status === tab);
  const usedElsewhere = (key: string) => new Set(props.filter(p => p.key !== key).flatMap(p => p.itemIds));

  const done = () => { setSel(new Set()); setEdit(null); setJv(null); setErr(null); router.refresh(); };
  const confirm = (ps: Proposal[]) => start(async () => {
    for (const p of ps) { const r = await bankMatch(p.lineIds, p.itemIds); if (r.error) { setErr(`${dateTh(lineOf(p.lineIds[0]).date)} ${lineOf(p.lineIds[0]).description}: ${r.error}`); router.refresh(); return; } }
    done();
  });
  const dismiss = (p: Proposal) => {
    setDismissed(new Set([...dismissed, ...p.lineIds]));
    const o = { ...override }; delete o[p.key]; setOverride(o);
    const s = new Set(sel); s.delete(p.key); setSel(s);
  };
  const reanalyze = () => { setDismissed(new Set()); setOverride({}); setSel(new Set()); setEdit(null); setAt(new Date()); };
  const saveJv = (p: Proposal) => start(async () => {
    const r = await bankMatchDiff({ lines: p.lineIds, items: p.itemIds, account: jv!.acc, memo: jv!.memo, date: jv!.date });
    if (r.error) return setErr(r.error);
    done();
  });
  const selected = props.filter(p => sel.has(p.key) && ready(p));

  return (
    <div className="panel" style={{ maxWidth: 'none' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        {(['all', 'ok', 'note', 'none'] as const).map(k => (
          <button key={k} className={`btn sm ${tab === k ? '' : 'ghost'}`} onClick={() => setTab(k)}>
            {{ all: 'ทั้งหมด', ok: 'รอยืนยัน', note: 'รอยืนยัน · มีข้อสังเกต', none: 'ไม่พบคู่' }[k]} {n[k]}</button>))}
        <span style={{ marginLeft: 'auto' }} className="sub">วิเคราะห์ล่าสุด {at.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.</span>
        <button className="btn sm ghost" onClick={reanalyze}>↻ วิเคราะห์ใหม่</button>
      </div>
      <p className="sub" style={{ marginTop: 0 }}>ระบบเทียบยอดเงิน วันที่ และข้อความ แล้วเสนอคู่ให้ · ยังไม่บันทึกจนกว่าจะกด "ยืนยัน"</p>
      {shown.length === 0 ? <div className="empty">{props.length === 0 ? 'ไม่มีรายการธนาคารที่รอกระทบยอด' : 'ไม่มีรายการในแท็บนี้'}</div> : (
        <div style={{ display: 'grid', gap: 8 }}>
          {shown.map(p => {
            const ok = ready(p), d = r2(sumL(p) - sumI(p)), editing = edit === p.key;
            const cand = editing ? rankItems(items.filter(i => !i.matched && !usedElsewhere(p.key).has(i.id)), p.lineIds.map(lineOf), q).slice(0, 10) : [];
            const up = sumL(p) - sumI(p) > 0;
            return (
              <div key={p.key} className="pairrow" style={{ display: 'grid', gap: 10, alignItems: 'start',
                border: '1px solid var(--line, #e3e6ee)', borderRadius: 10, padding: 10, background: editing ? 'var(--bg2, rgba(99,102,241,.04))' : undefined }}>
                <input type="checkbox" aria-label="เลือกคู่นี้" style={{ marginTop: 4 }} disabled={readOnly || !ok || pending} checked={sel.has(p.key)}
                  onChange={() => { const s = new Set(sel); s.has(p.key) ? s.delete(p.key) : s.add(p.key); setSel(s); }} />
                <div style={{ minWidth: 0 }}>{p.lineIds.map(id => { const l = lineOf(id); return (
                  <div key={id} style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                    <span>{dateTh(l.date)} · {l.description}</span><b style={{ color: l.amount < 0 ? 'var(--red)' : 'var(--green)', whiteSpace: 'nowrap' }}>{money(l.amount)}</b></div>); })}</div>
                <span aria-hidden style={{ color: 'var(--muted, #8a8fa3)', marginTop: 2 }}>⇄</span>
                <div style={{ minWidth: 0 }}>
                  {p.itemIds.length === 0 && !editing && <div className="sub" style={{ margin: 0 }}>— ยังไม่มีเอกสาร —</div>}
                  {!editing && p.itemIds.map(id => { const i = itemOf(id); return (
                    <div key={id} style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                      <span>{dateTh(i.date)} · <b>{i.no}</b> {i.memo}</span><b style={{ whiteSpace: 'nowrap' }}>{money(i.amount)}</b></div>); })}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                    {p.chips.map((c, k) => <span key={k} style={{ fontSize: 12, padding: '1px 8px', borderRadius: 999,
                      background: c.warn ? 'rgba(245,158,11,.14)' : 'rgba(16,185,129,.12)', color: c.warn ? 'var(--orange, #b45309)' : 'var(--green)' }}>{c.warn ? '⚠ ' : '✓ '}{c.t}</span>)}
                    {p.itemIds.length > 0 && d !== 0 && <span style={{ fontSize: 12, color: 'var(--red)' }}>ผลต่าง {money(d)}</span>}
                  </div>
                  {editing && (
                    <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                      <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหา: เลขที่เอกสาร (คั่นด้วย ,) / คำอธิบาย / จำนวนเงิน" />
                      {cand.length === 0 && <div className="sub" style={{ margin: 0 }}>ไม่พบเอกสารที่ยังไม่จับคู่</div>}
                      {cand.map(({ item: i, exact }) => (
                        <label key={i.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 400 }}>
                          <input type="checkbox" checked={p.itemIds.includes(i.id)} onChange={() => setOverride({ ...override,
                            [p.key]: p.itemIds.includes(i.id) ? p.itemIds.filter(x => x !== i.id) : [...p.itemIds, i.id] })} />
                          <span style={{ flex: 1, minWidth: 0 }}>{exact && <b style={{ color: 'var(--green)', fontSize: 12 }}>ยอดตรง </b>}{dateTh(i.date)} · <b>{i.no}</b> {i.memo}</span>
                          <b>{money(i.amount)}</b></label>))}
                      {!readOnly && (jv ? (
                        <div style={{ borderTop: '1px dashed var(--line, #ddd)', paddingTop: 8 }}>
                          <div className="sub" style={{ margin: '0 0 6px' }}>สร้างสมุดรายวันทั่วไป {money(Math.abs(d))} ({up ? 'เดบิตธนาคาร เครดิตบัญชีที่เลือก' : 'เดบิตบัญชีที่เลือก เครดิตธนาคาร'}) แล้วจับคู่ทันที</div>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                            {(up ? TAGS_UP : TAGS_DOWN).map(([t, c]) => <button key={t} className="btn sm ghost" onClick={() => setJv({ ...jv, memo: t, acc: c })}>{t}</button>)}</div>
                          <div className="grid">
                            <label className="f">บัญชี{up ? 'เครดิต' : 'เดบิต'}<select value={jv.acc} onChange={e => setJv({ ...jv, acc: e.target.value })}>
                              <option value="">เลือกบัญชี...</option>
                              {accounts.filter(a => (up ? ['revenue', 'liability', 'equity'] : ['expense', 'asset', 'liability']).includes(a.type)).map(a => <option key={a.code} value={a.code}>{a.label}</option>)}</select></label>
                            <label className="f">คำอธิบาย<input value={jv.memo} onChange={e => setJv({ ...jv, memo: e.target.value })} /></label>
                            <label className="f">วันที่<input value={jv.date} onChange={e => setJv({ ...jv, date: e.target.value })} placeholder="YYYY-MM-DD" /></label>
                          </div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button className="btn sm" disabled={pending || !jv.acc || !jv.memo.trim() || d === 0} onClick={() => saveJv(p)}>บันทึก JV และจับคู่</button>
                            <button className="btn sm ghost" onClick={() => setJv(null)}>ปิด</button></div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                          <button className="btn sm ghost" disabled={d === 0} title={d === 0 ? 'ยอดตรงแล้ว' : undefined}
                            onClick={() => setJv({ acc: '', memo: '', date: p.lineIds.map(id => lineOf(id).date).sort().pop()! })}>
                            + JV {d !== 0 ? `(${p.itemIds.length ? 'ปิดผลต่าง ' : ''}${money(Math.abs(d))})` : ''}</button>
                          <button className="btn sm ghost" onClick={() => { setEdit(null); setJv(null); }}>เสร็จ</button>
                        </div>))}
                    </div>)}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {!readOnly && <>
                    {ok ? <button className="btn sm" disabled={pending} onClick={() => confirm([p])}>ยืนยัน</button>
                      : p.itemIds.length > 0 && <button className="btn sm ghost" disabled={pending} onClick={() => onCompare(p.lineIds, p.itemIds)}>จับคู่แบบมีผลต่าง</button>}
                    {!editing && <button className="btn sm ghost" disabled={pending} onClick={() => { setEdit(p.key); setQ(''); setJv(null); }}>✎ เปลี่ยนคู่</button>}
                    {p.status !== 'none' && <button className="btn sm ghost" aria-label="ไม่ใช้คู่นี้" title="ไม่ใช้คู่นี้" disabled={pending} onClick={() => dismiss(p)}>✕</button>}
                  </>}
                </div>
              </div>);
          })}
        </div>)}
      {err && <div className="notice" role="alert" style={{ borderLeftColor: 'var(--red)', marginTop: 10 }}>{err}</div>}
      {!readOnly && selected.length > 0 && (
        <div className="panel" style={{ maxWidth: 'none', position: 'sticky', bottom: 12, marginTop: 12, boxShadow: 'var(--shadow)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>เลือก <b>{selected.length}</b> คู่</span>
          <button className="btn" disabled={pending} onClick={() => confirm(selected)}>{pending ? 'กำลังบันทึก...' : 'ยืนยันทั้งหมดที่เลือก'}</button>
          <button className="btn ghost" onClick={() => setSel(new Set())}>ล้างที่เลือก</button>
        </div>)}
      {!readOnly && n.ok + n.note > 0 && selected.length === 0 && (
        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn ghost sm" onClick={() => setSel(new Set(props.filter(p => p.status === 'ok' && ready(p)).map(p => p.key)))}>เลือกทุกคู่ที่ไม่มีข้อสังเกต ({props.filter(p => p.status === 'ok' && ready(p)).length})</button>
          <button className="btn ghost sm" onClick={() => setSel(new Set(props.filter(ready).map(p => p.key)))}>เลือกทุกคู่ที่ยอดตรง ({props.filter(ready).length})</button>
        </div>)}
    </div>
  );
}
