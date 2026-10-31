import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite;
const q = async <T = any>(s: string, a: unknown[] = []) => (await db.query<any>(s, a)).rows as T[];

beforeAll(async () => { db = new PGlite(); for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8')); });
beforeEach(async () => {
  await db.exec(`truncate journal_lines, journal_vouchers, period_locks, doc_sequences, petty_funds, credit_cards, cheque_accounts, bank_accounts, accounts cascade`);
  for (const [c, n, t] of [['11112', 'เงินสด', 'asset'], ['53211', 'ค่าธรรมเนียม', 'expense']]) await q('insert into accounts(code,name,type) values ($1,$2,$3)', [c, n, t]);
});
const bal = async (acc: string) => Number((await q(`select coalesce(sum(l.debit-l.credit),0) b from journal_lines l join accounts a on a.id=l.account_id where a.code=$1`, [acc]))[0].b);

describe('M27.9 บัญชีเงินสดย่อย', () => {
  it('เติมเงิน = Dr เงินสดย่อย / Cr ต้นทาง ด้วยคำอธิบายแบบ FA · เติมแล้วลบไม่ได้ · รายการเคลื่อนไหวครบ', async () => {
    const id = (await q(`select create_petty_fund('TEST Petty', 5000, 'วิศร') id`))[0].id;
    const code = (await q(`select a.code from petty_funds f join accounts a on a.id=f.account_id where f.id=$1`, [id]))[0].code;
    await q(`select topup_petty_fund($1,'2026-10-29',1000,'11112')`, [id]);
    expect(await bal(code)).toBe(1000); expect(await bal('11112')).toBe(-1000);
    const acc = (await q(`select account_id a from petty_funds where id=$1`, [id]))[0].a;
    const mv = await q(`select * from account_movements($1,null,null)`, [acc]);
    expect(mv).toHaveLength(1); expect(mv[0].memo).toBe('เติมวงเงินสดย่อย TEST Petty จำนวน 1000 บาท'); expect(Number(mv[0].debit)).toBe(1000);
    await expect(q(`select delete_petty_fund($1)`, [id])).rejects.toThrow(/ลบไม่ได้/);
    await q(`select update_petty_fund($1,'Petty B',8000,'ใหม่')`, [id]);
    expect((await q(`select name from accounts where id=$1`, [acc]))[0].name).toBe('เงินสดย่อย - Petty B');
    await q(`select set_petty_fund_active($1,false)`, [id]);
    await expect(q(`select topup_petty_fund($1,'2026-10-29',10,'11112')`, [id])).rejects.toThrow(/ไม่ใช้งาน/);
  });
  it('บัญชีที่ยังไม่มีรายการลบได้ · จำนวน ≤ 0 ถูกปฏิเสธ', async () => {
    const id = (await q(`select create_petty_fund('ว่าง', 100) id`))[0].id;
    await expect(q(`select topup_petty_fund($1,'2026-10-29',0,'11112')`, [id])).rejects.toThrow(/มากกว่า 0/);
    await q(`select delete_petty_fund($1)`, [id]);
    expect(await q(`select 1 from petty_funds`)).toHaveLength(0);
  });
});

describe('M27.10 เงินสดย่อยห้ามติดลบ', () => {
  it('ตัดเงินสดย่อยเกินยอดคงเหลือถูกปฏิเสธ · ไม่เกินทำได้', async () => {
    const id = (await q(`select create_petty_fund('TEST Petty', 5000) id`))[0].id;
    const code = (await q(`select a.code from petty_funds f join accounts a on a.id=f.account_id where f.id=$1`, [id]))[0].code;
    await q(`select topup_petty_fund($1,'2026-10-29',1000,'11112')`, [id]);
    await expect(q(`select bank_transfer($1,'11112','2026-10-29',1040)`, [code])).rejects.toThrow(/เงินสดย่อย.*ไม่พอ/);
    expect(await bal(code)).toBe(1000);
    await q(`select bank_transfer($1,'11112','2026-10-29',1000)`, [code]);
    expect(await bal(code)).toBe(0);
  });
});

describe('M27.9 บัตรเครดิตและบัญชีเช็คจ่าย', () => {
  it('บัตรเครดิต: แก้ไข/ไม่ใช้งาน/ลบ (ลบได้เมื่อไม่มีรายการ)', async () => {
    const id = (await q(`select create_credit_card('กสิกรไทย','1234','วิศร','TEST Card',20000,0,3) id`))[0].id;
    await q(`select update_credit_card($1,'กสิกรไทย','1234','วิศร','Card B',30000,0,5)`, [id]);
    const c = (await q(`select c.card_name, c.credit_limit, a.name, a.code from credit_cards c join accounts a on a.id=c.account_id where c.id=$1`, [id]))[0];
    expect(c.card_name).toBe('Card B'); expect(Number(c.credit_limit)).toBe(30000); expect(c.name).toBe('บัตรเครดิต - Card B');
    await q(`select bank_transfer('11112',$1,'2026-10-29',500)`, [c.code]);   // จ่ายบิลบัตร = โอนไปบัญชีบัตร
    await expect(q(`select delete_credit_card($1)`, [id])).rejects.toThrow(/ลบไม่ได้/);
    await q(`select set_credit_card_active($1,false)`, [id]);
    expect((await q(`select is_active from credit_cards where id=$1`, [id]))[0].is_active).toBe(false);
  });
  it('บัญชีเช็คจ่าย: เพิ่มผูกกับบัญชีธนาคาร · ไม่ใช้งาน · ลบ', async () => {
    const bank = (await q(`select bank_account_create('กสิกรไทย','748-2-31004-9','วิศร') id`))[0].id;
    const code = (await q(`select add_cheque_account($1) c`, [bank]))[0].c;
    expect(code).toMatch(/^21329\./);
    await q(`select set_cheque_account_active($1,false)`, [bank]);
    await q(`select delete_cheque_account($1)`, [bank]);
    expect(await q(`select 1 from cheque_accounts`)).toHaveLength(0);
  });
});
