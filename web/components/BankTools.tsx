'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createBankAccount, importStatement, checkStatementDups } from '@/lib/actions';
import { parseStatementCsv } from '@/lib/bank-csv';

// ตั้งบัญชีธนาคาร + นำเข้ารายการเดินบัญชีจากไฟล์ CSV
export function BankTools({ banks }: { banks: { id: string; label: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);
  const [nb, setNb] = useState({ bank: '', no: '', name: '' });
  const [target, setTarget] = useState(banks[0]?.id ?? '');
  const [file, setFile] = useState<{ name: string; rows: any[] } | null>(null);
  const [dups, setDups] = useState<number[] | null>(null);   // แถวที่ซ้ำ (เริ่มที่ 1) — null = ยังไม่ตรวจ/ไม่มี

  const addBank = () => start(async () => {
    const r = await createBankAccount(nb);
    if (r.error) return setMsg({ t: r.error, ok: false });
    setNb({ bank: '', no: '', name: '' }); setMsg({ t: 'เพิ่มบัญชีธนาคารแล้ว', ok: true }); router.refresh();
  });
  const pick = async (f: File | undefined) => {
    if (!f) return setFile(null);
    try { setFile({ name: f.name, rows: parseStatementCsv(await f.text()) }); setMsg(null); setDups(null); }
    catch (e: any) { setFile(null); setMsg({ t: e.message, ok: false }); }
  };
  const finish = async (skipDups: boolean) => {
    if (!file || !target) return;
    const r = await importStatement({ bank: target, file: file.name, rows: file.rows, skipDups });
    if (r.error) return setMsg({ t: r.error, ok: false });
    const n = skipDups ? file.rows.length - (dups?.length ?? 0) : file.rows.length;
    setMsg({ t: `นำเข้า ${n} รายการแล้ว`, ok: true }); setFile(null); setDups(null); router.refresh();
  };
  // ตรวจก่อน: ถ้ามีรายการซ้ำให้เตือนและถามก่อน (ไม่บล็อก) ถ้าไม่ซ้ำนำเข้าเลย
  const doImport = () => start(async () => {
    if (!file || !target) return;
    const c = await checkStatementDups({ bank: target, rows: file.rows });
    if (c.error) return setMsg({ t: c.error, ok: false });
    if (c.dups && c.dups.length > 0) { setDups(c.dups); setMsg(null); return; }
    await finish(false);
  });

  return (
    <div className="panel" style={{ marginBottom: 18 }}>
      <h3 style={{ marginTop: 0 }}>เพิ่มบัญชีธนาคาร</h3>
      <div className="grid">
        <label className="f">ธนาคาร<input value={nb.bank} onChange={e => setNb({ ...nb, bank: e.target.value })} /></label>
        <label className="f">เลขที่บัญชี<input value={nb.no} onChange={e => setNb({ ...nb, no: e.target.value })} /></label>
        <label className="f">ชื่อบัญชี (ไม่บังคับ)<input value={nb.name} onChange={e => setNb({ ...nb, name: e.target.value })} /></label>
      </div>
      <button className="btn" disabled={pending || !nb.bank.trim() || !nb.no.trim()} onClick={addBank}>เพิ่มบัญชี</button>
      <h3>นำเข้ารายการเดินบัญชี (CSV)</h3>
      <p className="sub" style={{ marginTop: 0 }}>คอลัมน์: วันที่, รายละเอียด, ถอน, ฝาก, คงเหลือ · วันที่รับ YYYY-MM-DD หรือ DD/MM/YYYY (พ.ศ. ได้)</p>
      <div className="grid">
        <label className="f">บัญชี
          <select value={target} onChange={e => setTarget(e.target.value)}>
            {banks.length === 0 && <option value="">(ยังไม่มีบัญชี)</option>}
            {banks.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select></label>
        <label className="f">ไฟล์ CSV<input type="file" accept=".csv,text/csv" onChange={e => pick(e.target.files?.[0])} /></label>
      </div>
      {file && <p className="sub">พร้อมนำเข้า {file.rows.length} รายการจาก {file.name}</p>}
      {dups && file && (
        <div className="notice" role="alert" style={{ borderLeftColor: 'var(--red)', marginBottom: 12 }}>
          <strong>พบรายการที่เคยนำเข้าแล้ว {dups.length} จาก {file.rows.length} รายการ</strong>
          <div className="sub" style={{ margin: '4px 0 8px' }}>ซ้ำ = วันที่ ยอดเงิน รายละเอียด และยอดคงเหลือตรงกับที่มีในบัญชีนี้ (แถวที่ {dups.slice(0, 12).join(', ')}{dups.length > 12 ? ' …' : ''})</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {dups.length < file.rows.length && <button className="btn" disabled={pending} onClick={() => start(() => finish(true))}>นำเข้าเฉพาะรายการใหม่ ({file.rows.length - dups.length})</button>}
            <button className="btn" disabled={pending} onClick={() => start(() => finish(false))}>นำเข้าทั้งหมด (รวมที่ซ้ำ)</button>
            <button className="btn" disabled={pending} onClick={() => setDups(null)}>ยกเลิก</button>
          </div>
        </div>
      )}
      <button className="btn" disabled={pending || !file || !target || !!dups} onClick={doImport}>นำเข้า</button>
      {msg && <div className="notice" role="alert" style={{ borderLeftColor: msg.ok ? 'var(--green)' : 'var(--red)', marginTop: 12 }}>{msg.t}</div>}
    </div>
  );
}
