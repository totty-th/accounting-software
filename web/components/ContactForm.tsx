'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveContact } from '@/lib/actions';

type V = Record<string, any>;
export const EMPTY: V = { person_kind: 'juristic', is_customer: true, is_vendor: false, is_foreign: false, branch: 'head' };

/** ฟอร์มผู้ติดต่อ (สร้าง/แก้) จัดกลุ่มตามต้นแบบ: ข้อมูลผู้ติดต่อ · รายละเอียดผู้ติดต่อ · ธนาคาร · ข้อมูลเพิ่มเติม */
export function ContactForm({ id, init, canSave }: { id: string | null; init: V; canSave: boolean }) {
  const router = useRouter();
  const [v, setV] = useState<V>({ ...EMPTY, ...init });
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: string, x: any) => setV(o => ({ ...o, [k]: x }));
  const t = (k: string, label: string, extra: { ph?: string; area?: boolean; type?: string } = {}) => (
    <label className="f">{label}
      {extra.area ? <textarea rows={3} disabled={!canSave} value={v[k] ?? ''} onChange={e => set(k, e.target.value)} />
        : <input type={extra.type ?? 'text'} disabled={!canSave} placeholder={extra.ph} value={v[k] ?? ''} onChange={e => set(k, e.target.value)} />}
    </label>);
  const ind = v.person_kind === 'individual';
  // ค้นจากฐานข้อมูลกรมสรรพากร (เลขผู้เสียภาษี/ชื่อ → เลือกสำนักงานใหญ่/สาขา แล้วเติมชื่อ ที่อยู่ ให้)
  const [rdQ, setRdQ] = useState(''); const [rdRows, setRdRows] = useState<any[] | null>(null); const [rdMsg, setRdMsg] = useState<string | null>(null); const [rdBusy, setRdBusy] = useState(false);
  const rdSearch = async () => {
    setRdBusy(true); setRdMsg(null); setRdRows(null);
    try {
      const r = await fetch(`/api/rd-lookup?q=${encodeURIComponent((rdQ || v.tax_id || '').trim())}`); const j = await r.json();
      if (!r.ok) setRdMsg(j.error ?? 'ค้นหาไม่สำเร็จ'); else if (!j.rows.length) setRdMsg('ไม่พบข้อมูล (กรมสรรพากรมีเฉพาะผู้จดทะเบียนภาษีมูลค่าเพิ่ม) กรุณากรอกเอง'); else setRdRows(j.rows);
    } catch { setRdMsg('ค้นหาไม่สำเร็จ กรุณาลองใหม่หรือกรอกเอง'); }
    setRdBusy(false);
  };
  const rdPick = (x: any) => {
    const head = x.branch_code === '00000';
    setV(o => ({ ...o, person_kind: 'juristic', business_name: x.name || o.business_name, tax_id: x.tax_id, branch: head ? 'head' : 'branch',
      branch_code: head ? '' : x.branch_code, address: x.address || o.address, postal_code: x.postal_code || o.postal_code }));
    setRdRows(null); setRdMsg(null);
  };
  const submit = () => start(async () => {
    const p = { ...v, branch_code: v.branch === 'branch' ? v.branch_code : '' };
    const r = await saveContact(id, p);
    if (r.error) return setErr(r.error);
    router.push('/contacts'); router.refresh();
  });
  return (
    <div>
      <div className="grid2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 16 }}>
        <section className="panel"><h3>ข้อมูลผู้ติดต่อ</h3>
          {canSave && <div className="f" style={{ marginBottom: 8 }}>ค้นหาจากฐานข้อมูลกรมสรรพากร
            <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <input style={{ flex: '1 1 200px' }} placeholder="เลขผู้เสียภาษี 13 หลัก" value={rdQ} onChange={e => setRdQ(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); rdSearch(); } }} />
              <button type="button" className="btn ghost" disabled={rdBusy} onClick={rdSearch}>{rdBusy ? 'กำลังค้นหา…' : 'ค้นหา'}</button></span>
            {rdMsg && <small role="alert">{rdMsg}</small>}
            {rdRows && <div style={{ border: '1px solid var(--line)', borderRadius: 6, maxHeight: 220, overflow: 'auto', marginTop: 6 }}>
              {rdRows.map((x, i) => <button type="button" key={i} className="btn ghost" style={{ display: 'block', width: '100%', textAlign: 'left', borderRadius: 0 }} onClick={() => rdPick(x)}>
                <b>{x.name}</b> · {x.tax_id} · {x.branch_code === '00000' ? 'สำนักงานใหญ่' : `สาขา ${x.branch_code}`}<br /><small>{x.address} {x.postal_code}</small></button>)}</div>}</div>}
          <div className="grid">
            <label className="f">ประเภทผู้ติดต่อ<select disabled={!canSave} value={v.person_kind} onChange={e => set('person_kind', e.target.value)}>
              <option value="juristic">นิติบุคคล</option><option value="individual">บุคคลธรรมดา</option></select></label>
            <div className="f">ประเภท
              <span><label><input type="checkbox" disabled={!canSave} checked={!!v.is_customer} onChange={e => set('is_customer', e.target.checked)} /> ลูกค้า</label>{' '}
                <label><input type="checkbox" disabled={!canSave} checked={!!v.is_vendor} onChange={e => set('is_vendor', e.target.checked)} /> ผู้จำหน่าย</label></span></div>
            {t('credit_days', 'เครดิต (วัน)', { type: 'number' })}
            <label className="f">ที่ตั้งธุรกิจ<select disabled={!canSave} value={v.is_foreign ? 'f' : 't'} onChange={e => set('is_foreign', e.target.value === 'f')}>
              <option value="t">ไทย</option><option value="f">ต่างประเทศ</option></select></label>
            {t('contact_code', 'รหัสผู้ติดต่อ')}
            {t('business_name', ind ? 'ชื่อ-นามสกุล' : 'ชื่อธุรกิจ', { ph: ind ? 'ตัวอย่าง: นางสาว ฟ้า โฟลว์แอคเคาท์' : 'ตัวอย่าง: บริษัท โฟลว์แอคเคาท์ จำกัด' })}
            {t('tax_id', ind ? 'เลขบัตรประชาชน' : 'เลขผู้เสียภาษี', { ph: 'ระบุเลข 10 - 13 หลัก' })}
            <label className="f">สำนักงาน/สาขา<select disabled={!canSave} value={v.branch} onChange={e => set('branch', e.target.value)}>
              <option value="head">สำนักงานใหญ่</option><option value="branch">สาขา</option></select></label>
            {v.branch === 'branch' && <>{t('branch_code', 'รหัสสาขา (5 หลัก)')}{t('branch_name', 'ชื่อสาขา')}</>}
            {t('address', 'ที่อยู่', { area: true })}{t('postal_code', 'รหัสไปรษณีย์')}{t('shipping_info', 'ข้อมูลจัดส่ง', { area: true })}
            {t('phone_office', 'เบอร์สำนักงาน')}{t('phone_fax', 'เบอร์โทรสาร')}{t('website', 'เว็บไซต์')}
          </div></section>
        <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <section className="panel"><h3>รายละเอียดผู้ติดต่อ</h3><div className="grid">
            {t('contact_name', 'ชื่อผู้ติดต่อ')}{t('person_email', 'อีเมล')}{t('person_mobile', 'เบอร์มือถือ')}</div></section>
          <section className="panel"><h3>ข้อมูลธนาคาร</h3><div className="grid">
            {t('bank_name', 'ธนาคาร')}{t('bank_account_name', 'ชื่อบัญชี')}{t('bank_account_no', 'เลขที่บัญชี')}{t('bank_branch', 'รหัสสาขา/ชื่อสาขา')}
            <label className="f">ประเภทบัญชี<select disabled={!canSave} value={v.bank_account_type ?? ''} onChange={e => set('bank_account_type', e.target.value)}>
              <option value="">-</option><option value="savings">ออมทรัพย์</option><option value="current">กระแสรายวัน</option></select></label>
            {v.is_foreign && <>{t('swift_code', 'Swift Code')}{t('bank_address', 'ที่อยู่ธนาคาร', { area: true })}</>}</div></section>
          <section className="panel"><h3>ข้อมูลเพิ่มเติม</h3>{t('note', 'โน้ต', { area: true })}</section>
        </div>
      </div>
      {err && <div className="toast" role="alert" onClick={() => setErr(null)}>{err}</div>}
      <div className="acts" style={{ justifyContent: 'flex-start', marginTop: 16 }}>
        {canSave && <button className="btn" disabled={pending} onClick={submit}>{pending ? '...' : 'บันทึกแล้วปิด'}</button>}
        <button className="btn ghost" onClick={() => router.push('/contacts')}>ปิดหน้าต่าง</button>
      </div>
    </div>
  );
}
