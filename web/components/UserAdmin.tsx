'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createUser, updateUser, resetPassword } from '@/lib/user-actions';
import { ROLES, ROLE_LABEL, type Role } from '@/lib/permissions';

type U = { id: string; username: string; display_name: string; role: Role; is_active: boolean; linked: boolean };

export function UserAdmin({ users, meId, supabaseMode }: { users: U[]; meId: string; supabaseMode: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);
  const [nu, setNu] = useState({ username: '', display: '', role: 'sales', password: '' });
  const [pw, setPw] = useState<Record<string, string>>({});
  const done = (r: { error?: string }, okText: string, after?: () => void) => {
    if (r.error) return setMsg({ t: r.error, ok: false });
    setMsg({ t: okText, ok: true }); after?.(); router.refresh();
  };
  return (
    <>
      <div className="panel" style={{ maxWidth: 'none', marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>เพิ่มผู้ใช้</h3>
        <div className="grid">
          <label className="f">ชื่อผู้ใช้ (a-z 0-9 . _ -)<input value={nu.username} onChange={e => setNu({ ...nu, username: e.target.value })} autoCapitalize="none" /></label>
          <label className="f">ชื่อที่แสดง<input value={nu.display} onChange={e => setNu({ ...nu, display: e.target.value })} /></label>
          <label className="f">ตำแหน่ง<select value={nu.role} onChange={e => setNu({ ...nu, role: e.target.value })}>
            {ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></label>
          {supabaseMode && <label className="f">รหัสผ่าน (อย่างน้อย 8 ตัว)<input type="password" autoComplete="new-password" value={nu.password} onChange={e => setNu({ ...nu, password: e.target.value })} /></label>}
        </div>
        {!supabaseMode && <p className="sub">โหมดเดโม: ผู้ใช้ทุกคนล็อกอินด้วยรหัสผ่านเดโมเดียวกัน เมื่อเชื่อม Supabase Auth จะตั้งรหัสรายบุคคลที่นี่</p>}
        <button className="btn" disabled={pending || !nu.username.trim() || !nu.display.trim() || (supabaseMode && nu.password.length < 8)}
          onClick={() => start(async () => done(await createUser(nu), 'เพิ่มผู้ใช้แล้ว', () => setNu({ ...nu, username: '', display: '', password: '' })))}>เพิ่มผู้ใช้</button>
      </div>
      {msg && <div className="notice" role="alert" style={{ borderLeftColor: msg.ok ? 'var(--green)' : 'var(--red)', marginBottom: 12 }}>{msg.t}</div>}
      <div className="panel" style={{ maxWidth: 'none', overflowX: 'auto' }}>
        <table style={{ minWidth: 0 }}>
          <thead><tr><th>ชื่อผู้ใช้</th><th>ชื่อที่แสดง</th><th>ตำแหน่ง</th><th>สถานะ</th><th /></tr></thead>
          <tbody>{users.map(u => {
            const me = u.id === meId;
            return (
              <tr key={u.id} style={{ opacity: u.is_active ? 1 : 0.55 }}>
                <td className="no">{u.username}{me && <small> (คุณ)</small>}</td>
                <td>{u.display_name}</td>
                <td><select aria-label={`ตำแหน่งของ ${u.username}`} value={u.role} disabled={pending || me}
                  onChange={e => start(async () => done(await updateUser({ id: u.id, role: e.target.value }), 'เปลี่ยนตำแหน่งแล้ว'))}>
                  {ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></td>
                <td>{u.is_active ? 'ใช้งาน' : 'ปิดใช้งาน'}</td>
                <td><div className="acts">
                  {!me && <button className="btn sm ghost" disabled={pending}
                    onClick={() => start(async () => done(await updateUser({ id: u.id, active: !u.is_active }), u.is_active ? 'ปิดใช้งานแล้ว' : 'เปิดใช้งานแล้ว'))}>
                    {u.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button>}
                  {supabaseMode && <>
                    <input type="password" placeholder="รหัสผ่านใหม่" autoComplete="new-password" style={{ width: 130 }}
                      value={pw[u.id] ?? ''} onChange={e => setPw({ ...pw, [u.id]: e.target.value })} />
                    <button className="btn sm ghost" disabled={pending || (pw[u.id] ?? '').length < 8}
                      onClick={() => start(async () => done(await resetPassword({ id: u.id, password: pw[u.id] }), 'ตั้งรหัสผ่านใหม่แล้ว', () => setPw({ ...pw, [u.id]: '' })))}>ตั้งรหัส</button></>}
                </div></td></tr>);
          })}</tbody></table>
      </div>
    </>
  );
}
