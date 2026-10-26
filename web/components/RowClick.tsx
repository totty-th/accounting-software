'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const SKIP = 'a,button,input,select,textarea,summary,label,[role=button],[data-noclick],.relpop,.xl-menu';
const BAD = /\/(export|pdf|xlsx|print|api)(\/|\?|$)|^\/s\//;
/** คลิกตรงไหนของแถวตารางก็เปิดรายการนั้น (แบบ FA) ใช้ทั้งระบบ: เปิดลิงก์ภายในอันแรกของแถว
 *  ยกเว้นคลิกที่ลิงก์/ปุ่ม/ช่องกรอก หรือกำลังลากเลือกข้อความ · Ctrl/⌘/คลิกกลาง = เปิดแท็บใหม่ */
export function RowClick() {
  const r = useRouter();
  useEffect(() => {
    const primary = (tr: Element) => [...tr.querySelectorAll<HTMLAnchorElement>('a[href^="/"]')].find(a => !a.target && !a.hasAttribute('download') && !BAD.test(a.getAttribute('href')!));
    const go = (e: MouseEvent) => {
      const t = e.target as HTMLElement; if (!t.closest || e.defaultPrevented) return;
      const tr = t.closest('main tbody tr, main .rowlink'); if (!tr || tr.classList.contains('clickable') || t.closest(SKIP)) return;
      if (window.getSelection()?.toString()) return;
      const a = primary(tr); if (!a) return;
      const href = a.getAttribute('href')!;
      if (e.button === 1 || e.ctrlKey || e.metaKey) { window.open(href, '_blank'); return; }
      if (e.button === 0) r.push(href);
    };
    document.addEventListener('click', go); document.addEventListener('auxclick', go);
    return () => { document.removeEventListener('click', go); document.removeEventListener('auxclick', go); };
  }, [r]);
  return null;
}
