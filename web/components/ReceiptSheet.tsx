import { bahtText } from '@/lib/wht-pdf';
import { SIGNERS } from '@/lib/doc-calc';
import { money, dateTh } from '@/lib/format';

export interface ReceiptView {
  receipt: { id: string; receipt_no: string; kind: string; receipt_date: string; status: string; amount: string | number; wht: string | number;
    collected_date: string | null; vat_rate: string | number | null; vat: string | number; base: string | number };
  contact: { name: string; address: string | null; tax_id: string | null };
  company: { name: string; address: string | null; tax_id: string | null } | null;
  items: { line_no: number; doc_no: string | null; doc_date: string | null; due_date: string | null; doc_total: string | number | null;
    description: string | null; amount: string | number; wht: string | number }[];
  payments: { method: string; bank: string | null; ref_no: string | null; pay_date: string; amount: string | number }[];
}
const METHODS: [string, string][] = [['cash', 'เงินสด'], ['cheque', 'เช็ค'], ['transfer', 'โอนเงิน'], ['card', 'บัตรเครดิต']];

const COLOR = '#2e8b3d';
// ใบเสร็จรับเงิน A4: รายการเอกสารที่รับชำระ สรุปยอด ช่องแสดงวิธีรับเงิน และลายเซ็น
export function ReceiptSheet({ v, copy = false }: { v: ReceiptView; copy?: boolean }) {
  const r = v.receipt, [signL, signR] = SIGNERS.RE;
  const net = (Number(r.amount) * 100 - Number(r.wht) * 100) / 100;
  const hasTax = r.vat_rate != null;
  return (
    <article className={`sheet${r.status === 'cancelled' ? ' cancelled' : ''}`} style={{ ['--dc' as any]: COLOR }}>
      {r.status === 'cancelled' && <div className="sh-mark">ยกเลิก</div>}
      <header className="sh-head">
        <div className="sh-co"><b>{v.company?.name ?? ''}</b><div>{v.company?.address}</div>
          {v.company?.tax_id && <div>เลขประจำตัวผู้เสียภาษี {v.company.tax_id}</div>}</div>
        <div className="sh-title"><h2>ใบเสร็จรับเงิน</h2><span className="sh-copy">{copy ? 'สำเนา' : 'ต้นฉบับ'}</span></div>
      </header>
      <section className="sh-meta">
        <div className="sh-cust"><small>ลูกค้า</small><b>{v.contact.name}</b><div>{v.contact.address}</div>
          {v.contact.tax_id && <div>เลขประจำตัวผู้เสียภาษี {v.contact.tax_id}</div>}</div>
        <dl><dt>เลขที่</dt><dd>{r.receipt_no}</dd><dt>วันที่</dt><dd>{dateTh(r.receipt_date)}</dd></dl>
      </section>
      <table className="sh-lines">
        <thead><tr><th>#</th><th>เลขที่เอกสาร</th><th>เอกสารวันที่</th><th>วันครบกำหนด</th><th className="num">ยอดรวม</th><th className="num">หัก ณ ที่จ่าย</th><th className="num">ยอดชำระ</th></tr></thead>
        <tbody>{v.items.map(i => (
          <tr key={i.line_no}><td>{i.line_no}</td><td>{i.doc_no ?? i.description}</td><td>{dateTh(i.doc_date)}</td><td>{dateTh(i.due_date)}</td>
            <td className="num">{i.doc_total != null ? money(i.doc_total) : ''}</td><td className="num">{money(i.wht)}</td><td className="num">{money(i.amount)}</td></tr>))}</tbody>
      </table>
      <section className="sh-sum">
        <div className="sh-words">({bahtText(Number(r.amount))})</div>
        <dl>
          <div><dt>จำนวนรวม</dt><dd>{v.items.length} รายการ</dd></div>
          <div><dt>รวมเป็นเงิน</dt><dd>{money(r.amount)} บาท</dd></div>
          {hasTax && <>
            <div className="gap"><dt>มูลค่าที่ไม่มี/ยกเว้นภาษี</dt><dd>{money(0)} บาท</dd></div>
            <div><dt>มูลค่าที่คำนวณภาษี</dt><dd>{money(r.base)} บาท</dd></div>
            <div><dt>ภาษีมูลค่าเพิ่ม {Number(r.vat_rate)}%</dt><dd>{money(r.vat)} บาท</dd></div></>}
          <div className="tot"><dt>จำนวนเงินรวมทั้งสิ้น</dt><dd>{money(r.amount)} บาท</dd></div>
          <hr />
          <div><dt>หักภาษี ณ ที่จ่ายทั้งสิ้น</dt><dd>{money(r.wht)} บาท</dd></div>
          <div><dt>ยอดชำระ</dt><dd>{money(net)} บาท</dd></div>
        </dl>
      </section>
      <div className="pay-box"><span>การชำระเงินจะสมบูรณ์เมื่อบริษัทได้รับเงินเรียบร้อยแล้ว</span>
        {METHODS.map(([k, m]) => <span key={k}><i className={`cb${v.payments.some(p => p.method === k) ? ' on' : ''}`} />{m}</span>)}</div>
      {(v.payments.length ? v.payments : [null]).map((p, i) => (
        <div className="pay-line" key={i}><span>ธนาคาร {p?.bank ?? ''}</span><span>เลขที่ {p?.ref_no ?? ''}</span>
          <span>วันที่ {p ? dateTh(p.pay_date) : ''}</span><span>จำนวนเงิน {p ? money(p.amount) : ''}</span></div>))}
      <footer className="sh-sign">
        <div><span className="on">ในนาม {v.contact.name}</span><i />{signL} / วันที่</div>
        <div><span className="on">ในนาม {v.company?.name ?? ''}</span><i />{signR} / วันที่</div>
      </footer>
    </article>
  );
}
