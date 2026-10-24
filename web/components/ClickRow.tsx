'use client';
import { useRouter } from 'next/navigation';
import type { ReactNode, CSSProperties } from 'react';

/** แถวตารางที่คลิกตรงไหนก็เปิดเอกสาร (ยกเว้นคลิกที่ลิงก์/ปุ่ม/ช่องกรอกในแถว) */
export function ClickRow({ href, children, style }: { href: string; children: ReactNode; style?: CSSProperties }) {
  const r = useRouter();
  return (
    <tr className="clickable" style={style} tabIndex={0}
      onClick={e => { if ((e.target as HTMLElement).closest('a,button,input,select,textarea,summary,details,label')) return; r.push(href); }}
      onKeyDown={e => { if (e.key === 'Enter' && e.target === e.currentTarget) r.push(href); }}>
      {children}
    </tr>
  );
}
