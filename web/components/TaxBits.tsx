import Link from 'next/link';
import { STATUS } from '@/lib/status';

/** จุดสีสถานะหน้าเลขที่เอกสาร (แบบ FA) */
export function Dot({ s }: { s: string }) {
  const [label, tone] = STATUS[s] ?? [s, 'grey'];
  return <span className={`dot dot-${tone}`} title={label} />;
}
/** ไอคอน "เอกสารที่เกี่ยวข้อง" — กดแล้วขึ้นรายการลิงก์ (FA ขึ้นเมื่อชี้เมาส์) */
export function RelPop({ rel, extra }: { rel: { no: string; kind: string; href: string }[]; extra?: string }) {
  if (!rel.length && !extra) return null;
  return (
    <details className="relpop noprint"><summary title="เอกสารที่เกี่ยวข้อง">📄</summary>
      <div className="relpop-body"><b>เอกสารที่เกี่ยวข้อง</b>
        {rel.length > 0 && <div className="sub">เอกสารอ้างอิง</div>}
        {rel.map(r => <div key={r.no}><Link href={r.href}>↗ {r.no}</Link></div>)}
        {extra && <><div className="sub" style={{ marginTop: 6 }}>แบบยื่นภาษี</div><div>{extra}</div></>}
      </div></details>
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
