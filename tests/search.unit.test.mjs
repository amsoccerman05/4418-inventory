import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/search.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
const {createInventoryMatcher} = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const matches = (query, ...fields) => createInventoryMatcher(query)(fields);

test('words match in any order with case, spacing and ordinary punctuation normalized', () => {
  for (const query of ['hex bolt', 'BOLT HEX', '  hex,   bolt  ', '(hex); bolt', 'hex-head bolt']) {
    assert.equal(matches(query, 'Bolt, hex-head'), true, query);
  }
  assert.equal(matches('hex bolt', 'Hex nut'), false);
  assert.equal(matches('hex bolt', 'Carriage bolt'), false);
  assert.equal(matches('bolt bolt hex', 'Bolt, hex'), true);
});

test('alphabetic prefixes preserve partial typing without fuzzy spelling substitution', () => {
  assert.equal(matches('bearing', '1/2" hex bearings'), true);
  assert.equal(matches('wren all', 'Allen wrench'), true);
  assert.equal(matches('bol hex', 'Bolt, hex'), true);
  assert.equal(matches('blot hex', 'Bolt, hex'), false);
  assert.equal(matches('nut', 'Nutsert tool'), true);
});

test('blank searches show all, but punctuation-only searches do not silently show everything', () => {
  for (const query of ['', '   ', '\t\n']) assert.equal(matches(query, null, undefined, ''), true);
  for (const query of ['...', '/', '—', '"', '!!!', ' () ']) assert.equal(matches(query, 'Bolt, hex'), false, query);
});

test('fractions and thread dimensions are whole tokens, not numeric substrings', () => {
  for (const [query, candidate] of [
    ['5', '5/32" Allen wrench'], ['32', '5/32" Allen wrench'],
    ['1/4', '1/40" Allen wrench'], ['1/4', '11/4" Allen wrench'],
    ['1/4', '1/4-20 hand tap'], ['20', '1/4-20 hand tap'],
    ['10-32', '10-320 hand tap'], ['10', '10-32 hand tap'],
    ['5/32 wrench', '3/32" Allen wrench'],
  ]) assert.equal(matches(query, candidate), false, `${query} must not match ${candidate}`);
  assert.equal(matches('wrench 5/32', '5/32" Allen wrench'), true);
  assert.equal(matches('tap 1/4-20', '1/4-20 hand tap'), true);
  assert.equal(matches('#10-32 bolt', '#10-32 bolts'), true);
});

test('decimal points, leading zeros, signs and numeric model names remain significant', () => {
  for (const [query, candidate] of [
    ['.5', '5 drill'], ['0.5', '.5 drill'], ['2.0', '20 roboRIO'],
    ['2', 'roboRIO 2.0'], ['001', '1 screw'], ['1', '001 screw'],
    ['-5', '5 rod'], ['+5', '5 rod'], ['60', 'Kraken X60'],
    ['X6', 'Kraken X60'], ['50', 'Anderson SB50 connectors'],
    ['6', 'M6 screw'], ['6mm', '6 mm wrench'],
  ]) assert.equal(matches(query, candidate), false, `${query} must not match ${candidate}`);
  assert.equal(matches('roborio 2.0', 'roboRIO 2.0'), true);
  assert.equal(matches('x60 kraken', 'Kraken X60'), true);
  assert.equal(matches('m6', 'M6 screw'), true);
  assert.equal(matches('.5 drill', 'Drill, .5'), true);
});

test('part-number punctuation and full numeric-bearing identifiers are preserved', () => {
  for (const candidate of ['ABC123', 'ABC-1234', 'ABC-0123', 'ABC/123', 'ABC.123', 'ABC_123', 'ABC:123', 'ABC--123']) {
    assert.equal(matches('ABC-123', candidate), false, candidate);
  }
  assert.equal(matches('ABC-123', 'ABC-123'), true);
  assert.equal(matches('abc/123', 'ABC/123'), true);
  assert.equal(matches('123', 'ABC-123'), false);
  assert.equal(matches('12', 'AB.12.C'), false);
  assert.equal(matches('AB.12.C', 'AB.12.C'), true);
  assert.equal(matches('ABC-123', 'ABC-', '123'), false);
  assert.equal(matches('ABC-123', 'ABC', '-123'), false);
  assert.equal(matches('ABC--123', 'ABC', '-123'), false);
  assert.equal(matches('ABC//123', 'ABC', '123'), false);
});

test('typographic punctuation normalizes without converting units or fractions', () => {
  assert.equal(matches('5/32" wrench', '5⁄32″ Allen wrench'), true);
  assert.equal(matches('ABC-123', 'ABC–123'), true);
  assert.equal(matches('hex head', 'Hex—head'), true);
  assert.equal(matches('1/4', '¼ inch wrench'), false);
  assert.equal(matches('¼', '1/4 inch wrench'), false);
  assert.equal(matches('6mm', '6 cm wrench'), false);
  assert.equal(matches('0.25', '1/4" wrench'), false);
  assert.equal(matches('café', 'cafe\u0301 tools'), true);
});

test('explicit foot and inch marks remain different, while unmarked sizes find the same marked size', () => {
  for (const inch of ['6" rod', '6″ rod', '6” rod']) {
    assert.equal(matches('6"', inch), true);
    assert.equal(matches("6'", inch), false);
    assert.equal(matches('6', inch), true);
  }
  assert.equal(matches("6'", '6′ rod'), true);
  assert.equal(matches('6"', "6' rod"), false);
  assert.equal(matches('6"', '6 rod'), false);
  assert.equal(matches("6'", '6 rod'), false);
  assert.equal(matches("6''", "6' rod"), false);
  assert.equal(matches('5/32 Allen Wrench', '5/32" Allen wrench'), true);
});

test('matches can span supplied searchable fields without reading or modifying other data', () => {
  const fields = Object.freeze(['Bolt, hex', 'ABC-123', 'WestCoast Products', 'Hardware', null, undefined]);
  assert.equal(createInventoryMatcher('hex abc-123 west')(fields), true);
  assert.equal(createInventoryMatcher('hex abc-124 west')(fields), false);
  assert.equal(createInventoryMatcher('quantity 100')(fields), false);
  assert.deepEqual(fields, ['Bolt, hex', 'ABC-123', 'WestCoast Products', 'Hardware', null, undefined]);
  assert.equal(matches('bolt', undefined, null, ''), false);
});
