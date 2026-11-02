'use client';
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { uploadAssetFile, removeAssetFile } from '@/lib/actions';

type F = { id: string; filename: string; mime: string; size: number };
/** แนบเอกสาร/รูปภาพ (ตาม FA: คลิกหรือลากไฟล์ → อัปโหลดทันที · รูปย่อ+ชื่อไฟล์+ปุ่ม ×) */
export function AssetFiles({ id, files, canWrite, queue, setQueue }: { id?: string; files: F[]; canWrite: boolean; queue?: File[]; setQueue?: (f: File[]) => void }) {
  const ref = useRef<HTMLInputElement>(null); const r = useRouter();
  const [m, setM] = useState<string | null>(null); const [p, st] = useTransition(); const [over, setOver] = useState(false);
  const send = (list: FileList | null) => {
    if (!list?.length) return;
    if (!id) { // ยังไม่มีสินทรัพย์ (หน้าสร้างใหม่): เก็บไว้ก่อน อัปโหลดหลังบันทึก
      const next = [...(queue ?? []), ...Array.from(list)];
      if (next.length > 5) return setM('แนบไฟล์ได้สูงสุด 5 ไฟล์ต่อสินทรัพย์');
      if (next.some(x => x.size > 5 * 1024 * 1024)) return setM('ไฟล์ใหญ่เกิน 5 MB');
      setQueue?.(next); if (ref.current) ref.current.value = ''; return;
    }
    st(async () => {
      for (const file of Array.from(list)) {
        const f = new FormData(); f.set('id', id!); f.set('file', file);
        const res = await uploadAssetFile(f); if (res.error) { setM(res.error); break; }
      }
      if (ref.current) ref.current.value = ''; r.refresh();
    });
  };
  return (<div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
      {canWrite && <div role="button" tabIndex={0} aria-label="เลือกไฟล์แนบ" onClick={() => ref.current?.click()} onKeyDown={e => e.key === 'Enter' && ref.current?.click()}
        onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={e => { e.preventDefault(); setOver(false); send(e.dataTransfer.files); }}
        style={{ width: 150, height: 150, border: '1px dashed var(--line, #bbb)', borderRadius: 6, display: 'grid', placeItems: 'center', textAlign: 'center', cursor: 'pointer', padding: 8,
          background: over ? 'var(--hover, #eef)' : undefined }}>
        <span className="sub">{p ? 'กำลังอัปโหลด...' : 'คลิกเพื่อเลือกไฟล์ หรือลากและวางไฟล์ที่นี่'}</span></div>}
      <input ref={ref} type="file" multiple hidden onChange={e => send(e.target.files)} />
      {(queue ?? []).map((q, i) => (<div key={`q${i}`} style={{ width: 150, border: '1px solid var(--line, #ddd)', borderRadius: 6, padding: 6, position: 'relative' }}>
        {q.type.startsWith('image/') ? <img src={URL.createObjectURL(q)} alt={q.name} style={{ width: '100%', height: 110, objectFit: 'cover', borderRadius: 4 }} />
          : <div style={{ height: 110, display: 'grid', placeItems: 'center' }} className="sub">{q.name.split('.').pop()?.toUpperCase()}</div>}
        <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.name}</div><div className="sub">{Math.ceil(q.size / 1024)} KB</div>
        <button type="button" className="btn sm danger" aria-label={`ลบ ${q.name}`} style={{ position: 'absolute', top: 4, right: 4 }} onClick={() => setQueue?.((queue ?? []).filter((_, j) => j !== i))}>×</button></div>))}
      {files.map(f => (<div key={f.id} style={{ width: 150, border: '1px solid var(--line, #ddd)', borderRadius: 6, padding: 6, position: 'relative' }}>
        <a href={`/assets/file/${f.id}?dl=1`} title={f.filename}>
          {f.mime.startsWith('image/') ? <img src={`/assets/file/${f.id}`} alt={f.filename} style={{ width: '100%', height: 110, objectFit: 'cover', borderRadius: 4 }} />
            : <div style={{ height: 110, display: 'grid', placeItems: 'center' }} className="sub">{f.filename.split('.').pop()?.toUpperCase()}</div>}
          <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.filename}</div></a>
        <div className="sub">{Math.ceil(f.size / 1024)} KB</div>
        {canWrite && <button className="btn sm danger" aria-label={`ลบ ${f.filename}`} disabled={p} style={{ position: 'absolute', top: 4, right: 4 }}
          onClick={() => st(async () => { const res = await removeAssetFile(id!, f.id); if (res.error) setM(res.error); else r.refresh(); })}>×</button>}
      </div>))}
    </div>
    {!files.length && !canWrite && <p className="sub">ยังไม่มีไฟล์แนบ</p>}
    {m && <div className="toast" role="alert" onClick={() => setM(null)}>{m}</div>}
  </div>);
}
