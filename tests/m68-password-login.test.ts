import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { hashPassword, checkPassword, tokenHash } from '../web/lib/password';
import { attemptLogin, adminSetPassword, changeOwnPassword, setupWithToken, type Q } from '../web/lib/login';

const dir = new URL('../supabase/migrations/', import.meta.url);
const sql = readdirSync(dir).sort().map(f => readFileSync(new URL(f, dir), 'utf8')).join('\n');
let pg: PGlite; let db: Q;
const one = async (q: string, p: unknown[] = []) => (await db.q(q, p))[0];
beforeAll(async () => { pg = new PGlite(); await pg.exec(sql); db = { q: async (s, p) => (await pg.query<any>(s, p as any[])).rows }; });
beforeEach(async () => { await pg.exec(`truncate app_users cascade`); await pg.query(`select app_user_create('rootadm','root','super_admin')`); });
const mk = async (u: string, role = 'accountant', email: string | null = null) => {
  const id = (await one(`select app_user_create($1,$2,$3) as id`, [u, u, role])).id;
  if (email) await db.q(`update app_users set email=$2 where id=$1`, [id, email]);
  return id as string;
};

describe('M68 รหัสผ่าน', () => {
  it('scrypt: ถูก/ผิด และ hash ต่างกันทุกครั้ง (salt)', async () => {
    const a = await hashPassword('Secret#123'), b = await hashPassword('Secret#123');
    expect(a).not.toBe(b); expect(a.startsWith('scrypt$')).toBe(true);
    expect(await checkPassword('Secret#123', a)).toBe(true);
    expect(await checkPassword('secret#123', a)).toBe(false);
    expect(await checkPassword('x', null)).toBe(false);
  });
});

describe('M68 ล็อกอินด้วยอีเมล', () => {
  it('ผู้ดูแลตั้งรหัส → ล็อกอินด้วยอีเมล (ไม่สนตัวพิมพ์) ได้ และต้องเปลี่ยนรหัส', async () => {
    const id = await mk('somchai', 'accountant', 'somchai@co.th');
    expect(await adminSetPassword(db, id, 'short')).toContain('8');
    expect(await adminSetPassword(db, id, 'Initial-1234')).toBeNull();
    const r: any = await attemptLogin(db, '  SomChai@CO.th ', 'Initial-1234', 'password');
    expect(r.user.username).toBe('somchai'); expect(r.user.mustChange).toBe(true);
    expect(await attemptLogin(db, 'somchai', 'Initial-1234', 'password')).toHaveProperty('error');   // โหมดจริงห้ามใช้ชื่อผู้ใช้
  });
  it('โหมดจริง: บัญชีไม่มีรหัส ใช้รหัสเดโมไม่ได้ · โหมดเดโมในเครื่องใช้ได้', async () => {
    await mk('admin', 'super_admin');
    expect(await attemptLogin(db, 'admin', 'demo1234', 'password')).toHaveProperty('error');
    expect(await attemptLogin(db, 'admin', 'demo1234', 'demo')).toHaveProperty('user');
  });
  it('ปิดใช้งานแล้วเข้าไม่ได้', async () => {
    const id = await mk('usera1', 'accountant', 'a1@co.th'); await adminSetPassword(db, id, 'Initial-1234');
    await db.q(`update app_users set is_active=false where id=$1`, [id]);
    expect(await attemptLogin(db, 'a1@co.th', 'Initial-1234', 'password')).toHaveProperty('error');
  });
  it('ผิด 5 ครั้งล็อก (เก็บในฐานข้อมูล) แม้รหัสถูกก็ยังเข้าไม่ได้จนหมดเวลา', async () => {
    const id = await mk('userb1', 'accountant', 'b1@co.th'); await adminSetPassword(db, id, 'Initial-1234');
    for (let i = 0; i < 4; i++) expect((await attemptLogin(db, 'b1@co.th', 'wrong-pass', 'password') as any).error).toContain('ไม่ถูกต้อง');
    expect((await attemptLogin(db, 'b1@co.th', 'wrong-pass', 'password') as any).error).toContain('รอ');
    expect((await attemptLogin(db, 'b1@co.th', 'Initial-1234', 'password') as any).error).toContain('รอ');
    await db.q(`update app_users set locked_until = now() - interval '1 second' where id=$1`, [id]);
    expect(await attemptLogin(db, 'b1@co.th', 'Initial-1234', 'password')).toHaveProperty('user');
    expect((await one(`select failed_logins from app_users where id=$1`, [id])).failed_logins).toBe(0);
  });
  it('อีเมลซ้ำไม่ได้ (ไม่สนตัวพิมพ์)', async () => {
    await mk('userc1', 'accountant', 'x@co.th');
    await expect(mk('c2', 'accountant', 'X@CO.TH')).rejects.toThrow();
  });
});

