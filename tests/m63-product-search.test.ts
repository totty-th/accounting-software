import { describe, it, expect } from 'vitest';
import { matcher, hayOf, attrsOf, norm, attrOk } from '../web/lib/product-match';

const P = [
  { code: 'PS34C1.5X5P8A', name: "ตะแกรงแสตนเลสรูกลม SS304 หนา 1.5 มม. รู 5 มม. P8 ขนาด 4'x8'", category: 'ตะแกรงแสตนเลสรูกลม' },
  { code: 'PS34C0.8X1.5B', name: "ตะแกรงแสตนเลสรูกลม SS304 BHS หนา 0.8 มม. รู 1.5 มม. P2.5 ขนาด 5'x10'", category: 'ตะแกรงแสตนเลสรูกลม' },
  { code: 'PSCCH1X8', name: "ตะแกรงเหล็กรูกลม หนา 1.0 มม. รู 8 มม. (P12) ขนาด 4'x8'", category: 'ตะแกรงเหล็กรูกลม' },
  { code: 'PSCCH12X8', name: "ตะแกรงเหล็กรูกลม หนา 12 มม. รู 8 มม. ขนาด 4'x8'", category: 'ตะแกรงเหล็กรูกลม' },
  { code: 'PS34XXS32B', name: "ตะแกรงแสตนเลสฉีก SS304 XS-32 (CT20) ขนาด 5'x10'", category: 'ตะแกรงแสตนเลสฉีก' },
  { code: 'PSACH1X8', name: "ตะแกรงอลูมิเนียมรูกลม หนา 1 มม. รู 8 มม. ขนาด 4'x8'", category: 'ตะแกรงอลูมิเนียม' },
];
const find = (q: string) => { const m = matcher(q); return P.filter(p => m(hayOf(p))).map(p => p.code); };

describe('M63 ค้นหาสินค้าหลายคำ + คุณสมบัติจากชื่อ', () => {
  it('หลายคำ ลำดับใดก็ได้ · "หนา 1.5" เป็นคู่ ไม่ใช่เจอ 1.5 ที่รู', () => {
    expect(find('304 กลม หนา 1.5 รู 5')).toEqual(['PS34C1.5X5P8A']);
    expect(find('รู 5 หนา1.5 304')).toEqual(['PS34C1.5X5P8A']);
  });
  it('ตัวเลขเทียบเป็นค่า: 1 = 1.0 แต่ไม่ใช่ 12 · ไม่สน \' (4x8) · สแตนเลส = แสตนเลส · ค้นด้วยรหัส', () => {
    expect(find('เหล็ก หนา 1 รู 8')).toEqual(['PSCCH1X8']);
    expect(find('สแตนเลส ฉีก 5x10')).toEqual(['PS34XXS32B']);
    expect(find('pscch1x8')).toEqual(['PSCCH1X8']);
    expect(find('อลู 4x8')).toEqual(['PSACH1X8']);
    expect(norm("หนา 1.50 มม. 4'x8'")).toBe('หนา 1.5 มม. 4x8');
  });
  it('แยกคุณสมบัติ วัสดุ/ชนิดรู/หนา/ขนาดแผ่น และกรองได้', () => {
    expect(attrsOf(P[0].name)).toEqual({ material: 'SS304', hole: 'รูกลม', thick: '1.5', sheet: "4'x8'" });
    expect(attrsOf(P[4].name)).toEqual({ material: 'SS304', hole: 'ฉีก', thick: '', sheet: "5'x10'" });
    expect(attrsOf(P[5].name).material).toBe('อลูมิเนียม');
    expect(P.filter(p => attrOk(p.name, { material: 'เหล็ก', thick: '1' })).map(p => p.code)).toEqual(['PSCCH1X8']);
  });
});
