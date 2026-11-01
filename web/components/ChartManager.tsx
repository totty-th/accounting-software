'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createAccount, deleteAccount, updateAccount } from '@/lib/actions';

export type ChartNode = { id: string; code: string; name: string; name_en: string | null; description: string | null; description_en: string | null; parent_id: string | null; is_control: boolean; is_active: boolean; deletable: boolean };
type Form = { code: string; name: string; description: string; en: boolean; nameEn: string; descriptionEn: string; control: boolean; active: boolean };
const blank = (control: boolean): Form => ({ code: '', name: '', description: '', en: false, nameEn: '', descriptionEn: '', control, active: true });
// ค่าเริ่มต้นของ "สร้างเป็นบัญชีคุม": ติ๊กไว้เมื่อกลุ่มแม่อยู่ระดับบน (รหัสลงท้าย 000) · ที่เหลือเป็นบัญชีย่อย (สันนิษฐานจากที่เห็นใน FA)
const defaultControl = (parent: ChartNode) => /000$/.test(parent.code);

/** บริหารผังบัญชีแบบ FA: ต้นไม้ผังบัญชี (โฟลเดอร์ = บัญชีคุม · ใบ = บัญชีย่อย) ซ้าย · ฟอร์มสร้าง/แก้ไขขวา · "+ สร้างผังบัญชี" ใต้กลุ่มที่เปิดอยู่ */
export function ChartManager({ nodes }: { nodes: ChartNode[] }) {
  const r = useRouter();
  const [open, setOpen] = useState(false);
  const [exp, setExp] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<string | null>(null);          // บัญชีที่เลือกแก้ไข
  const [under, setUnder] = useState<string | null>(null);      // กลุ่มที่กำลังสร้างบัญชีใหม่ใต้มัน
  const [f, setF] = useState<Form>(blank(false));
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; title: string; lines?: string[] } | null>(null);
  const [confirm, setConfirm] = useState<'save' | 'delete' | null>(null);
  const [pending, start] = useTransition();
  const kids = useMemo(() => { const m = new Map<string | null, ChartNode[]>(); for (const n of nodes) { const k = n.parent_id; m.set(k, [...(m.get(k) ?? []), n]); } m.forEach(v => v.sort((a, b) => a.code.localeCompare(b.code))); return m; }, [nodes]);
  const byId = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);
  const cur = sel ? byId.get(sel) : null;
  const parent = under ? byId.get(under) : null;

  const pick = (n: ChartNode) => {
    setSel(n.id); setUnder(null); setMsg(null); setConfirm(null);
    setF({ code: n.code, name: n.name, description: n.description ?? '', en: !!(n.name_en || n.description_en), nameEn: n.name_en ?? '', descriptionEn: n.description_en ?? '', control: n.is_control, active: n.is_active });
    if (n.is_control) setExp(new Set(exp).add(n.id));
  };
  const create = (p: ChartNode) => { setSel(null); setUnder(p.id); setMsg(null); setF(blank(defaultControl(p))); };
  const toggle = (id: string) => { const s = new Set(exp); s.has(id) ? s.delete(id) : s.add(id); setExp(s); };
  const finish = (title: string) => { setMsg({ kind: 'ok', title }); r.refresh(); };

  const save = () => {
    if (!cur) {   // สร้างใหม่ (ไม่มีหน้าต่างยืนยัน)
      const miss = [!f.code.trim() && 'กรุณากรอกรหัสบัญชี', !f.name.trim() && 'กรุณากรอกชื่อบัญชี'].filter(Boolean) as string[];
      if (miss.length) return setMsg({ kind: 'err', title: 'ไม่สามารถบันทึกได้ เนื่องจากข้อมูลไม่ถูกต้อง/ไม่ครบถ้วน', lines: miss.map((m, i) => `${i + 1}. ${m}`) });
      start(async () => {
        const x = await createAccount({ code: f.code, name: f.name, description: f.description, parent: parent?.code ?? null, control: f.control, nameEn: f.en ? f.nameEn : '', descriptionEn: f.en ? f.descriptionEn : '' });
        if (x.error) return setMsg({ kind: 'err', title: 'บันทึกข้อมูลไม่สำเร็จ', lines: [x.error] });
        if (parent) setExp(new Set(exp).add(parent.id));
        setUnder(null); setF(blank(false)); finish('บันทึกข้อมูลสำเร็จ');
      });
    } else setConfirm('save');   // แก้ไข: ยืนยันก่อน
  };
  const doEdit = () => start(async () => {
    setConfirm(null);
    if (!f.name.trim()) return setMsg({ kind: 'err', title: 'ไม่สามารถบันทึกได้ เนื่องจากข้อมูลไม่ถูกต้อง/ไม่ครบถ้วน', lines: ['1. กรุณากรอกชื่อบัญชี'] });
    const x = await updateAccount({ id: cur!.id, name: f.name, description: f.description, active: f.active, nameEn: f.en ? f.nameEn : '', descriptionEn: f.en ? f.descriptionEn : '' });
    if (x.error) return setMsg({ kind: 'err', title: 'บันทึกข้อมูลไม่สำเร็จ', lines: [x.error] });
    finish('บันทึกข้อมูลสำเร็จ');
  });
  const doDelete = () => start(async () => {
    setConfirm(null);
    const x = await deleteAccount(cur!.id);
    if (x.error) return setMsg({ kind: 'err', title: 'ลบข้อมูลไม่สำเร็จ', lines: [x.error] });
    setSel(null); setF(blank(false)); finish('บันทึกข้อมูลสำเร็จ');
  });

  const Tree = ({ pid, depth }: { pid: string | null; depth: number }) => (
    <>{(kids.get(pid) ?? []).map(n => (
      <div key={n.id}>
        <div role="treeitem" aria-expanded={n.is_control ? exp.has(n.id) : undefined} tabIndex={0} onClick={() => { pick(n); if (n.is_control) toggle(n.id); }} onKeyDown={e => e.key === 'Enter' && pick(n)}
          style={{ paddingLeft: 8 + depth * 18, cursor: 'pointer', display: 'flex', gap: 6, padding: '3px 6px 3px ' + (8 + depth * 18) + 'px', background: sel === n.id ? 'var(--accent-soft, #e8eefc)' : undefined, opacity: n.is_active ? 1 : 0.55 }}>
          <span aria-hidden>{n.is_control ? (exp.has(n.id) ? '📂' : '📁') : '📄'}</span><span>{n.code} - {n.name}{n.is_active ? '' : ' (ปิดใช้งาน)'}</span></div>
        {n.is_control && exp.has(n.id) && <>
          <Tree pid={n.id} depth={depth + 1} />
          <div style={{ paddingLeft: 8 + (depth + 1) * 18 + 24, padding: `3px 6px 3px ${8 + (depth + 1) * 18 + 24}px` }}><button type="button" className="btn sm ghost" style={{ border: 'none', color: 'var(--accent, #3b5bdb)' }} onClick={() => create(n)}>+ สร้างผังบัญชี</button></div></>}
      </div>))}</>
  );

  if (!open) return <button className="btn" onClick={() => setOpen(true)}>บริหารผังบัญชี</button>;
  const title = cur ? 'แก้ไขผังบัญชี' : 'สร้างผังบัญชี';
  const crumb = cur ? `${cur.name} / แก้ไข` : `${f.name || 'สร้างใหม่'} / สร้างใหม่`;
  return (
    <div role="dialog" aria-modal="true" aria-label="บริหารผังบัญชี" style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,.45)', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div className="panel" style={{ width: 'min(920px, 100%)', height: 'min(640px, 92vh)', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 0, padding: 0, overflow: 'hidden', position: 'relative' }}>
        <div style={{ overflow: 'auto', padding: 12, borderRight: '1px solid var(--line, #ddd)' }} role="tree"><Tree pid={null} depth={0} /></div>
        <div style={{ display: 'flex', flexDirection: 'column', padding: 16, gap: 10, minHeight: 0, overflow: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><div><h2 style={{ margin: 0 }}>{title}</h2><div className="sub">{crumb}</div></div>
            <button className="btn sm ghost" aria-label="ปิด" onClick={() => { setOpen(false); r.refresh(); }}>✕</button></div>
          {!cur && !parent && <div className="sub">เลือกกลุ่มบัญชีทางซ้าย แล้วกด "+ สร้างผังบัญชี" หรือเลือกบัญชีเพื่อแก้ไข</div>}
          {(cur || parent) && <>
            <label className="f">รหัสบัญชี *<input value={f.code} disabled={!!cur} maxLength={9} inputMode="decimal" onChange={e => setF({ ...f, code: e.target.value.replace(/[^0-9.]/g, '') })} /></label>
            <label className="f">ชื่อบัญชี *<input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></label>
            <label className="f">คำอธิบายบัญชี<textarea rows={3} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={f.en} onChange={e => setF({ ...f, en: e.target.checked })} /> คำอธิบายภาษาอังกฤษ</label>
            {f.en && <><label className="f">ชื่อบัญชี (อังกฤษ)<input value={f.nameEn} onChange={e => setF({ ...f, nameEn: e.target.value })} /></label>
              <label className="f">คำอธิบายบัญชี (อังกฤษ)<textarea rows={3} value={f.descriptionEn} onChange={e => setF({ ...f, descriptionEn: e.target.value })} /></label></>}
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', opacity: cur ? 0.6 : 1 }}><input type="checkbox" style={{ width: 'auto' }} checked={f.control} disabled={!!cur} onChange={e => setF({ ...f, control: e.target.checked })} /> สร้างเป็นบัญชีคุม</label>
            {cur && !cur.is_control && <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={f.active} onChange={e => setF({ ...f, active: e.target.checked })} /> เปิดใช้งาน</label>}</>}
          {msg && <div role="alert" className={msg.kind === 'err' ? 'err' : 'ok'} style={{ borderLeft: `4px solid ${msg.kind === 'err' ? '#f5a623' : '#2f9e44'}`, padding: '6px 10px' }}><b>{msg.title}</b>{msg.lines?.map((l, i) => <div key={i} className="sub">{l}</div>)}</div>}
          <div style={{ flex: 1 }} />
          {(cur || parent) && <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {cur?.deletable && <button type="button" className="btn sm ghost" style={{ color: 'var(--red, #d6336c)', border: 'none' }} onClick={() => setConfirm('delete')}>🗑 ลบข้อมูล</button>}
            <span style={{ flex: 1 }} />
            <button className="btn ghost" onClick={() => { setSel(null); setUnder(null); setMsg(null); }}>ยกเลิก</button>
            <button className="btn" disabled={pending} onClick={save}>บันทึกข้อมูล</button></div>}
        </div>
        {confirm && <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.35)', display: 'grid', placeItems: 'center' }}>
          <div className="panel" role="alertdialog" style={{ width: 'min(440px, 92%)', display: 'grid', gap: 10, textAlign: 'center' }}>
            {confirm === 'save'
              ? <><h3 style={{ margin: 0 }}>คุณต้องการบันทึกข้อมูลหรือไม่</h3><p className="sub">การแก้ไขข้อมูลนี้ จะมีผลต่อรายการบัญชีที่เคยผ่านรายการบัญชีทั้งหมด รวมถึงเอกสารบัญชีที่เกี่ยวข้อง</p>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}><button className="btn ghost" onClick={() => setConfirm(null)}>ยกเลิก</button><button className="btn" onClick={doEdit}>บันทึก</button></div></>
              : <><h3 style={{ margin: 0 }}>ยืนยันการลบผังบัญชี</h3><p className="sub">คุณกำลังลบผังบัญชี, ต้องการดำเนินการต่อหรือไม่?</p>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}><button className="btn ghost" onClick={() => setConfirm(null)}>ปิด</button><button className="btn" style={{ background: 'var(--red, #d6336c)' }} onClick={doDelete}>ลบข้อมูล</button></div></>}
          </div></div>}
      </div>
    </div>
  );
}
