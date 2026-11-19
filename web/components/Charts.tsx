// กราฟสำหรับหน้าภาพรวม: เรนเดอร์ฝั่งเซิร์ฟเวอร์เป็น SVG/HTML ล้วน (ไม่ใช้ไลบรารีเพิ่ม) · เลื่อนเมาส์ดูค่าได้จาก title
// สี: อ้างอิงจาก CSS ตัวแปร --dv-* (ชุดสีหมวดหมู่ที่ผ่านการตรวจ CVD แล้ว มีค่าแยกโหมดมืด)
import type { ReactNode } from 'react';

const nf0 = (n: number) => Math.round(n).toLocaleString('th-TH');
const nf2 = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const TH_MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export const monLabel = (ym: string) => `${TH_MON[Number(ym.slice(5, 7)) - 1]} ${String(Number(ym.slice(0, 4)) + 543).slice(2)}`;

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

export interface Series { key: string; name: string; color: string; values: number[] }

/** แท่งคู่รายเดือน (รายได้ vs ค่าใช้จ่าย) พร้อมเส้นฐาน กริดจาง และคำอธิบายสี */
export function Columns({ labels, series, height = 240, line }: { labels: string[]; series: Series[]; height?: number; line?: Series }) {
  const W = 680, H = height, L = 64, R = 10, T = 12, B = 30;
  const all = [...series, ...(line ? [line] : [])];
  const max = niceMax(Math.max(0, ...all.flatMap(s => s.values)));
  const min = Math.min(0, ...all.flatMap(s => s.values));
  const lo = min < 0 ? -niceMax(-min) : 0;
  const y = (v: number) => T + (H - T - B) * (1 - (v - lo) / (max - lo));
  const gw = (W - L - R) / labels.length;
  const bw = Math.min(26, (gw - 10) / series.length - 2);
  const ticks = [0, 1, 2, 3, 4].map(i => lo + ((max - lo) * i) / 4);
  return (
    <div className="dv-chart">
      <div className="dv-legend">{series.map(s => <span key={s.key}><i style={{ background: s.color }} />{s.name}</span>)}
        {line && <span><i className="ln" style={{ background: line.color }} />{line.name}</span>}</div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={series.map(s => s.name).join(' เทียบ ')} className="dv-svg">
        {ticks.map(t => (
          <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className={t === 0 ? 'dv-base' : 'dv-grid'} />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" className="dv-axis">{nf0(t)}</text></g>))}
        {labels.map((lb, i) => {
          const cx = L + gw * i + gw / 2, x0 = cx - (bw * series.length + 2 * (series.length - 1)) / 2;
          return (
            <g key={lb}>
              <rect x={L + gw * i} y={T} width={gw} height={H - T - B} fill="transparent"><title>{`${lb}\n${all.map(s => `${s.name}: ${nf2(s.values[i])}`).join('\n')}`}</title></rect>
              {series.map((s, k) => {
                const v = s.values[i], top = y(Math.max(v, 0)), h = Math.max(Math.abs(y(v) - y(0)), v !== 0 ? 2 : 0);
                return <rect key={s.key} x={x0 + k * (bw + 2)} y={v >= 0 ? top : y(0)} width={bw} height={h} rx={3} fill={s.color} style={{ pointerEvents: 'none' }} />;
              })}
              <text x={cx} y={H - 10} textAnchor="middle" className="dv-axis">{lb}</text>
            </g>);
        })}
        {line && <g style={{ pointerEvents: 'none' }}>
          <polyline fill="none" stroke={line.color} strokeWidth={2} strokeLinejoin="round" points={line.values.map((v, i) => `${L + gw * i + gw / 2},${y(v)}`).join(' ')} />
          {line.values.map((v, i) => <circle key={i} cx={L + gw * i + gw / 2} cy={y(v)} r={4} fill={line.color} stroke="var(--surface)" strokeWidth={2} />)}</g>}
      </svg>
    </div>
  );
}

/** เส้นแนวโน้มย่อ (ไม่มีแกน) ใช้ประกอบตัวเลขหลัก */
export function Spark({ values, color, label }: { values: number[]; color: string; label: string }) {
  if (values.length < 2 || values.every(v => v === 0)) return <div className="db-spark none" aria-hidden />;
  const W = 100, H = 30, lo = Math.min(0, ...values), hi = Math.max(0, ...values), span = hi - lo || 1;
  const x = (i: number) => (i / (values.length - 1)) * W, y = (v: number) => 2 + (H - 4) * (1 - (v - lo) / span);
  const pts = values.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ');
  return (
    <svg className="db-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <polygon points={`0,${y(0)} ${pts} ${W},${y(0)}`} fill={color} opacity={0.16} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>);
}

/** วงแหวนสัดส่วนค่าเดียว (เช่น อัตราเก็บเงิน) */
export function Ring({ pct, color, caption }: { pct: number | null; color: string; caption: string }) {
  const r = 52, c = 2 * Math.PI * r, v = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <svg className="db-ring" viewBox="0 0 132 132" role="img" aria-label={`${caption} ${pct == null ? 'ไม่มีข้อมูล' : pct.toFixed(0) + '%'}`}>
      <circle cx={66} cy={66} r={r} fill="none" stroke="var(--hover)" strokeWidth={13} />
      {v > 0 && <circle cx={66} cy={66} r={r} fill="none" stroke={color} strokeWidth={13} strokeLinecap="round"
        strokeDasharray={`${(c * v) / 100} ${c}`} transform="rotate(-90 66 66)" />}
      <text x={66} y={64} textAnchor="middle" className="db-ring-v">{pct == null ? '–' : `${v.toFixed(0)}%`}</text>
      <text x={66} y={84} textAnchor="middle" className="db-ring-c">{caption}</text>
    </svg>);
}

/** แถบเดียวแบ่งส่วน (เช่น อายุหนี้) พร้อมคำอธิบายสี */
export function Stack({ items, legend = true, empty = 'ไม่มียอดค้าง' }: { items: Bar[]; legend?: boolean; empty?: string }) {
  const sum = items.reduce((a, b) => a + Math.max(0, b.value), 0);
  if (sum <= 0) return <div className="db-stack-empty">{empty}</div>;
  const on = items.filter(i => i.value > 0);
  return (
    <div>
      <div className="db-stack" role="img" aria-label={on.map(i => `${i.label} ${nf2(i.value)}`).join(', ')}>
        {on.map(i => <span key={i.label} title={`${i.label}: ${nf2(i.value)} (${((i.value / sum) * 100).toFixed(0)}%)`} style={{ flexGrow: i.value, background: i.color }} />)}</div>
      {legend && <ul className="db-stack-lg">{on.map(i => <li key={i.label}><i style={{ background: i.color }} /><span>{i.label}</span><b>{nf2(i.value)}</b></li>)}</ul>}
    </div>);
}

export interface Bar { label: string; value: number; color?: string; note?: string; href?: string }

/** แท่งแนวนอนเรียงลำดับ พร้อมค่าและสัดส่วน (ใช้แทนวงกลมเมื่อมีหมวดมากกว่า 4) */
export function HBars({ items, color = 'var(--dv-1)', total, empty = 'ไม่มีข้อมูลในช่วงนี้', showPct = true }:
  { items: Bar[]; color?: string; total?: number; empty?: string; showPct?: boolean }) {
  const sum = total ?? items.reduce((a, b) => a + Math.max(0, b.value), 0);
  const max = Math.max(1, ...items.map(i => i.value));
  if (items.length === 0 || items.every(i => i.value === 0)) return <div className="empty sm">{empty}</div>;
  return (
    <ul className="dv-bars">
      {items.map(it => {
        const pct = sum > 0 ? (it.value / sum) * 100 : 0;
        const label: ReactNode = it.href ? <a href={it.href}>{it.label}</a> : it.label;
        return (
          <li key={it.label} title={`${it.label}: ${nf2(it.value)}${showPct ? ` (${pct.toFixed(1)}%)` : ''}`}>
            <div className="dv-bl"><span className="dv-name">{label}</span><span className="dv-val">{nf2(it.value)}{showPct && <small>{pct.toFixed(0)}%</small>}</span></div>
            <div className="dv-track"><div className="dv-fill" style={{ width: `${Math.max(1.5, (Math.max(0, it.value) / max) * 100)}%`, background: it.color ?? color }} /></div>
            {it.note && <div className="dv-note">{it.note}</div>}
          </li>);
      })}
    </ul>
  );
}

/** กล่องข้อมูลตัวเลขหลัก: ค่า + เทียบช่วงก่อนหน้า (ลูกศร+ข้อความ ไม่พึ่งสีอย่างเดียว) */
export function Kpi({ label, value, sub, delta, good = 'up', accent, href }:
  { label: string; value: string; sub?: ReactNode; delta?: number | null; good?: 'up' | 'down'; accent: string; href?: string }) {
  const has = delta != null && isFinite(delta);
  const up = has && delta! > 0, flat = has && Math.abs(delta!) < 0.05;
  const isGood = has && !flat && (good === 'up' ? up : !up);
  const body = (
    <>
      <span>{label}</span><b>{value}</b>
      {has && <div className={`dv-delta ${flat ? 'flat' : isGood ? 'ok' : 'bad'}`}>{flat ? '▬ ไม่เปลี่ยนแปลง' : `${up ? '▲' : '▼'} ${Math.abs(delta!).toFixed(1)}%`}<small> เทียบช่วงก่อนหน้า</small></div>}
      {sub && <div className="dv-sub">{sub}</div>}
    </>);
  return href ? <a className="card kpi" href={href} style={{ ['--c' as any]: accent }}>{body}</a> : <div className="card kpi" style={{ ['--c' as any]: accent }}>{body}</div>;
}
