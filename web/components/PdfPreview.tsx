'use client';
import { useEffect, useRef, useState } from 'react';

// แสดง "ไฟล์ PDF จริง" เป็นภาพบนหน้าเว็บ — หน้าพรีวิว/ลิงก์ลูกค้า จึงเหมือนไฟล์ที่ดาวน์โหลดทุกประการ (แหล่งเดียว ไม่มีสองแบบให้เพี้ยน)
export function PdfPreview({ src }: { src: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  useEffect(() => {
    let dead = false; let doc: any = null;
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        doc = await pdfjs.getDocument({ url: src }).promise;
        const el = box.current; if (!el || dead) return;
        el.innerHTML = '';
        const scale = Math.min(window.devicePixelRatio || 1, 2) * 1.6;   // คมชัดพอสำหรับซูม/พิมพ์
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n); if (dead) return;
          const vp = page.getViewport({ scale });
          const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; c.className = 'pdf-page';
          c.setAttribute('role', 'img'); c.setAttribute('aria-label', `หน้า ${n} จาก ${doc.numPages}`);
          el.appendChild(c);
          await page.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise;
        }
        if (!dead) setState('ok');
      } catch { if (!dead) setState('error'); }
    })();
    return () => { dead = true; try { doc?.destroy(); } catch { /* ignore */ } };
  }, [src]);
  return (
    <div className="pdf-preview">
      {state === 'loading' && <p className="sub" style={{ textAlign: 'center', padding: 24 }}>กำลังโหลดเอกสาร...</p>}
      {state === 'error' && <p role="alert" className="sub" style={{ textAlign: 'center', padding: 24 }}>แสดงตัวอย่างไม่สำเร็จ — <a href={src}>เปิดไฟล์ PDF</a></p>}
      <div ref={box} />
    </div>
  );
}
