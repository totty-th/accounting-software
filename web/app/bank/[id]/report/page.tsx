import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { money, dateTh, dateIso } from '@/lib/format';
import { PrintButton } from '@/components/ShareTools';
import { buildReconcileReport, monthEnd } from '@/lib/bank-report';


// รายงานกระทบยอดธนาคาร (Bank Reconciliation Statement) สำหรับพิมพ์ A4
export default async function ReconcileReport({ params, searchParams }: { params: { id: string }; searchParams: { batch?: string; month?: string } }) {
  const db = await getDb();
  const b = (await db.q(`select b.id, b.bank_name, b.account_no, b.account_name, a.code from bank_accounts b join accounts a on a.id=b.account_id where b.id=$1`, [params.id]))[0];
  if (!b) notFound();
  const company = (await db.q('select name, tax_id from company_profile limit 1'))[0] ?? {};
  const batch = searchParams.batch && /^[0-9a-f-]{36}$/i.test(searchParams.batch) ? searchParams.batch : null;
  const lines = await db.q(`select row_number() over (order by s.line_date, x.created_at, s.line_no)::int seq, s.line_date, s.description, s.amount, s.balance, s.group_id
      from bank_statement_lines s join bank_statement_batches x on x.id = s.batch_id
     where s.bank_account_id=$1 and ($2::uuid is null or s.batch_id=$2) order by seq`, [b.id, batch]);
  const items = await db.q('select * from bank_book_items($1)', [b.id]);
  const today = dateIso((await db.q('select today_th() d'))[0].d);
  // ณ วันที่: เลือกเดือน (สิ้นเดือน) · ไม่เลือก = วันนี้ (สถานะปัจจุบัน)
  const month = searchParams.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(searchParams.month) ? searchParams.month : '';
  const asOf = month ? monthEnd(month) : today;
  const months = Array.from(new Set([...lines.map(l => dateIso(l.line_date).slice(0, 7)), ...items.map(i => dateIso(i.voucher_date).slice(0, 7)), today.slice(0, 7)])).sort().reverse();

  const R = buildReconcileReport(
    lines.map(l => ({ seq: l.seq, date: dateIso(l.line_date), description: l.description ?? '', amount: Number(l.amount), balance: l.balance === null ? null : Number(l.balance), groupId: l.group_id })),
    items.map(i => ({ date: dateIso(i.voucher_date), no: i.voucher_no, memo: i.memo ?? '', amount: Number(i.amount), groupId: i.group_id })), asOf);
  const lastDate = lines.map(l => dateIso(l.line_date)).filter(d => d <= asOf).pop() ?? null;

  const Row = ({ t, v, strong, indent, note }: { t: string; v: number; strong?: boolean; indent?: boolean; note?: string }) => (
    <tr style={{ fontWeight: strong ? 700 : 400, borderTop: strong ? '1px solid #8a8a94' : undefined }}>
      <td style={{ paddingLeft: indent ? 22 : 0 }}>{t}{note && <small style={{ display: 'inline', marginLeft: 8 }}>{note}</small>}</td><td className="num">{money(v)}</td></tr>);
  const itemRow = (i: { date: string; no: string; memo: string; amount: number; groupId: string | null }, k: number) =>
    <Row key={k} indent t={`${dateTh(i.date)}  ${i.no}  ${i.memo}`} v={i.amount} note={R.matchedLater(i.groupId) ? '(ธนาคารบันทึกภายหลังวันที่รายงาน)' : undefined} />;
  const inTransit = R.inTransit as any[], outstanding = R.outstanding as any[];

  return (
    <>
      <div className="top noprint">
        <div><h1>รายงานกระทบยอด</h1>
          <p className="sub"><Link href={`/bank/${b.id}${batch ? `?batch=${batch}` : ''}`}>← กลับไปหน้ากระทบยอด</Link></p></div>
        <div className="acts"><PrintButton /></div>
      </div>
      <form className="noprint" method="get" style={{ display: 'flex', gap: 8, alignItems: 'end', marginBottom: 12, flexWrap: 'wrap' }}>
        {batch && <input type="hidden" name="batch" value={batch} />}
        <label className="f" style={{ margin: 0 }}>ณ สิ้นเดือน
          <select name="month" defaultValue={month}>
            <option value="">ปัจจุบัน ({dateTh(today)})</option>
            {months.map(m => <option key={m} value={m}>{m.slice(5)}/{Number(m.slice(0, 4)) + 543} (สิ้นเดือน {dateTh(monthEnd(m))})</option>)}
          </select></label>
        <button className="btn ghost" type="submit">ดูรายงาน</button>
      </form>
      <div className="sheet" style={{ ['--dc' as any]: '#1f6fb5' }}>
        <div className="sh-head">
          <div className="sh-co"><b>{company.name ?? ''}</b>{company.tax_id && <small>เลขประจำตัวผู้เสียภาษี {company.tax_id}</small>}</div>
          <div className="sh-title"><h2>งบกระทบยอดเงินฝากธนาคาร</h2>
            <small>ณ วันที่ {dateTh(asOf)}</small>
            <small>{b.bank_name} · เลขที่บัญชี {b.account_no}{b.account_name ? ` · ${b.account_name}` : ''}</small>
            <small>รหัสบัญชี {b.code} · รายการธนาคารล่าสุด {lastDate ? dateTh(lastDate) : '-'} · พิมพ์ {dateTh(today)}</small></div>
        </div>

        <table className="sh-lines" style={{ marginTop: 18 }}><tbody>
          <Row t="ยอดคงเหลือตามรายงานธนาคาร (statement)" v={R.bankBalance} strong />
          <tr><td colSpan={2} style={{ paddingTop: 8 }}><small>บวก: รายการรับในสมุดบัญชี ที่ธนาคารยังไม่ปรากฏ (เงินฝากระหว่างทาง)</small></td></tr>
          {inTransit.length === 0 && <tr><td colSpan={2} style={{ paddingLeft: 22 }}>-</td></tr>}
          {inTransit.map(itemRow)}
          <tr><td colSpan={2} style={{ paddingTop: 8 }}><small>หัก: รายการจ่ายในสมุดบัญชี ที่ธนาคารยังไม่ปรากฏ (เช็ค/โอนที่ยังไม่ผ่านธนาคาร)</small></td></tr>
          {outstanding.length === 0 && <tr><td colSpan={2} style={{ paddingLeft: 22 }}>-</td></tr>}
          {outstanding.map(itemRow)}
          <Row t="ยอดคงเหลือธนาคารหลังปรับปรุง" v={R.adjBank} strong />

          <tr><td colSpan={2} style={{ paddingTop: 22 }} /></tr>
          <Row t={`ยอดคงเหลือตามสมุดบัญชี (${b.code})`} v={R.bookTotal} strong />
          <tr><td colSpan={2} style={{ paddingTop: 8 }}><small>บวก/หัก: รายการในธนาคารที่ยังไม่ได้จับคู่กับสมุดบัญชี (เช่น ดอกเบี้ย ค่าธรรมเนียม ที่ยังไม่บันทึก)</small></td></tr>
          {R.unLines.length === 0 && <tr><td colSpan={2} style={{ paddingLeft: 22 }}>-</td></tr>}
          {R.unLines.map((l, k) => <Row key={k} indent t={`${dateTh(l.date)}  ${l.description}`} v={l.amount} note={R.matchedLater(l.groupId) ? '(สมุดบัญชีบันทึกภายหลังวันที่รายงาน)' : undefined} />)}
          <Row t="ยอดคงเหลือสมุดบัญชีหลังปรับปรุง" v={R.adjBook} strong />

          <tr><td colSpan={2} style={{ paddingTop: 22 }} /></tr>
          <Row t="ผลต่างที่ยังอธิบายไม่ได้ (ธนาคารหลังปรับปรุง − สมุดบัญชีหลังปรับปรุง)" v={R.unexplained} strong />
        </tbody></table>
        {R.unexplained !== 0 && (
          <p className="sh-note">หมายเหตุ: ผลต่างนี้มักมาจากยอดยกมาของ statement กับสมุดบัญชีไม่เท่ากัน หรือ statement ที่นำเข้าไม่ครบช่วง ควรตรวจสอบก่อนอนุมัติ</p>)}
        <p className="sh-note"><small>กระทบยอดแล้ว {R.matchedLines} จาก {R.lineCount} รายการธนาคาร (ถึงวันที่รายงาน) · รายการสมุดบัญชีที่ยังไม่กระทบ {R.unmatchedItems} รายการ{batch ? ' · เฉพาะชุดข้อมูลที่เลือก' : ''}</small></p>
        <p className="sh-note"><small>รายการที่จับคู่แล้วจะนับว่า "ผ่านธนาคาร" เมื่อทั้งสองฝั่งลงวันที่ไม่เกินวันที่รายงาน · ใบสำคัญที่ถูกกลับรายการแล้วไม่แสดง</small></p>

        <div className="sh-sign"><div><i />ผู้จัดทำ<br />วันที่ ____/____/______</div><div><i />ผู้ตรวจสอบ<br />วันที่ ____/____/______</div><div><i />ผู้อนุมัติ<br />วันที่ ____/____/______</div></div>
      </div>
    </>
  );
}
