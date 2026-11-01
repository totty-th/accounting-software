export type SlipState = 'pending' | 'paid' | 'received' | 'cancelled';
export const SLIP_TH: Record<SlipState, string> = { pending: 'รอดำเนินการ', paid: 'ชำระเงินแล้ว', received: 'รับใบเสร็จแล้ว', cancelled: 'ยกเลิก' };
export const SLIP_COLOR: Record<SlipState, string> = { pending: 'var(--grey)', paid: 'var(--green)', received: 'var(--blue, #2980b9)', cancelled: 'var(--red, #c0392b)' };
