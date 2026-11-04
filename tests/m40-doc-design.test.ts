import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolveDesign, DEFAULT_DESIGN } from '../web/lib/doc-design';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite;
beforeAll(async () => { db = new PGlite(); for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8')); });
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };

describe('M40 รูปแบบดีไซน์เอกสาร (REA FA 02-11-2026)', () => {
  it('บันทึก/ทับ/รีเซ็ต และตรวจค่า', async () => {
    expect(await err(db.query(`select save_doc_design('all','{"paper":"b5"}')`))).toContain('ขนาดกระดาษ');
    expect(await err(db.query(`select save_doc_design('all','{"paper":"continuous","paper_format":"x"}')`))).toContain('รูปแบบกระดาษต่อเนื่อง');
    expect(await err(db.query(`select save_doc_design('all','{"font":"comic"}')`))).toContain('ฟอนต์');
    expect(await err(db.query(`select save_doc_design('ZZ','{}')`))).toBeTruthy();
    await db.query(`select save_doc_design('all','{"bw":true,"size":"l","show_credit":false}')`);
    await db.query(`select save_doc_design('QT','{"title":"ใบประเมินราคา"}')`);
    const rows = (await db.query<any>('select scope, settings from doc_design')).rows;
    const qt = resolveDesign(rows, 'QT'), inv = resolveDesign(rows, 'INV');
    expect([qt.title, qt.bw, qt.size, qt.show_credit]).toEqual(['ใบประเมินราคา', true, 'l', false]);
    expect([inv.title, inv.bw]).toEqual(['', true]);           // ชนิดอื่นใช้ค่า 'all'
    expect(inv.copy_mark).toBe(DEFAULT_DESIGN.copy_mark);
    await db.query('select reset_doc_design()');
    expect((await db.query<any>('select count(*)::int n from doc_design')).rows[0].n).toBe(0);
  });
});
