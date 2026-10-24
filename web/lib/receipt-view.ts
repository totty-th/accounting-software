import { getDb } from './db';
import type { ReceiptView } from '@/components/ReceiptSheet';

export async function loadReceiptView(id: string | null | undefined): Promise<ReceiptView | null> {
  if (!id) return null;
  const db = await getDb();
  return (await db.q<{ v: ReceiptView }>('select receipt_view($1) as v', [id]))[0]?.v ?? null;
}
export async function receiptIdByNo(no: string): Promise<string | null> {
  const db = await getDb();
  return (await db.q<{ id: string }>('select id from receipts where receipt_no=$1', [no]))[0]?.id ?? null;
}
export async function receiptIdByToken(token: string): Promise<string | null> {
  const db = await getDb();
  return (await db.q<{ id: string | null }>('select receipt_by_token($1) as id', [token]))[0]?.id ?? null;
}
