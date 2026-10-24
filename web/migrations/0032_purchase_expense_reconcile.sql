create or replace function purchase_expense_reconcile(p_from date, p_to date) returns jsonb language sql stable as $$
  with ri as (
    select coalesce(sum(subtotal),0) s, coalesce(sum(vat),0) v, count(*) n from goods_receipts
     where status not in ('rejected','cancelled') and (p_from is null or ri_date >= p_from) and (p_to is null or ri_date <= p_to)
  ), ex as (
    select e.id, e.vat, l.account_code, l.net from expenses e join expense_lines l on l.expense_id = e.id
     where e.status not in ('rejected','cancelled') and (p_from is null or e.exp_date >= p_from) and (p_to is null or e.exp_date <= p_to)
  ), exn as (
    select count(distinct id) n from ex
  ), exv as (
    select coalesce(sum(vat),0) v from (select distinct id, vat from ex) q
  ), g as (
    select v.source_type, a.code, a.name, v.voucher_no, v.voucher_date, l.debit - l.credit amt
      from journal_lines l join journal_vouchers v on v.id = l.voucher_id join accounts a on a.id = l.account_id
     where (p_from is null or v.voucher_date >= p_from) and (p_to is null or v.voucher_date <= p_to)
  ), gp as (   -- ฝั่งบัญชีของเอกสารซื้อ: ไม่นับบัญชีเจ้าหนี้ (หมวด 2) และภาษีซื้อ
    select code, name, sum(amt) amt from g where source_type in ('RI','EXP') and code not like '2%' and code <> '17113' group by code, name
  )
  select jsonb_build_object(
    'doc', jsonb_build_object(
      'ri', (select s from ri), 'ri_count', (select n from ri), 'exp', coalesce((select sum(net) from ex),0), 'exp_count', (select n from exn),
      'total', (select s from ri) + coalesce((select sum(net) from ex),0),
      'vat', (select v from ri) + (select v from exv),
      'exp_by_account', coalesce((select jsonb_agg(jsonb_build_object('code', x.account_code, 'name', a.name, 'amount', x.s) order by x.account_code)
         from (select account_code, sum(net) s from ex group by account_code) x left join accounts a on a.code = x.account_code), '[]'::jsonb)),
    'gl', jsonb_build_object(
      'from_docs', coalesce((select sum(amt) from gp),0),
      'vat', coalesce((select sum(amt) from g where source_type in ('RI','EXP') and code = '17113'),0),
      'by_account', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'amount', amt) order by code) from gp),'[]'::jsonb),
      'other_expense', coalesce((select jsonb_agg(jsonb_build_object('source', coalesce(source_type,'JV'), 'code', code, 'name', name, 'amount', amt) order by source_type, code)
         from (select source_type, code, name, sum(amt) amt from g
                where (code like '5%' or code like '6%') and (source_type is null or source_type not in ('RI','EXP')) group by source_type, code, name) o),'[]'::jsonb)),
    'diff', coalesce((select sum(amt) from gp),0) - ((select s from ri) + coalesce((select sum(net) from ex),0)),
    'vat_diff', coalesce((select sum(amt) from g where source_type in ('RI','EXP') and code = '17113'),0) - ((select v from ri) + (select v from exv)))
$$;
