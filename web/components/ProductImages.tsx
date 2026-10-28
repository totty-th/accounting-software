'use client';
import { useRef, useState } from 'react';

export type ImgItem = { id?: string; url: string; blob?: Blob; name: string };
export const MAX_IMAGES = 10;
const MAX_SRC = 5 * 1024 * 1024;   // FA: ไฟล์ละไม่เกิน 5 MB
const MAX_SIDE = 1200;

/** ย่อรูปในเบราว์เซอร์ (ด้านยาวสุด 1200px, JPEG) — ลดขนาดก่อนอัปโหลดไปเก็บในฐานข้อมูล */
async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
  return await new Promise<Blob>((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('ย่อรูปไม่สำเร็จ'))), 'image/jpeg', 0.85));
}

/** ส่วนรูปสินค้าในฟอร์ม (ตาม FA): สูงสุด 10 รูป รูปละไม่เกิน 5 MB · รูปแรก = รูปหลัก · ลบ/ย้ายลำดับได้ */
export function ProductImages({ items, onChange }: { items: ImgItem[]; onChange: (x: ImgItem[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const add = async (files: FileList | null) => {
    setMsg(null); if (!files) return;
    let next = [...items]; const errs: string[] = [];
    for (const f of Array.from(files)) {
      if (next.length >= MAX_IMAGES) { errs.push(`อัปโหลดได้สูงสุด ${MAX_IMAGES} รูป`); break; }
      if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { errs.push(`${f.name}: รองรับเฉพาะ JPG, PNG, WEBP`); continue; }
      if (f.size > MAX_SRC) { errs.push(`${f.name}: ไฟล์ใหญ่เกิน 5 MB`); continue; }
      try { const b = await shrink(f); next = [...next, { blob: b, url: URL.createObjectURL(b), name: f.name.length > 50 ? f.name.slice(0, 50) : f.name }]; }
      catch { errs.push(`${f.name}: อ่านรูปไม่ได้`); }
    }
    onChange(next); if (errs.length) setMsg(errs.join(' · ')); if (input.current) input.current.value = '';
  };
  const move = (i: number, d: number) => { const n = [...items]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; onChange(n); };
  return (
    <div className="panel"><h3>รูปสินค้า</h3>
      <p className="sub">อัปโหลดได้สูงสุด {MAX_IMAGES} รูป · ไฟล์ละไม่เกิน 5 MB · JPG, PNG, WEBP · แนะนำ 720×720 พิกเซล · รูปแรกใช้เป็นรูปหลักในรายการสินค้า</p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {items.map((x, i) => (
          <div key={x.id ?? x.url} style={{ width: 104, display: 'grid', gap: 4, justifyItems: 'center' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={x.url} alt={x.name} width={96} height={96} style={{ objectFit: 'cover', borderRadius: 6, border: '1px solid var(--line, #ddd)' }} />
            {i === 0 && <span className="pill blue">รูปหลัก</span>}
            <div style={{ display: 'flex', gap: 2 }}>
              <button type="button" className="btn sm ghost" aria-label={`ย้ายรูป ${x.name} ไปก่อนหน้า`} disabled={i === 0} onClick={() => move(i, -1)}>◀</button>
              <button type="button" className="btn sm ghost" aria-label={`ย้ายรูป ${x.name} ไปถัดไป`} disabled={i === items.length - 1} onClick={() => move(i, 1)}>▶</button>
              <button type="button" className="btn sm ghost" aria-label={`ลบรูป ${x.name}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>✕</button>
            </div>
          </div>))}
        {items.length < MAX_IMAGES && <button type="button" className="btn ghost" style={{ width: 96, height: 96 }} onClick={() => input.current?.click()}>＋ เพิ่มรูป</button>}
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={e => add(e.target.files)} />
      {msg && <div className="notice" role="alert" style={{ borderLeftColor: 'var(--red)' }}>{msg}</div>}
    </div>
  );
}
