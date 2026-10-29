'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useRole } from '@/components/Can';
import { can, type Perm } from '@/lib/permissions';

// เมนูจัดกลุ่มแบบ FA (REA 29-10-2026): หมวดหลัก 1 ระดับ → รายการย่อย (บางหมวดมีหัวข้อย่อยคั่น) · เปิดได้ทีละหมวด หมวดที่อยู่ในหน้าปัจจุบันเปิดให้อัตโนมัติ
// ไม่เปลี่ยนที่อยู่หน้าเดิม: เปลี่ยนเฉพาะการจัดเรียง/ชื่อกลุ่มเมนู
type Item = { href: string; label: string; perms: Perm[]; gap?: boolean; head?: string };
type Group = { key: string; label: string; c: string; href?: string; perms?: Perm[]; items?: Item[] };

const R: Perm[] = ['reports.read'];
const GROUPS: Group[] = [
  { key: 'home', label: 'ภาพรวม', c: 'var(--brand)', href: '/', perms: ['dash.view'] },
  { key: 'fin', label: 'การเงิน', c: 'var(--teal)', items: [
    { href: '/bank', label: 'บัญชีธนาคาร/กระทบยอด', perms: ['bank.read'] },
    { href: '/finance/petty-cash', label: 'เงินสดย่อย', perms: ['bank.read'] },
    { href: '/finance/cheque', label: 'เช็คจ่าย', perms: ['bank.read'] },
    { href: '/finance/credit-card', label: 'บัตรเครดิตจ่าย', perms: ['bank.read'] }] },
  { key: 'sales', label: 'เอกสารขาย', c: 'var(--green)', items: [
    { href: '/sales?type=QT', label: 'ใบเสนอราคา', perms: ['sales.read', 'quote.own'] },
    { href: '/sales?type=BL', label: 'ใบวางบิล', perms: ['sales.read'] },
    { href: '/sales?type=INV', label: 'ใบแจ้งหนี้/ใบกำกับภาษี', perms: ['sales.read'] },
    { href: '/receipts', label: 'ใบเสร็จรับเงิน', perms: ['receipts.read'] },
    { href: '/sales?type=CA', label: 'ขายเงินสด', perms: ['sales.read'], gap: true },
    { href: '/sales?type=CN', label: 'ใบลดหนี้', perms: ['sales.read'], gap: true },
    { href: '/sales?type=DN', label: 'ใบเพิ่มหนี้', perms: ['sales.read'] }] },
  { key: 'buy', label: 'เอกสารซื้อ', c: 'var(--purple)', items: [
    { href: '/purchases/orders', label: 'ใบสั่งซื้อ', perms: ['expenses.read'] },
    { href: '/purchases', label: 'ใบรับสินค้า', perms: ['expenses.read'] }] },
  { key: 'exp', label: 'ค่าใช้จ่าย', c: 'var(--purple)', items: [
    { href: '/expenses', label: 'ค่าใช้จ่าย', perms: ['expenses.read'] },
    { href: '/wht', label: 'หัก ณ ที่จ่าย (50 ทวิ)', perms: ['wht.read'] },
    { href: '/payments', label: 'ใบเตรียมจ่าย', perms: ['expenses.read'] }] },
  { key: 'stock', label: 'สินค้า', c: 'var(--blue)', items: [
    { href: '/products', label: 'สินค้า/บริการ', perms: ['master.read'] },
    { href: '/stock', label: 'สต็อก', perms: ['stock.read'] },
    { href: '/stock/transfers', label: 'โอนสินค้า', perms: ['stock.read'] },
    { href: '/stock/warehouses', label: 'คลังสินค้า', perms: ['stock.read'] },
    { href: '/stock/low', label: 'สินค้าใกล้หมด', perms: ['stock.read'] }] },
  { key: 'contacts', label: 'สมุดรายชื่อ', c: 'var(--grey)', href: '/contacts', perms: ['master.read'] },
  { key: 'reports', label: 'รายงาน', c: 'var(--red)', items: [
    { head: 'ขาย', href: '/reports/sales?view=summary', label: 'สรุปยอดขาย', perms: R },
    { href: '/reports/sales?view=product', label: 'ยอดขายตามสินค้า', perms: R },
    { href: '/reports/sales?view=employee', label: 'ยอดขายตามพนักงาน', perms: R },
    { href: '/reports/sales?view=customer', label: 'ยอดขายตามลูกค้า', perms: R },
    { href: '/reports/billing', label: 'ใบวางบิล', perms: R },
    { href: '/reports/collections', label: 'การเก็บเงิน', perms: R },
    { head: 'ซื้อ/ค่าใช้จ่าย', href: '/reports/purchases', label: 'รายงานซื้อ/ค่าใช้จ่าย', perms: R },
    { href: '/reports/payments', label: 'การชำระเงิน', perms: R },
    { head: 'โปรเจ็ค/สินค้าคงเหลือ', href: '/reports/projects', label: 'โปรเจ็ค', perms: R },
    { href: '/reports/inventory', label: 'สรุปสินค้าคงเหลือ', perms: R },
    { head: 'ภาษี', href: '/reports/sales-tax', label: 'ภาษีขายตามเอกสาร', perms: R },
    { href: '/reports/purchase-tax', label: 'ภาษีซื้อตามเอกสาร', perms: R },
    { href: '/reports/wht', label: 'ภาษีหัก ณ ที่จ่าย', perms: R },
    { head: 'บัญชี', href: '/reports/ar', label: 'ลูกหนี้ตามเอกสาร', perms: R },
    { href: '/reports/ap', label: 'เจ้าหนี้ตามเอกสาร', perms: R }] },
  { key: 'acct', label: 'บริหารบัญชี', c: 'var(--teal)', items: [
    { head: 'สมุดบัญชี', href: '/journals', label: 'สมุดรายวัน', perms: R },
    { href: '/accounts', label: 'ผังบัญชี/บัญชีแยกประเภท', perms: R },
    { href: '/settings/close-year', label: 'ปิดงบบัญชี (ปิดบัญชีสิ้นปี)', perms: R },
    { head: 'รายงานด้านบัญชี', href: '/reports/trial-balance', label: 'งบทดลอง', perms: R },
    { href: '/reports/pnl', label: 'งบกำไรขาดทุน', perms: R },
    { href: '/reports/balance-sheet', label: 'งบฐานะการเงิน', perms: R },
    { href: '/ledger/transactions', label: 'รายการเคลื่อนไหว', perms: R },
    { head: 'บริหารภาษีมูลค่าเพิ่ม', href: '/tax/purchase-vat', label: 'จัดการเอกสารภาษีซื้อ', perms: R },
    { href: '/tax/filings', label: 'เตรียมแบบภาษีรายเดือน (ภ.พ.30)', perms: R },
    { href: '/reports/output-tax', label: 'รายงานภาษีขาย ภ.พ.30', perms: R },
    { href: '/reports/input-tax', label: 'รายงานภาษีซื้อ ภ.พ.30', perms: R },
    { href: '/reports/foreign-input-tax', label: 'รายงานภาษีซื้อ ภ.พ.36', perms: R },
    { head: 'หัก ณ ที่จ่าย', href: '/tax/wht-submission', label: 'ยื่นหัก ณ ที่จ่ายออนไลน์', perms: R }] },
  { key: 'set', label: 'ตั้งค่า', c: 'var(--grey)', items: [
    { href: '/settings/company', label: 'ข้อมูลบริษัท', perms: ['settings.company'] },
    { href: '/settings/lock', label: 'ล็อกงวดบัญชี', perms: R },
    { href: '/settings/opening-balance', label: 'ยอดเริ่มต้น', perms: R },
    { href: '/stock/settings', label: 'ตั้งค่าสต็อก', perms: ['stock.read'] },
    { href: '/admin/users', label: 'ผู้ใช้และสิทธิ์', perms: ['users.manage'] }] },
];

