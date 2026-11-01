// นำเข้าผู้ติดต่อจากไฟล์ (ตามขั้นตอน/กฎของ FA — REA 02-11-2026)
export const MAX_ROWS = 500;
export const FIELDS = [
  ['name', 'ชื่อธุรกิจ', true], ['kind', 'ประเภทผู้ติดต่อ', true], ['person', 'ประเภทกิจการ', true],
  ['code', 'รหัสผู้ติดต่อ', false], ['contact', 'ชื่อผู้ติดต่อ', false], ['address', 'ที่อยู่', false], ['postal', 'รหัสไปรษณีย์', false], ['tax', 'เลขผู้เสียภาษี', false],
  ['branch', 'สาขา', false], ['phone', 'เบอร์โทร', false], ['email', 'อีเมล', false], ['credit', 'เครดิต (วัน)', false], ['bank', 'บัญชีธนาคาร', false], ['note', 'โน้ต', false],
] as const;
export type FieldKey = (typeof FIELDS)[number][0];
const SYN: Record<FieldKey, string[]> = {
  name: ['ชื่อธุรกิจ', 'ชื่อบริษัท', 'ชื่อ', 'name', 'businessname'], kind: ['ประเภทผู้ติดต่อ', 'ประเภทรายชื่อ', 'contacttype'], person: ['ประเภทกิจการ', 'ประเภทบุคคล', 'entitytype'],
  code: ['รหัสผู้ติดต่อ', 'รหัสลูกค้า', 'รหัส', 'code'], contact: ['ชื่อผู้ติดต่อ', 'ผู้ติดต่อ', 'contactname'], address: ['ที่อยู่', 'address'], postal: ['รหัสไปรษณีย์', 'ไปรษณีย์', 'postalcode', 'zipcode'],
  tax: ['เลขผู้เสียภาษี', 'เลขประจำตัวผู้เสียภาษี', 'เลขที่ผู้เสียภาษี', 'taxid'], branch: ['สาขา', 'รหัสสาขา', 'branch'], phone: ['เบอร์โทร', 'เบอร์โทรศัพท์', 'โทรศัพท์', 'phone'],
  email: ['อีเมล', 'email'], credit: ['เครดิต', 'เครดิตวัน', 'creditdays', 'credit'], bank: ['บัญชีธนาคาร', 'เลขบัญชี', 'เลขที่บัญชี', 'bankaccount'], note: ['โน้ต', 'หมายเหตุ', 'note'],
};
const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[\s_\-()*:./]/g, '');
export function autoMap(headers: string[]): Record<FieldKey, number> {
  const out = {} as Record<FieldKey, number>; const used = new Set<number>(); const hs = headers.map(norm);
  for (const [k] of FIELDS) {
    let idx = hs.findIndex((h, i) => !used.has(i) && SYN[k].some(s => norm(s) === h));
    if (idx < 0) idx = hs.findIndex((h, i) => !used.has(i) && h && SYN[k].some(s => norm(s).length > 3 && h.startsWith(norm(s))));
    out[k] = idx; if (idx >= 0) used.add(idx);
  }
  return out;
}
export type ContactItem = {
  business_name: string; kinds: 'customer' | 'vendor' | 'both'; person_kind: 'juristic' | 'individual'; contact_code: string; contact_name: string; address: string;
  postal_code: string; tax_id: string; branch_code: string; phone_office: string; person_email: string; credit_days: number; bank_account_no: string; note: string;
};
export type RowIssue = { row: number; message: string };
export type Validation = { items: ContactItem[]; issues: RowIssue[]; dups: number[]; ready: number; total: number };
const KIND: Record<string, ContactItem['kinds']> = { 'ลูกค้า': 'customer', customer: 'customer', 'ผู้จำหน่าย': 'vendor', vendor: 'vendor', supplier: 'vendor',
  'ลูกค้าและผู้จำหน่าย': 'both', 'ลูกค้า/ผู้จำหน่าย': 'both', 'ลูกค้าผู้จำหน่าย': 'both', both: 'both' };
const PERSON: Record<string, ContactItem['person_kind']> = { 'นิติบุคคล': 'juristic', juristic: 'juristic', 'บุคคลธรรมดา': 'individual', individual: 'individual' };

