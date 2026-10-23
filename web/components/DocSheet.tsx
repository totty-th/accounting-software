import { DOC_TITLE, type DocView } from '@/lib/doc-view';
import { bahtText } from '@/lib/wht-pdf';
import { money, qty, dateTh } from '@/lib/format';

// เอกสารขนาด A4 ที่ลูกค้าเห็น (ใช้ร่วมกันในหน้ารายละเอียด หน้าพิมพ์ และลิงก์แชร์)
export function DocSheet({ v, copy = false }: { v: DocView; copy?: boolean }) {
  const t = DOC_TITLE[v.doc.doc_type];
  const rows = [
    ['มูลค่าก่อนภาษี', v.doc.subtotal],
    [`ภาษีมูลค่าเพิ่ม ${Number(v.doc.vat_rate)}%`, v.doc.vat],
  ] as const;
  const showVat = v.doc.doc_type !== 'BL';
  return (
    <article className="sheet" style={{ ['--dc' as any]: t.color }}>
      <header className="sh-head">
        <div className="sh-co">
          <b>{v.company?.name ?? ''}</b>
          <div>{v.company?.address}</div>
          {v.company?.tax_id && <div>เลขประจำตัวผู้เสียภาษี {v.company.tax_id}</div>}
        </div>
        <div className="sh-title">
          <h2>{t.title}</h2>
          <span className="sh-copy">{copy ? 'สำเนา' : 'ต้นฉบับ'}</span>
        </div>
      </header>
      <section className="sh-meta">
        <div className="sh-cust">
          <small>ลูกค้า</small>
          <b>{v.contact.name}</b>
          <div>{v.contact.address}</div>
          {v.contact.tax_id && <div>เลขประจำตัวผู้เสียภาษี {v.contact.tax_id}</div>}
        </div>
        <dl>
          <dt>เลขที่</dt><dd>{v.doc.doc_no}</dd>
          <dt>วันที่</dt><dd>{dateTh(v.doc.doc_date)}</dd>
          {v.doc.due_date && v.doc.doc_type !== 'QT' && <><dt>ครบกำหนด</dt><dd>{dateTh(v.doc.due_date)}</dd></>}
          {v.ref && <><dt>อ้างอิง</dt><dd>{v.ref.doc_no}</dd></>}
        </dl>
      </section>
      <table className="sh-lines">
        <thead><tr><th>#</th><th>รายละเอียด</th><th className="num">จำนวน</th><th className="num">ราคาต่อหน่วย</th><th className="num">มูลค่า</th></tr></thead>
        <tbody>{v.lines.map(l => (
          <tr key={l.line_no}><td>{l.line_no}</td><td>{l.description}</td><td className="num">{qty(l.qty)}</td>
            <td className="num">{money(l.unit_price)}</td><td className="num">{money(l.amount)}</td></tr>))}</tbody>
      </table>
      <section className="sh-sum">
        <div className="sh-words">({bahtText(Number(v.doc.total))})</div>
        <dl>
          {showVat && rows.map(([k, val]) => <div key={k}><dt>{k}</dt><dd>{money(val)}</dd></div>)}
          {Number(v.doc.deposit_net) > 0 && <div><dt>หักมัดจำ (ก่อนภาษี)</dt><dd>{money(v.doc.deposit_net)}</dd></div>}
          <div className="tot"><dt>จำนวนเงินรวมทั้งสิ้น</dt><dd>{money(v.doc.total)} บาท</dd></div>
        </dl>
      </section>
      {v.doc.reason && <p className="sh-note"><small>เหตุผล</small> {v.doc.reason}</p>}
      <footer className="sh-sign">
        <div><i />ผู้รับเอกสาร / วันที่</div>
        <div><i />ผู้มีอำนาจลงนาม / วันที่</div>
      </footer>
    </article>
  );
}
