import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { columnIndex, xlsxToText } from './xlsx-text';

async function workbook(parts: Record<string, string>) {
  const zip = new JSZip();
  for (const [path, xml] of Object.entries(parts)) zip.file(path, xml);
  return zip.generateAsync({ type: 'nodebuffer' });
}

const book = {
  'xl/workbook.xml':
    '<workbook xmlns:r="x"><sheets><sheet name="قیمت‌ها" sheetId="1" r:id="rId1"/><sheet name="Notes &amp; more" sheetId="2" r:id="rId2"/><sheet name="Empty" sheetId="3" r:id="rId3"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels':
    '<Relationships><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="t" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="t" Target="worksheets/sheet3.xml"/></Relationships>',
  'xl/sharedStrings.xml':
    '<sst><si><t>محصول</t></si><si><t>قیمت</t></si><si><r><t>اشتراک </t></r><r><t>ویژه</t></r></si><si><t>a,"b"</t></si></sst>',
  'xl/worksheets/sheet1.xml':
    '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1500000</v></c><c r="D2" t="b"><v>1</v></c></row><row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>',
  'xl/worksheets/sheet2.xml':
    '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>x &lt; y</t></is></c></row></sheetData></worksheet>',
  'xl/worksheets/sheet3.xml': '<worksheet><sheetData/></worksheet>',
};

describe('xlsxToText (docs/77 phase 4)', () => {
  it('reads every sheet in order with shared, rich, inline, boolean and formula cells', async () => {
    const text = await xlsxToText(await workbook(book));
    expect(text).toBe(
      [
        '## قیمت‌ها',
        'محصول,قیمت',
        'اشتراک ویژه,1500000,,TRUE',
        '"a,""b""",2',
        '',
        '## Notes & more',
        'x < y',
      ].join('\n'),
    );
  });

  it('refuses a zip that is not a workbook', async () => {
    await expect(xlsxToText(await workbook({ 'a.txt': 'hi' }))).rejects.toThrow(/Excel/);
    await expect(xlsxToText(Buffer.from('not a zip'))).rejects.toThrow();
  });

  it('turns column letters into indexes', () => {
    expect([columnIndex('A1'), columnIndex('Z9'), columnIndex('AA1'), columnIndex('AB12')]).toEqual(
      [0, 25, 26, 27],
    );
  });
});
