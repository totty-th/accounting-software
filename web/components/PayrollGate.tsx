import Link from 'next/link';
/** แสดงเมื่อโมดูลเงินเดือนยังไม่เปิดใช้ */
export function PayrollOff() {
  return (
    <div className="panel" style={{ maxWidth: 560 }}>
      <h1 style={{ marginTop: 0 }}>โมดูลเงินเดือนยังไม่เปิดใช้</h1>
      <p className="sub">เงินเดือนเป็นโมดูลเสริม ไม่บังคับใช้ · เปิดได้ที่ <Link href="/settings/modules">ตั้งค่า › โมดูลเสริม</Link></p>
    </div>
  );
}
