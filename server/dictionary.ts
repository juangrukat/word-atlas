import { DatabaseSync } from 'node:sqlite';
import type { Graph, GraphNode, GraphEdge, LookupResult, Meaning, PartOfSpeech, Stats, Suggestion, Word } from '../src/types.js';

const RELATIONS: Record<string, string> = {
  '!': 'opposite of', '@': 'type of', '@i': 'instance of', '~': 'more specific', '~i': 'specific instance',
  '&': 'similar to', '^': 'see also', '*': 'entails', '>': 'causes', '$': 'verb group',
  '#m': 'has member', '#s': 'has substance', '#p': 'has part', '%m': 'member of', '%s': 'substance of', '%p': 'part of',
  '=': 'attribute', '<': 'participle of', '\\': 'pertains to', '+': 'derived from',
  '-c': 'domain category', '-r': 'domain region', '-u': 'domain usage', ';c': 'domain member', ';r': 'regional member', ';u': 'usage member',
};
export const RELATION_FILTERS = ['synonyms', 'broader', 'narrower', 'antonyms', 'similar', 'all'] as const;
export type RelationFilter = typeof RELATION_FILTERS[number];
export interface LookupOptions { pos?: PartOfSpeech[]; relations?: RelationFilter; senseLimit?: number; }
interface MeaningRow { id: number; pos: PartOfSpeech; definition: string; examples: string; ordinal: number; }
interface RelationRow { source: number; target: number; type: string; from_word: string; to_word: string; }
export const normalize = (text: string): string => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replaceAll('-', ' ').replaceAll('_', ' ').trim().replace(/\s+/g, ' ');

/** Bounded optimal-string-alignment distance: includes adjacent transpositions. */
export function editDistance(a: string, b: string, cutoff = 3): number {
  if (Math.abs(a.length - b.length) > cutoff) return cutoff + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let beforePrevious = previous;
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let minimum = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(row[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) row[j] = Math.min(row[j], beforePrevious[j - 2] + 1);
      minimum = Math.min(minimum, row[j]);
    }
    if (minimum > cutoff) return cutoff + 1;
    beforePrevious = previous;
    previous = row;
  }
  return previous[b.length];
}

