import { apiUser } from '@/lib/auth';
import { lookupRd, lookupAllBranches } from '@/lib/rd-lookup';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 25;

// GET /api/rd-lookup?q=<เลขผู้เสียภาษี 13 หลัก หรือชื่อ> → รายการสำนักงานใหญ่/สาขาจากฐานข้อมูลกรมสรรพากร (ต้องล็อกอิน และเพิ่ม/แก้ผู้ติดต่อได้)
// เพิ่ม &debug=1 เพื่อดู XML ดิบ ใช้ตรวจเวลากรมสรรพากรเปลี่ยนรูปแบบ
export async function GET(req: Request) {
  const au = await apiUser(['contact.create', 'master.write', 'master.read']); if (au instanceof Response) return au;
  const sp = new URL(req.url).searchParams;
  try {
    const q = sp.get('q') ?? '', br = sp.get('branch');
    // ไม่ระบุ branch = ค้นทุกสาขา; ระบุ branch = สาขานั้นสาขาเดียว (0 = สำนักงานใหญ่)
    const { rows, raw } = br === null || br === '' ? { rows: await lookupAllBranches(q), raw: undefined } : await lookupRd(q, Number(br));
    return Response.json({ rows, ...(sp.get('debug') === '1' || !rows.length ? { raw: raw?.slice(0, 6000) } : {}) });
  } catch (e: any) {
    const m = String(e?.name) === 'TimeoutError' ? 'กรมสรรพากรไม่ตอบกลับ (หมดเวลา) กรุณาลองใหม่หรือกรอกเอง' : String(e?.message ?? e);
    return Response.json({ error: m }, { status: 502 });
  }
}
