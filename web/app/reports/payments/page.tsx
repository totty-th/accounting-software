import { getDb, today } from '@/lib/db';
import { money, dateTh, partyName } from '@/lib/format';
import { periodRange } from '@/lib/period';
import { reportPeriod } from '@/lib/report-filter';
import { channelOptions, paymentRows, groupPayments } from '@/lib/payment-report';
import { ReportFilter } from '@/components/ReportFilter';
import { PayGroups, type PayGroup } from '@/components/PayGroups';
import { requirePage } from '@/lib/auth';
import { ReportTools } from '@/components/ReportTools';

export const dynamic = 'force-dynamic';
type Sp = { period?: string; from?: string; to?: string; ch?: string | string[] };
// รายงานการชำระเงิน (ค่าใช้จ่าย/ซื้อสินค้า): จัดกลุ่มตามช่องทางที่จ่ายจริง (เงินสด / โอน / บัตรเครดิต / เงินสดย่อย / เช็ค) กรองตามวันที่ชำระ
// ไม่นับเอกสารที่ยกเลิก · ยอดรวมสุทธิ = ยอดจ่ายสุทธิของเอกสาร (หลังหัก ณ ที่จ่าย) · ยอดชำระ = เงินที่จ่ายผ่านช่องทางนั้น
export default async function PaymentReport({ searchParams }: { searchParams: Sp }) {
  await requirePage('reports.read');
  const period = reportPeriod(searchParams.period);
  const range = periodRange(period, today(), searchParams.from, searchParams.to);
  const db = await getDb();
  const chOpts = (await channelOptions(db)).map(x => [x.key, x.label] as [string, string]);
  const sel = ([] as string[]).concat(searchParams.ch ?? []).filter(k => chOpts.some(o => o[0] === k));
  const rows = await paymentRows(db, range, sel);
  const g = groupPayments(rows);
  const groups: PayGroup[] = g.groups.map(x => ({ key: x.key, label: x.label, net: x.net, paid: x.paid,
    rows: x.rows.map(r => ({ key: `${r.doc_id}:${r.line_no}`, href: r.doc_type === 'RI' ? `/purchases/ri/${r.doc_id}` : `/expenses/${r.doc_id}`, no: r.no, date: dateTh(r.dt), party: partyName(r),
      payDate: dateTh(r.pay_date), detail: r.method === 'cheque' ? `เช็คเลขที่ ${r.cheque_no ?? '-'}` : r.label, net: Number(r.net), paid: Number(r.amount) })) }));
  const docs = { size: g.docCount }, totNet = g.totNet, totPaid = g.totPaid;
  return (
    <>
      <div className="top"><div><h1>รายงานการชำระเงิน</h1><p className="sub">ค่าใช้จ่ายและใบรับสินค้าที่จ่ายแล้ว จัดกลุ่มตามช่องทาง · กรองตามวันที่ชำระ · ไม่รวมเอกสารที่ยกเลิก</p></div></div>
      <ReportFilter period={period} from={searchParams.from} to={searchParams.to} name="ch" allLabel="ช่องทางการชำระเงินทั้งหมด" groups={[{ label: '', options: chOpts }]} selected={sel} />
      <div className="panel">
        <div className="sub">ณ วันที่ {dateTh(today())} · ช่วงเวลา {range ? `${dateTh(range[0])} - ${dateTh(range[1])}` : 'ทั้งหมด'} · {docs.size} เอกสาร</div>
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', marginTop: 8 }}>
          <div><div className="sub">ยอดรวมทั้งสิ้น</div><strong>{money(totNet)}</strong></div>
          <div><div className="sub">ยอดชำระสุทธิ</div><strong>{money(totPaid)}</strong></div>
        </div>
      </div>
      <ReportTools exportBase="/reports/payments/export" title="รายงานการชำระเงิน" meta={[['ช่วงเวลา :', range ? `${dateTh(range[0])} - ${dateTh(range[1])}` : 'ทั้งหมด']]} />
      <div data-report className="panel" style={{ padding: 0, overflowX: 'auto', marginTop: 4 }}>
        {rows.length === 0 ? <div className="empty">ไม่มีข้อมูลในช่วงที่เลือก</div> : <PayGroups groups={groups} />}
      </div>
    </>
  );
}