export class Dictionary {
  readonly db: DatabaseSync;
  readonly stats: Stats;
  private vocabulary: Word[];
  constructor(path: string) {
    this.db = new DatabaseSync(path, { readOnly: true });
    this.db.exec('PRAGMA query_only=ON; PRAGMA cache_size=-12000;');
    const row = this.db.prepare("SELECT value FROM metadata WHERE key='stats'").get() as { value: string } | undefined;
    if (!row) throw new Error('Dictionary metadata is missing. Run the importer first.');
    this.stats = JSON.parse(row.value);
    this.vocabulary = this.db.prepare('SELECT id,text,norm,frequency FROM words').all() as unknown as Word[];
  }
  close(): void { this.db.close(); }
  private exact(text: string): Word | undefined {
    return this.db.prepare('SELECT * FROM words WHERE norm=? ORDER BY text=? DESC,frequency DESC LIMIT 1').get(normalize(text), text) as unknown as Word | undefined;
  }
  private resolve(text: string): Word | undefined {
    const direct = this.exact(text);
    if (direct) return direct;
    const stems = this.db.prepare('SELECT word FROM stems WHERE form=? LIMIT 12').all(normalize(text)) as unknown as { word: string }[];
    for (const stem of stems) { const word = this.exact(stem.word); if (word) return word; }
    return undefined;
  }
  suggestions(query: string, limit = 8): Suggestion[] {
    const norm = normalize(query);
    if (!norm) return [];
    const prefix = this.db.prepare('SELECT w.text, (SELECT count(*) FROM memberships m WHERE m.word_id=w.id) AS meanings FROM words w WHERE w.norm>=? AND w.norm<? ORDER BY w.norm=? DESC, w.frequency DESC,w.text LIMIT ?').all(norm, norm + '\uffff', norm, limit) as unknown as { text: string; meanings: number }[];
    const result: Suggestion[] = prefix.map(w => ({ ...w, match: 'prefix' }));
    if (result.length >= Math.min(limit, 4) || norm.length < 3 || norm.length > 40) return result;
    const seen = new Set(result.map(w => w.text));
    const pairs = new Set(Array.from({ length: norm.length - 1 }, (_, i) => norm.slice(i, i + 2)));
    const candidates: { word: Word; distance: number }[] = [];
    for (const word of this.vocabulary) {
      if (seen.has(word.text) || Math.abs(word.norm.length - norm.length) > 2) continue;
      let overlap = 0;
      for (let i = 0; i < word.norm.length - 1; i++) if (pairs.has(word.norm.slice(i, i + 2))) overlap++;
      if (overlap < Math.max(1, Math.min(norm.length, word.norm.length) - 5)) continue;
      const distance = editDistance(norm, word.norm, 2);
      if (distance <= 2) candidates.push({ word, distance });
    }
    candidates.sort((a, b) => a.distance - b.distance || b.word.frequency - a.word.frequency || a.word.text.localeCompare(b.word.text));
    for (const { word } of candidates.slice(0, limit - result.length)) {
      const count = this.db.prepare('SELECT count(*) AS n FROM memberships WHERE word_id=?').get(word.id) as { n: number };
      result.push({ text: word.text, meanings: count.n, match: 'similar' });
    }
    return result;
  }
  private members(id: number, limit = 12): Word[] {
    return this.db.prepare('SELECT w.* FROM words w JOIN memberships m ON w.id=m.word_id WHERE m.meaning_id=? ORDER BY m.weight DESC,w.frequency DESC,w.text LIMIT ?').all(id, limit) as unknown as Word[];
  }
  private meaning(id: number): MeaningRow | undefined {
    return this.db.prepare('SELECT *,1 AS ordinal FROM meanings WHERE id=?').get(id) as unknown as MeaningRow | undefined;
  }
  private publicMeaning(row: MeaningRow): Meaning {
    const examples = (JSON.parse(row.examples) as string[]).flatMap(text => text.split(/";\s*"/).map(example => example.replace(/^"|"$/g, '').trim()).filter(Boolean));
    return { ...row, examples, synonyms: this.members(row.id, 100).map(w => w.text) };
  }
  lookup(text: string, options: LookupOptions = {}): LookupResult | undefined {
    const word = this.resolve(text);
    if (!word) return undefined;
    const rows = this.db.prepare("SELECT s.*,m.ordinal FROM meanings s JOIN memberships m ON s.id=m.meaning_id WHERE m.word_id=? ORDER BY CASE s.pos WHEN 'noun' THEN 1 WHEN 'adjective' THEN 2 WHEN 'verb' THEN 3 ELSE 4 END,m.ordinal,s.id").all(word.id) as unknown as MeaningRow[];
    const meanings = rows.map(row => this.publicMeaning(row));
    const chosen = meanings.filter(m => !options.pos || options.pos.includes(m.pos)).slice(0, options.senseLimit ?? 8);
    const graph = this.makeGraph(word, chosen, options.relations ?? 'synonyms');
    graph.truncated ||= meanings.filter(m => !options.pos || options.pos.includes(m.pos)).length > chosen.length;
    return { word, meanings, totalMeanings: meanings.length, graph, ...(normalize(text) !== word.norm ? { resolvedFrom: text } : {}) };
  }
  private makeGraph(root: Word | undefined, meanings: Meaning[], filter: RelationFilter, expanded = false): Graph {
    const nodes = new Map<string, GraphNode>();
    const edges = new Map<string, GraphEdge>();
    let truncated = false;
    const node = (n: GraphNode): void => { if (nodes.has(n.id)) return; if (nodes.size >= 180) { truncated = true; return; } nodes.set(n.id, n); };
    const edge = (a: string, b: string, type: string, label: string): void => {
      if (!nodes.has(a) || !nodes.has(b) || a === b) return;
      const id = `${a}:${type}:${b}`;
      edges.set(id, { id, source: a, target: b, type, label });
    };
    const senseNode = (m: Meaning, related = false, group = m.id): void => node({ id: `s:${m.id}`, kind: 'meaning', label: m.definition.split(/[;,(]/)[0].slice(0, 48) || m.synonyms[0] || 'meaning', pos: m.pos, senseId: m.id, group, related, definition: m.definition, examples: m.examples });
    const wordNode = (w: Word, m: Meaning): void => node({ id: `w:${w.id}`, kind: 'word', label: w.text, word: w.text, group: m.id, pos: m.pos });
    if (root) node({ id: `w:${root.id}`, kind: 'word', label: root.text, word: root.text, root: true });
    for (const m of meanings) {
      senseNode(m);
      if (root) edge(`w:${root.id}`, `s:${m.id}`, 'word-sense', 'meaning');
    }
    for (const m of meanings) {
      const members = this.members(m.id, expanded ? 30 : 10);
      for (const w of members) {
        if (root && w.id === root.id) continue;
        wordNode(w, m); edge(`s:${m.id}`, `w:${w.id}`, 'synonym', 'same meaning');
      }
      if (m.synonyms.length > members.length) truncated = true;
      if (filter === 'synonyms') continue;
      const rels = this.db.prepare('SELECT * FROM relations WHERE source=? ORDER BY CASE type WHEN \'!\' THEN 0 WHEN \'@\' THEN 1 WHEN \'&\' THEN 2 ELSE 3 END,target').all(m.id) as unknown as RelationRow[];
      const accepted = rels.filter(r => {
        if (r.from_word && root && normalize(r.from_word) !== root.norm) return false;
        if (filter === 'broader') return ['@', '@i', '%m', '%s', '%p'].includes(r.type);
        if (filter === 'narrower') return ['~', '~i', '#m', '#s', '#p'].includes(r.type);
        if (filter === 'antonyms') return r.type === '!';
        if (filter === 'similar') return ['&', '^', '+', '\\', '$'].includes(r.type);
        return true;
      });
      const max = expanded ? 12 : 3;
      if (accepted.length > max) truncated = true;
      for (const r of accepted.slice(0, max)) {
        const row = this.meaning(r.target); if (!row) continue;
        const target = this.publicMeaning(row);
        senseNode(target, true, m.id);
        edge(`s:${m.id}`, `s:${target.id}`, r.type, RELATIONS[r.type] ?? 'related to');
        for (const w of this.members(target.id, 3)) {
          wordNode(w, target); edge(`s:${target.id}`, `w:${w.id}`, 'synonym', 'same meaning');
        }
      }
    }
    return { nodes: [...nodes.values()], edges: [...edges.values()], truncated };
  }
  expand(id: number, filter: RelationFilter = 'all'): { meaning: Meaning; graph: Graph } | undefined {
    const row = this.meaning(id); if (!row) return undefined;
    const meaning = this.publicMeaning(row);
    return { meaning, graph: this.makeGraph(undefined, [meaning], filter, true) };
  }
}
