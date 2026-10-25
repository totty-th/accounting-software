'use client';
import { Suspense, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Nav } from '@/components/Nav';
import { RoleProvider } from '@/components/Can';
import { logoutAction } from '@/lib/auth-actions';
import { ROLE_LABEL, type Role } from '@/lib/permissions';

// หน้า /s/... เป็นหน้าสาธารณะของลูกค้า และ /login ไม่แสดงเมนูระบบ
export function Shell({ children, user }: { children: React.ReactNode; user: { name: string; role: Role } | null }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [path]);
  if (path.startsWith('/s/') || path === '/login' || !user) return <>{children}</>;
  return (
    <RoleProvider role={user.role}>
      <div className="shell">
        <div className="mbar noprint"><button type="button" className="mbtn" aria-label="เมนู" aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? '✕' : '☰'}</button>
          <span className="logo">฿</span><b>ระบบบัญชี</b></div>
        <aside className={`side noprint ${open ? 'open' : ''}`}>
          <div className="brand"><span className="logo">฿</span>ระบบบัญชี</div>
          <Suspense fallback={null}><Nav /></Suspense>
          <form action={logoutAction} style={{ marginTop: 'auto', padding: '12px 14px', borderTop: '1px solid rgba(255,255,255,.12)', fontSize: 13 }}>
            <div style={{ opacity: .85 }}>{user.name}</div>
            <div style={{ opacity: .6, fontSize: 12, marginBottom: 8 }}>{ROLE_LABEL[user.role]}</div>
            <button className="btn sm ghost" type="submit">ออกจากระบบ</button>
          </form>
        </aside>
        <main className="main">{children}</main>
      </div>
    </RoleProvider>
  );
}
