import Link from 'next/link';
import { money } from '@/lib/format';

type Doc = { no: string; href: string; a: string; b: string; qty: number | null; unit: number | null; net: number };
type Grp = { name: string; qty: number | null; unit: number | null; sub: number; docs: Doc[] };
const n4 = (v: number) => v.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

// ตารางกลุ่มสินค้า/บัญชี กางดูเอกสารได้ (แบบ FA ยอดขายแยกตามสินค้า) · แถวสรุปด้านล่าง = ยอดรวมของแท็บ
export function ProductGroups({ cols, groups, total }: { cols: string[]; groups: Grp[]; total: number }) {
  return (
    <table className="pg-tbl">
      <thead><tr><th>{cols[0]}</th><th>{cols[1]}</th><th className="num">{cols[2] && cols[2] !== 'คำอธิบาย' ? cols[2] : ''}</th><th className="num">{cols[3]}</th><th className="num">{cols[4]}</th></tr></thead>
      {groups.map(g => (
        <tbody key={g.name}><tr><td colSpan={5} style={{ padding: 0 }}>
          <details>
            <summary style={{ cursor: 'pointer', display: 'grid', gridTemplateColumns: '1fr 110px 130px 140px', padding: '8px 12px', color: 'var(--accent, #1a8fc9)' }}>
              <span>{g.name} <span className="sub">({g.docs.length})</span></span>
              <span className="num">{g.qty == null ? '' : n4(g.qty)}</span><span className="num">{g.unit == null ? '' : money(g.unit)}</span><b className="num">{money(g.sub)}</b>
            </summary>
            <table style={{ width: '100%' }}><tbody>{g.docs.map((d, i) => (
              <tr key={d.no + i}>
                <td style={{ width: 190, paddingLeft: 28 }}>{d.href ? <Link href={d.href}>{d.no}</Link> : d.no}</td>
                <td>{d.a}{d.b ? ` · ${d.b}` : ''}</td>
                <td className="num" style={{ width: 110 }}>{d.qty == null ? '' : n4(d.qty)}</td>
                <td className="num" style={{ width: 130 }}>{d.unit == null ? '' : money(d.unit)}</td>
                <td className="num" style={{ width: 140 }}>{money(d.net)}</td>
              </tr>))}</tbody></table>
          </details>
        </td></tr></tbody>
      ))}
      <tfoot><tr><td colSpan={4} className="num"><b>ยอดรวมก่อนภาษี</b></td><td className="num"><b>{money(total)}</b></td></tr></tfoot>
    </table>
  );
}
