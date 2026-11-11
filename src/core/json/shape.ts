import { isObject, type Json } from '../parse/json';

export type Kind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

/** Merged structure of one or more JSON samples. */
export interface Shape {
  kinds: Set<Kind>;
  /** Object members, in first-seen order. */
  props?: Map<string, Shape>;
  /** Merged array element shape. */
  items?: Shape;
  /** How many values were merged into this node. */
  count: number;
  /** Max array length seen (arrays only). */
  maxLen?: number;
  /** A string value that itself parses as a JSON object/array (double-encoded JSON). */
  jsonInString?: boolean;
}

export function kindOf(v: Json): Kind {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v === 'object' ? 'object' : (typeof v as Kind);
}

function empty(): Shape {
  return { kinds: new Set(), count: 0 };
}

export function addSample(shape: Shape, v: Json): Shape {
  shape.count++;
  const k = kindOf(v);
  shape.kinds.add(k);
  if (k === 'object') {
    shape.props ??= new Map();
    for (const [key, child] of Object.entries(v as Record<string, Json>)) {
      if (!shape.props.has(key)) shape.props.set(key, empty());
      addSample(shape.props.get(key)!, child);
    }
  } else if (k === 'array') {
    const arr = v as Json[];
    shape.maxLen = Math.max(shape.maxLen ?? 0, arr.length);
    shape.items ??= empty();
    for (const el of arr) addSample(shape.items, el);
  } else if (k === 'string' && /^\s*[\[{]/.test(v as string)) {
    try {
      const inner = JSON.parse(v as string);
      if (typeof inner === 'object' && inner !== null) shape.jsonInString = true;
    } catch {
      /* not JSON */
    }
  }
  return shape;
}

export function shapeOf(...samples: Json[]): Shape {
  const s = empty();
  for (const v of samples) addSample(s, v);
  return s;
}

/** Kinds other than null. */
export function realKinds(s: Shape): Kind[] {
  return [...s.kinds].filter((k) => k !== 'null');
}

export const isScalarShape = (s: Shape) => realKinds(s).every((k) => k !== 'object' && k !== 'array');

/** An array whose elements are all arrays (a `[][]` matrix). */
export function isMatrix(s: Shape): boolean {
  return !!s.items && realKinds(s.items).length > 0 && realKinds(s.items).every((k) => k === 'array');
}

/** First row of a matrix sample, if every cell is a string (header row). */
export function matrixHeader(v: Json): string[] | null {
  if (!Array.isArray(v) || !Array.isArray(v[0])) return null;
  const first = v[0] as Json[];
  return first.length && first.every((c) => typeof c === 'string') ? (first as string[]) : null;
}

export { isObject };
