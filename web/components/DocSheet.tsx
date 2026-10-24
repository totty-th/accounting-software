import { DOC_TITLE, type DocView } from '@/lib/doc-view';
import { bahtText } from '@/lib/wht-pdf';
import { docSummary, lineTaxLabel, lineWhtLabel, SIGNERS } from '@/lib/doc-calc';
import { money, qty, dateTh } from '@/lib/format';

// เอกสารขนาด A4 ที่ลูกค้าเห็น (ใช้ร่วมกันในหน้ารายละเอียด หน้าพิมพ์ และลิงก์แชร์)
export function DocSheet({ v, copy = false }: { v: DocView; copy?: boolean }) {
  const t = DOC_TITLE[v.doc.doc_type], ty = v.doc.doc_type;
  const sum = docSummary(v);
  const [signL, signR] = SIGNERS[ty];
  const showTax = ty !== 'BL';
  const credit = v.contact.credit_days;
  return (
    <article className={`sheet${v.doc.status === 'cancelled' ? ' cancelled' : ''}`} style={{ ['--dc' as any]: t.color }}>
      {v.doc.status === 'cancelled' && <div className="sh-mark">ยกเลิก</div>}
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
          {credit > 0 && <><dt>เครดิต</dt><dd>{credit} วัน</dd></>}
          {v.doc.due_date && ty !== 'QT' && <><dt>ครบกำหนด</dt><dd>{dateTh(v.doc.due_date)}</dd></>}
          {v.ref && (ty === 'CN' || ty === 'DN') && <><dt>วันที่อ้างอิง</dt><dd>{dateTh(v.ref.doc_date)}</dd></>}
          {v.doc.salesperson && <><dt>พนักงานขาย</dt><dd>{v.doc.salesperson}</dd></>}
          {v.ref && <><dt>อ้างอิง</dt><dd>{v.ref.doc_no}</dd></>}
        </dl>
      </section>
      <table className="sh-lines">
        <thead><tr><th>#</th><th>รายละเอียด</th><th className="num">จำนวน</th><th className="num">ราคาต่อหน่วย</th>
          {showTax && <><th className="num">ภาษี</th><th className="num">หัก ณ ที่จ่าย</th></>}<th className="num">มูลค่า</th></tr></thead>
        <tbody>{v.lines.map(l => (
          <tr key={l.line_no}><td>{l.line_no}</td><td className="desc">{l.description}</td><td className="num">{qty(l.qty)}</td>
            <td className="num">{money(l.unit_price)}</td>
            {showTax && <><td className="num">{lineTaxLabel(v)}</td><td className="num">{lineWhtLabel(v)}</td></>}
            <td className="num">{money(l.amount)}</td></tr>))}</tbody>
      </table>
      <section className="sh-sum">
        <div className="sh-words">({bahtText(Number(sum.total))})</div>
        <dl>
          {sum.rows.map(r => <div key={r.label} className={`${r.strong ? 'tot' : ''}${r.gap ? ' gap' : ''}`}><dt>{r.label}</dt><dd>{money(r.value)} บาท</dd></div>)}
          {sum.wht.length > 0 && <hr />}
          {sum.wht.map(r => <div key={r.label}><dt>{r.label}</dt><dd>{money(r.value)} บาท</dd></div>)}
        </dl>
      </section>
      {v.doc.reason && <p className="sh-note"><small>หมายเหตุ</small>{v.doc.reason}</p>}
      <footer className="sh-sign">
        <div><span className="on">ในนาม {v.contact.name}</span><i />{signL} / วันที่</div>
        <div><span className="on">ในนาม {v.company?.name ?? ''}</span><i />{signR} / วันที่</div>
      </footer>
    </article>
  );
}
