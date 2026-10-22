import type { ReactNode } from 'react';
export function Group({ title, color, count, children }: { title: string; color: string; count: number; children: ReactNode }) {
  return (
    <section className="group" style={{ ['--c' as any]: color }}>
      <div className="ghead"><span>{title}</span><small>{count} รายการ</small></div>
      <div className="board" style={{ ['--c' as any]: color }}>{children}</div>
    </section>
  );
}
