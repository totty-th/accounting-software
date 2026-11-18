'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createUser, updateUser, resetPassword } from '@/lib/user-actions';
import { ROLES, ROLE_LABEL, type Role } from '@/lib/permissions';

type U = { id: string; username: string; display_name: string; role: Role; is_active: boolean; email: string; has_pw: boolean; must: boolean };
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const userOf = (email: string) => email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '').replace(/^[._-]+/, '').slice(0, 32);

export function UserAdmin({ users, meId }: { users: U[]; meId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);
  const blank = { username: '', display: '', role: 'sales', password: '', first: '', last: '', phone: '', email: '' };
  const [nu, setNu] = useState(blank);
  const [pw, setPw] = useState<Record<string, string>>({});
  const [em, setEm] = useState<Record<string, string>>({});
  const done = (r: { error?: string }, okText: string, after?: () => void) => {
    if (r.error) return setMsg({ t: r.error, ok: false });
    setMsg({ t: okText, ok: true }); after?.(); router.refresh();
  };
  const ready = nu.username.trim() && nu.display.trim() && EMAIL.test(nu.email.trim()) && nu.password.length >= 8;
  return (
    <>
      <div className="panel" style={{ maxWidth: 'none', marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>เพิ่มผู้ใช้</h3>
        <div className="grid">
          <label className="f">อีเมล (ใช้ล็อกอิน)<input type="email" value={nu.email} autoCapitalize="none"
            onChange={e => setNu({ ...nu, email: e.target.value, username: nu.username && nu.username !== userOf(nu.email) ? nu.username : userOf(e.target.value) })} /></label>
          <label className="f">รหัสผ่านเริ่มต้น (อย่างน้อย 8 ตัว)<input type="text" autoComplete="off" spellCheck={false} value={nu.password} onChange={e => setNu({ ...nu, password: e.target.value })} /></label>
          <label className="f">ชื่อผู้ใช้ (a-z 0-9 . _ -)<input value={nu.username} onChange={e => setNu({ ...nu, username: e.target.value })} autoCapitalize="none" /></label>
          <label className="f">ชื่อที่แสดง<input value={nu.display} onChange={e => setNu({ ...nu, display: e.target.value })} /></label>
          <label className="f">ชื่อจริง<input value={nu.first} onChange={e => setNu({ ...nu, first: e.target.value })} /></label>
          <label className="f">นามสกุล<input value={nu.last} onChange={e => setNu({ ...nu, last: e.target.value })} /></label>
          <label className="f">เบอร์โทร<input inputMode="tel" value={nu.phone} onChange={e => setNu({ ...nu, phone: e.target.value })} /></label>
          <label className="f">ตำแหน่ง<select value={nu.role} onChange={e => setNu({ ...nu, role: e.target.value })}>
            {ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></label>
        </div>
        <p className="sub">แจ้งอีเมลและรหัสเริ่มต้นให้ผู้ใช้เอง · ผู้ใช้ต้องตั้งรหัสใหม่ตอนเข้าครั้งแรก</p>
        <button className="btn" disabled={pending || !ready}
          onClick={() => start(async () => done(await createUser(nu), 'เพิ่มผู้ใช้แล้ว', () => setNu(blank)))}>เพิ่มผู้ใช้</button>
      </div>
      {msg && <div className="notice" role="alert" style={{ borderLeftColor: msg.ok ? 'var(--green)' : 'var(--red)', marginBottom: 12 }}>{msg.t}</div>}
      <div className="panel" style={{ maxWidth: 'none', overflowX: 'auto' }}>
        <table style={{ minWidth: 0 }}>
          <thead><tr><th>ชื่อผู้ใช้</th><th>อีเมล</th><th>ชื่อที่แสดง</th><th>ตำแหน่ง</th><th>สถานะ</th><th>รหัสผ่าน</th></tr></thead>
          <tbody>{users.map(u => {
            const me = u.id === meId;
            return (
              <tr key={u.id} style={{ opacity: u.is_active ? 1 : 0.55 }}>
                <td className="no">{u.username}{me && <small> (คุณ)</small>}</td>
                <td>{u.email
                  ? u.email
                  : <div className="acts"><input type="email" placeholder="กำหนดอีเมล" style={{ width: 170 }} value={em[u.id] ?? ''} onChange={e => setEm({ ...em, [u.id]: e.target.value })} />
                      <button className="btn sm ghost" disabled={pending || !EMAIL.test((em[u.id] ?? '').trim())}
                        onClick={() => start(async () => done(await updateUser({ id: u.id, email: em[u.id] }), 'บันทึกอีเมลแล้ว', () => setEm({ ...em, [u.id]: '' })))}>บันทึก</button></div>}</td>
                <td>{u.display_name}</td>
                <td><select aria-label={`ตำแหน่งของ ${u.username}`} value={u.role} disabled={pending || me}
                  onChange={e => start(async () => done(await updateUser({ id: u.id, role: e.target.value }), 'เปลี่ยนตำแหน่งแล้ว'))}>
                  {ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
                  {!me && <button className="btn sm ghost" style={{ marginLeft: 6 }} disabled={pending}
                    onClick={() => start(async () => done(await updateUser({ id: u.id, active: !u.is_active }), u.is_active ? 'ปิดใช้งานแล้ว' : 'เปิดใช้งานแล้ว'))}>
                    {u.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button>}</td>
                <td>{u.is_active ? 'ใช้งาน' : 'ปิดใช้งาน'}</td>
                <td>{me ? <a href="/change-password">เปลี่ยนรหัสของฉัน</a> : <div className="acts">
                  <small style={{ opacity: .75 }}>{!u.has_pw ? 'ยังไม่ตั้ง' : u.must ? 'รอผู้ใช้เปลี่ยน' : 'ตั้งแล้ว'}</small>
                  <input type="text" placeholder="รหัสใหม่" autoComplete="off" spellCheck={false} style={{ width: 120 }}
                    value={pw[u.id] ?? ''} onChange={e => setPw({ ...pw, [u.id]: e.target.value })} />
                  <button className="btn sm ghost" disabled={pending || (pw[u.id] ?? '').length < 8 || !u.email}
                    title={!u.email ? 'กำหนดอีเมลก่อน' : undefined}
                    onClick={() => start(async () => done(await resetPassword({ id: u.id, password: pw[u.id] }), `ตั้งรหัสของ ${u.username} แล้ว — ผู้ใช้ต้องเปลี่ยนรหัสตอนเข้าครั้งถัดไป`, () => setPw({ ...pw, [u.id]: '' })))}>ตั้งรหัส</button></div>}</td>
              </tr>);
          })}</tbody></table>
      </div>
    </>
  );
}
