import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { autoMap, validateContacts } from '../web/lib/contact-import';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite;
beforeAll(async () => { db = new PGlite(); for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8')); });
const H = ['ชื่อธุรกิจ', 'ประเภทผู้ติดต่อ', 'ประเภทกิจการ', 'เลขผู้เสียภาษี', 'สาขา', 'อีเมล', 'เครดิต (วัน)'];
const map = autoMap(H);
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };

describe('M39 นำเข้าผู้ติดต่อ (REA FA 02-11-2026)', () => {
  it('จับคู่หัวคอลัมน์อัตโนมัติ', () => { expect(map.name).toBe(0); expect(map.kind).toBe(1); expect(map.person).toBe(2); expect(map.tax).toBe(3); expect(map.credit).toBe(6); });
  it('ตรวจไฟล์: ช่องจำเป็น เลขภาษี 10/13 หลัก อีเมล สาขา ซ้ำข้าม', () => {
    const ok = ['บริษัท ก จำกัด', 'ลูกค้า', 'นิติบุคคล', '0105500000001', 'สำนักงานใหญ่', 'a@b.co', 30];
    const v = validateContacts([ok, ['', 'x', 'y', '123', 'ab', 'bad', -1]], map, new Set());
    expect(v.items).toHaveLength(1); expect(v.items[0].branch_code).toBe(''); expect(v.items[0].credit_days).toBe(30);
    const msgs = v.issues.map(i => i.message).join('|');
    for (const m of ['ชื่อธุรกิจ', 'ประเภทผู้ติดต่อ', 'ประเภทกิจการ', '10 หรือ 13', 'สาขา', 'อีเมล', 'เครดิต']) expect(msgs).toContain(m);
    // ซ้ำในไฟล์/ในระบบ (ชื่อ+สาขา) = ข้าม ไม่ใช่ข้อผิดพลาด · คนละสาขา = คนละราย
    const d = validateContacts([ok, ok, [...ok.slice(0, 4), '2', ...ok.slice(5)], ['ใหม่', 'ผู้จำหน่าย', 'บุคคลธรรมดา', '', '', '', 0]], map, new Set(['ใหม่|']));
    expect(d.issues).toHaveLength(0); expect(d.items).toHaveLength(2); expect(d.dups).toEqual([2, 4]);
    expect(validateContacts(Array(501).fill(ok), map, new Set()).issues[0].message).toContain('500');
  });
  it('import_contacts: สร้างตามประเภท ข้ามซ้ำ ลบทั้งชุด (คงรายที่มีเอกสารอ้างอิง)', async () => {
    const items = [
      { business_name: 'ลูกค้า A', kinds: 'customer', person_kind: 'juristic', tax_id: '0105500000001', branch_code: '', credit_days: 15 },
      { business_name: 'ผู้ขาย B', kinds: 'both', person_kind: 'individual', branch_code: '00002' },
      { business_name: 'ลูกค้า A', kinds: 'customer', person_kind: 'juristic', branch_code: '' }];
    const b = (await db.query<any>('select import_contacts($1,$2::jsonb) id', ['f.xlsx', JSON.stringify(items)])).rows[0].id;
    const bt = (await db.query<any>('select * from contact_import_batches where id=$1', [b])).rows[0];
    expect([bt.item_count, bt.skipped_count]).toEqual([2, 1]);
    const a = (await db.query<any>(`select * from contacts where business_name='ลูกค้า A'`)).rows[0];
    expect([a.is_customer, a.is_vendor, a.credit_days, a.person_kind]).toEqual([true, false, 15, 'juristic']);
    const c = (await db.query<any>(`select * from contacts where business_name='ผู้ขาย B'`)).rows[0];
    expect([c.is_customer, c.is_vendor, c.branch_code]).toEqual([true, true, '00002']);
    expect(await err(db.query(`select import_contacts('x','[]')`))).toContain('ไม่มีรายชื่อ');
    await db.query(`insert into accounts(code,name,type) values ('11311','ลูกหนี้','asset') on conflict do nothing`);
    await db.query(`insert into sales_docs(doc_type,doc_no,doc_date,contact_id,status) values ('QT','QT-T','2026-10-01',$1,'draft')`, [a.id]);
    const r = (await db.query<any>('select delete_contact_import_batch($1) r', [b])).rows[0].r;
    expect(r).toEqual({ deleted: 1, kept: 1 });
    expect(await err(db.query('select delete_contact_import_batch($1)', [b]))).toContain('ถูกลบไปแล้ว');
  });
});
