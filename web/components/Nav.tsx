'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useRole } from '@/components/Can';
import { can, type Perm } from '@/lib/permissions';

// [path, ป้าย, สี, หัวข้อกลุ่ม, สิทธิ์ที่ต้องมี (อย่างน้อยหนึ่งอย่าง)]
const ITEMS: [string, string, string, string, Perm[]][] = [
  ['/', 'ภาพรวม', 'var(--brand)', '', ['dash.view']],
  ['/expenses', 'ซื้อ/ค่าใช้จ่าย', 'var(--purple)', 'ซื้อ', ['expenses.read']],
  ['/wht', 'หัก ณ ที่จ่าย (50 ทวิ)', 'var(--purple)', '', ['wht.read']],
  ['/stock', 'สต็อก', 'var(--blue)', '', ['stock.read']],
  ['/bank', 'ธนาคาร/กระทบยอด', 'var(--teal)', '', ['bank.read']],
  ['/reports/sales', 'รายงานขาย', 'var(--red)', 'รายงาน', ['reports.read']],
  ['/reports/trial-balance', 'งบทดลอง', 'var(--red)', '', ['reports.read']],
  ['/reports/pnl', 'กำไรขาดทุน', 'var(--red)', '', ['reports.read']],
  ['/reports/ar', 'ลูกหนี้ตามเอกสาร', 'var(--red)', '', ['reports.read']],
  ['/reports/ap', 'เจ้าหนี้ตามเอกสาร', 'var(--red)', '', ['reports.read']],
  ['/contacts', 'ลูกค้า/ผู้ขาย', 'var(--grey)', 'ข้อมูลหลัก', ['master.read']],
  ['/products', 'สินค้า', 'var(--grey)', '', ['master.read']],
  ['/admin/users', 'ผู้ใช้และสิทธิ์', 'var(--grey)', 'ผู้ดูแลระบบ', ['users.manage']],
  ['/settings/company', 'ข้อมูลบริษัท', 'var(--grey)', '', ['settings.company']],
];
// เมนูย่อยของ "เอกสารขาย" (เรียงและแบ่งกลุ่มเหมือนต้นแบบ: เสนอราคา→วางบิล→แจ้งหนี้→ใบเสร็จ | ขายสด | ลด/เพิ่มหนี้)
const SALES_SUB: { href: string; label: string; key: string; perms: Perm[]; gap?: boolean }[] = [
  { href: '/sales?type=QT', label: 'ใบเสนอราคา', key: 'QT', perms: ['sales.read', 'quote.own'] },
  { href: '/sales?type=BL', label: 'ใบวางบิล', key: 'BL', perms: ['sales.read'] },
  { href: '/sales?type=INV', label: 'ใบแจ้งหนี้/ใบกำกับภาษี', key: 'INV', perms: ['sales.read'] },
  { href: '/receipts', label: 'ใบเสร็จรับเงิน', key: 'RE', perms: ['receipts.read'] },
  { href: '/sales?type=CA', label: 'ขายเงินสด', key: 'CA', perms: ['sales.read'], gap: true },
  { href: '/sales?type=CN', label: 'ใบลดหนี้', key: 'CN', perms: ['sales.read'], gap: true },
  { href: '/sales?type=DN', label: 'ใบเพิ่มหนี้', key: 'DN', perms: ['sales.read'] },
];
function SalesMenu() {
  const path = usePathname();
  const sp = useSearchParams();
  const role = useRole();
  const items = SALES_SUB.filter(i => i.perms.some(p => can(role, p)));
  if (!items.length) return null;
  // หน้ารายการใช้ ?type= ส่วนหน้ารายละเอียด /sales/INV2026... ดูจากตัวอักษรนำหน้าเลขที่
  const cur = path.startsWith('/receipts') ? 'RE'
    : path.startsWith('/sales/') ? (/^\/sales\/([A-Z]+)\d/.exec(path)?.[1] ?? '')
    : path === '/sales' ? (sp.get('type') ?? '') : '';
  return (
    <span style={{ display: 'contents' }}>
      <h6>เอกสารขาย</h6>
      {items.map(i => (
        <span key={i.key} style={{ display: 'contents' }}>
          {i.gap && <hr className="navsep" />}
          <Link href={i.href} className={`sub ${cur === i.key ? 'on' : ''}`} style={{ ['--c' as any]: 'var(--green)' }}>{i.label}</Link>
        </span>))}
    </span>
  );
}
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
      {ITEMS.slice(0, 1).map(([href, label, c, head, perms]) => <Item key={href} href={href} label={label} c={c} head={head} perms={perms} />)}
      <SalesMenu />
      {ITEMS.slice(1).map(([href, label, c, head, perms]) => <Item key={href} href={href} label={label} c={c} head={head} perms={perms} />)}
    </nav>
  );
}
