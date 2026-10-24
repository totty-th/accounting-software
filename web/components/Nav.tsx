'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRole } from '@/components/Can';
import { can, type Perm } from '@/lib/permissions';

// [path, ป้าย, สี, หัวข้อกลุ่ม, สิทธิ์ที่ต้องมี (อย่างน้อยหนึ่งอย่าง)]
const ITEMS: [string, string, string, string, Perm[]][] = [
  ['/', 'ภาพรวม', 'var(--brand)', '', ['dash.view']],
  ['/sales', 'ขาย', 'var(--green)', 'เอกสาร', ['sales.read', 'quote.own']],
  ['/receipts', 'รับเงิน', 'var(--orange)', '', ['receipts.read']],
  ['/expenses', 'ซื้อ/ค่าใช้จ่าย', 'var(--purple)', '', ['expenses.read']],
  ['/wht', 'หัก ณ ที่จ่าย (50 ทวิ)', 'var(--purple)', '', ['wht.read']],
  ['/stock', 'สต็อก', 'var(--blue)', '', ['stock.read']],
  ['/bank', 'ธนาคาร/กระทบยอด', 'var(--teal)', '', ['bank.read']],
  ['/reports/trial-balance', 'งบทดลอง', 'var(--red)', 'รายงาน', ['reports.read']],
  ['/reports/pnl', 'กำไรขาดทุน', 'var(--red)', '', ['reports.read']],
  ['/reports/ar', 'ลูกหนี้ตามเอกสาร', 'var(--red)', '', ['reports.read']],
  ['/reports/ap', 'เจ้าหนี้ตามเอกสาร', 'var(--red)', '', ['reports.read']],
  ['/contacts', 'ลูกค้า/ผู้ขาย', 'var(--grey)', 'ข้อมูลหลัก', ['master.read']],
  ['/products', 'สินค้า', 'var(--grey)', '', ['master.read']],
  ['/admin/users', 'ผู้ใช้และสิทธิ์', 'var(--grey)', 'ผู้ดูแลระบบ', ['users.manage']],
  ['/settings/company', 'ข้อมูลบริษัท', 'var(--grey)', '', ['settings.company']],
];
function Item({ href, label, c, head, perms }: { href: string; label: string; c: string; head: string; perms: Perm[] }) {
  const path = usePathname();
  const role = useRole();
  if (!perms.some(p => can(role, p))) return null;
  return (
    <span style={{ display: 'contents' }}>
      {head && <h6>{head}</h6>}
      <Link href={href} className={(href === '/' ? path === '/' : path.startsWith(href)) ? 'on' : ''} style={{ ['--c' as any]: c }}>
        <i className="dot" style={{ ['--c' as any]: c }} />{label}
      </Link>
    </span>
  );
}
export function Nav() {
  return (
    <nav className="nav">
      {ITEMS.map(([href, label, c, head, perms]) => <Item key={href} href={href} label={label} c={c} head={head} perms={perms} />)}
    </nav>
  );
}
