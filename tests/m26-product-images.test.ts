import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite; let pid: string;
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const add = async (name = 'a.jpg', mime = 'image/jpeg', data: Uint8Array = new Uint8Array([1, 2, 3])) =>
  (await one<any>('select add_product_image($1,$2,$3,$4) id', [pid, name, mime, data])).id as string;
const order = async () => (await db.query<any>('select name from product_images where product_id=$1 order by pos', [pid])).rows.map(r => r.name);

beforeAll(async () => { db = new PGlite(); for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8')); });
beforeEach(async () => {
  await db.exec('truncate product_images, products cascade');
  pid = (await one<any>(`insert into products(code,name,kind) values ('P1','สินค้า','service') returning id`)).id;
});

describe('M26.4 รูปสินค้า', () => {
  it('เพิ่มรูปตามลำดับ · อ่านไบต์คืนได้ตรง', async () => {
    await add('a.jpg'); await add('b.png', 'image/png', new Uint8Array([9, 8]));
    expect(await order()).toEqual(['a.jpg', 'b.png']);
    const r = await one<any>(`select data, mime from product_images where name='b.png'`);
    expect([...r.data]).toEqual([9, 8]); expect(r.mime).toBe('image/png');
  });
  it('สูงสุด 10 รูปต่อสินค้า', async () => {
    for (let i = 0; i < 10; i++) await add(`i${i}.jpg`);
    expect(await err(add('x.jpg'))).toContain('สูงสุด 10 รูป');
    const p2 = (await one<any>(`insert into products(code,name,kind) values ('P2','อีกตัว','service') returning id`)).id;
    await db.query('select add_product_image($1,$2,$3,$4)', [p2, 'ok.jpg', 'image/jpeg', new Uint8Array([1])]);
  });
  it('ปฏิเสธชนิดไฟล์ที่ไม่ใช่รูป / ไฟล์ว่าง / ใหญ่เกิน 5 MB', async () => {
    expect(await err(add('a.gif', 'image/gif'))).toContain('JPG, PNG, WEBP');
    expect(await err(add('e.jpg', 'image/jpeg', new Uint8Array()))).toContain('ไม่พบไฟล์รูป');
    expect(await err(add('big.jpg', 'image/jpeg', new Uint8Array(5 * 1024 * 1024 + 1)))).toContain('5 MB');
  });
  it('เรียงลำดับใหม่ · ลบรูป · รูปที่ไม่ได้ระบุคงลำดับเดิมไว้ท้าย', async () => {
    const a = await add('a'), b = await add('b'), c = await add('c');
    await db.query('select set_product_image_order($1,$2::uuid[])', [pid, [c, a]]);
    expect(await order()).toEqual(['c', 'a', 'b']);
    await db.query('select delete_product_image($1)', [a]);
    expect(await order()).toEqual(['c', 'b']);
    expect(await err(db.query('select delete_product_image($1)', [a]))).toContain('ไม่พบรูปสินค้า');
    await db.query('select add_product_image($1,$2,$3,$4)', [pid, 'd', 'image/jpeg', new Uint8Array([1])]);
    expect((await order()).at(-1)).toBe('d'); void b;
  });
  it('ลบสินค้า → รูปถูกลบตาม · ชื่อไฟล์ยาวถูกตัดที่ 50 ตัวอักษร', async () => {
    await add('x'.repeat(80) + '.jpg');
    expect((await one<any>('select length(name) l from product_images')).l).toBe(50);
    await db.query('select delete_product($1)', [pid]);
    expect(+(await one<any>('select count(*) c from product_images')).c).toBe(0);
  });
});
