'use client';
import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { importProducts } from '@/lib/actions';
import { FIELDS, MAX_ROWS, autoMap, validateImport, type FieldKey } from '@/lib/product-import';

type Wh = { id: string; name: string; is_main: boolean };
const STEPS = ['อัปโหลดไฟล์', 'จับคู่หัวคอลัมน์', 'รายละเอียด', 'ตรวจสอบและนำเข้า'];

/** ตัวช่วยนำเข้าสินค้า 4 ขั้น (แบบ FA): อัปโหลด → จับคู่คอลัมน์ → เลือกคลัง → ตรวจสอบ · ผิดแถวเดียวนำเข้าทั้งไฟล์ไม่ได้ */
export function ImportWizard({ whs, existing }: { whs: Wh[]; existing: string[] }) {
  const r = useRouter();
  const [step, setStep] = useState(1);
  const [file, setFile] = useState<{ name: string; headers: string[]; rows: unknown[][]; total: number } | null>(null);
  const [map, setMap] = useState<Record<FieldKey, number> | null>(null);
  const [wh, setWh] = useState(whs.find(w => w.is_main)?.id ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const known = useMemo(() => new Set(existing), [existing]);
  const v = useMemo(() => (file && map ? validateImport(file.rows, map, known) : null), [file, map, known]);

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
    const x = await importProducts({ file: file!.name, wh: wh || null, rows: file!.rows, map: map as any });
    if (x.error) setErr(x.error); else { setDone(v!.items.length); r.refresh(); }
  });
  const errReport = () => {
    const csv = '﻿แถว,ข้อผิดพลาด\n' + v!.issues.map(i => `${i.row},"${i.message.replace(/"/g, '""')}"`).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = 'รายงานข้อผิดพลาดการนำเข้าสินค้า.csv'; a.click();
  };

  if (done != null) return <div className="panel" style={{ textAlign: 'center' }}><h2>นำเข้าสำเร็จ {done} รายการ</h2><p className="sub">ยอดตั้งต้นไม่กระทบการลงบัญชี แต่ปรากฏในรายงานสินค้าคงเหลือ · ลบทั้งชุดได้จากประวัติการนำเข้า (เฉพาะสินค้าที่ยังไม่เคลื่อนไหว)</p><Link className="btn" href="/products">ดูรายการสินค้า</Link></div>;

  return (
    <>
      <ol className="noprint" style={{ display: 'flex', gap: 16, listStyle: 'none', padding: 0, flexWrap: 'wrap' }}>{STEPS.map((s, i) =>
        <li key={s} aria-current={step === i + 1 ? 'step' : undefined} style={{ opacity: step >= i + 1 ? 1 : 0.5, fontWeight: step === i + 1 ? 700 : 400 }}>
          <span className="pill blue" style={{ display: 'inline-block', minWidth: 24, borderRadius: 12, marginRight: 6 }}>{i + 1}</span>{s}</li>)}</ol>

      {step === 1 && <div className="panel">
        <h3>อัปโหลดไฟล์</h3>
        <ul className="rel"><li>รองรับสินค้านับสต็อกหลายหน่วยนับและยอดตั้งต้น: 1 แถวคือ 1 หน่วยสินค้าอื่น แถวที่ใช้รหัสสินค้าเดียวกันจะถูกรวมเป็นสินค้ารายการเดียว</li>
          <li>เพิ่มสินค้าใหม่เท่านั้น (ไม่อัปเดตสินค้าเดิม) · ไม่เกิน {MAX_ROWS} แถวต่อไฟล์ · ไฟล์ .xlsx / .csv ไม่เกิน 4 MB</li></ul>
        <p><b>เตรียมไฟล์:</b> <a href="/products/import/template?type=basic">เทมเพลตพื้นฐาน</a> (บริการ / ไม่นับสต็อก) · <a href="/products/import/template?type=advanced">เทมเพลตขั้นสูง</a> (นับสต็อก หลายหน่วย ยอดตั้งต้น — แนะนำเมื่อไม่แน่ใจ) · หรือใช้ไฟล์ของคุณเอง ขอแค่มีคอลัมน์ ประเภทสินค้า ชื่อสินค้า และหน่วยหลัก</p>
        <label className="f">เลือกไฟล์นำเข้า<input type="file" accept=".xlsx,.csv" onChange={e => upload(e.target.files?.[0])} disabled={pending} /></label>
        {file && <p>✓ {file.name} — พบ {file.total} แถว</p>}
      </div>}

      {step === 2 && file && map && <div className="panel" style={{ overflowX: 'auto' }}>
        <h3>จับคู่หัวคอลัมน์</h3><p className="sub">ระบบจับคู่ให้อัตโนมัติ แก้ไขได้ · ช่อง * ต้องจับคู่</p>
        <table><thead><tr><th>ข้อมูลในระบบ</th><th>คอลัมน์ในไฟล์</th><th>ตัวอย่าง</th></tr></thead>
          <tbody>{FIELDS.map(([k, label, req]) => <tr key={k}><td>{label}{req && <b style={{ color: 'var(--red)' }}> *</b>}</td>
            <td><select aria-label={label} value={map[k]} onChange={e => setMap({ ...map, [k]: Number(e.target.value) })}><option value={-1}>— ไม่นำเข้า —</option>{file.headers.map((h, i) => <option key={i} value={i}>{h || `(คอลัมน์ ${i + 1})`}</option>)}</select></td>
            <td className="sub">{map[k] >= 0 ? String(file.rows[0]?.[map[k]] ?? '') : ''}</td></tr>)}</tbody></table>
        {missing.length > 0 && <div className="notice" role="alert" style={{ borderLeftColor: 'var(--red)' }}>ยังไม่ได้จับคู่: {missing.join(', ')}</div>}
      </div>}

      {step === 3 && <div className="panel">
        <h3>รายละเอียด</h3>
        <label className="f">คลังสินค้าสำหรับยอดตั้งต้น (1 คลังต่อไฟล์)<select value={wh} onChange={e => setWh(e.target.value)}>{whs.map(w => <option key={w.id} value={w.id}>{w.name}{w.is_main ? ' (คลังหลัก)' : ''}</option>)}</select></label>
        <p className="sub">ยอดตั้งต้นของสินค้านับสต็อกทุกรายการในไฟล์จะเข้าคลังนี้ · ไม่ลงบัญชี</p>
      </div>}

      {step === 4 && v && <div className="panel" style={{ overflowX: 'auto' }}>
        <h3>ตรวจสอบและนำเข้า</h3>
        <p><b>พร้อมนำเข้า {v.ready} จาก {v.total}</b> แถว → จะสร้างสินค้า {v.items.length} รายการ{v.issues.length > 0 && <span style={{ color: 'var(--red)' }}> · พบข้อผิดพลาด {v.issues.length} จุด ต้องแก้ไขไฟล์แล้วอัปโหลดใหม่ (ผิดแถวเดียวก็นำเข้าทั้งไฟล์ไม่ได้)</span>}</p>
        {v.issues.length > 0 && <><button type="button" className="btn sm ghost" onClick={errReport}>ดาวน์โหลดรายงานข้อผิดพลาด</button>
          <table><thead><tr><th style={{ width: 70 }}>แถว</th><th>ข้อผิดพลาด</th></tr></thead><tbody>{v.issues.slice(0, 200).map((i, k) => <tr key={k}><td>{i.row || '-'}</td><td>{i.message}</td></tr>)}</tbody></table></>}
        {v.issues.length === 0 && <table><thead><tr><th>ประเภท</th><th>รหัส</th><th>ชื่อสินค้า</th><th>หน่วย</th><th className="num">ราคาขาย</th><th className="num">ยอดตั้งต้น</th><th>หน่วยอื่น</th></tr></thead>
          <tbody>{v.items.slice(0, 100).map((it, k) => <tr key={k}><td>{it.kind === 'service' ? 'บริการ' : it.kind === 'goods_stock' ? 'นับสต็อก' : 'ไม่นับสต็อก'}</td><td>{it.code || <span className="sub">(สร้างให้อัตโนมัติ)</span>}</td><td>{it.name}</td><td>{it.unit}</td><td className="num">{it.sale}</td><td className="num">{it.open?.qty ?? '-'}</td><td>{it.units.map(u => u.unit).join(', ')}</td></tr>)}</tbody></table>}
      </div>}

      {err && <div className="notice" role="alert" style={{ borderLeftColor: 'var(--red)' }}>{err}</div>}
      <div className="noprint" style={{ display: 'flex', gap: 8 }}>
        <Link className="btn ghost" href="/products">ยกเลิก</Link>
        {step > 1 && <button className="btn ghost" onClick={() => setStep(step - 1)}>ย้อนกลับ</button>}
        {step < 4 && <button className="btn" disabled={pending || (step === 1 && !file) || (step === 2 && missing.length > 0)} onClick={() => { setErr(null); setStep(step + 1); }}>ถัดไป</button>}
        {step === 4 && <button className="btn" disabled={pending || !v || v.issues.length > 0 || v.items.length === 0} onClick={doImport}>{pending ? 'กำลังนำเข้า...' : 'นำเข้าข้อมูล'}</button>}
      </div>
    </>
  );
}
