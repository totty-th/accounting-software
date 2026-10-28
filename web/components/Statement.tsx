import { Fragment } from 'react';
import { money } from '@/lib/format';
import type { Sec } from '@/lib/statements';

export const stmtFmt = (n: number) => (n < 0 ? `(${money(-n)})` : money(n));
/**
 * แถวของงบการเงินแบบ FA: หัวข้อใหญ่ → หัวข้อ → กลุ่ม/บัญชี → รวม · cmp = แสดงคอลัมน์ปีก่อน
 * expand = แสดงทุกบัญชีเป็นบรรทัด (งบกำไรขาดทุน/ส่วนของผู้ถือหุ้น) · ไม่ expand = แสดงยอดรายกลุ่ม คลิกดูบัญชีได้ (สินทรัพย์/หนี้สิน)
 */
export function StatementRows({ title, sections, total, totalLabel, cmp, expand }: {
  title: string; sections: Sec[]; total: { amount: number; prev: number }; totalLabel: string; cmp: boolean; expand: boolean;
}) {
  const cols = cmp ? 3 : 2;
  const num = (a: number, p: number, bold = false) => <><td className="num" style={bold ? { fontWeight: 700 } : undefined}>{stmtFmt(a)}</td>{cmp && <td className="num" style={bold ? { fontWeight: 700 } : undefined}>{stmtFmt(p)}</td>}</>;
  return (
    <>
      <tr data-group style={{ background: 'var(--bg2, #f4f6f8)' }}><td colSpan={cols} style={{ fontWeight: 700 }}>{title}</td></tr>
      {sections.map(s => (
        <Fragment key={s.name}>
          <tr data-group><td colSpan={cols} style={{ fontWeight: 600, paddingLeft: 14 }}>{s.name}</td></tr>
          {s.groups.map(g => {
            const sameAsSection = g.name === s.name;
            return expand ? (
              <Fragment key={g.name}>
                {!sameAsSection && <tr><td colSpan={cols} style={{ paddingLeft: 28 }}>{g.name}</td></tr>}
                {g.lines.map(l => <tr key={l.code + l.name}><td style={{ paddingLeft: sameAsSection ? 30 : 44 }}>{l.name}</td>{num(l.amount, l.prev ?? 0)}</tr>)}
                {!sameAsSection && <tr><td style={{ paddingLeft: 28 }}>รวม{g.name}</td>{num(g.amount, g.prev)}</tr>}
              </Fragment>
            ) : (
              <tr key={g.name}><td style={{ paddingLeft: 30 }}>
                <details style={{ display: 'inline' }}><summary style={{ cursor: 'pointer' }}>{g.name}</summary>
                  {g.lines.map(l => <div key={l.code + l.name} className="sub" style={{ paddingLeft: 16 }}>{l.code} {l.name}: {stmtFmt(l.amount)}</div>)}</details></td>{num(g.amount, g.prev)}</tr>
            );
          })}
          <tr><td style={{ paddingLeft: 14, fontWeight: 600 }}>รวม{s.name}</td>{num(s.amount, s.prev, true)}</tr>
        </Fragment>
      ))}
      <tr data-group><td style={{ fontWeight: 700 }}>{totalLabel}</td>{num(total.amount, total.prev, true)}</tr>
    </>
  );
}
export const StatementHead = ({ cmp, cur, prev }: { cmp: boolean; cur: string; prev: string }) =>
  <thead><tr><th>รายการ</th><th className="num">{cur}</th>{cmp && <th className="num">{prev}</th>}</tr></thead>;
