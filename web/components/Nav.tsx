'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS: [string, string, string, string][] = [
  ['/', 'ภาพรวม', 'var(--brand)', ''],
  ['/sales', 'ขาย', 'var(--green)', 'เอกสาร'],
  ['/receipts', 'รับเงิน', 'var(--orange)', ''],
  ['/expenses', 'ซื้อ/ค่าใช้จ่าย', 'var(--purple)', ''],
  ['/stock', 'สต็อก', 'var(--blue)', ''],
  ['/reports/trial-balance', 'งบทดลอง', 'var(--red)', 'รายงาน'],
  ['/reports/pnl', 'กำไรขาดทุน', 'var(--red)', ''],
  ['/contacts', 'ลูกค้า/ผู้ขาย', 'var(--grey)', 'ข้อมูลหลัก'],
  ['/products', 'สินค้า', 'var(--grey)', ''],
];
export function Nav() {
  const path = usePathname();
  return (
    <nav className="nav">
      {ITEMS.map(([href, label, c, head]) => (
        <span key={href} style={{ display: 'contents' }}>
          {head && <h6>{head}</h6>}
          <Link href={href} className={(href === '/' ? path === '/' : path.startsWith(href)) ? 'on' : ''} style={{ ['--c' as any]: c }}>
            <i className="dot" style={{ ['--c' as any]: c }} />{label}
          </Link>
        </span>
      ))}
    </nav>
  );
}
