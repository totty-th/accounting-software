'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { matchShortcut } from '@/lib/shortcuts';

/** ตัวจัดการแป้นพิมพ์ลัดทั่วระบบ — ทำงานกับปุ่ม/ฟอร์มที่มีอยู่ในหน้าเท่านั้น */
export function Shortcuts() {
  const router = useRouter();
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const s = matchShortcut(e); if (!s) return;
      e.preventDefault();
      switch (s.id) {
        case 'new-sale': router.push('/sales/new'); break;
        case 'new-contact': router.push('/contacts/new'); break;
        case 'new-product': router.push('/products/new'); break;
        case 'print': window.print(); break;
        case 'close': router.back(); break;
        case 'save': case 'save-close': {
          const f = (document.activeElement as HTMLElement | null)?.closest('form') ?? document.querySelector('main form');
          (f as HTMLFormElement | null)?.requestSubmit();
          break;
        }
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [router]);
  return null;
}
