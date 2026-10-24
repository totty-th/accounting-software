import { requirePage } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { authMode } from '@/lib/session';
import { UserAdmin } from '@/components/UserAdmin';
import { ROLES, ROLE_LABEL, PERMS, permsOf } from '@/lib/permissions';

const PERM_LABEL: Record<string, string> = {
  'dash.view': 'ภาพรวม', 'sales.read': 'ดูเอกสารขาย', 'sales.write': 'สร้าง/แก้เอกสารขาย', 'sales.approve': 'อนุมัติเอกสารขาย',
  'quote.own': 'ใบเสนอราคาของตัวเอง', 'receipts.read': 'ดูใบเสร็จ', 'receipts.write': 'จัดการใบเสร็จ', 'expenses.read': 'ดูค่าใช้จ่าย',
  'expenses.write': 'จัดการค่าใช้จ่าย', 'expenses.approve': 'อนุมัติค่าใช้จ่าย', 'wht.read': 'ดู 50 ทวิ', 'wht.write': 'แก้ 50 ทวิ',
  'stock.read': 'ดูสต็อก', 'bank.read': 'ดูธนาคาร', 'bank.write': 'จัดการธนาคาร/กระทบยอด', 'reports.read': 'รายงาน',
  'master.read': 'ดูลูกค้า/สินค้า', 'master.write': 'แก้สินค้า', 'contact.create': 'เพิ่มลูกค้า', 'cost.view': 'เห็นราคาซื้อ/ต้นทุน',
  'settings.company': 'ตั้งค่าบริษัท', 'users.manage': 'จัดการผู้ใช้',
};

export default async function Users() {
  const me = await requirePage('users.manage');
  const rows = await (await getDb()).q(`select id, username, display_name, role, is_active, auth_user_id is not null as linked from app_users order by is_active desc, role, username`);
  return (
    <>
      <div className="top"><div><h1>ผู้ใช้และสิทธิ์</h1><p className="sub">ตำแหน่งกำหนดสิทธิ์ · เปลี่ยนมีผลทันทีในคำขอถัดไปของผู้ใช้</p></div></div>
      <UserAdmin users={rows.map(r => ({ id: r.id, username: r.username, display_name: r.display_name, role: r.role, is_active: !!r.is_active, linked: !!r.linked }))} meId={me.id} supabaseMode={authMode() === 'supabase'} />
      <div className="panel" style={{ maxWidth: 'none', overflowX: 'auto', marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>ตารางสิทธิ์ตามตำแหน่ง</h3>
        <p className="sub">ร่างตามที่ตกลง: ส่วนที่ยังรอยืนยันดู docs/spec.md (M14) · แก้ที่ไฟล์ web/lib/permissions.ts</p>
        <table style={{ minWidth: 0 }}>
          <thead><tr><th>สิทธิ์</th>{ROLES.map(r => <th key={r} style={{ textAlign: 'center' }}>{ROLE_LABEL[r]}</th>)}</tr></thead>
          <tbody>{PERMS.map(p => (
            <tr key={p}><td>{PERM_LABEL[p] ?? p}</td>{ROLES.map(r => <td key={r} style={{ textAlign: 'center' }}>{permsOf(r).includes(p) ? '✓' : ''}</td>)}</tr>))}</tbody></table>
      </div>
    </>
  );
}
