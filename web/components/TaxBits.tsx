import Link from 'next/link';
import { STATUS } from '@/lib/status';

/** จุดสีสถานะหน้าเลขที่เอกสาร (แบบ FA) */
export function Dot({ s }: { s: string }) {
  const [label, tone] = STATUS[s] ?? [s, 'grey'];
  return <span className={`dot dot-${tone}`} title={label} />;
}
/** ไอคอน "เอกสารที่เกี่ยวข้อง" ข้างเลขที่เอกสาร — ชี้เมาส์ (หรือแตะ/โฟกัส) แล้วขึ้นป๊อปอัปทันทีแบบ FA · ไม่มีเอกสารเชื่อมโยง = ไม่แสดงไอคอน */
export function RelPop({ rel, extra }: { rel: { no: string; kind: string; href: string }[]; extra?: string }) {
  if (!rel.length && !extra) return null;
  return (
    <span className="relpop noprint" tabIndex={0} aria-label="เอกสารที่เกี่ยวข้อง"><span className="relpop-ico" aria-hidden>🗎</span>
      <span className="relpop-body" role="tooltip"><b>เอกสารที่เกี่ยวข้อง</b>
        {rel.length > 0 && <span className="sub">เอกสารอ้างอิง</span>}
        {rel.map(r => <Link key={r.no} href={r.href} target="_blank" title={r.kind}>↗ {r.no}</Link>)}
        {extra && <><span className="sub">แบบยื่นภาษี</span><span>{extra}</span></>}
      </span></span>
  );
}
/** ปุ่ม "…" ท้ายแถว: พิมพ์เอกสาร / ดาวน์โหลด */
export function Kebab({ print, download }: { print?: string; download?: string }) {
  if (!print && !download) return null;
  return (
    <details className="kebab noprint"><summary aria-label="เมนู">•••</summary>
      <div className="kebab-pop">
        {print && <a href={print} target="_blank" rel="noreferrer">🖨 พิมพ์เอกสาร</a>}
        {download && <a href={download} download>⬇ ดาวน์โหลด</a>}
      </div></details>
  );
}
