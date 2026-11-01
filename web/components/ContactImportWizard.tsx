'use client';
import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { importContacts } from '@/lib/actions';
import { FIELDS, autoMap, validateContacts } from '@/lib/contact-import';

const STEPS = ['อัปโหลดไฟล์', 'จับคู่หัวคอลัมน์', 'รายละเอียด', 'ตรวจสอบและนำเข้า'];
const KIND_TH = { customer: 'ลูกค้า', vendor: 'ผู้จำหน่าย', both: 'ลูกค้าและผู้จำหน่าย' } as const;

/** ตัวช่วยนำเข้าผู้ติดต่อ 4 ขั้น (แบบ FA): อัปโหลด → จับคู่คอลัมน์ → วิธีจัดการรายชื่อซ้ำ → ตรวจสอบและนำเข้า */
export function ContactImportWizard({ existing }: { existing: string[] }) {
  const r = useRouter();
  const [step, setStep] = useState(1);
  const [file, setFile] = useState<{ name: string; headers: string[]; rows: unknown[][]; total: number } | null>(null);
  const [map, setMap] = useState<Record<string, number> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ n: number; dup: number } | null>(null);
  const [pending, start] = useTransition();
  const known = useMemo(() => new Set(existing), [existing]);
  const v = useMemo(() => (file && map ? validateContacts(file.rows, map as any, known) : null), [file, map, known]);
  const upload = (f: File | undefined) => {
    setErr(null); if (!f) return;
    start(async () => {
      const fd = new FormData(); fd.set('file', f);
      const res = await fetch('/products/import/parse', { method: 'POST', body: fd });
      const j = await res.json().catch(() => ({ error: 'อ่านไฟล์ไม่ได้' }));
      if (!res.ok) return setErr(j.error ?? 'อ่านไฟล์ไม่ได้');
      setFile({ name: j.file, headers: j.headers, rows: j.rows, total: j.total }); setMap(autoMap(j.headers));
    });
  };
  const missing = map ? FIELDS.filter(f => f[2] && map[f[0]] < 0).map(f => f[1]) : [];
  const doImport = () => start(async () => {
    const x = await importContacts({ file: file!.name, rows: file!.rows, map: map! });
    if (x.error) setErr(x.error); else { setDone({ n: v!.items.length, dup: v!.dups.length }); r.refresh(); }
  });
  const errReport = () => {
    const csv = '﻿แถว,ข้อผิดพลาด\n' + v!.issues.map(i => `${i.row},"${i.message.replace(/"/g, '""')}"`).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = 'รายงานข้อผิดพลาดการนำเข้าผู้ติดต่อ.csv'; a.click();
  };
  if (done) return <div className="panel" style={{ textAlign: 'center' }}><h2>นำเข้าสำเร็จ {done.n} รายชื่อ</h2>
    {done.dup > 0 && <p className="sub">ข้ามรายชื่อซ้ำ {done.dup} รายการ</p>}<p className="sub">ไม่กระทบยอดลูกหนี้/เจ้าหนี้</p><Link className="btn" href="/contacts">ไปที่สมุดรายชื่อ</Link></div>;
  return (
    <>
      <ol className="noprint" style={{ display: 'flex', gap: 16, listStyle: 'none', padding: 0, flexWrap: 'wrap' }}>{STEPS.map((s, i) =>
        <li key={s} aria-current={step === i + 1 ? 'step' : undefined} style={{ opacity: step >= i + 1 ? 1 : 0.5, fontWeight: step === i + 1 ? 700 : 400 }}>
          <span className="pill blue" style={{ display: 'inline-block', minWidth: 24, borderRadius: 12, marginRight: 6 }}>{i + 1}</span>{s}</li>)}</ol>
      {step === 1 && <div className="panel"><h3>อัปโหลดไฟล์</h3>
        <ul className="rel"><li>นำเข้าได้ทั้งลูกค้า ผู้จำหน่าย นิติบุคคลและบุคคลธรรมดา · ไม่เกิน 500 รายชื่อต่อไฟล์ · .xlsx / .csv</li>
          <li>ช่องจำเป็น: ชื่อธุรกิจ, ประเภทผู้ติดต่อ (ลูกค้า / ผู้จำหน่าย / ลูกค้าและผู้จำหน่าย), ประเภทกิจการ (นิติบุคคล / บุคคลธรรมดา)</li>
          <li>รายชื่อซ้ำ (ชื่อธุรกิจ + รหัสสาขา เหมือนในระบบ) จะถูกข้าม · 1 สาขา = 1 ผู้ติดต่อ · การนำเข้าไม่กระทบยอดลูกหนี้/เจ้าหนี้</li></ul>
        <p><a href="/contacts/import/template">ดาวน์โหลดไฟล์ตัวอย่าง</a></p>
        <label className="f">เลือกไฟล์นำเข้า<input type="file" accept=".xlsx,.csv" onChange={e => upload(e.target.files?.[0])} disabled={pending} /></label>
        {file && <p>✓ {file.name} — พบ {file.total} แถว</p>}</div>}
      {step === 2 && file && map && <div className="panel" style={{ overflowX: 'auto' }}><h3>จับคู่หัวคอลัมน์</h3><p className="sub">ระบบจับคู่ให้อัตโนมัติ แก้ไขได้ · ช่อง * ต้องจับคู่</p>
        <table><thead><tr><th>ข้อมูลในระบบ</th><th>คอลัมน์ในไฟล์</th><th>ตัวอย่าง</th></tr></thead>
          <tbody>{FIELDS.map(([k, label, req]) => <tr key={k}><td>{label}{req && <b style={{ color: 'var(--red)' }}> *</b>}</td>
            <td><select aria-label={label} value={map[k]} onChange={e => setMap({ ...map, [k]: Number(e.target.value) })}><option value={-1}>— ไม่นำเข้า —</option>{file.headers.map((h, i) => <option key={i} value={i}>{h || `(คอลัมน์ ${i + 1})`}</option>)}</select></td>
            <td className="sub">{map[k] >= 0 ? String(file.rows[0]?.[map[k]] ?? '') : ''}</td></tr>)}</tbody></table>
        {missing.length > 0 && <div className="notice" role="alert" style={{ borderLeftColor: 'var(--red)' }}>ยังไม่ได้จับคู่: {missing.join(', ')}</div>}</div>}
      {step === 3 && <div className="panel"><h3>รายละเอียด</h3><p><b>เมื่อพบรายชื่อซ้ำกับในระบบ:</b> ข้ามรายการนั้น (ไม่แก้ข้อมูลเดิม)</p>
        <p className="sub">ตรวจซ้ำจากชื่อธุรกิจ + รหัสสาขา (ไม่ใช้เลขผู้เสียภาษี) · ตัวเลือกจัดการรายชื่อซ้ำแบบอื่นยังไม่ทดสอบบนต้นแบบ จึงยังไม่เปิด</p></div>}
      {step === 4 && v && <div className="panel" style={{ overflowX: 'auto' }}><h3>ตรวจสอบและนำเข้า</h3>
        <p><b>พร้อมนำเข้า {v.items.length} จาก {v.total}</b> แถว{v.dups.length > 0 && ` · ซ้ำจะถูกข้าม ${v.dups.length} แถว (แถว ${v.dups.slice(0, 10).join(', ')}${v.dups.length > 10 ? '…' : ''})`}
          {v.issues.length > 0 && <span style={{ color: 'var(--red)' }}> · พบข้อผิดพลาด {v.issues.length} จุด ต้องแก้ไขไฟล์แล้วอัปโหลดใหม่ก่อนนำเข้า</span>}</p>
        {v.issues.length > 0 && <><button type="button" className="btn sm ghost" onClick={errReport}>ดาวน์โหลดรายงานข้อผิดพลาด</button>
          <table><thead><tr><th style={{ width: 70 }}>แถว</th><th>ข้อผิดพลาด</th></tr></thead><tbody>{v.issues.slice(0, 200).map((i, k) => <tr key={k}><td>{i.row || '-'}</td><td>{i.message}</td></tr>)}</tbody></table></>}
        {v.issues.length === 0 && <table><thead><tr><th>ชื่อธุรกิจ</th><th>ประเภท</th><th>กิจการ</th><th>สาขา</th><th>เลขผู้เสียภาษี</th></tr></thead>
          <tbody>{v.items.slice(0, 100).map((it, k) => <tr key={k}><td>{it.business_name}</td><td>{KIND_TH[it.kinds]}</td><td>{it.person_kind === 'juristic' ? 'นิติบุคคล' : 'บุคคลธรรมดา'}</td><td>{it.branch_code || 'สำนักงานใหญ่'}</td><td>{it.tax_id}</td></tr>)}</tbody></table>}</div>}
      {err && <div className="notice" role="alert" style={{ borderLeftColor: 'var(--red)' }}>{err}</div>}
      <div className="noprint" style={{ display: 'flex', gap: 8 }}>
        <Link className="btn ghost" href="/contacts">ยกเลิก</Link>
        {step > 1 && <button className="btn ghost" onClick={() => setStep(step - 1)}>ย้อนกลับ</button>}
        {step < 4 && <button className="btn" disabled={pending || (step === 1 && !file) || (step === 2 && missing.length > 0)} onClick={() => { setErr(null); setStep(step + 1); }}>ถัดไป</button>}
        {step === 4 && <button className="btn" disabled={pending || !v || v.issues.length > 0 || v.items.length === 0} onClick={doImport}>{pending ? 'กำลังนำเข้า...' : 'นำเข้าข้อมูล'}</button>}
      </div>
    </>
  );
}
