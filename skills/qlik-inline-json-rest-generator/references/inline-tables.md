# INLINE tables

## Syntax

```
[Table]:
LOAD * INLINE [
a,b
1,x
] (delimiter is '\t', no labels, msq, embedded labels, utf8);
```

- **Enclosures:** `[ ]`, `` ` ` ``, `" "` or `' '`. The content is read like a text file. The first line sets the number of columns.
- **Safe format specs for INLINE:** `delimiter is 'c'` (single ASCII character; `'\t'` for tab), `embedded labels`, `no labels` (fields become `@1`, `@2`…), `msq`, `no quotes`, `fix`, `utf8`, `txt`.
- **Transforms:** a field list with expressions works: `Text(code) AS code`, `Replace(...) AS x`.
- **Mapping tables:** `MAPPING LOAD * INLINE [...]` needs exactly two columns.

## Escaping: what the generator does

1. **Delimiter.** It uses the first of `, \t ; |` that appears nowhere in the data or headers. If all of them appear, it uses `,` and tokenises commas.
2. **Enclosure.** It uses the first of `[ `` " '` whose closing character never appears. If none fits, it uses `[` and tokenises `]`.
   - `]]` doubling inside data worked on Qlik Cloud (Oct 2026), but community reports show it failing in older versions. Prefer switching enclosure.
3. **Tokens.** These substrings are swapped for `{#NAME#}` tokens and restored in the field list with `Replace(field, '{#NAME#}', <expr>)`:
   - `\r\n`, `\n`, `\r` → `Chr(13)&Chr(10)`, `Chr(10)`, `Chr(13)`
   - `$(` → `Chr(36)&'('`. Dollar expansion runs before the statement is parsed, even inside INLINE data.
   - boundary quotes (a value starting or ending with `"` or `'`) → `Chr(34)` / `Chr(39)`
   - forced delimiter or closing character → the character
4. **Header names** that would need a token switch the load to `(no labels)` with `@n AS [Name]`.
5. **Codes:** values like `007` or numbers over 15 digits get `Text()`, so they keep their exact text.
6. **Options:**
   - "Empty → null" wraps fields in `If(Len(x) = 0, Null(), x)`. This is local, unlike `SET NullInterpret`.
   - "Keep spaces" wraps the load in `SET Verbatim = 1;` … `SET Verbatim = 0;`.

## Verified behaviour (Qlik Cloud, Oct 2026)

- `;` inside INLINE data is kept. A line starting with `REM` is data. `//` is data, so URLs are fine.
- `(no quotes)` keeps literal quotes in values.
- Tab-delimited data from an Excel or Sheets paste loads with `(delimiter is '\t')`. A value like `1,234.50` keeps its text.
- A zero-row `LOAD … AUTOGENERATE 0` does create the table.
- Blank lines are skipped. A single-column table with empty values therefore loses those rows.

## Pitfalls

- **Auto-concatenation:** two INLINE tables with identical field names concatenate automatically. Use `NOCONCATENATE` or different names.
- **Size:** keep a script section under about 50,000 characters (Qlik's guideline). Upload a file for anything bigger.
- **Comments:** comments can't go inside INLINE. To drop comment rows, filter them in a resident load.

Sources:
- [Inline loads](https://help.qlik.com/en-US/cloud-services/Subsystems/Hub/Content/Sense_Hub/Scripting/inline-loads-qs.htm)
- [Quotes](https://help.qlik.com/en-US/cloud-services/Subsystems/Hub/Content/Sense_Hub/Scripting/FileSpecifiers/quotes.htm)
- [Dollar-sign expansion](https://help.qlik.com/en-US/cloud-services/Subsystems/Hub/Content/Sense_Hub/Scripting/dollar-sign-expansions.htm)
- Community: [brackets in inline data](https://community.qlik.com/t5/QlikView/Square-Brackets-inside-an-Inline-Load/td-p/1030900), [escaping `$(` in inline](https://community.qlik.com/t5/New-to-Qlik-Analytics/Escape-sign-in-Inline-Load/td-p/2022749)
