export type PartOfSpeech = 'noun' | 'verb' | 'adjective' | 'adverb';
export interface Word { id: number; text: string; norm: string; frequency: number; }
export interface Meaning {
  id: number; pos: PartOfSpeech; definition: string; examples: string[];
  ordinal: number; synonyms: string[];
}
export interface Relation {
  source: number; target: number; type: string; label: string;
  word?: string; targetWord?: string;
}
export interface GraphNode {
  id: string; kind: 'word' | 'meaning'; label: string; pos?: PartOfSpeech;
  senseId?: number; group?: number; root?: boolean; related?: boolean;
  definition?: string; examples?: string[]; word?: string;
}
export interface GraphEdge { id: string; source: string; target: string; type: string; label: string; }
export interface Graph { nodes: GraphNode[]; edges: GraphEdge[]; truncated: boolean; }
export interface LookupResult {
  word: Word; meanings: Meaning[]; graph: Graph;
  resolvedFrom?: string; totalMeanings: number;
}
export interface Suggestion { text: string; meanings: number; match: 'prefix' | 'similar'; }
export interface Stats { words: number; meanings: number; relationships: number; definitions: number; }
