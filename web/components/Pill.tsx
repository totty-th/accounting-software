import { STATUS } from '@/lib/status';
export function Pill({ s }: { s: string }) {
  const [label, tone] = STATUS[s] ?? [s, 'grey'];
  return <span className={`pill ${tone}`}>{label}</span>;
}
