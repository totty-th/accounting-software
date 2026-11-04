// รายงานการเก็บเงิน (ฝั่งขาย): SQL อยู่ที่นี่เพื่อให้เทสต์ใช้ชุดเดียวกับหน้ารายงาน
// ช่องทางรับชำระ: INV/DN = receipt_payments ของใบเสร็จที่ไม่ยกเลิก · CA (ขายสด) ไม่มี receipt_payments
// จึงอ่านจากใบสำคัญเก็บเงิน (collect_voucher_id): เดบิตเข้าบัญชีธนาคาร = โอนเงิน ไม่ใช่ = เงินสด
export const COLLECTION_SQL = `select d.id, d.doc_no, d.doc_type, d.doc_date, d.status, d.total, c.business_name, c.contact_name,
    case when d.doc_type = 'CA' then
      (select case when d.collect_voucher_id is null then null
         when exists (select 1 from journal_lines l join bank_accounts b on b.account_id = l.account_id
                      where l.voucher_id = d.collect_voucher_id and l.debit > 0) then 'transfer' else 'cash' end)
    else (select string_agg(distinct rp.method, ',') from receipt_items ri join receipts r on r.id=ri.receipt_id and r.status<>'cancelled'
            join receipt_payments rp on rp.receipt_id=r.id where ri.doc_id=d.id) end methods
  from sales_docs d join contacts c on c.id=d.contact_id
  where d.doc_type in ('INV','CA','DN') and ($1::date is null or d.doc_date>=$1::date) and ($2::date is null or d.doc_date<=$2::date)
    and (cardinality($3::text[])=0 or d.status = any($3::text[]))
  order by d.doc_date desc, d.doc_no desc`;