/** existing = "ชื่อธุรกิจ(ตัวพิมพ์เล็ก)|รหัสสาขา" ของรายชื่อที่มีในระบบ · ซ้ำ = ข้ามอัตโนมัติ (ไม่นับเป็นข้อผิดพลาด) · ผิดแถวเดียวก็ไม่นำเข้า */
export function validateContacts(rows: unknown[][], map: Record<FieldKey, number>, existing: Set<string>): Validation {
  const issues: RowIssue[] = []; const dups: number[] = []; const bad = (row: number, message: string) => issues.push({ row, message });
  const str = (r: unknown[], k: FieldKey) => (map[k] >= 0 ? String(r[map[k]] ?? '').trim() : '');
  if (rows.length === 0) return { items: [], issues: [{ row: 0, message: 'ไม่พบข้อมูลในไฟล์' }], dups, ready: 0, total: 0 };
  if (rows.length > MAX_ROWS) return { items: [], issues: [{ row: 0, message: `ไฟล์มี ${rows.length} แถว เกินกำหนด ${MAX_ROWS} รายชื่อต่อไฟล์` }], dups, ready: 0, total: rows.length };
  const seen = new Set(existing); const items: ContactItem[] = [];
  rows.forEach((r, i) => {
    const row = i + 1; const before = issues.length;
    const name = str(r, 'name'); if (!name) bad(row, 'ต้องระบุชื่อธุรกิจ');
    const kr = str(r, 'kind'); const kinds = KIND[kr.replace(/\s/g, '')] ?? KIND[norm(kr)];
    if (!kinds) bad(row, kr ? `ประเภทผู้ติดต่อ "${kr}" ไม่ถูกต้อง (ลูกค้า / ผู้จำหน่าย / ลูกค้าและผู้จำหน่าย)` : 'ต้องระบุประเภทผู้ติดต่อ');
    const pr = str(r, 'person'); const person = PERSON[pr.replace(/\s/g, '')];
    if (!person) bad(row, pr ? `ประเภทกิจการ "${pr}" ไม่ถูกต้อง (นิติบุคคล / บุคคลธรรมดา)` : 'ต้องระบุประเภทกิจการ');
    const tax = str(r, 'tax').replace(/[-\s]/g, '');
    if (tax && !/^([0-9]{10}|[0-9]{13})$/.test(tax)) bad(row, 'เลขผู้เสียภาษีต้องเป็นตัวเลข 10 หรือ 13 หลัก');
    let branch = str(r, 'branch'); const hq = branch === '' || /^(สำนักงานใหญ่|สนญ|hq|headoffice|0+)$/i.test(branch.replace(/\s/g, ''));
    if (hq) branch = ''; else if (!/^[0-9]{1,5}$/.test(branch)) bad(row, 'สาขาต้องเป็น "สำนักงานใหญ่" หรือรหัสสาขาตัวเลข 5 หลัก'); else branch = branch.padStart(5, '0');
    const email = str(r, 'email'); if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) bad(row, 'รูปแบบอีเมลไม่ถูกต้อง');
    const cr = str(r, 'credit'); const credit = cr === '' ? 0 : Number(cr.replace(/,/g, ''));
    if (!Number.isInteger(credit) || credit < 0) bad(row, 'เครดิตต้องเป็นจำนวนวันเต็มไม่ติดลบ');
    const postal = str(r, 'postal'); if (postal && !/^[0-9]{5}$/.test(postal)) bad(row, 'รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก');
    const key = `${name.toLowerCase()}|${branch}`;
    if (name && issues.length === before) {
      if (seen.has(key)) { dups.push(row); return; }
      seen.add(key);
      items.push({ business_name: name, kinds: kinds!, person_kind: person!, contact_code: str(r, 'code'), contact_name: str(r, 'contact'), address: str(r, 'address'), postal_code: postal,
        tax_id: tax, branch_code: branch, phone_office: str(r, 'phone'), person_email: email, credit_days: credit, bank_account_no: str(r, 'bank'), note: str(r, 'note') });
    }
  });
  const badSet = new Set(issues.map(i => i.row));
  return { items, issues: issues.sort((a, b) => a.row - b.row), dups, ready: rows.length - badSet.size - dups.length, total: rows.length };
}
