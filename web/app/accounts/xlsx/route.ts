import { apiUser } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { companyOf, send } from '@/lib/fa-xlsx';
import { glList, glRange, glWorkbook, chartWorkbook, parseTypes } from '@/lib/gl';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /accounts/xlsx?mode=ledger|chart&codes=…&q=&type=&m=…&cancelled=1 — ดาวน์โหลดบัญชีแยกประเภท / โครงสร้างผังบัญชี (Excel)
export async function GET(req: Request) {
  const au = await apiUser(['reports.read']); if (au instanceof Response) return au;
  const u = new URL(req.url), p = u.searchParams, db = await getDb();
  const co = (await companyOf(db)).name?.trim() ?? '';
  const r = glRange({ m: p.get('m') ?? undefined, month: p.get('month') ?? undefined, year: p.get('year') ?? undefined, from: p.get('from') ?? undefined, to: p.get('to') ?? undefined }, today());
  const explicit = (p.get('codes') ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const list = await glList(db, { q: (p.get('q') ?? '').trim(), types: parseTypes(p.get('type') ?? ''), from: r.from, to: r.to, all: p.get('all') === '1', desc: false });
  const chosen = explicit.length ? list.filter(a => explicit.includes(a.code)) : list;
  if (p.get('mode') === 'chart') {
    const wb = await chartWorkbook(db, { company: co, user: au.displayName, today: today(), rows: chosen });
    return send(wb, `${co}_ChartOfAccount`);
  }
  if (!chosen.length) return Response.json({ error: 'ไม่พบบัญชีที่ตรงกับเงื่อนไข' }, { status: 404 });
  const g = await glWorkbook(db, { company: co, user: au.displayName, today: today(), codes: chosen.map(a => a.code), from: r.from, to: r.to, explicit: explicit.length > 0, withCancelled: p.get('cancelled') === '1' });
  const code = !g.first ? 'none' : g.first === g.last ? g.first : `${g.first}_${g.last}`;
  return send(g.wb, `${co}_GL_${code}_${r.from.replace(/-/g, '')}_ถึง_${r.to.replace(/-/g, '')}`);
}
