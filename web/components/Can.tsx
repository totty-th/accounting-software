'use client';
import { createContext, useContext } from 'react';
import { can, type Perm, type Role } from '@/lib/permissions';

const Ctx = createContext<Role | null>(null);
export const RoleProvider = ({ role, children }: { role: Role | null; children: React.ReactNode }) => <Ctx.Provider value={role}>{children}</Ctx.Provider>;
export const useRole = () => useContext(Ctx);
export const useCan = (perm: Perm) => can(useContext(Ctx), perm);
/** ซ่อนส่วนที่ผู้ใช้ไม่มีสิทธิ์ (การบังคับจริงอยู่ที่ server action ทุกครั้ง — นี่เป็นแค่ความสะดวก) */
export function Can({ perm, children }: { perm: Perm; children: React.ReactNode }) {
  return useCan(perm) ? <>{children}</> : null;
}
