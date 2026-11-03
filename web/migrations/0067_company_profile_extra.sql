alter table company_profile
  add column business_type text not null default 'company' check (business_type in ('company','individual','partnership','other')),
  add column vat_registered boolean not null default true,
  add column is_branch boolean not null default false,
  add column branch_no text check (branch_no is null or branch_no ~ '^[0-9]{5}$'),
  add column phone text, add column mobile text, add column fax text, add column website text,
  add column name_en text, add column address_en text,
  add constraint company_branch_chk check (not is_branch or branch_no is not null);
