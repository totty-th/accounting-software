'use client';
/** แถวหัวกลุ่ม (ลูกค้า/ผู้ขาย) กดเพื่อยุบ/กางเอกสารในกลุ่ม · เริ่มต้นยุบแบบ FA */
export function GroupHead({ children }: { children: React.ReactNode }) {
  return <tr className="ghead" tabIndex={0} onClick={e => e.currentTarget.closest('tbody')?.classList.toggle('closed')}
    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.closest('tbody')?.classList.toggle('closed'); } }}>{children}</tr>;
}
