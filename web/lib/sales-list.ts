import { today } from '@/lib/db';
import { PERIODS, periodRange } from '@/lib/period';
import { DOC_TYPE } from '@/lib/status';

export const PER_PAGE = [10, 20, 50, 100];
export type Sp = { type?: string; q?: string; period?: string; from?: string; to?: string; status?: string; page?: string; pp?: string; ids?: string };

/** เงื่อนไขกรองรายการเอกสารขาย (ใช้ร่วมกันระหว่างหน้ารายการกับไฟล์ Excel) */
export function listFilter(sp: Sp, type: string, own: boolean, userId: string) {
  const q = (sp.q ?? '').trim();
  const period = PERIODS.some(p => p[0] === sp.period) ? sp.period! : 'all';
  const range = periodRange(period, today(), sp.from, sp.to);
  const ids = (sp.ids ?? '').split(',').filter(x => /^[0-9a-f-]{36}$/.test(x));
  const where = `d.doc_type=$1 and (not $2 or d.created_by=$3) and ($4='' or d.status=$4)
    and ($5::date is null or d.doc_date >= $5::date) and ($6::date is null or d.doc_date <= $6::date)
    and ($7='' or d.doc_no ilike '%'||$7||'%' or c.business_name ilike '%'||$7||'%' or c.contact_name ilike '%'||$7||'%'
      or d.project ilike '%'||$7||'%' or d.ref_no ilike '%'||$7||'%' or d.description ilike '%'||$7||'%'
      or exists (select 1 from sales_doc_lines l where l.doc_id=d.id and (l.description ilike '%'||$7||'%' or l.detail ilike '%'||$7||'%')))
    and (cardinality($8::uuid[])=0 or d.id = any($8::uuid[]))`;
  return { q, period, range, where, args: [type, own, userId, sp.status ?? '', range?.[0] ?? null, range?.[1] ?? null, q, ids] as any[] };
}
export const typeOf = (sp: Sp, own: boolean) => (own ? 'QT' : DOC_TYPE[sp.type ?? ''] ? sp.type! : '');