describe('M68 เปลี่ยนรหัส/เซสชัน', () => {
  it('เปลี่ยนรหัสเอง: ต้องรู้รหัสเดิม · สำเร็จแล้วไม่ต้องเปลี่ยนอีก และ session_version ขยับ', async () => {
    const id = await mk('userd1', 'accountant', 'd1@co.th'); await adminSetPassword(db, id, 'Initial-1234');
    const v0 = (await one(`select session_version from app_users where id=$1`, [id])).session_version;
    expect(await changeOwnPassword(db, id, 'bad', 'NewPass-5678', 'NewPass-5678')).toHaveProperty('error');
    expect((await changeOwnPassword(db, id, 'Initial-1234', 'NewPass-5678', 'NewPass-567x') as any).error).toContain('ไม่ตรง');
    expect((await changeOwnPassword(db, id, 'Initial-1234', 'Initial-1234', 'Initial-1234') as any).error).toContain('ซ้ำ');
    const r: any = await changeOwnPassword(db, id, 'Initial-1234', 'NewPass-5678', 'NewPass-5678');
    expect(r.v).toBe(v0 + 1);
    const l: any = await attemptLogin(db, 'd1@co.th', 'NewPass-5678', 'password');
    expect(l.user.mustChange).toBe(false); expect(l.user.v).toBe(v0 + 1);
    expect(await attemptLogin(db, 'd1@co.th', 'Initial-1234', 'password')).toHaveProperty('error');
  });
  it('ผู้ดูแลรีเซ็ต → session_version ขยับ (คุกกี้เดิมใช้ไม่ได้) และต้องเปลี่ยนรหัสอีก', async () => {
    const id = await mk('usere1', 'accountant', 'e1@co.th'); await adminSetPassword(db, id, 'Initial-1234');
    await changeOwnPassword(db, id, 'Initial-1234', 'NewPass-5678', 'NewPass-5678');
    const v = (await one(`select session_version from app_users where id=$1`, [id])).session_version;
    await adminSetPassword(db, id, 'Reset-9999x');
    const u = await one(`select session_version, must_change_password from app_users where id=$1`, [id]);
    expect(u.session_version).toBe(v + 1); expect(u.must_change_password).toBe(true);
  });
});

describe('M68 ลิงก์ตั้งบัญชีครั้งแรก', () => {
  it('ใช้ได้ครั้งเดียว · หมดอายุใช้ไม่ได้ · ตั้งอีเมลและรหัสแล้วล็อกอินได้ทันที', async () => {
    const id = await mk('admin', 'super_admin');
    await db.q(`update app_users set setup_token_hash=$2, setup_token_expires=now()+interval '1 day' where id=$1`, [id, tokenHash('tok-abc')]);
    expect(await setupWithToken(db, 'wrong', 'boss@co.th', 'Owner-12345', 'Owner-12345')).toHaveProperty('error');
    expect((await setupWithToken(db, 'tok-abc', 'not-an-email', 'Owner-12345', 'Owner-12345') as any).error).toContain('อีเมล');
    const r: any = await setupWithToken(db, 'tok-abc', 'Boss@co.th', 'Owner-12345', 'Owner-12345');
    expect(r.user.username).toBe('admin');
    expect(await setupWithToken(db, 'tok-abc', 'boss@co.th', 'Owner-12345', 'Owner-12345')).toHaveProperty('error');
    const l: any = await attemptLogin(db, 'boss@co.th', 'Owner-12345', 'password');
    expect(l.user.mustChange).toBe(false);
    await db.q(`update app_users set setup_token_hash=$2, setup_token_expires=now()-interval '1 minute' where id=$1`, [id, tokenHash('old')]);
    expect(await setupWithToken(db, 'old', 'boss@co.th', 'Owner-12345', 'Owner-12345')).toHaveProperty('error');
  });
});
