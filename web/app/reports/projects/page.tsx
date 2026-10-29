import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getDb } from '@/lib/db';
import { money } from '@/lib/format';
import { Group } from '@/components/Board';
import { ReportTools } from '@/components/ReportTools';
import { ProjectManager } from '@/components/ProjectManager';

export const dynamic = 'force-dynamic';
export default async function Projects() {
  const user = await requirePage('reports.read');
  const db = await getDb();
  const rows = await db.q<any>(`select s.id, s.name, s.contact_name, s.revenue::float8 rev, s.expense::float8 exp, p.contact_id from project_summary() s join projects p on p.id = s.id`);
  const contacts = (await db.q<any>(`select id, coalesce(business_name, contact_name) name from contacts order by 2`)) as { id: string; name: string }[];
  const canW = can(user.role, 'accounts.write');
  return (
    <>
      <div className="top"><div><h1>โปรเจ็คทั้งหมด</h1><p className="sub">รายได้ = ใบแจ้งหนี้ + ขายสด − ใบลดหนี้ · ค่าใช้จ่าย = ค่าใช้จ่าย + ใบรับสินค้า (ยอดก่อน VAT) ที่ระบุชื่อโปรเจ็คในเอกสาร</p></div>
        {canW && <ProjectManager contacts={contacts} />}</div>
      <ReportTools title="โปรเจ็คทั้งหมด" />
      <div data-report><Group title="โปรเจ็ค" color="var(--red)" count={rows.length}>
        <table><thead><tr><th>ชื่อโปรเจ็ค</th><th>ชื่อลูกค้า/ผู้จำหน่าย</th><th className="num">รายได้รวม</th><th className="num">ค่าใช้จ่ายรวม</th><th className="num">กำไร/ขาดทุน</th><th /></tr></thead>
          <tbody>{rows.map(r => <tr key={r.id}><td>{r.name}</td><td>{r.contact_name ?? ''}</td><td className="num">{money(r.rev)}</td><td className="num">{money(r.exp)}</td><td className="num">{money(r.rev - r.exp)}</td>
            <td>{canW && <ProjectManager edit={{ id: r.id, name: r.name, contact_id: r.contact_id }} contacts={contacts} />}</td></tr>)}
            {rows.length === 0 && <tr><td colSpan={6} className="empty">ยังไม่มีโปรเจ็ค</td></tr>}</tbody></table>
      </Group></div>
    </>
  );
}
