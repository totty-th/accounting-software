import { type DocView } from '@/lib/doc-view';
import { shipRows } from '@/lib/doc-calc';
import { qty, dateTh } from '@/lib/format';

// ใบส่งของ A4 — เหมือนใบแจ้งหนี้/ใบเสนอราคาแต่ไม่มีราคา (ตาม FlowAccount) + บล็อกข้อมูลจัดส่งที่ฝ่ายขายกรอก
export function DeliverySheet({ v, copy = false }: { v: DocView; copy?: boolean }) {
  const rows = shipRows(v), color = '#2f7d6d';
  const nodate = v.doc.doc_type === 'INV' && v.doc.term_mode === 'credit_nodate';
  return (
    <article className={`sheet${v.doc.status === 'cancelled' ? ' cancelled' : ''}`} style={{ ['--dc' as any]: color }}>
      {v.doc.status === 'cancelled' && <div className="sh-mark">ยกเลิก</div>}
      <header className="sh-head">
        <div className="sh-co">
          <b>{v.company?.name ?? ''}</b>
          <div>{v.company?.address}</div>
          {v.company?.tax_id && <div>เลขประจำตัวผู้เสียภาษี {v.company.tax_id}</div>}
        </div>
        <div className="sh-title"><h2>ใบส่งของ</h2><span className="sh-copy">{copy ? 'สำเนา' : 'ต้นฉบับ'}</span></div>
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
          <dt>วันที่</dt><dd>{nodate ? '................................' : dateTh(v.doc.doc_date)}</dd>
          {v.doc.salesperson && <><dt>พนักงานขาย</dt><dd>{v.doc.salesperson}</dd></>}
          {v.doc.ref_no && <><dt>เลขที่อ้างอิง</dt><dd>{v.doc.ref_no}</dd></>}
          {v.doc.project && <><dt>โปรเจกต์</dt><dd>{v.doc.project}</dd></>}
        </dl>
      </section>
      {rows.length > 0 && <section className="sh-ship">
        <dl>{rows.map(([k, val]) => <div key={k}><dt>{k}</dt><dd style={{ whiteSpace: 'pre-line' }}>{val}</dd></div>)}</dl>
      </section>}
      <table className="sh-lines">
        <thead><tr><th>#</th><th>รายละเอียด</th><th className="num">จำนวน</th></tr></thead>
        <tbody>{v.lines.map(l => (
          <tr key={l.line_no}><td>{l.line_no}</td><td className="desc" style={{ whiteSpace: 'pre-line' }}>{l.description}{l.detail ? `\n${l.detail}` : ''}</td>
            <td className="num">{qty(l.qty)}{l.unit ? ` ${l.unit}` : ''}</td></tr>))}</tbody>
      </table>
      <p className="sh-count">จำนวน {v.lines.length} รายการ</p>
      <footer className="sh-sign">
        <div><span className="on">ในนาม {v.contact.name}</span><i />ผู้รับสินค้า / วันที่</div>
        <div><span className="on">ในนาม {v.company?.name ?? ''}</span><i />ผู้ส่งสินค้า / วันที่</div>
      </footer>
    </article>
  );
}
