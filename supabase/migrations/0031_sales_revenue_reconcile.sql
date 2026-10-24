-- M19 รายงานขายต้องตรงกับบัญชีรายได้ · REA FlowAccount รายงานขาย 25-10-2026
-- ข้อค้นพบจาก FA (ทดสอบแล้ว): สรุปยอดขาย = INV+CA+DN เป็นบวก, CN เป็นลบ, ไม่รวมที่ยกเลิก, นับเอกสารที่ยัง "รอดำเนินการ" ด้วย
--   และแท็บ "เอกสารบัญชี" ดึงใบสำคัญทั่วไป (JV) ที่เครดิตบัญชีรายได้ (เช่น 49010 ดอกเบี้ยรับ) เข้ายอดรวมด้วย · รายงานตามลูกค้าไม่รวม JV
--   ยอดตามสินค้าต่างจากตามลูกค้า 500 บาท (สาเหตุยังไม่ทราบ — ยังไม่ทดสอบ)
-- ของเรา: รายงานขายไม่นับใบมัดจำ (ลง 21921 ไม่ใช่รายได้ รายได้เกิดที่ใบแจ้งหนี้ฉบับสุดท้าย) และมีฟังก์ชันกระทบยอดกับบัญชี 41xxx
-- sales_revenue_reconcile: ยอดตามเอกสาร (ก่อน VAT) เทียบยอดตามบัญชีหมวด 41 (เครดิต-เดบิต) ของใบสำคัญที่มาจากเอกสารขาย
--   ผลต่างต้องเป็น 0 · รายการบัญชีรายได้ที่ลงตรง (ไม่ผ่านเอกสารขาย เช่น JV) แสดงแยกและไม่ปนในยอดขาย
create or replace function sales_revenue_reconcile(p_from date, p_to date) returns jsonb language sql stable as $$
  with d as (
    select doc_type, sum(subtotal) s, count(*) n from sales_docs
     where doc_type in ('INV','CA','DN','CN') and status <> 'cancelled' and not is_deposit
       and (p_from is null or doc_date >= p_from) and (p_to is null or doc_date <= p_to)
     group by doc_type
  ), dep as (
    select coalesce(sum(subtotal),0) s, count(*) n from sales_docs
     where is_deposit and status <> 'cancelled' and (p_from is null or doc_date >= p_from) and (p_to is null or doc_date <= p_to)
  ), g as (
    select v.source_type, a.code, a.name, v.voucher_no, v.voucher_date, l.credit - l.debit amt
      from journal_lines l join journal_vouchers v on v.id = l.voucher_id join accounts a on a.id = l.account_id
     where a.code like '41%' and (p_from is null or v.voucher_date >= p_from) and (p_to is null or v.voucher_date <= p_to)
  )
  select jsonb_build_object(
    'doc', jsonb_build_object(
       'inv', coalesce((select s from d where doc_type='INV'),0), 'ca', coalesce((select s from d where doc_type='CA'),0),
       'dn', coalesce((select s from d where doc_type='DN'),0), 'cn', -coalesce((select s from d where doc_type='CN'),0),
       'total', coalesce((select sum(case when doc_type='CN' then -s else s end) from d),0),
       'count', coalesce((select sum(n) from d),0),
       'deposit_excluded', (select s from dep), 'deposit_count', (select n from dep)),
    'gl', jsonb_build_object(
       'from_docs', coalesce((select sum(amt) from g where source_type in ('INV','CA','DN','CN')),0),
       'manual', coalesce((select sum(amt) from g where source_type is null or source_type not in ('INV','CA','DN','CN')),0),
       'by_account', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'amount', amt) order by code)
          from (select code, name, sum(amt) amt from g where source_type in ('INV','CA','DN','CN') group by code, name) x),'[]'::jsonb),
       'manual_items', coalesce((select jsonb_agg(jsonb_build_object('voucher_no', voucher_no, 'date', voucher_date, 'code', code, 'name', name, 'amount', amt)
          order by voucher_date, voucher_no) from g where source_type is null or source_type not in ('INV','CA','DN','CN')),'[]'::jsonb)),
    'diff', coalesce((select sum(amt) from g where source_type in ('INV','CA','DN','CN')),0)
          - coalesce((select sum(case when doc_type='CN' then -s else s end) from d),0))
$$;

-- รายการสินค้า/บริการที่ขาย (มูลค่าก่อน VAT หลังส่วนลด) สำหรับรายงานตามสินค้า
-- เอกสารแบบเต็ม (มี vat_rate ต่อบรรทัด): ราคารวม VAT ต้องถอด VAT ออก ไม่งั้นรายได้เกิน
-- เอกสารเก่าที่ไม่มี vat_rate (สร้างจาก create_sales_doc เช่น ใบลดหนี้/ใบเพิ่มหนี้): แบ่งมูลค่าก่อน VAT ของเอกสารตามสัดส่วนยอดบรรทัด
--   (ใช้ผลต่างสะสมปัดเศษ ผลรวมทุกบรรทัดจึงเท่ายอดเอกสารพอดี)
create or replace function sales_report_lines(p_from date, p_to date, p_type text default null)
returns table (doc_id uuid, doc_no text, doc_type text, doc_date date, contact_id uuid, description text, qty numeric, net numeric)
language sql stable as $$
  with x as (
    select d.id, d.doc_no, d.doc_type, d.doc_date, d.contact_id, d.subtotal, d.price_mode, l.line_no, l.description, l.qty, l.amount, l.vat_rate, l.vat_exempt,
           sum(l.amount) over (partition by d.id) tot,
           sum(l.amount) over (partition by d.id order by l.line_no) cum
      from sales_docs d join sales_doc_lines l on l.doc_id = d.id
     where d.doc_type in ('INV','CA','DN','CN') and d.status <> 'cancelled' and not d.is_deposit
       and (p_type is null or d.doc_type = p_type)
       and (p_from is null or d.doc_date >= p_from) and (p_to is null or d.doc_date <= p_to)
  )
  select id, doc_no, doc_type, doc_date, contact_id, description,
         qty * case when doc_type = 'CN' then -1 else 1 end,
         (case when vat_rate is not null then
                 case when price_mode = 'inclusive' and not coalesce(vat_exempt, false) and vat_rate > 0 then round(amount * 100 / (100 + vat_rate), 2) else amount end
               when tot = 0 then 0
               else round(cum * subtotal / tot, 2) - round((cum - amount) * subtotal / tot, 2) end)
         * case when doc_type = 'CN' then -1 else 1 end
    from x
$$;
