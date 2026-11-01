import Link from 'next/link';
import { getDb, today } from '@/lib/db';
import { can } from '@/lib/permissions';
import { money, dateTh } from '@/lib/format';
import { closingRange, CLOSING_MODES, STATUS_TH } from '@/lib/closing';
import { ClosingActions } from '@/components/ClosingForm';

type Q = { mode?: string; month?: string; year?: string; from?: string; to?: string; date?: string; eq?: string };

/** หน้าสร้าง/ดู/แก้เอกสารปิดบัญชีรายได้และค่าใช้จ่าย: วันที่ปิด · รอบปิดบัญชี (เดือน/ช่วงวันที่/ปี) · บัญชีบันทึกผลต่าง · แสดงข้อมูล */
export async function ClosingDoc({ id, q, role }: { id?: string; q: Q; role: string }) {
  const db = await getDb();
  const [doc] = id ? await db.q<any>(`select c.*, c.closing_date::text d, c.period_from::text f, c.period_to::text t, v.voucher_no from period_closings c left join journal_vouchers v on v.id = c.voucher_id where c.id = $1 and c.deleted_at is null`, [id]) : [];
  const approved = doc?.status === 'approved';
  const eqs = await db.q<any>(`select code, name from accounts where type = 'equity' and is_active order by code`);
  const [def] = await db.q<any>(`select closing_default_account() code`);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(q.date ?? '') ? q.date! : doc?.d ?? today();
  const eq = eqs.some(a => a.code === q.eq) ? q.eq! : doc?.equity_account ?? def.code;
  const hasQ = !!(q.mode || q.from || q.month || q.year);
  const base = doc ? { mode: 'range', from: doc.f, to: doc.t } : closingRange({}, today());
  const rg = hasQ ? closingRange(q, today()) : base;
  const shown = !!doc || hasQ;
  let rev: any[] = [], exp: any[] = [], eqLine: any = null;
  if (approved) {
    const ls = await db.q<any>(`select a.code, a.name, a.type, (l.debit - l.credit)::float8 dr from journal_lines l join accounts a on a.id = l.account_id where l.voucher_id = $1 order by l.line_no`, [doc.voucher_id]);
    rev = ls.filter(r => r.type === 'revenue').map(r => ({ code: r.code, name: r.name, amount: r.dr })); exp = ls.filter(r => r.type === 'expense').map(r => ({ code: r.code, name: r.name, amount: -r.dr }));
    eqLine = ls.find(r => r.type === 'equity');
  } else if (shown) {
    const is = await db.q<any>('select section, code, name, amount::float8 amount from income_statement($1::date,$2::date)', [rg.from, rg.to]);
    rev = is.filter(r => r.section === 'revenue'); exp = is.filter(r => r.section !== 'revenue');
  }
  const [co] = await db.q<any>('select name from company_profile');
  const revT = rev.reduce((s, r) => s + r.amount, 0), expT = exp.reduce((s, r) => s + r.amount, 0), net = revT - expT;
  const total = Math.max(expT, 0) + Math.max(-net, 0);
  const eqName = eqs.find(a => a.code === eq)?.name ?? '';
  const canW = can(role as any, 'accounts.write');
  const years = Array.from({ length: 8 }, (_, i) => Number(today().slice(0, 4)) + 1 - i);
  const Group = ({ title, rows, t, side }: { title: string; rows: any[]; t: number; side: 'dr' | 'cr' }) => (
    <>
      <tr style={{ background: 'var(--bg2, #f3f5f8)', fontWeight: 600 }}><td colSpan={2}>{title}</td><td className="num">{side === 'dr' ? money(t) : ''}</td><td className="num">{side === 'cr' ? money(t) : ''}</td></tr>
      {rows.map(r => <tr key={r.code}><td className="no">{r.code}</td><td>{r.name}</td><td className="num">{side === 'dr' ? money(r.amount) : ''}</td><td className="num">{side === 'cr' ? money(r.amount) : ''}</td></tr>)}
    </>
  );
  return (
    <>
      <div className="top"><div><p className="sub"><Link href="/settings/close-year">← ปิดบัญชีรายได้และค่าใช้จ่าย</Link></p>
        <h1>{doc ? doc.doc_no : 'สร้างรายการปิดบัญชีรายได้และค่าใช้จ่าย'} {doc && <small style={{ fontWeight: 400, fontSize: 14 }}>{STATUS_TH[doc.status]}</small>}</h1></div>
        <div className="noprint" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {doc && <a className="btn ghost" href={`/settings/close-year/${doc.id}/xlsx`}>⬇ ดาวน์โหลด Excel</a>}
          {approved && <Link className="btn ghost" href={`/journals/${doc.voucher_id}`}>ดูใบสำคัญ {doc.voucher_no}</Link>}
          {(!doc || !approved) && shown && (rev.length + exp.length > 0) && <ClosingActions id={doc?.id} status={doc?.status} canWrite={canW} vals={{ date, from: rg.from, to: rg.to, equity: eq }} />}
          {approved && <ClosingActions id={doc.id} status="approved" canWrite={canW} vals={{ date, from: doc.f, to: doc.t, equity: eq }} />}</div></div>
      <div className="panel">
        {approved ? (
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <label className="f">วันที่ปิดบัญชี<input readOnly value={dateTh(doc.d)} /></label>
            <label className="f">รอบปิดบัญชี<input readOnly value={`${dateTh(doc.f)} - ${dateTh(doc.t)}`} /></label>
            <label className="f">บัญชีสำหรับบันทึกผลต่าง<input readOnly value={`${doc.equity_account} / ${eqLine?.name ?? eqName}`} /></label></div>
        ) : (
          <form method="get" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="f">วันที่ปิดบัญชี<input type="date" name="date" defaultValue={date} /></label>
            <label className="f">รอบปิดบัญชี<select name="mode" defaultValue={rg.mode}>{CLOSING_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label className="f">เดือน (เมื่อเลือก "เดือน")<input type="month" name="month" defaultValue={rg.from.slice(0, 7)} /></label>
            <label className="f">ปี (เมื่อเลือก "ปี")<select name="year" defaultValue={rg.from.slice(0, 4)}>{years.map(y => <option key={y} value={y}>{y}</option>)}</select></label>
            <label className="f">ตั้งแต่ (เมื่อเลือก "ช่วงวันที่")<input type="date" name="from" defaultValue={rg.from} /></label>
            <label className="f">ถึง<input type="date" name="to" defaultValue={rg.to} /></label>
            <label className="f">บัญชีสำหรับบันทึกผลต่าง<select name="eq" defaultValue={eq}>{eqs.map(a => <option key={a.code} value={a.code}>{a.code} / {a.name}</option>)}</select></label>
            <button className="btn">แสดงข้อมูล</button></form>
        )}
      </div>
      {!shown && <div className="panel empty">เลือก "รอบปิดบัญชี" เพื่อแสดงยอดรายได้และค่าใช้จ่าย แล้วคลิก "แสดงข้อมูล"</div>}
      {shown && rev.length + exp.length === 0 && <div className="panel empty">ไม่พบรายการรายได้/ค่าใช้จ่ายในช่วงที่เลือก</div>}
      {shown && rev.length + exp.length > 0 && (
        <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
          <div style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div><b style={{ fontSize: 18 }}>{co?.name}</b><div className="sub">ช่วงเวลา {dateTh(approved ? doc.f : rg.from)} - {dateTh(approved ? doc.t : rg.to)}</div></div>
            <div style={{ textAlign: 'right' }}><div className="sub">{net >= 0 ? 'กำไร' : 'ขาดทุน'}</div><b style={{ fontSize: 24 }}>{money(net)}</b></div></div>
          <table><thead><tr><th colSpan={2}>บัญชี</th><th className="num">เดบิต</th><th className="num">เครดิต</th></tr></thead>
            <tbody>
              <Group title="รายได้" rows={rev} t={revT} side="dr" />
              <Group title="ค่าใช้จ่าย" rows={exp} t={expT} side="cr" />
              {net !== 0 && <tr><td className="no">{approved ? doc.equity_account : eq}</td><td>{approved ? (eqLine?.name ?? eqName) : eqName}</td><td className="num">{net < 0 ? money(-net) : ''}</td><td className="num">{net > 0 ? money(net) : ''}</td></tr>}
              <tr style={{ fontWeight: 700 }}><td /><td>รวมทั้งสิ้น</td><td className="num">{money(Math.max(revT, 0) + Math.max(-net, 0))}</td><td className="num">{money(Math.max(expT, 0) + Math.max(net, 0))}</td></tr>
            </tbody></table>
        </div>)}
    </>
  );
}
