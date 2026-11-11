// Shared helpers for emitting Qlik load script.

/** Square-bracket field/table reference. Only `]` needs escaping (doubled). */
export function ref(name: string): string {
  return `[${name.replace(/]/g, ']]')}]`;
}

const RESERVED = new Set(
  'and as by distinct from group having inline is join keep like load mapping not or order resident select sql table to where with xor'.split(' '),
);

/** Field reference that only brackets when needed, for readable output. */
export function field(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !RESERVED.has(name.toLowerCase()) ? name : ref(name);
}

/** Table label, e.g. `[Orders]:` */
export function label(name: string): string {
  return `${ref(name)}:`;
}

/**
 * Single-quoted string literal for use in a script expression.
 * `'` is doubled; `$(` is split so dollar-sign expansion cannot fire.
 */
export function str(s: string): string {
  return `'${s.replace(/'/g, "''").split('$(').join(`' & Chr(36) & '(`)}'`;
}

/** Escape one key for an RFC 6901 JSON pointer segment. */
export function pointerSegment(key: string): string {
  return key.replace(/~/g, '~0').replace(/\//g, '~1');
}

/** A safe table name derived from free text. */
export function tableName(s: string, fallback = 'Table'): string {
  const t = s.trim().replace(/[\[\]"'`;]/g, '').replace(/\s+/g, '_');
  return t || fallback;
}

/** Make names unique: Name, Name_2, Name_3 ... Blank names become Field1, Field2 ... */
export function uniqueNames(names: string[], fallback = 'Field'): string[] {
  const used = new Set<string>();
  return names.map((raw, i) => {
    const base = raw.trim() || `${fallback}${i + 1}`;
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base}_${n}`;
    used.add(name);
    return name;
  });
}

export const SECTION_SOFT_LIMIT = 50_000;
export const JSON_FIELD_LIMIT = 5_000;
export const JSON_TABLE_LIMIT = 1_000;
