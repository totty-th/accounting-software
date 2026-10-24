'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { bankMatch, bankMatchDiff, bankUnmatch } from '@/lib/actions';
import { money, dateTh } from '@/lib/format';
import { suggestMatches, type Suggestion } from '@/lib/bank-suggest';

type Line = { id: string; date: string; description: string; amount: number; matched: boolean; hasDiff: boolean };
type Item = { id: string; date: string; no: string; memo: string; amount: number; matched: boolean };
type Acct = { code: string; label: string; type: string };

// ปุ่มลัดตามทิศทางผลต่าง (รหัสบัญชีเป็นของผังตัวอย่าง ต้องยืนยันกับผังบัญชีจริง)
const TAGS_UP: [string, string][] = [['ดอกเบี้ยรับ', '49010'], ['รายได้อื่น', '49990']];
const TAGS_DOWN: [string, string][] = [['ค่าธรรมเนียมธนาคาร', '53211'], ['ค่าใช้จ่ายเบ็ดเตล็ด', '59910']];
const r2 = (n: number) => Math.round(n * 100) / 100;

export function ReconcileBoard({ lines, items, accounts, readOnly = false }: { lines: Line[]; items: Item[]; accounts: Acct[]; readOnly?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sl, setSl] = useState<Set<string>>(new Set());
  const [si, setSi] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const [acc, setAcc] = useState(''); const [memo, setMemo] = useState(''); const [date, setDate] = useState('');
  const [askDiff, setAskDiff] = useState(false);
  const [sug, setSug] = useState<Suggestion[] | null>(null);

  const selLines = lines.filter(l => sl.has(l.id));
  const selItems = items.filter(i => si.has(i.id));
  const unmatchMode = selLines.some(l => l.matched);
  const bankSum = r2(selLines.reduce((s, l) => s + l.amount, 0));
  const docSum = r2(selItems.reduce((s, i) => s + i.amount, 0));
  const diff = r2(bankSum - docSum);
  const defDate = useMemo(() => selLines.map(l => l.date).sort().pop() ?? '', [selLines]);

  const tog = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const n = new Set(set); n.has(id) ? n.delete(id) : n.add(id); setter(n); setErr(null);
  };
  const reset = () => { setSl(new Set()); setSi(new Set()); setDiffOpen(false); setAskDiff(false); setErr(null); setAcc(''); setMemo(''); setDate(''); };
  const finish = (r: { error?: string }) => { if (r.error) return setErr(r.error); reset(); router.refresh(); };

  const doMatch = () => start(async () => {
    if (diff === 0) return finish(await bankMatch([...sl], [...si]));
    setDiffOpen(true); setDate(defDate);
  });
  const doDiff = () => start(async () => finish(await bankMatchDiff({ lines: [...sl], items: [...si], account: acc, memo, date })));
  const doUnmatch = (action?: 'cancel' | 'keep') => start(async () => {
    const l = selLines.find(x => x.matched)!;
    finish(await bankUnmatch(l.id, action));
  });
  const onUnmatch = () => (selLines.find(l => l.matched)?.hasDiff ? setAskDiff(true) : doUnmatch());

  const CONF = { high: ['มั่นใจสูง', 'var(--green)'], medium: ['น่าจะใช่', 'var(--orange)'], low: ['ตรวจสอบก่อน', 'var(--red)'] } as const;
  const lineOf = (id: string) => lines.find(l => l.id === id)!;
  const itemOf = (id: string) => items.find(i => i.id === id)!;
  const pickSug = (g: Suggestion) => { setSl(new Set(g.lineIds)); setSi(new Set(g.itemIds)); setDiffOpen(false); setAskDiff(false); setErr(null); };
  const acceptSug = (gs: Suggestion[]) => start(async () => {
    for (const g of gs) { const r = await bankMatch(g.lineIds, g.itemIds); if (r.error) { setErr(r.error); break; } }
    setSug(null); reset(); router.refresh();
  });

  const tags = diff > 0 ? TAGS_UP : TAGS_DOWN;
  const accOpts = accounts.filter(a => (diff > 0 ? ['revenue', 'liability', 'equity'] : ['expense', 'asset', 'liability']).includes(a.type));

  return (
    <>
      <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {!readOnly && <button className="btn ghost" disabled={pending} onClick={() => setSug(sug ? null : suggestMatches(lines, items))}>
          {sug ? 'ซ่อนคำแนะนำ' : 'แนะนำจับคู่อัตโนมัติ'}</button>}
        <span className="sub" style={{ margin: 0 }}>เทียบยอดเงิน วันที่ และข้อความของรายการที่ยังไม่จับคู่ · ต้องกดยืนยันเองทุกครั้ง</span>
      </div>
      {sug && (
        <div className="panel" style={{ maxWidth: 'none', marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>คำแนะนำ {sug.length} ชุด</h3>
            {sug.some(g => g.confidence === 'high') && (
              <button className="btn" disabled={pending} onClick={() => acceptSug(sug.filter(g => g.confidence === 'high'))}>
                จับคู่ที่มั่นใจสูงทั้งหมด ({sug.filter(g => g.confidence === 'high').length})</button>)}
          </div>
          {sug.length === 0 ? <div className="empty">ไม่พบรายการที่ยอดตรงกัน (รายการที่ผลต่างไม่เป็นศูนย์ ให้เลือกเองแล้วใช้ "จับคู่แบบมีผลต่าง")</div> : (
            <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
              {sug.map((g, k) => (
                <div key={k} style={{ border: '1px solid var(--line, #ddd)', borderRadius: 8, padding: '8px 12px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ color: CONF[g.confidence][1], fontWeight: 600, minWidth: 84 }}>{CONF[g.confidence][0]}</span>
                  <div style={{ flex: 1, minWidth: 240 }}>
                    {g.lineIds.map(id => <div key={id}>ธนาคาร: {dateTh(lineOf(id).date)} {lineOf(id).description} <b>{money(lineOf(id).amount)}</b></div>)}
                    {g.itemIds.map(id => <div key={id}>สมุดบัญชี: {dateTh(itemOf(id).date)} {itemOf(id).no} {itemOf(id).memo} <b>{money(itemOf(id).amount)}</b></div>)}
                    <small className="sub">{g.reason}</small>
                  </div>
                  <button className="btn sm ghost" disabled={pending} onClick={() => pickSug(g)}>เลือกดู</button>
                  <button className="btn sm" disabled={pending} onClick={() => acceptSug([g])}>จับคู่</button>
                </div>))}
            </div>)}
        </div>)}
      <div className="split" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 16, alignItems: 'start' }}>
        <div className="panel" style={{ maxWidth: 'none', minWidth: 0, overflowX: 'auto' }}>
          <h3 style={{ marginTop: 0 }}>รายการธนาคาร (statement)</h3>
          {lines.length === 0 ? <div className="empty">ยังไม่มีรายการ นำเข้า CSV ที่หน้าธนาคาร</div> : (
            <table style={{ minWidth: 0 }}><thead><tr><th /><th>วันที่</th><th>รายละเอียด</th><th className="num">จำนวนเงิน</th></tr></thead>
              <tbody>{lines.map(l => (
                <tr key={l.id} style={{ opacity: l.matched && !sl.has(l.id) ? 0.6 : 1 }}>
                  <td><input type="checkbox" aria-label="เลือกรายการธนาคาร" checked={sl.has(l.id)} disabled={readOnly || pending || (unmatchMode && !l.matched) || (!unmatchMode && l.matched && sl.size > 0)}
                    onChange={() => tog(sl, setSl, l.id)} /></td>
                  <td>{dateTh(l.date)}</td><td>{l.description}{l.matched && <span style={{ marginLeft: 6, color: 'var(--green)', fontSize: 12.5 }}>✓ จับคู่แล้ว</span>}</td>
                  <td className="num" style={{ color: l.amount < 0 ? 'var(--red)' : 'var(--green)' }}>{money(l.amount)}</td></tr>))}</tbody></table>)}
        </div>
        <div className="panel" style={{ maxWidth: 'none', minWidth: 0, overflowX: 'auto' }}>
          <h3 style={{ marginTop: 0 }}>รายการในสมุดบัญชี</h3>
          {items.length === 0 ? <div className="empty">ยังไม่มีรายการของบัญชีนี้ในสมุดรายวัน</div> : (
            <table style={{ minWidth: 0 }}><thead><tr><th /><th>วันที่</th><th>เลขที่</th><th>คำอธิบาย</th><th className="num">จำนวนเงิน</th></tr></thead>
              <tbody>{items.map(i => (
                <tr key={i.id} style={{ opacity: i.matched ? 0.6 : 1 }}>
                  <td><input type="checkbox" aria-label="เลือกรายการสมุดบัญชี" checked={si.has(i.id)} disabled={readOnly || pending || i.matched || unmatchMode}
                    onChange={() => tog(si, setSi, i.id)} /></td>
                  <td>{dateTh(i.date)}</td><td className="no">{i.no}</td><td>{i.memo}{i.matched && <span style={{ marginLeft: 6, color: 'var(--green)' }}>✓</span>}</td>
                  <td className="num" style={{ color: i.amount < 0 ? 'var(--red)' : undefined }}>{money(i.amount)}</td></tr>))}</tbody></table>)}
        </div>
      </div>

      {(sl.size > 0 || si.size > 0) && (
        <div className="panel" style={{ maxWidth: 'none', position: 'sticky', bottom: 12, marginTop: 16, boxShadow: 'var(--shadow)' }}>
          {unmatchMode ? (
            askDiff ? (
              <>
                <b>กลุ่มนี้มี JV ผลต่างที่ระบบสร้างให้ จะจัดการอย่างไร?</b>
                <div style={{ margin: '10px 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn danger" disabled={pending} onClick={() => doUnmatch('cancel')}>ยกเลิกจับคู่ และกลับรายการ JV ผลต่าง (แนะนำ)</button>
                  <button className="btn ghost" disabled={pending} onClick={() => doUnmatch('keep')}>ยกเลิกจับคู่ แต่คง JV ผลต่างไว้</button>
                  <button className="btn ghost" onClick={reset}>ปิด</button>
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <span>รายการที่จับคู่แล้ว · ยกเลิกแถวเดียวจะปลดทั้งกลุ่ม</span>
                <button className="btn danger" disabled={pending} onClick={onUnmatch}>ยกเลิกจับคู่</button>
                <button className="btn ghost" onClick={reset}>ล้างที่เลือก</button>
              </div>)
          ) : (
            <>
              <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
                <span>เงินธนาคาร <b>{money(bankSum)}</b></span><span>−</span>
                <span>เงินในสมุดบัญชี <b>{money(docSum)}</b></span><span>=</span>
                <span>ผลต่าง <b style={{ color: diff === 0 ? 'var(--green)' : 'var(--red)' }}>{money(diff)}</b></span>
                <button className="btn" disabled={pending || sl.size === 0 || si.size === 0} onClick={doMatch}>
                  {diff === 0 ? 'จับคู่' : 'จับคู่แบบมีผลต่าง'}</button>
                <button className="btn ghost" onClick={reset}>ล้างที่เลือก</button>
              </div>
              {diffOpen && diff !== 0 && (
                <div style={{ marginTop: 14 }}>
                  <p className="sub" style={{ margin: '0 0 8px' }}>ระบบจะสร้างสมุดรายวันทั่วไปปิดผลต่าง {money(Math.abs(diff))} ให้และจับคู่ทันที
                    ({diff > 0 ? 'เดบิตบัญชีธนาคาร เครดิตบัญชีที่เลือก' : 'เดบิตบัญชีที่เลือก เครดิตบัญชีธนาคาร'})</p>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                    {tags.map(([t, code]) => (
                      <button key={t} className="btn sm ghost" onClick={() => { setMemo(t); setAcc(code); }}>{t}</button>))}
                  </div>
                  <div className="grid">
                    <label className="f">บัญชี{diff > 0 ? 'เครดิต' : 'เดบิต'}
                      <select value={acc} onChange={e => setAcc(e.target.value)}>
                        <option value="">เลือกบัญชี...</option>
                        {accOpts.map(a => <option key={a.code} value={a.code}>{a.label}</option>)}</select></label>
                    <label className="f">คำอธิบายรายการ<input value={memo} onChange={e => setMemo(e.target.value)} /></label>
                    <label className="f">วันที่เอกสาร<input value={date} placeholder="YYYY-MM-DD" onChange={e => setDate(e.target.value)} /></label>
                  </div>
                  <button className="btn" disabled={pending || !acc || !memo.trim()} onClick={doDiff}>{pending ? 'กำลังบันทึก...' : 'บันทึกและจับคู่'}</button>
                </div>)}
            </>)}
          {err && <div className="notice" role="alert" style={{ borderLeftColor: 'var(--red)', marginTop: 10 }}>{err}</div>}
        </div>)}
    </>
  );
}
