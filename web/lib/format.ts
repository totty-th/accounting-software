export const money = (n: unknown) =>
  Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const qty = (n: unknown) => Number(n ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 4 });
export const dateTh = (d: unknown) => {
  if (!d) return '';
  const s = d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
  const [y, m, dd] = s.split('-');
  return `${dd}/${m}/${Number(y) + 543}`;
};
export const dateIso = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? '').slice(0, 10));
export const partyName = (r: { business_name?: string | null; contact_name?: string | null }) =>
  r.business_name || r.contact_name || '-';
