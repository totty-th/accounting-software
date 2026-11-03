import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getDb } from '@/lib/db';
import { SForm } from '@/components/SForm';
import { savePaymentInfo, removePaymentInfo } from '@/lib/actions';

export const dynamic = 'force-dynamic';
const KIND: Record<string, string> = { cash: 'เงินสด', transfer: 'โอนเงิน', cheque: 'เช็ค' };
function Fields({ r }: { r?: any }) {
  return (<>
    {r?.id && <input type="hidden" name="id" value={r.id} />}
    <label>ประเภท <select name="kind" defaultValue={r?.kind ?? 'transfer'}>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
    <label>ธนาคาร (โอนเงิน) <input name="bank" defaultValue={r?.bank ?? ''} /></label>
    <label>เลขที่บัญชี <input name="account_no" defaultValue={r?.account_no ?? ''} /></label>
    <label>ชื่อบัญชี <input name="account_name" defaultValue={r?.account_name ?? ''} /></label>
    <label>สาขา <input name="branch" defaultValue={r?.branch ?? ''} /></label>
    <label>สั่งจ่ายเช็คในนาม (เช็ค) <input name="cheque_payee" defaultValue={r?.cheque_payee ?? ''} /></label>
    <label>หมายเหตุ <input name="remark" maxLength={300} defaultValue={r?.remark ?? ''} /></label>
    <label>QR Code {r?.qr_img && <img alt="QR" src={r.qr_img} style={{ height: 48, verticalAlign: 'middle' }} />} <input type="file" name="qr" accept="image/png,image/jpeg" /></label>
    <label>สถานะ <select name="is_active" defaultValue={r?.is_active === false ? '0' : '1'}><option value="1">ใช้งาน</option><option value="0">ไม่ใช้งาน</option></select></label>
  </>);
}
export default async function PaymentInfo() {
  const user = await requirePage('settings.company'); const w = can(user.role, 'settings.company');
  const rows = await (await getDb()).q<any>('select * from payment_infos order by sort_no, created_at');
  return (
    <>
      <div className="top"><div><h1>ข้อมูลการรับชำระ</h1><p className="sub">แสดงท้ายเอกสารขายที่รอรับชำระ (ใบเสนอราคา ใบแจ้งหนี้ ใบวางบิล) เฉพาะรายการที่ใช้งาน</p></div></div>
      <div style={{ display: 'grid', gap: 10, maxWidth: 720 }}>
        {rows.map(r => <div key={r.id} className="panel" style={{ padding: 12 }}>
          <SForm action={savePaymentInfo} className="" style={{ padding: 0 }} canWrite={w}><Fields r={r} /></SForm>
          {w && <SForm action={removePaymentInfo} className="" style={{ padding: 0, marginTop: 6 }} label="ลบ" danger><input type="hidden" name="id" value={r.id} /></SForm>}
        </div>)}
        {w && <div className="panel" style={{ padding: 12 }}><h3>เพิ่มช่องทางรับชำระ</h3><SForm action={savePaymentInfo} className="" style={{ padding: 0 }} label="เพิ่ม"><Fields /></SForm></div>}
      </div>
    </>
  );
}