const pathOf = (h: string) => h.split('?')[0];
const viewOf = (h: string) => new URLSearchParams(h.split('?')[1] ?? '').get('view');
const typeOf = (h: string) => new URLSearchParams(h.split('?')[1] ?? '').get('type');

/** หา href ของรายการเมนูที่ตรงกับหน้าปัจจุบัน (เลือกอันที่เส้นทางยาวที่สุด) */
function activeHref(path: string, sp: URLSearchParams): string | null {
  const all = GROUPS.flatMap(g => [...(g.href ? [g.href] : []), ...(g.items ?? []).map(i => i.href)]);
  // เอกสารขาย: หน้ารายการใช้ ?type= ส่วนหน้ารายละเอียด /sales/INV2026... ดูจากตัวอักษรนำหน้าเลขที่
  if (path.startsWith('/receipts')) return '/receipts';
  if (path === '/sales' || path.startsWith('/sales/')) {
    const t = path === '/sales' ? sp.get('type') : /^\/sales\/([A-Z]+)\d/.exec(path)?.[1];
    return all.find(h => pathOf(h) === '/sales' && typeOf(h) === t) ?? null;
  }
  if (path === '/reports/sales') return all.find(h => pathOf(h) === path && viewOf(h) === (sp.get('view') ?? 'summary')) ?? null;
  let best: string | null = null;
  for (const h of all) { const p = pathOf(h); if (p !== '/' && (path === p || path.startsWith(p + '/')) && (!best || p.length > pathOf(best).length)) best = h; }
  return path === '/' ? '/' : best;
}

export function Nav() {
  const path = usePathname(), sp = useSearchParams(), role = useRole();
  const act = activeHref(path, sp);
  const home = GROUPS.find(g => g.items?.some(i => i.href === act))?.key ?? null;
  const [pick, setPick] = useState<{ from: string | null; key: string | null } | null>(null);
  // เลือกเปิด/ปิดเองได้ แต่เมื่อย้ายไปหน้าในหมวดอื่น ให้กลับมาเปิดหมวดของหน้านั้น
  const openKey = pick && pick.from === home ? pick.key : home;
  return (
    <nav className="nav">
      {GROUPS.map(g => {
        if (g.href) {
          if (!g.perms!.some(p => can(role, p))) return null;
          return <Link key={g.key} href={g.href} className={`grp ${act === g.href ? 'on' : ''}`} style={{ ['--c' as any]: g.c }}><i className="dot" style={{ ['--c' as any]: g.c }} />{g.label}</Link>;
        }
        const items = g.items!.filter(i => i.perms.some(p => can(role, p)));
        if (!items.length) return null;
        const open = openKey === g.key;
        return (
          <div key={g.key} className="navgrp">
            <button type="button" className={`grp ${open ? 'open' : ''} ${home === g.key ? 'cur' : ''}`} style={{ ['--c' as any]: g.c }} aria-expanded={open}
              onClick={() => setPick({ from: home, key: open ? null : g.key })}>
              <i className="dot" style={{ ['--c' as any]: g.c }} />{g.label}<span className="chev">{open ? '▾' : '▸'}</span></button>
            {open && items.map(i => (
              <span key={i.href} style={{ display: 'contents' }}>
                {i.head && <h6>{i.head}</h6>}
                {i.gap && <hr className="navsep" />}
                <Link href={i.href} className={`sub ${act === i.href ? 'on' : ''}`} style={{ ['--c' as any]: g.c }}>{i.label}</Link>
              </span>))}
          </div>);
      })}
    </nav>
  );
}
