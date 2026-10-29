import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getDb } from '@/lib/db';
import { money, dateTh } from '@/lib/format';
import { ActionButton } from '@/components/ActionButton';
import { closeYear, resetYearClose } from '@/lib/actions';

export const dynamic = 'force-dynamic';
/** รายละเอียดการปิดบัญชีรายได้/ค่าใช้จ่ายของปี (แบบ FA): วันที่ปิด · รอบ · บัญชีบันทึกผลต่าง · กำไร(ขาดทุน) · รายได้/ค่าใช้จ่ายรายบัญชี + บรรทัดบัญชีกำไรสะสม · ยอดรวมสุทธิ */
export default async function CloseYearDetail({ params }: { params: { year: string } }) {
  const user = await requirePage('reports.read');
  if (!/^\d{4}$/.test(params.year)) notFound();
  const y = Number(params.year);
  const db = await getDb();
  const is = await db.q<any>('select section, code, name, amount::float8 amount from income_statement($1::date,$2::date)', [`${y}-01-01`, `${y}-12-31`]);
  const [c] = await db.q<any>(`select y.voucher_id, v.voucher_no, v.voucher_date::text d from year_closes y join journal_vouchers v on v.id = y.voucher_id where y.year = $1 and y.status = 'closed'`, [y]);
  const [re] = await db.q<any>(`select a.code, a.name from system_accounts s join accounts a on a.code = s.account_code where s.key = 'retained_earnings'`);
  const [co] = await db.q<any>('select name from company_profile');
  if (!is.length && !c) notFound();
  const rev = is.filter(r => r.section === 'revenue'), exp = is.filter(r => r.section !== 'revenue');
  const revT = rev.reduce((s, r) => s + r.amount, 0), expT = exp.reduce((s, r) => s + r.amount, 0), net = revT - expT;
  const total = Math.max(expT, 0) + Math.max(-net, 0);
  const canW = can(user.role, 'accounts.write');
  const cell = { padding: '6px 10px' } as const;
  const Group = ({ title, rows, total: t, side }: { title: string; rows: any[]; total: number; side: 'dr' | 'cr' }) => (
    <>
      <tr style={{ background: 'var(--bg2, #f3f5f8)', fontWeight: 600 }}><td colSpan={2}>{title}</td><td className="num">{side === 'dr' ? money(t) : ''}</td><td className="num">{side === 'cr' ? money(t) : ''}</td></tr>
      {rows.map(r => <tr key={r.code}><td className="no" style={cell}>{r.code}</td><td>{r.name}</td><td className="num">{side === 'dr' ? money(r.amount) : ''}</td><td className="num">{side === 'cr' ? money(r.amount) : ''}</td></tr>)}
    </>
  );
  return (
    <>
      <div className="top"><div><p className="sub"><Link href="/settings/close-year">← ปิดบัญชีรายได้และค่าใช้จ่าย</Link></p>
        <h1>{c ? c.voucher_no : `ปิดบัญชีปี ${y}`} <small style={{ fontWeight: 400, fontSize: 14 }}>{c ? 'ปิดบัญชีแล้ว' : 'ยังไม่ปิด'}</small></h1></div>
        <div className="noprint" style={{ display: 'flex', gap: 8 }}>
          {c && <Link className="btn ghost" href={`/journals/${c.voucher_id}`}>ดูใบสำคัญ</Link>}
          {canW && (c
            ? <ActionButton action={resetYearClose.bind(null, y)} label="รีเซ็ต" variant="ghost" confirmText={`รีเซ็ตการปิดบัญชีปี ${y}?`} />
            : <ActionButton action={closeYear.bind(null, y)} label="อนุมัติปิดบัญชี" confirmText={`ปิดบัญชีปี ${y}? กำไรสุทธิ ${money(net)} จะโอนเข้า ${re?.name ?? 'กำไรสะสม'}`} />)}</div></div>
      <div className="panel">
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <label className="f">วันที่ปิดบัญชี<input readOnly value={dateTh(c ? c.d : `${y}-12-31`)} /></label>
          <label className="f">รอบปิดบัญชี<input readOnly value={`${dateTh(`${y}-01-01`)} - ${dateTh(`${y}-12-31`)}`} /></label>
          <label className="f">บัญชีสำหรับบันทึกผลต่าง<input readOnly value={re ? `${re.code} / ${re.name}` : ''} /></label></div>
      </div>
      <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
        <div style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div><b style={{ fontSize: 18 }}>{co?.name}</b><div className="sub">ช่วงเวลา {dateTh(`${y}-01-01`)} - {dateTh(`${y}-12-31`)}</div></div>
          <div style={{ textAlign: 'right' }}><div className="sub">{net >= 0 ? 'กำไร (ขาดทุน)' : 'ขาดทุน'}</div><b style={{ fontSize: 24 }}>{money(net)}</b></div></div>
        <table><thead><tr><th colSpan={2}>บัญชี</th><th className="num">เดบิต</th><th className="num">เครดิต</th></tr></thead>
          <tbody>
            <Group title="รายได้" rows={rev} total={revT} side="cr" />
            <Group title="ค่าใช้จ่าย" rows={exp} total={expT} side="dr" />
            {net !== 0 && <tr><td className="no">{re?.code}</td><td>{re?.name}</td><td className="num">{net < 0 ? money(-net) : ''}</td><td className="num">{net > 0 ? money(net) : ''}</td></tr>}
            <tr style={{ fontWeight: 700 }}><td /><td>ยอดรวมสุทธิ</td><td className="num">{money(total)}</td><td className="num">{money(total)}</td></tr>
          </tbody></table>
      </div>
    </>
  );
}
