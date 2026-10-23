'use client';
import { usePathname } from 'next/navigation';
import { Nav } from '@/components/Nav';

// หน้า /s/... เป็นหน้าสาธารณะของลูกค้า ไม่แสดงเมนูระบบ
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  if (path.startsWith('/s/')) return <>{children}</>;
  return (
    <div className="shell">
      <aside className="side noprint">
        <div className="brand"><span className="logo">฿</span>ระบบบัญชี</div>
        <Nav />
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
