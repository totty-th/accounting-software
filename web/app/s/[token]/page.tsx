import { notFound } from 'next/navigation';
import { loadViewByToken, DOC_TITLE } from '@/lib/doc-view';
import { DocSheet } from '@/components/DocSheet';
import { PrintButton } from '@/components/ShareTools';

export const dynamic = 'force-dynamic';

// หน้าสาธารณะสำหรับลูกค้า (ไม่ต้องล็อกอิน) เข้าถึงด้วยรหัสลิงก์เท่านั้น
export async function generateMetadata({ params }: { params: { token: string } }) {
  const v = await loadViewByToken(params.token);
  return { title: v ? `${DOC_TITLE[v.doc.doc_type].title} ${v.doc.doc_no}` : 'ไม่พบเอกสาร', robots: { index: false, follow: false } };
}

export default async function Shared({ params, searchParams }: { params: { token: string }; searchParams: { c?: string } }) {
  const v = await loadViewByToken(params.token);
  if (!v) notFound();
  return (
    <div className="public">
      <div className="pub-bar noprint">
        <span>{v.company?.name}</span>
        <span className="acts"><PrintButton /><a className="btn" href={`/s/${params.token}/pdf`}>ดาวน์โหลด PDF</a></span>
      </div>
      <DocSheet v={v} copy={searchParams.c === '1'} />
    </div>
  );
}
