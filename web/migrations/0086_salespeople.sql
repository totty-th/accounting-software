create table salespeople (
  name text primary key,
  sort_order int not null default 0,
  is_active boolean not null default true
);
insert into salespeople(name, sort_order)
select n, o from unnest(array['จิม','ร่ม','เปี๊ยก','มล','เป้','เอก','นา','อุ๊','วาสนา','เมย์','นก','ปุ๋ย','วิโรจน์','จ้อย','โก้']) with ordinality as t(n, o);
