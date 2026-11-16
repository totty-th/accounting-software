// ค้นข้อมูลผู้ประกอบการจดทะเบียน VAT จาก web service กรมสรรพากร (เลขผู้เสียภาษี → ชื่อ สาขา ที่อยู่) · เปิดให้ใช้ด้วย anonymous/anonymous
// เอกสาร: https://rd.go.th/42535.html · เรียกจากฝั่งเซิร์ฟเวอร์เท่านั้น · ได้เฉพาะผู้จดทะเบียน VAT
const ENDPOINT = 'https://rdws.rd.go.th/serviceRD3/vatserviceRD3.asmx';
const NS = 'https://rdws.rd.go.th/serviceRD3/vatserviceRD3';

export type RdRow = { tax_id: string; branch_code: string; name: string; address: string; postal_code: string; first_date: string };

const esc = (s: string) => s.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]!));
const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

export function buildRequest(q: string): string {
  const tin = /^\d{13}$/.test(q) ? q : '';
  const name = tin ? '' : q;
  return `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope" xmlns:vat="${NS}"><soap12:Body><vat:Service>`
    + `<vat:username>anonymous</vat:username><vat:password>anonymous</vat:password><vat:TIN>${tin}</vat:TIN><vat:Name>${esc(name)}</vat:Name>`
    + `<vat:ProvinceCode>0</vat:ProvinceCode><vat:BranchNumber>0</vat:BranchNumber><vat:AmphurCode>0</vat:AmphurCode></vat:Service></soap12:Body></soap12:Envelope>`;
}

/** อ่านผลลัพธ์: แต่ละฟิลด์ (vNID, vName, ...) เป็นอาร์เรย์ของ <anyType> เรียงตามแถวเดียวกัน */
export function parseResponse(xml: string): RdRow[] {
  const cols: Record<string, string[]> = {};
  const re = /<(v[A-Za-z]+)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g;
  for (let m; (m = re.exec(xml)); ) {
    const vals = [...m[2].matchAll(/<(?:anyType|string)(?:\s[^>]*)?>([\s\S]*?)<\/(?:anyType|string)>/g)].map(x => unesc(x[1]).trim());
    cols[m[1].slice(1).toLowerCase()] = vals;
  }
  const get = (i: number, ...keys: string[]) => {
    for (const k of keys) { const v = cols[k]?.[i]; if (v && v !== '-') return v; }
    return '';
  };
  const n = Math.max(0, ...Object.values(cols).map(v => v.length));
  const rows: RdRow[] = [];
  for (let i = 0; i < n; i++) {
    const tax = get(i, 'nid');
    if (!tax) continue;
    const prov = get(i, 'province', 'provincename');
    const bkk = /กรุงเทพ/.test(prov);
    const sub = get(i, 'thambol', 'thumbolname'), dist = get(i, 'amphur', 'amphurname');
    const withPrefix = (v: string, pre: string[]) => (v && !pre.some(p => v.startsWith(p)) ? pre[0] + v : v);
    const parts = [
      get(i, 'housenumber') && get(i, 'housenumber'),
      get(i, 'buildingname') && `อาคาร${get(i, 'buildingname').replace(/^อาคาร/, '')}`,
      get(i, 'roomnumber') && `ห้อง ${get(i, 'roomnumber')}`, get(i, 'floornumber') && `ชั้น ${get(i, 'floornumber')}`,
      get(i, 'villagename') && `หมู่บ้าน${get(i, 'villagename').replace(/^หมู่บ้าน/, '')}`,
      get(i, 'moonumber') && `หมู่ ${get(i, 'moonumber')}`,
      get(i, 'soiname') && withPrefix(get(i, 'soiname'), ['ซอย', 'ซ.']),
      get(i, 'streetname') && withPrefix(get(i, 'streetname'), ['ถนน', 'ถ.']),
      sub && withPrefix(sub, bkk ? ['แขวง'] : ['ตำบล', 'ต.']),
      dist && withPrefix(dist, bkk ? ['เขต'] : ['อำเภอ', 'อ.']),
      prov && (bkk ? prov : withPrefix(prov, ['จังหวัด', 'จ.'])),
    ].filter(Boolean);
    const person = [get(i, 'titlename'), get(i, 'name'), get(i, 'surname')].filter(Boolean).join(' ');
    const branch = [get(i, 'branchtitlename'), get(i, 'branchname')].filter(Boolean).join(' ');
    rows.push({
      tax_id: tax, branch_code: (get(i, 'branchnumber') || '0').padStart(5, '0'), name: person || branch,
      address: parts.join(' '), postal_code: get(i, 'postcode'), first_date: get(i, 'businessfirstdate'),
    });
  }
  return rows;
}

export async function lookupRd(q: string): Promise<{ rows: RdRow[]; raw?: string }> {
  const query = q.trim();
  if (!/^\d{13}$/.test(query) && query.length < 3) throw new Error('กรอกเลขผู้เสียภาษี 13 หลัก หรือชื่ออย่างน้อย 3 ตัวอักษร');
  const res = await fetch(ENDPOINT, { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(15000),
    headers: { 'content-type': 'application/soap+xml; charset=utf-8' }, body: buildRequest(query) });
  const xml = await res.text();
  if (!res.ok) throw new Error(`กรมสรรพากรตอบกลับผิดปกติ (${res.status})`);
  return { rows: parseResponse(xml).slice(0, 30), raw: xml };
}
