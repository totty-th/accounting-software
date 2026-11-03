import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getDb, today } from '@/lib/db';
import { SForm } from '@/components/SForm';
import { saveFiscalPeriod } from '@/lib/actions';

export const dynamic = 'force-dynamic';
const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
export default async function FiscalPeriod() {
  const user = await requirePage('settings.company');
  const c = (await (await getDb()).q<any>(`select fiscal_end_month m, founded_on::text f from company_profile`))[0];
  const m = c?.m ?? 12;
  const t = today(); const y = Number(t.slice(0, 4));
  // วันสิ้นงวดของรอบปัจจุบัน: สิ้นเดือน m ของปีที่ยังไม่ผ่าน
  const endThis = (yy: number) => new Date(Date.UTC(yy, m, 0)).toISOString().slice(0, 10);
  const end = endThis(y) >= t ? endThis(y) : endThis(y + 1);
  return (
    <>
      <div className="top"><div><h1>ตั้งค่างวดบัญชี</h1><p className="sub">เดือนสิ้นสุดรอบบัญชี และวันที่เริ่มจัดตั้งบริษัท</p></div></div>
      {!c ? <p className="empty">กรอกข้อมูลธุรกิจก่อน (ตั้งค่า → ข้อมูลธุรกิจ)</p> :
        <SForm action={saveFiscalPeriod} canWrite={can(user.role, 'settings.company')} style={{ maxWidth: 560 }}>
          <label>วันสิ้นงวดบัญชีปีปัจจุบัน <select name="end_month" defaultValue={String(m)}>{MONTHS.map((n, i) => <option key={n} value={i + 1}>สิ้นเดือน{n}</option>)}</select></label>
          <p className="sub">รอบปัจจุบันสิ้นสุด {end}</p>
          <label>วันที่เริ่มจัดตั้งบริษัท <input type="date" name="founded_on" defaultValue={c.f ?? ''} max={t} /></label>
        </SForm>}
    </>
  );
}
