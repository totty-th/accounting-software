import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { money, dateTh, dateIso } from '@/lib/format';
import { PrintButton } from '@/components/ShareTools';

const r2 = (n: number) => Math.round(n * 100) / 100;

// รายงานกระทบยอดธนาคาร (Bank Reconciliation Statement) สำหรับพิมพ์ A4
export default async function ReconcileReport({ params, searchParams }: { params: { id: string }; searchParams: { batch?: string } }) {
  const db = await getDb();
  const b = (await db.q(`select b.id, b.bank_name, b.account_no, b.account_name, a.code from bank_accounts b join accounts a on a.id=b.account_id where b.id=$1`, [params.id]))[0];
  if (!b) notFound();
  const company = (await db.q('select name, tax_id from company_profile limit 1'))[0] ?? {};
  const batch = searchParams.batch && /^[0-9a-f-]{36}$/i.test(searchParams.batch) ? searchParams.batch : null;
  const st = (await db.q('select * from bank_reconcile_status($1,$2)', [b.id, batch]))[0];
  const lines = await db.q(`select s.line_date, s.description, s.amount, s.group_id from bank_statement_lines s
     where s.bank_account_id=$1 and ($2::uuid is null or s.batch_id=$2) order by s.line_date, s.batch_id, s.line_no`, [b.id, batch]);
  const items = await db.q('select * from bank_book_items($1)', [b.id]);
  const lastDate = lines.length ? dateIso(lines[lines.length - 1].line_date) : null;
  const today = (await db.q('select today_th() d'))[0].d;

  const uLines = lines.filter(l => !l.group_id);
  const uItems = items.filter(i => !i.group_id);
  const bankBal = Number(st.bank_balance), bookAll = Number(st.book_all);
  const inTransit = uItems.filter(i => Number(i.amount) > 0), outstanding = uItems.filter(i => Number(i.amount) < 0);
  const sum = (a: any[]) => r2(a.reduce((s, x) => s + Number(x.amount), 0));
  const adjBank = r2(bankBal + sum(inTransit) + sum(outstanding));
  const adjBook = r2(bookAll + sum(uLines));
  const unexplained = r2(adjBank - adjBook);
  const matchedLines = lines.length - uLines.length;

  const Row = ({ t, v, strong, indent }: { t: string; v: number; strong?: boolean; indent?: boolean }) => (
    <tr style={{ fontWeight: strong ? 700 : 400, borderTop: strong ? '1px solid #8a8a94' : undefined }}>
      <td style={{ paddingLeft: indent ? 22 : 0 }}>{t}</td><td className="num">{money(v)}</td></tr>);

  return (
    <>
      <div className="top noprint">
        <div><h1>รายงานกระทบยอด</h1>
          <p className="sub"><Link href={`/bank/${b.id}${batch ? `?batch=${batch}` : ''}`}>← กลับไปหน้ากระทบยอด</Link></p></div>
        <div className="acts"><PrintButton /></div>
      </div>
      <div className="sheet" style={{ ['--dc' as any]: '#1f6fb5' }}>
        <div className="sh-head">
          <div className="sh-co"><b>{company.name ?? ''}</b>{company.tax_id && <small>เลขประจำตัวผู้เสียภาษี {company.tax_id}</small>}</div>
          <div className="sh-title"><h2>งบกระทบยอดเงินฝากธนาคาร</h2>
            <small>{b.bank_name} · เลขที่บัญชี {b.account_no}{b.account_name ? ` · ${b.account_name}` : ''}</small>
            <small>รหัสบัญชี {b.code} · รายการธนาคารล่าสุด {lastDate ? dateTh(lastDate) : '-'} · พิมพ์ {dateTh(today)}</small></div>
        </div>

        <table className="sh-lines" style={{ marginTop: 18 }}><tbody>
          <Row t="ยอดคงเหลือตามรายงานธนาคาร (statement)" v={bankBal} strong />
          <tr><td colSpan={2} style={{ paddingTop: 8 }}><small>บวก: รายการรับในสมุดบัญชี ที่ธนาคารยังไม่ปรากฏ (เงินฝากระหว่างทาง)</small></td></tr>
          {inTransit.length === 0 && <tr><td colSpan={2} style={{ paddingLeft: 22 }}>-</td></tr>}
          {inTransit.map((i, k) => <Row key={k} indent t={`${dateTh(i.voucher_date)}  ${i.voucher_no}  ${i.memo ?? ''}`} v={Number(i.amount)} />)}
          <tr><td colSpan={2} style={{ paddingTop: 8 }}><small>หัก: รายการจ่ายในสมุดบัญชี ที่ธนาคารยังไม่ปรากฏ (เช็ค/โอนที่ยังไม่ผ่านธนาคาร)</small></td></tr>
          {outstanding.length === 0 && <tr><td colSpan={2} style={{ paddingLeft: 22 }}>-</td></tr>}
          {outstanding.map((i, k) => <Row key={k} indent t={`${dateTh(i.voucher_date)}  ${i.voucher_no}  ${i.memo ?? ''}`} v={Number(i.amount)} />)}
          <Row t="ยอดคงเหลือธนาคารหลังปรับปรุง" v={adjBank} strong />

          <tr><td colSpan={2} style={{ paddingTop: 22 }} /></tr>
          <Row t={`ยอดคงเหลือตามสมุดบัญชี (${b.code})`} v={bookAll} strong />
          <tr><td colSpan={2} style={{ paddingTop: 8 }}><small>บวก/หัก: รายการในธนาคารที่ยังไม่ได้จับคู่กับสมุดบัญชี (เช่น ดอกเบี้ย ค่าธรรมเนียม ที่ยังไม่บันทึก)</small></td></tr>
          {uLines.length === 0 && <tr><td colSpan={2} style={{ paddingLeft: 22 }}>-</td></tr>}
          {uLines.map((l, k) => <Row key={k} indent t={`${dateTh(l.line_date)}  ${l.description ?? ''}`} v={Number(l.amount)} />)}
          <Row t="ยอดคงเหลือสมุดบัญชีหลังปรับปรุง" v={adjBook} strong />

          <tr><td colSpan={2} style={{ paddingTop: 22 }} /></tr>
          <Row t="ผลต่างที่ยังอธิบายไม่ได้ (ธนาคารหลังปรับปรุง − สมุดบัญชีหลังปรับปรุง)" v={unexplained} strong />
        </tbody></table>
        {unexplained !== 0 && (
          <p className="sh-note">หมายเหตุ: ผลต่างนี้มักมาจากยอดยกมาของ statement กับสมุดบัญชีไม่เท่ากัน หรือ statement ที่นำเข้าไม่ครบช่วง ควรตรวจสอบก่อนอนุมัติ</p>)}
        <p className="sh-note"><small>จับคู่แล้ว {matchedLines} จาก {lines.length} รายการธนาคาร · รายการสมุดบัญชีที่ยังไม่จับคู่ {uItems.length} รายการ{batch ? ' · เฉพาะชุดข้อมูลที่เลือก' : ''}</small></p>

        <div className="sh-sign"><div><i />ผู้จัดทำ<br />วันที่ ____/____/______</div><div><i />ผู้ตรวจสอบ<br />วันที่ ____/____/______</div><div><i />ผู้อนุมัติ<br />วันที่ ____/____/______</div></div>
      </div>
    </>
  );
}
