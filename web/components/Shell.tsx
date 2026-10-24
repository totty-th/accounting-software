'use client';
import { Suspense } from 'react';
import { usePathname } from 'next/navigation';
import { Nav } from '@/components/Nav';
import { RoleProvider } from '@/components/Can';
import { logoutAction } from '@/lib/auth-actions';
import { ROLE_LABEL, type Role } from '@/lib/permissions';

// หน้า /s/... เป็นหน้าสาธารณะของลูกค้า และ /login ไม่แสดงเมนูระบบ
export function Shell({ children, user }: { children: React.ReactNode; user: { name: string; role: Role } | null }) {
  const path = usePathname();
  if (path.startsWith('/s/') || path === '/login' || !user) return <>{children}</>;
  return (
    <RoleProvider role={user.role}>
      <div className="shell">
        <aside className="side noprint">
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
