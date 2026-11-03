import { requirePage } from '@/lib/auth';
import { SHORTCUTS, keyOf } from '@/lib/shortcuts';

export default async function ShortcutsPage() {
  await requirePage('reports.read');
  return (
    <>
      <div className="top"><div><h1>แป้นพิมพ์ลัด</h1><p className="sub">กด Alt + ตัวอักษร (Mac: ⌥ Option) ใช้ได้ทุกหน้าหลังเข้าสู่ระบบ</p></div></div>
      <table className="panel" style={{ maxWidth: 560 }}>
        <thead><tr><th>การทำงาน</th><th>ปุ่มลัด</th></tr></thead>
        <tbody>{SHORTCUTS.map(s => <tr key={s.id}><td>{s.label}</td><td><kbd>{keyOf(s).replace('Alt', 'Alt/⌥')}</kbd></td></tr>)}</tbody>
      </table>
    </>
  );
}
