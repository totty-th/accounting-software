'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ExpForm } from '@/components/ExpForm';
import { uploadScanFiles, discardScan } from '@/lib/actions';

type Scan = { id: string; filename: string; mime: string; size: number; at: string; by: string };
type FormProps = Omit<React.ComponentProps<typeof ExpForm>, 'scanId' | 'onSaved'>;
const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const OK = ['image/jpeg', 'image/png', 'application/pdf'];

/** M71 โต๊ะบันทึกจากเอกสาร: ซ้าย = ไฟล์รอบันทึก · กลาง = ภาพ · ขวา = ฟอร์มค่าใช้จ่าย
 *  ตัวอ่านข้อมูลอัตโนมัติยังไม่ต่อ (เฟสถัดไปจะเติมค่าลงฟอร์มผ่าน doc_scans.extracted) */
export function ScanDesk({ scans, form }: { scans: Scan[]; form: FormProps }) {
  const router = useRouter();
  const [sel, setSel] = useState<string | null>(scans[0]?.id ?? null);
  const [zoom, setZoom] = useState(1), [rot, setRot] = useState(0);
  const [msg, setMsg] = useState<{ t: string; href?: string; err?: boolean } | null>(null);
  const [drag, setDrag] = useState(false);
  const [pending, start] = useTransition();
  const inp = useRef<HTMLInputElement>(null);
  const cur = scans.find(s => s.id === sel) ?? null;
  // รายการเปลี่ยน (บันทึก/ยกเลิก/อัปโหลด) → ถ้าไฟล์ที่เลือกหายไป เลือกไฟล์แรกที่เหลือ
  useEffect(() => { if (!cur) setSel(scans[0]?.id ?? null); }, [scans, cur]);
  useEffect(() => { setZoom(1); setRot(0); }, [sel]);

  const upload = (list: FileList | File[]) => {
    const files = Array.from(list);
    const bad = files.find(f => !OK.includes(f.type));
    if (bad) return setMsg({ t: `${bad.name}: รองรับเฉพาะ JPG, PNG หรือ PDF`, err: true });
    const big = files.find(f => (f.type === 'application/pdf' ? f.size > 7.5 * 1048576 : f.size > 4 * 1048576));
    if (big) return setMsg({ t: `${big.name}: ใหญ่เกินกำหนด (รูป ≤ 4 MB, PDF ≤ 7.5 MB)`, err: true });
    if (!files.length) return;
    start(async () => {
      const fd = new FormData(); files.forEach(f => fd.append('file', f));
      const r = await uploadScanFiles(fd);
      if (r.error) return setMsg({ t: r.error, err: true });
      setMsg({ t: `อัปโหลดแล้ว ${files.length} ไฟล์` });
      if (r.ids?.[0] && !cur) setSel(r.ids[0]);
      router.refresh();
    });
  };
  const discard = (id: string) => start(async () => {
    const r = await discardScan(id); if (r.error) return setMsg({ t: r.error, err: true });
    setMsg({ t: 'ย้ายไฟล์ไปที่ "ยกเลิก" แล้ว (นำกลับได้ที่หน้าประวัติ)' });
    const i = scans.findIndex(s => s.id === id); setSel(scans[i + 1]?.id ?? scans[i - 1]?.id ?? null); router.refresh();
  });
  const saved = (expenseId: string) => {
    const i = scans.findIndex(s => s.id === sel);
    setMsg({ t: 'บันทึกค่าใช้จ่ายแล้ว', href: `/expenses/${expenseId}` });
    setSel(scans[i + 1]?.id ?? scans[i - 1]?.id ?? null); router.refresh();
  };
  const src = cur ? `/expenses/scan/file/${cur.id}?inline=1` : '';

  return (
    <div className="scan-desk">
      <aside className={`scan-files panel ${drag ? 'drag' : ''}`}
        onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}>
        <button type="button" className="btn" style={{ width: '100%' }} disabled={pending} onClick={() => inp.current?.click()}>{pending ? 'กำลังทำงาน…' : '+ อัปโหลดไฟล์'}</button>
        <input ref={inp} type="file" multiple accept="image/jpeg,image/png,application/pdf" hidden aria-label="เลือกไฟล์บิล"
          onChange={e => { if (e.target.files) upload(e.target.files); e.target.value = ''; }} />
        <p className="sub" style={{ margin: '6px 0 10px' }}>ลากไฟล์มาวางได้ · JPG/PNG ≤ 4 MB · PDF ≤ 7.5 MB</p>
        <div className="scan-count">รอบันทึก {scans.length} ไฟล์</div>
        <ul>{scans.map(s => (
          <li key={s.id} className={s.id === sel ? 'on' : ''}>
            <button type="button" className="scan-item" onClick={() => setSel(s.id)}>
              <span className="scan-ico">{s.mime === 'application/pdf' ? 'PDF' : 'IMG'}</span>
              <span className="scan-meta"><b title={s.filename}>{s.filename}</b><small>{kb(s.size)} · {s.at}{s.by ? ` · ${s.by}` : ''}</small></span>
            </button>
            <button type="button" className="scan-x" title="ยกเลิกไฟล์นี้" aria-label={`ยกเลิก ${s.filename}`} disabled={pending} onClick={() => discard(s.id)}>×</button>
          </li>))}
        </ul>
        {!scans.length && <p className="sub">ยังไม่มีไฟล์รอบันทึก</p>}
      </aside>

      <section className="scan-view panel">
        {cur ? <>
          <div className="scan-tools">
            <b className="scan-name" title={cur.filename}>{cur.filename}</b>
            {cur.mime !== 'application/pdf' && <>
              <button type="button" className="btn ghost sm" onClick={() => setZoom(z => Math.max(0.5, +(z - 0.25).toFixed(2)))} aria-label="ย่อ">−</button>
              <span className="sub">{Math.round(zoom * 100)}%</span>
              <button type="button" className="btn ghost sm" onClick={() => setZoom(z => Math.min(4, +(z + 0.25).toFixed(2)))} aria-label="ขยาย">+</button>
              <button type="button" className="btn ghost sm" onClick={() => setRot(r => (r + 90) % 360)}>หมุน</button></>}
            <a className="btn ghost sm" href={src} target="_blank" rel="noreferrer">เปิดแท็บใหม่</a>
          </div>
          <div className="scan-canvas">
            {cur.mime === 'application/pdf'
              ? <iframe key={cur.id} src={src} title={cur.filename} />
              // eslint-disable-next-line @next/next/no-img-element
              : <img key={cur.id} src={src} alt={cur.filename} style={{ transform: `rotate(${rot}deg) scale(${zoom})` }} />}
          </div>
        </> : <div className="scan-empty sub">เลือกหรืออัปโหลดไฟล์ทางซ้าย เพื่อดูภาพบิลข้างฟอร์ม</div>}
      </section>

      <section className="scan-form">
        {msg && <div className={`scan-msg ${msg.err ? 'err' : ''}`} role="status">{msg.t}{msg.href && <> · <Link href={msg.href}>เปิดเอกสาร</Link></>}
          <button type="button" className="scan-x" onClick={() => setMsg(null)} aria-label="ปิดข้อความ">×</button></div>}
        {cur ? <ExpForm key={cur.id} {...form} scanId={cur.id} onSaved={saved} />
          : <div className="panel sub">ยังไม่มีไฟล์ที่เลือก · บันทึกค่าใช้จ่ายแบบไม่มีไฟล์ได้ที่ <Link href="/expenses/new">สร้างค่าใช้จ่าย</Link></div>}
      </section>
    </div>
  );
}
