alter table app_users add column password_hash text, add column must_change_password boolean not null default false,
  add column session_version int not null default 0, add column failed_logins int not null default 0, add column locked_until timestamptz,
  add column setup_token_hash text, add column setup_token_expires timestamptz, add column password_set_at timestamptz;
update app_users set email = lower(btrim(email)) where email is not null and email <> lower(btrim(email));
create unique index app_users_email_uq on app_users (lower(email)) where email is not null;
