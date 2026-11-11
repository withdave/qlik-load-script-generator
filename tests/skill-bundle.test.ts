// The skill ships a pre-bundled CLI (skills/.../scripts/qlik-gen.mjs). These tests run that
// committed file with Node and check it produces exactly what the source generators produce, so a
// dependency bump (esbuild in particular) or a forgotten `npm run build:skill` cannot ship a
// broken or stale bundle.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseTabular } from '../src/core/detect';
import { generateInline } from '../src/core/inline/generate';
import { generateEngine } from '../src/core/json/engine';
import { generateRest } from '../src/core/json/rest';
import type { Json } from '../src/core/parse/json';

const root = fileURLToPath(new URL('..', import.meta.url));
const bundle = `${root}skills/qlik-inline-json-rest-generator/scripts/qlik-gen.mjs`;
const fx = (p: string) => `${root}fixtures/${p}`;
const json = (p: string) => JSON.parse(readFileSync(fx(p), 'utf8')) as Json;
const run = (...args: string[]) => execFileSync(process.execPath, [bundle, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

describe('bundled skill CLI matches the source generators', () => {
  it('inline', () => {
    const expected = generateInline(parseTabular(readFileSync(fx('tabular/nasty.csv'), 'utf8')).table, { tableName: 'Notes' }).script;
    expect(run('inline', fx('tabular/nasty.csv'), '--table', 'Notes')).toBe(expected);
  });

  it('engine, file source', () => {
    const expected = generateEngine([json('json/nested.json')], { source: { kind: 'file', path: 'lib://DataFiles/n.json' }, rootName: 'Company' }).script;
    expect(run('engine', fx('json/nested.json'), '--path', 'lib://DataFiles/n.json', '--root', 'Company')).toBe(expected);
  });

  it('engine, database column', () => {
    const expected = generateEngine(json('db-column/orders.json') as Json[], {
      source: { kind: 'field', table: 'Orders', field: 'payload', keyField: 'id', method: 'reader' },
      rootName: 'Order',
    }).script;
    expect(run('engine', fx('db-column/orders.json'), '--field', 'payload', '--table', 'Orders', '--key', 'id', '--root', 'Order')).toBe(expected);
  });

  it('rest with next-URL paging', () => {
    const expected = generateRest(json('json/qlik-cloud-users-page.json'), {
      connection: 'c',
      url: 'https://t/api/v1/users',
      query: [['limit', '100']],
      pagination: { type: 'nexturl', table: 'next', field: 'href' },
    }).script;
    expect(
      run('rest', fx('json/qlik-cloud-users-page.json'), '--connection', 'c', '--url', 'https://t/api/v1/users', '--query', 'limit=100', '--paging', 'nexturl', '--next', 'links.next.href'),
    ).toBe(expected);
  });

  it('rest paged by the connection', () => {
    const expected = generateRest(json('json/qlik-cloud-users-page.json'), {
      connection: 'c',
      url: 'https://t/api/v1/users',
      query: [['limit', '100']],
      pagination: { type: 'offset', offsetParam: 'offset', limitParam: 'limit', limit: 100, recordsTable: 'data', total: { table: 'root', field: 'totalResults' } },
      pagingBy: 'connector',
    }).script;
    const args = ['rest', fx('json/qlik-cloud-users-page.json'), '--connection', 'c', '--url', 'https://t/api/v1/users', '--query', 'limit=100'];
    expect(run(...args, '--paging', 'offset', '--paging-by', 'connector', '--records', 'data', '--total', 'totalResults')).toBe(expected);
  });

  it('inspect runs', () => {
    expect(run('inspect', fx('json/qlik-cloud-users-page.json'))).toContain('REST connector tables');
  });
});
