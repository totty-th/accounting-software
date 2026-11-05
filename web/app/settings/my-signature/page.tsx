import { currentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db';
import * as A from '@/lib/actions';

export const dynamic = 'force-dynamic';
// ลายเซ็นของผู้ใช้แต่ละคน: ใช้บนเอกสารขายที่ผู้ใช้นั้นเป็นผู้สร้าง (พนักงานขาย) · ทุกบทบาทตั้งของตัวเองได้
export default async function MySignature() {
  const u = await currentUser(); if (!u) redirect('/login');
  const r = (await (await getDb()).q<any>('select signature_img from app_users where id=$1', [u.id]))[0];
  return (
    <>
      <div className="top"><div><h1>ลายเซ็นของฉัน</h1>
        <p className="sub">ลายเซ็นของ {u.displayName} จะแสดงในช่องผู้อนุมัติ/พนักงานขายของเอกสารขายที่คุณเป็นผู้สร้าง · ไฟล์ PNG (พื้นหลังโปร่งใสจะสวยที่สุด) หรือ JPG ไม่เกิน 600 KB</p></div></div>
      <form action={A.saveMySignature} className="panel" style={{ display: 'grid', gap: 10, padding: 16, maxWidth: 520 }}>
        {r?.signature_img ? <img alt="ลายเซ็นปัจจุบัน" src={r.signature_img} style={{ maxHeight: 90, maxWidth: 260, objectFit: 'contain', background: '#fff', border: '1px solid var(--line)', padding: 6 }} /> : <p className="sub">ยังไม่ได้อัปโหลดลายเซ็น</p>}
        <label>ไฟล์ลายเซ็นใหม่ <input type="file" name="signature" accept="image/png,image/jpeg" /></label>
        <div className="acts" style={{ justifyContent: 'flex-start' }}>
          <button className="btn">บันทึก</button>
          {r?.signature_img && <button className="btn ghost" name="clear" value="1" formNoValidate>ลบลายเซ็น</button>}
        </div>
      </form>
    </>
  );
}
