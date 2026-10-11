import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Dictionary, editDistance } from '../server/dictionary.js';
const dictionary = new Dictionary(resolve('data/dictionary.sqlite'));
after(() => dictionary.close());

test('the complete recovered corpus is present', () => {
  assert.equal(dictionary.stats.words, 148730);
  assert.equal(dictionary.stats.meanings, 117659);
  assert.equal(dictionary.stats.definitions, dictionary.stats.meanings);
  assert.equal(dictionary.stats.relationships, 377488);
});
test('polysemous words preserve separate meanings, definitions and synonym memberships', () => {
  const value = dictionary.lookup('bank')!;
  assert.equal(value.totalMeanings, 18);
  assert.equal(new Set(value.meanings.map(m => m.id)).size, 18);
  assert.ok(value.meanings.some(m => /financial/i.test(m.definition)));
  assert.ok(value.meanings.some(m => /sloping land/i.test(m.definition)));
  assert.ok(value.meanings.every(m => m.synonyms.includes('bank')));
  assert.equal(value.graph.nodes.filter(n => n.kind === 'meaning').length, 8);
  assert.equal(value.graph.truncated, true);
  assert.equal(value.graph.nodes.filter(n => n.root).length, 1);
});
test('meaning map edges are valid and bounded, including the expanded relation view', () => {
  for (const word of ['bank', 'good', 'run', 'light', 'pen', 'wonder']) {
    const value = dictionary.lookup(word, { relations: 'all', senseLimit: 32 })!;
    const ids = new Set(value.graph.nodes.map(n => n.id));
    assert.ok(value.graph.nodes.length <= 180, word);
    assert.equal(ids.size, value.graph.nodes.length);
    assert.ok(value.graph.edges.every(e => ids.has(e.source) && ids.has(e.target) && e.source !== e.target), word);
  }
});
test('noun filtering only includes noun clusters while retaining all definitions', () => {
  const value = dictionary.lookup('bank', { pos: ['noun'], senseLimit: 32 })!;
  assert.equal(value.totalMeanings, 18);
  assert.ok(value.graph.nodes.filter(n => n.kind === 'meaning').every(n => n.pos === 'noun'));
  assert.equal(value.graph.nodes.filter(n => n.kind === 'meaning').length, value.meanings.filter(m => m.pos === 'noun').length);
});
test('broader and narrower relations retain their direction', () => {
  for (const [mode, symbols] of [['broader', ['@', '@i', '%m', '%s', '%p']], ['narrower', ['~', '~i', '#m', '#s', '#p']]] as const) {
    const value = dictionary.lookup('dog', { relations: mode })!;
    const relations = value.graph.edges.filter(e => !['synonym', 'word-sense'].includes(e.type));
    assert.ok(relations.length > 0);
    assert.ok(relations.every(e => (symbols as readonly string[]).includes(e.type)));
  }
});
test('lexical antonyms can be expanded independently of word lookup', () => {
  const happy = dictionary.lookup('happy', { relations: 'antonyms' })!;
  assert.ok(happy.graph.edges.some(e => e.type === '!'));
  assert.ok(happy.graph.nodes.some(n => n.label === 'unhappy'));
  const first = happy.meanings[0];
  const value = dictionary.expand(first.id, 'all')!;
  assert.equal(value.meaning.id, first.id);
  assert.ok(value.graph.nodes.some(n => n.id === `s:${first.id}`));
  assert.equal(dictionary.expand(2147483647), undefined);
});
test('lookup supports case, surrounding spaces and stored irregular forms', () => {
  assert.equal(dictionary.lookup('  WONDER ')?.word.text, 'wonder');
  assert.equal(dictionary.lookup('aardwolves')?.word.text, 'aardwolf');
  assert.equal(dictionary.lookup('zzzzunknownwordzzzz'), undefined);
});
test('suggestions provide prefixes and recover a misspelling', () => {
  assert.ok(dictionary.suggestions('serend').some(w => w.text === 'serendipity'));
  assert.ok(dictionary.suggestions('hapy', 12).some(w => w.text === 'happy' && w.match === 'similar'));
  assert.equal(dictionary.suggestions('').length, 0);
});
test('spelling distance recognizes an adjacent transposition', () => {
  assert.equal(editDistance('bnak', 'bank'), 1);
  assert.equal(editDistance('wonder', 'wonder'), 0);
});
