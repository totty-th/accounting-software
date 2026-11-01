import { acctDocs } from './fa-xlsx';

type Db = { q: <T = any>(sql: string, a?: unknown[]) => Promise<T[]> };
export const NO_EMP = '__none';
const EMP_LABEL = 'ไม่ระบุพนักงาน';

export type EmpDoc = { no: string; type: string; date: string; party: string; project: string | null; status: string; sub: number; vat: number; total: number; dep_doc: string | null };
export type EmpGroup = { name: string; customers: number; sub: number; vat: number; total: number; docs: EmpDoc[] };
export type AcctGroup = { name: string; sub: number; docs: { no: string; date: string; party: string; account: string; val: number; status: string }[] };

/**
 * รายงานยอดขายตามพนักงาน (REA FA 01-11-2026)
 * - แสดงทุกสถานะรวมใบยกเลิก (จางลง) แต่ "ไม่นับยอดรวม" · ตัวกรองสถานะจำกัดรายการที่แสดง
 * - ลูกค้าที่ขายได้ = ลูกค้าไม่ซ้ำของเอกสารที่แสดงในกลุ่ม · ใบลดหนี้ติดลบ · ไม่รวมใบมัดจำ
 * - แท็บเอกสารบัญชี = ใบสำคัญ JV ที่ลงรายได้ตรง จัดกลุ่มตามผู้ทำรายการ
 */
export async function employeeReport(db: Db, o: { range: [string, string] | null; statuses: string[]; emp: string }) {
  const sg = `case when d.doc_type='CN' then -1 else 1 end`;
  const rows = await db.q<any>(`select coalesce(nullif(btrim(d.salesperson), ''), '${EMP_LABEL}') emp, d.doc_no, d.doc_type, d.doc_date, d.status, d.project, d.contact_id,
      coalesce(c.business_name, c.contact_name, '-') party, d.subtotal*(${sg}) sub, d.vat*(${sg}) vat, d.total*(${sg}) total,
      (select dep.doc_no from sales_docs dep where d.deposit_net > 0 and dep.ref_doc_id = d.ref_doc_id and dep.is_deposit and dep.status <> 'cancelled' limit 1) dep_doc
    from sales_docs d join contacts c on c.id = d.contact_id
    where d.doc_type in ('INV','CA','CN','DN') and not d.is_deposit
      and ($1::date is null or d.doc_date >= $1::date) and ($2::date is null or d.doc_date <= $2::date)
      and (cardinality($3::text[]) = 0 or d.status = any($3::text[]))
    order by d.doc_date desc, d.doc_no desc`, [o.range?.[0] ?? null, o.range?.[1] ?? null, `{${o.statuses.join(',')}}`]);
  const emps = [...new Set(rows.map(r => r.emp as string))].sort((a, b) => a.localeCompare(b, 'th'));
  const pick = rows.filter(r => !o.emp || r.emp === (o.emp === NO_EMP ? EMP_LABEL : o.emp));
  const m = new Map<string, EmpGroup & { cs: Set<string> }>();
  for (const r of pick) {
    const g = m.get(r.emp) ?? { name: r.emp, customers: 0, sub: 0, vat: 0, total: 0, docs: [] as EmpDoc[], cs: new Set<string>() };
    g.cs.add(r.contact_id); g.docs.push({ no: r.doc_no, type: r.doc_type, date: r.doc_date, party: r.party, project: r.project, status: r.status, sub: +r.sub, vat: +r.vat, total: +r.total, dep_doc: r.dep_doc });
    if (r.status !== 'cancelled') { g.sub += +r.sub; g.vat += +r.vat; g.total += +r.total; }
    m.set(r.emp, g);
  }
  const groups: EmpGroup[] = [...m.values()].map(({ cs, ...g }) => ({ ...g, customers: cs.size, sub: round(g.sub), vat: round(g.vat), total: round(g.total) })).sort((a, b) => b.sub - a.sub);
  const sum = (k: 'sub' | 'vat' | 'total') => round(groups.reduce((t, g) => t + g[k], 0));
  // เอกสารบัญชี: ผู้ทำรายการ (ยังไม่ทดสอบ: การกรองพนักงานกับแท็บนี้ — FA ไม่มีรายชื่อให้เลือกในรอบ REA จึงไม่กรอง)
  const am = new Map<string, AcctGroup>();
  for (const v of await acctDocs(db, 'revenue', o.range)) {
    const k = v.by_user ?? '-'; const g: AcctGroup = am.get(k) ?? { name: k, sub: 0, docs: [] };
    g.docs.push({ no: v.no, date: v.dt, party: '', account: `${v.code} / ${v.name}`, val: +v.val, status: v.status });
    if (v.status !== 'cancelled') g.sub += +v.val; am.set(k, g);
  }
  const acct = [...am.values()].map(g => ({ ...g, sub: round(g.sub) }));
  const acctTotal = round(acct.reduce((t, g) => t + g.sub, 0));
  return { groups, emps, totals: { sub: sum('sub'), vat: sum('vat'), total: sum('total'), docs: pick.length }, acct, acctTotal, acctDocs: acct.reduce((t, g) => t + g.docs.length, 0) };
}
const round = (n: number) => Math.round(n * 100) / 100;
