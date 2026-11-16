import { describe, it, expect } from 'vitest';
import { buildRequest, parseResponse } from '../web/lib/rd-lookup';

const sample = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><ServiceResponse xmlns="https://rdws.rd.go.th/serviceRD3/vatserviceRD3"><ServiceResult>
<vNID><anyType>0105536000001</anyType><anyType>0105536000001</anyType></vNID>
<vtin><anyType>-</anyType><anyType>-</anyType></vtin>
<vtitleName><anyType>บริษัท</anyType><anyType>บริษัท</anyType></vtitleName>
<vName><anyType>ตัวอย่าง จำกัด</anyType><anyType>ตัวอย่าง จำกัด</anyType></vName>
<vSurname><anyType>-</anyType><anyType>-</anyType></vSurname>
<vBranchTitleName><anyType>-</anyType><anyType>สาขา</anyType></vBranchTitleName>
<vBranchName><anyType>-</anyType><anyType>บางนา</anyType></vBranchName>
<vBranchNumber><anyType>0</anyType><anyType>1</anyType></vBranchNumber>
<vBuildingName><anyType>-</anyType><anyType>-</anyType></vBuildingName>
<vFloorNumber><anyType>-</anyType><anyType>-</anyType></vFloorNumber>
<vVillageName><anyType>-</anyType><anyType>-</anyType></vVillageName>
<vRoomNumber><anyType>-</anyType><anyType>-</anyType></vRoomNumber>
<vHouseNumber><anyType>99/9</anyType><anyType>1 &amp; 2</anyType></vHouseNumber>
<vMooNumber><anyType>-</anyType><anyType>3</anyType></vMooNumber>
<vSoiName><anyType>สุขุมวิท 50</anyType><anyType>-</anyType></vSoiName>
<vStreetName><anyType>สุขุมวิท</anyType><anyType>บางนา-ตราด</anyType></vStreetName>
<vThambol><anyType>พระโขนง</anyType><anyType>บางนา</anyType></vThambol>
<vAmphur><anyType>คลองเตย</anyType><anyType>บางพลี</anyType></vAmphur>
<vProvince><anyType>กรุงเทพมหานคร</anyType><anyType>สมุทรปราการ</anyType></vProvince>
<vPostCode><anyType>10110</anyType><anyType>10540</anyType></vPostCode>
<vBusinessFirstDate><anyType>2020-01-01</anyType><anyType>2021-01-01</anyType></vBusinessFirstDate>
</ServiceResult></ServiceResponse></soap:Body></soap:Envelope>`;

describe('M14.6 ค้นกรมสรรพากร', () => {
  it('แยกผลตอบกลับเป็นสำนักงานใหญ่/สาขา พร้อมที่อยู่', () => {
    const r = parseResponse(sample);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ tax_id: '0105536000001', branch_code: '00000', name: 'บริษัท ตัวอย่าง จำกัด', postal_code: '10110' });
    expect(r[0].address).toBe('99/9 ซอยสุขุมวิท 50 ถนนสุขุมวิท แขวงพระโขนง เขตคลองเตย กรุงเทพมหานคร');
    expect(r[1].branch_code).toBe('00001');
    expect(r[1].address).toBe('1 & 2 หมู่ 3 ถนนบางนา-ตราด ตำบลบางนา อำเภอบางพลี จังหวัดสมุทรปราการ');
  });
  it('ผลว่างไม่พัง', () => { expect(parseResponse('<x/>')).toEqual([]); });
  it('สร้างคำขอ: เลข 13 หลักใส่ TIN, ชื่อใส่ Name (escape)', () => {
    expect(buildRequest('0105536000001')).toContain('<vat:TIN>0105536000001</vat:TIN><vat:Name></vat:Name>');
    expect(buildRequest('A&B')).toContain('<vat:Name>A&amp;B</vat:Name>');
  });
});
