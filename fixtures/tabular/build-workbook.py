# Writes workbook.xlsx: a hand-built Office Open XML workbook shaped like Excel's own output, used by
# tests/xlsx.test.ts. Standard library only. Run: python3 fixtures/tabular/build-workbook.py
import os
import zipfile

NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

files = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    '_rels/.rels': f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook {NS}><workbookPr/><sheets>'
    '<sheet name="Products" sheetId="1" r:id="rId1"/>'
    '<sheet name="Regions &amp; Codes" sheetId="2" r:id="rId2"/>'
    '<sheet name="Lookup" sheetId="3" state="hidden" r:id="rId3"/>'
    '</sheets></workbook>',
    'xl/_rels/workbook.xml.rels': f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    f'<Relationship Id="rId1" Type="{REL}/worksheet" Target="worksheets/sheet1.xml"/>'
    f'<Relationship Id="rId2" Type="{REL}/worksheet" Target="/xl/worksheets/sheet2.xml"/>'
    f'<Relationship Id="rId3" Type="{REL}/worksheet" Target="worksheets/sheet3.xml"/>'
    f'<Relationship Id="rId4" Type="{REL}/styles" Target="styles.xml"/>'
    f'<Relationship Id="rId5" Type="{REL}/sharedStrings" Target="sharedStrings.xml"/>'
    '</Relationships>',
    'xl/styles.xml': f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet {NS}>'
    '<numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy\\ hh:mm"/><numFmt numFmtId="165" formatCode="&quot;$&quot;#,##0.00"/></numFmts>'
    '<cellStyleXfs count="1"><xf numFmtId="14"/></cellStyleXfs>'
    '<cellXfs count="5"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/><xf numFmtId="164" applyNumberFormat="1"/><xf numFmtId="20" applyNumberFormat="1"/><xf numFmtId="165" applyNumberFormat="1"/></cellXfs>'
    '</styleSheet>',
    # 0 SKU, 1 Name, 2 Price, 3 Released, 4 Updated, 5 Active, 6 007, 7 Widget (rich text + phonetic), 8 Plug "3-pin"\nUK, 9 Total
    'xl/sharedStrings.xml': f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst {NS} count="10" uniqueCount="10">'
    '<si><t>SKU</t></si><si><t>Name</t></si><si><t>Price</t></si><si><t>Released</t></si><si><t>Updated</t></si><si><t>Active</t></si>'
    '<si><t>007</t></si>'
    '<si><r><rPr><b/></rPr><t>Wid</t></r><r><t>get</t></r><rPh sb="0" eb="1"><t>XX</t></rPh></si>'
    '<si><t xml:space="preserve">Plug "3-pin"\nUK</t></si>'
    '<si><t>Total</t></si>'
    '</sst>',
    'xl/worksheets/sheet1.xml': f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet {NS}><dimension ref="A1:G4"/><sheetData>'
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c><c r="F1" t="s"><v>5</v></c><c r="G1" t="s"><v>9</v></c></row>'
    '<row r="2"><c r="A2" t="s"><v>6</v></c><c r="B2" t="s"><v>7</v></c><c r="C2" s="4"><v>0.30000000000000004</v></c><c r="D2" s="1"><v>46326</v></c><c r="E2" s="2"><v>46326.5</v></c><c r="F2" t="b"><v>1</v></c><c r="G2"><f>C2*2</f><v>0.60000000000000009</v></c></row>'
    '<row r="3"><c r="A3" t="inlineStr"><is><t>A&amp;B_x000D_</t></is></c><c r="B3" t="s"><v>8</v></c><c r="C3"><v>12</v></c><c r="D3" s="1"/><c r="E3" s="3"><v>0.75</v></c><c r="F3" t="b"><v>0</v></c><c r="G3" t="e"><v>#DIV/0!</v></c></row>'
    '<row r="4"><c r="A4" t="str"><f>"x"&amp;"y"</f><v>xy</v></c><c r="C4"><v>-1.5E-3</v></c></row>'
    '</sheetData></worksheet>',
    # Data starts at B3 with an empty row in the middle, rows without r attributes on cells.
    'xl/worksheets/sheet2.xml': f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>'
    '<x:row r="3"><x:c r="B3" t="inlineStr"><x:is><x:t>Code</x:t></x:is></x:c><x:c r="C3" t="inlineStr"><x:is><x:t>Region</x:t></x:is></x:c></x:row>'
    '<x:row r="4"><x:c r="B4" t="inlineStr"><x:is><x:t>N</x:t></x:is></x:c><x:c r="C4" t="inlineStr"><x:is><x:t>North</x:t></x:is></x:c></x:row>'
    '<x:row r="5"/>'
    '<x:row r="6"><x:c r="B6" t="inlineStr"><x:is><x:t>S</x:t></x:is></x:c></x:row>'
    '</x:sheetData></x:worksheet>',
    'xl/worksheets/sheet3.xml': f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet {NS}><sheetData>'
    '<row><c t="inlineStr"><is><t>k</t></is></c><c t="inlineStr"><is><t>v</t></is></c></row>'
    '<row><c><v>1</v></c><c t="inlineStr"><is><t>one</t></is></c></row>'
    '</sheetData></worksheet>',
}

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'workbook.xlsx')
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for name, body in files.items():
        info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_STORED if name == '[Content_Types].xml' else zipfile.ZIP_DEFLATED
        z.writestr(info, body.encode('utf-8'))
print(out)
