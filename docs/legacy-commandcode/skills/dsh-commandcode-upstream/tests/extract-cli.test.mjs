import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extract } from '../scripts/extract-cli.mjs';

const fixture = `
const levels = ['low', 'high'];
const sharedId = 'premium';
const supported = new Map([[sharedId, levels]]);
const registry = {
  OPEN: {id:'open', name:'Open', inputModalities:['text'], provider:'commandcode', reasoning:!0, contextWindow:1e6},
  CLOSED: {id:sharedId, name:'Premium', inputModalities:['text','image'], provider:'other', reasoningEfforts:levels, contextWindow:1e6},
  DYNAMIC: {id:'conditional', inputModalities:['text'], get hidden(){return expired()}},
};
const unrelated = {OPEN:{id:'open', inputModalities:['text'], reasoningEfforts:['max']}};
const credits = {'individual-go':10,'individual-pro':30,'individual-pro-v1':80};
const names = {'individual-go':'Go','individual-pro':'Pro','individual-pro-v1':'Pro'};
const zdrEnum = {ALPHA:{id:'alpha-model', provider:'someRef'}, BETA:{id:'beta-model'}};
const zdrExcluded = new Set([zdrEnum.ALPHA.id, 'beta-model']);
const zdrSibling = new Set(['beta-model']);
function getSupportedEfforts(model){return supported.get(model)??null}
function buildModelGroups(){return Object.values(registry)}
function getPlanInfo(plan){return {name:names[plan], monthlyCredits:credits[plan]}}
function modelSupportsZdr(model){return !zdrExcluded.has(model)}
function knownModelSupportsZdr(model){return !!model && !zdrSibling.has(model)}
`;

function run(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-extract-test-'));
  const file = path.join(dir, 'cli.mjs');
  fs.writeFileSync(file, source);
  try { return extract(file, process.cwd()); }
  finally { fs.rmSync(dir, {recursive:true, force:true}); }
}

test('consumer selection retains premium models and ignores unrelated OAuth tables', () => {
  const result = run(fixture);
  assert.deepEqual(result.models.map(m=>m.id), ['open','premium','conditional']);
  assert.deepEqual(result.efforts, {premium:['low','high']});
  assert.equal(result.models[0].reasoning, true);
  assert.match(result.models[2].hiddenExpression, /expired/);
  assert.equal(result.subscriptions['individual-pro-v1'].monthlyCredits, 80);
});

test('variable minification does not select another table', () => {
  assert.deepEqual(run(fixture.replaceAll('registry','ZZ').replaceAll('supported','AA')).efforts, {premium:['low','high']});
});

test('missing semantic anchor fails instead of returning empty data', () => {
  assert.throws(()=>run(fixture.replace('getSupportedEfforts','renamed')), /anchor/);
});

test('a __name-wrapped declaration is found by its semantic name (command-code@1.82.4)', () => {
  // From 1.82.4 the bundler keeps the semantic name only in the
  // `__name(fn, "name")` wrapper, so the declaration itself is renamed. The
  // extractor must resolve the anchor through the wrapper — looking up the
  // declaration name alone reported `Missing/ambiguous effort map`, which is
  // exactly how this check broke against 1.82.4.
  const wrapped = fixture
    .replace('function getSupportedEfforts(model)', 'function getSupportedEfforts2(model)')
    .replace('const unrelated =', 'function __name(fn, label){return fn}\n__name(getSupportedEfforts2, "getSupportedEfforts");\nconst unrelated =');
  const result = run(wrapped);
  assert.deepEqual(result.efforts, {premium:['low','high']});
  assert.equal(result.effortSource, 'bundled-map');
});

test('a catalog-backed getSupportedEfforts yields the registry rows instead of failing', () => {
  // 1.82.4 drops the bundled Map: the predicate reads the catalog instead, so the
  // body has no `.get()` call for the extractor to follow. That is a migration,
  // not a defect — the rows carry `reasoningEfforts` and become the source.
  const migrated = fixture
    .replace('function getSupportedEfforts(model){return supported.get(model)??null}', 'function getSupportedEfforts(model){return lookup(model)?.efforts??null}');
  const result = run(migrated);
  assert.equal(result.effortSource, 'registry-rows');
  assert.deepEqual(result.efforts, {premium:['low','high']});
  assert.match(result.effortError, /Missing\/ambiguous effort map/);
});

test('unknown computed effort expressions fail and are never executed', () => {
  assert.throws(()=>run(fixture.replace("const levels = ['low', 'high']", "const levels = (()=>{throw Error('EXECUTED')})()")), /Unsupported static expression/);
});

test('subscription key drift fails', () => {
  assert.throws(()=>run(fixture.replace("'individual-pro-v1':'Pro'", "'individual-ultra':'Ultra'")), /key mismatch/);
});

test('duplicate map entries fail instead of silently overwriting', () => {
  assert.throws(()=>run(fixture.replace('[[sharedId, levels]]', '[[sharedId, levels],[sharedId, ["max"]]]')), /duplicate Map/);
});

test('scope shadows do not contaminate top-level bindings', () => {
  const result = run(fixture + `function unrelatedScope(){const levels=['wrong'];return levels}`);
  assert.deepEqual(result.efforts.premium, ['low','high']);
});

test('ambiguous reassignment fails instead of assuming latest value', () => {
  assert.throws(()=>run(fixture.replace('const levels', 'let levels') + `levels=['max'];`), /ambiguous binding/);
});

test('zdr exception sets are read from the predicates, not variable names', () => {
  const result = run(fixture);
  // The receiver of `.has` is followed by symbol (minification renames it per
  // release), enum members resolve to their ids, and the union covers both
  // predicates — including the divergence the CLI itself ships (1.64.0's
  // `modelSupportsZdr` carries one id its sibling route table does not).
  assert.deepEqual(result.zdrAnchors, ['modelSupportsZdr', 'knownModelSupportsZdr']);
  assert.deepEqual(result.zdrExceptions, ['alpha-model', 'beta-model']);
  assert.deepEqual(result.zdrSets.modelSupportsZdr, ['alpha-model', 'beta-model']);
});

test('one surviving zdr anchor still yields the exception set', () => {
  const result = run(fixture.replace(/function knownModelSupportsZdr[\s\S]*?\n/, ''));
  assert.deepEqual(result.zdrAnchors, ['modelSupportsZdr']);
  assert.deepEqual(result.zdrExceptions, ['alpha-model', 'beta-model']);
});

test('no zdr anchor fails instead of claiming every model is covered', () => {
  assert.throws(()=>run(fixture.replace(/function modelSupportsZdr[\s\S]*?\n/, '').replace(/function knownModelSupportsZdr[\s\S]*?\n/, '')), /ZDR anchor/);
});

test('zdr set built from an unresolvable member access fails', () => {
  assert.throws(()=>run(fixture.replace('zdrEnum.ALPHA.id', 'zdrEnum.GAMMA.id')), /Missing object member/);
});
