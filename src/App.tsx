import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Check, ChevronDown, Compass, Expand, GitBranch, HelpCircle, History, LoaderCircle, Network, Search, Share2, Sparkles, Star, Volume2, X } from 'lucide-react';
import { GraphCanvas, COLORS } from './GraphCanvas';
import type { Graph, GraphNode, LookupResult, Meaning, PartOfSpeech, Stats, Suggestion } from './types';

const PARTS: PartOfSpeech[] = ['noun', 'verb', 'adjective', 'adverb'];
const STARTERS = ['serendipity', 'resilience', 'bright', 'connection', 'wander'];
type RelationMode = 'synonyms' | 'broader' | 'narrower' | 'antonyms' | 'similar' | 'all';
function storedWords(key: string): string[] {
  try { const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]'); return Array.isArray(value) ? value.filter(v => typeof v === 'string').slice(0, 60) : []; } catch { return []; }
}
function persist(key: string, value: string[]) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Explorer continues if browser storage is disabled. */ } }
function initialWord() { return new URLSearchParams(window.location.search).get('word')?.slice(0, 100) || 'wonder'; }
function mergeGraph(current: Graph, incoming: Graph): Graph {
  const nodes = new Map(current.nodes.map(n => [n.id, n]));
  const edges = new Map(current.edges.map(e => [e.id, e]));
  let truncated = current.truncated || incoming.truncated;
  for (const n of incoming.nodes) {
    if (nodes.has(n.id)) continue;
    if (nodes.size >= 220) { truncated = true; continue; }
    nodes.set(n.id, n);
  }
  for (const e of incoming.edges) if (nodes.has(e.source) && nodes.has(e.target) && edges.size < 500) edges.set(e.id, e);
  return { nodes: [...nodes.values()], edges: [...edges.values()], truncated };
}

export function App() {
  const [word, setWord] = useState(initialWord);
  const [query, setQuery] = useState(word);
  const [result, setResult] = useState<LookupResult>();
  const [graph, setGraph] = useState<Graph>({ nodes: [], edges: [], truncated: false });
  const [stats, setStats] = useState<Stats>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState<Suggestion[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [part, setPart] = useState<PartOfSpeech | 'all'>('all');
  const [relations, setRelations] = useState<RelationMode>('synonyms');
  const [senseLimit, setSenseLimit] = useState(8);
  const [selected, setSelected] = useState<Meaning>();
  const [expanding, setExpanding] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [expandError, setExpandError] = useState('');
  const [history, setHistory] = useState(() => storedWords('word-atlas.history'));
  const [saved, setSaved] = useState(() => storedWords('word-atlas.saved'));
  const [sidebarTab, setSidebarTab] = useState<'history' | 'saved'>('history');
  const [help, setHelp] = useState(false);
  const [toast, setToast] = useState('');
  const [navigation, setNavigation] = useState<string[]>([word]);
  const [navigationIndex, setNavigationIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const helpRef = useRef<HTMLElement>(null);
  const requestId = useRef(0);
  const wordRef = useRef(word); wordRef.current = word;
  const controller = useRef<AbortController | undefined>(undefined);
  const suggestionController = useRef<AbortController | undefined>(undefined);

  const navigate = useCallback((next: string) => {
    next = next.trim().slice(0, 100);
    if (!next) return;
    controller.current?.abort(); suggestionController.current?.abort();
    requestId.current++;
    setWord(next); setQuery(next); setSearchOpen(false); setActiveSuggestion(-1);
    setPart('all'); setSenseLimit(8); setSelected(undefined); setExpanded(new Set()); setExpandError('');
    if (next !== wordRef.current) {
      setNavigation(prev => [...prev.slice(0, navigationIndex + 1), next]);
      setNavigationIndex(navigationIndex + 1);
      const url = new URL(window.location.href); url.searchParams.set('word', next);
      window.history.pushState({}, '', url);
    }
  }, [navigationIndex]);

  useEffect(() => {
    fetch('/api/stats').then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(setStats).catch(() => {});
    const pop = () => { const next = initialWord(); setWord(next); setQuery(next); setPart('all'); setSenseLimit(8); setSelected(undefined); };
    const shortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) { event.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); }
      if (event.key === 'Escape') { setHelp(false); setSearchOpen(false); }
    };
    window.addEventListener('popstate', pop); window.addEventListener('keydown', shortcut);
    return () => { window.removeEventListener('popstate', pop); window.removeEventListener('keydown', shortcut); controller.current?.abort(); };
  }, []);

  useEffect(() => {
    const abort = new AbortController(); controller.current?.abort(); controller.current = abort;
    const id = ++requestId.current;
    setLoading(true); setError(''); setMissing([]); setExpandError('');
    const params = new URLSearchParams({ word, relations, senses: String(senseLimit) });
    if (part !== 'all') params.set('pos', part);
    fetch(`/api/lookup?${params}`, { signal: abort.signal, cache: 'no-cache' }).then(async response => {
      const data = await response.json();
      if (abort.signal.aborted || id !== requestId.current) return;
      if (!response.ok) {
        setResult(undefined); setGraph({ nodes: [], edges: [], truncated: false }); setSelected(undefined);
        setMissing(data.suggestions ?? []);
        setError(response.status === 404 ? `We couldn’t find “${word}”.` : 'The dictionary could not be loaded. Please try again.');
        return;
      }
      const value = data as LookupResult;
      setResult(value); setGraph(value.graph); setExpanded(new Set());
      setSelected(previous => value.meanings.find(m => m.id === previous?.id && (part === 'all' || m.pos === part)) ?? undefined);
      setHistory(previous => { const next = [value.word.text, ...previous.filter(w => w !== value.word.text)].slice(0, 30); persist('word-atlas.history', next); return next; });
    }).catch(reason => {
      if (reason.name !== 'AbortError' && id === requestId.current) { setError('Unable to reach the dictionary server. Check the connection and try again.'); setResult(undefined); }
    }).finally(() => { if (id === requestId.current) setLoading(false); });
    return () => abort.abort();
  }, [word, part, relations, senseLimit]);

  useEffect(() => {
    if (!searchOpen || query.trim().length < 1) { setSuggestions([]); return; }
    const abort = new AbortController(); suggestionController.current = abort;
    const timer = setTimeout(() => {
      fetch(`/api/suggest?q=${encodeURIComponent(query.trim())}`, { signal: abort.signal })
        .then(r => r.ok ? r.json() : { suggestions: [] }).then(data => { if (!abort.signal.aborted) { setSuggestions(data.suggestions); setActiveSuggestion(-1); } }).catch(() => {});
    }, 180);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [query, searchOpen]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 2500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    if (!help || !helpRef.current) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = helpRef.current;
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,select,[tabindex="0"]')];
    focusable()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const elements = focusable(), first = elements[0], last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    dialog.addEventListener('keydown', trap);
    return () => { dialog.removeEventListener('keydown', trap); if (previous?.isConnected) previous.focus(); };
  }, [help]);

  async function selectNode(node: GraphNode) {
    if (!node.senseId) return;
    const known = result?.meanings.find(m => m.id === node.senseId);
    if (known) { setSelected(known); setExpandError(''); return; }
    const id = requestId.current;
    try {
      const response = await fetch(`/api/meanings/${node.senseId}/expand?relations=synonyms`, { cache: 'no-cache' });
      if (!response.ok) throw new Error();
      const value = await response.json();
      if (id === requestId.current) { setSelected(value.meaning); setExpandError(''); }
    } catch { if (id === requestId.current) setExpandError('This meaning could not be loaded. Try again.'); }
  }
  async function expandMeaning(meaning: Meaning) {
    if (expanding || loading) return;
    const id = requestId.current;
    setExpanding(true); setExpandError('');
    try {
      const response = await fetch(`/api/meanings/${meaning.id}/expand?relations=${relations === 'synonyms' ? 'all' : relations}`, { cache: 'no-cache' });
      if (!response.ok) throw new Error();
      const value = await response.json() as { meaning: Meaning; graph: Graph };
      if (id !== requestId.current) return;
      setGraph(current => mergeGraph(current, value.graph));
      setExpanded(current => new Set([...current, meaning.id])); setSelected(value.meaning);
    } catch { if (id === requestId.current) setExpandError('Could not expand this meaning. Please try again.'); }
    finally { setExpanding(false); }
  }
  function selectMeaning(m: Meaning) {
    setSelected(m); setExpandError('');
    if (!graph.nodes.some(n => n.id === `s:${m.id}`)) {
      const node: GraphNode = { id: `s:${m.id}`, kind: 'meaning', label: m.definition.slice(0, 48), pos: m.pos, senseId: m.id, group: m.id, definition: m.definition, examples: m.examples };
      const root = graph.nodes.find(n => n.root);
      if (root) setGraph(g => mergeGraph(g, { nodes: [node], edges: [{ id: `${root.id}:word-sense:${node.id}`, source: root.id, target: node.id, type: 'word-sense', label: 'meaning' }], truncated: false }));
      void expandMeaning(m);
    }
  }
  function toggleSave() {
    if (!result) return;
    const text = result.word.text;
    setSaved(prev => { const next = prev.includes(text) ? prev.filter(w => w !== text) : [text, ...prev].slice(0, 60); persist('word-atlas.saved', next); return next; });
  }
  async function share() {
    const url = new URL(window.location.href); url.searchParams.set('word', result?.word.text ?? word);
    try { await navigator.clipboard.writeText(url.toString()); setToast('Link copied to clipboard'); }
    catch { setToast('The current address is a shareable link'); }
  }
  function back(direction: number) {
    const index = navigationIndex + direction;
    if (index < 0 || index >= navigation.length) return;
    setNavigationIndex(index); setWord(navigation[index]); setQuery(navigation[index]); setPart('all'); setSenseLimit(8); setSelected(undefined);
    const url = new URL(window.location.href); url.searchParams.set('word', navigation[index]); window.history.replaceState({}, '', url);
  }
  const visibleMeanings = result?.meanings.filter(m => part === 'all' || m.pos === part) ?? [];
  const isSaved = result && saved.includes(result.word.text);

  return <div className="app-shell">
    <header className="topbar">
      <a href="/" className="brand" onClick={event => { event.preventDefault(); navigate('wonder'); }} aria-label="Word Atlas home"><span className="brand-mark"><Network size={24} strokeWidth={1.6}/></span><span>word<span className="brand-light">atlas</span><small>THE VISUAL THESAURUS</small></span></a>
      <form className="search-wrap" role="search" onSubmit={event => { event.preventDefault(); navigate(activeSuggestion >= 0 ? suggestions[activeSuggestion].text : query); }}>
        <Search size={18} className="search-icon"/>
        <input ref={searchRef} value={query} maxLength={100} aria-label="Search for a word" placeholder="Where will a word take you?" autoComplete="off" role="combobox" aria-autocomplete="list" aria-expanded={searchOpen && suggestions.length > 0} aria-controls="word-suggestions" aria-activedescendant={activeSuggestion >= 0 ? `suggestion-${activeSuggestion}` : undefined}
          onChange={e => { setQuery(e.target.value); setActiveSuggestion(-1); setSearchOpen(true); }} onFocus={() => setSearchOpen(true)}
          onBlur={() => setSearchOpen(false)} onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setActiveSuggestion(i => suggestions.length ? (i + 1) % suggestions.length : -1); } else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveSuggestion(i => suggestions.length ? (i - 1 + suggestions.length) % suggestions.length : -1); } else if (e.key === 'Escape') setSearchOpen(false); }}/>
        <kbd>/</kbd><button type="submit" className="search-submit" aria-label="Explore word"><ArrowRight size={18}/></button>
        {searchOpen && suggestions.length > 0 && <div id="word-suggestions" className="suggestion-menu" role="listbox">
          {suggestions.map((s, i) => <button type="button" role="option" aria-selected={activeSuggestion === i} id={`suggestion-${i}`} className={activeSuggestion === i ? 'active' : ''} key={s.text} onMouseDown={e => e.preventDefault()} onClick={() => navigate(s.text)}><span><Search size={14}/>{s.text}{s.match === 'similar' && <em>similar spelling</em>}</span><small>{s.meanings} meanings</small></button>)}
        </div>}
      </form>
      <div className="topbar-end"><span className="live-label"><i/>ENGLISH DICTIONARY</span><button className="icon-button" aria-label="Help and about" onClick={() => setHelp(true)}><HelpCircle size={19}/></button></div>
    </header>
    <div className="workspace">
      <aside className="sidebar">
        <div className="sidebar-intro"><span className="eyebrow">FOLLOW YOUR CURIOSITY</span><h2>One word.<br/>A world of meaning.</h2><p>Discover the connections<br/>hidden between words.</p></div>
        <div className="sidebar-tabs"><button className={sidebarTab === 'history' ? 'active' : ''} onClick={() => setSidebarTab('history')}><History size={14}/>Recent</button><button className={sidebarTab === 'saved' ? 'active' : ''} onClick={() => setSidebarTab('saved')}><Star size={14}/>Saved <span>{saved.length}</span></button></div>
        <div className="sidebar-list">
          {(sidebarTab === 'history' ? history : saved).length === 0 && <p className="empty-sidebar">{sidebarTab === 'saved' ? 'Save a word with the star to return to it later.' : 'The words you explore will appear here.'}</p>}
          {(sidebarTab === 'history' ? history : saved).map(text => <button className={`history-item ${result?.word.text === text ? 'active' : ''}`} key={text} onClick={() => navigate(text)}><span>{text}</span>{result?.word.text === text ? <span className="current-dot"/> : <ArrowUpRight size={14}/>}</button>)}
        </div>
        <div className="discovery"><span className="eyebrow"><Sparkles size={13}/> A LITTLE INSPIRATION</span><div className="starter-words">{STARTERS.map(text => <button key={text} onClick={() => navigate(text)}>{text}<ArrowUpRight size={12}/></button>)}</div></div>
        <div className="sidebar-footer"><span className="dictionary-symbol"><BookOpen size={19}/></span><div><strong>{stats ? stats.words.toLocaleString() : '…'} words</strong><small>Ready to be explored</small></div></div>
      </aside>
      <main className="explorer">
        <div className="explorer-heading">
          <div className="word-heading"><div className="breadcrumb"><Compass size={13}/><span>THE WORD EXPLORER</span></div><div className="word-title"><h1>{result?.word.text ?? word}</h1>{result && typeof window.speechSynthesis !== 'undefined' && <button className="pronounce" aria-label={`Pronounce ${result.word.text}`} title="Pronounce with your browser voice" onClick={() => { window.speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(result.word.text); utterance.lang = 'en-US'; window.speechSynthesis.speak(utterance); }}><Volume2 size={18}/></button>}</div><p>{result ? `${result.totalMeanings} ${result.totalMeanings === 1 ? 'meaning' : 'meanings'} · ${new Set(result.meanings.flatMap(m => m.synonyms)).size} connected words` : 'Explore a word and its connections'}{result?.resolvedFrom && <span> · matched from “{result.resolvedFrom}”</span>}</p></div>
          <div className="word-actions"><div className="history-controls"><button aria-label="Previous word" disabled={navigationIndex === 0} onClick={() => back(-1)}><ArrowLeft size={16}/></button><button aria-label="Next word" disabled={navigationIndex >= navigation.length - 1} onClick={() => back(1)}><ArrowRight size={16}/></button></div><button className={`save-button ${isSaved ? 'saved' : ''}`} disabled={!result} onClick={toggleSave}><Star size={15} fill={isSaved ? 'currentColor' : 'none'}/><span>{isSaved ? 'Saved' : 'Save word'}</span></button><button className="icon-button share-button" title="Copy a link to this word" aria-label="Share word" onClick={share}><Share2 size={17}/></button></div>
        </div>
        <div className="map-toolbar"><div className="part-tabs" aria-label="Filter by part of speech"><button className={part === 'all' ? 'active' : ''} onClick={() => setPart('all')}>All meanings</button>{PARTS.filter(p => result?.meanings.some(m => m.pos === p)).map(p => <button className={part === p ? 'active' : ''} onClick={() => setPart(p)} key={p}><i style={{ background: COLORS[p] }}/>{p}<span>{result?.meanings.filter(m => m.pos === p).length}</span></button>)}</div><label className="relation-select"><GitBranch size={14}/><select aria-label="Relationship type" value={relations} onChange={e => setRelations(e.target.value as RelationMode)}><option value="synonyms">Synonyms</option><option value="broader">Broader meanings</option><option value="narrower">Narrower meanings</option><option value="antonyms">Opposites</option><option value="similar">Similar & derived</option><option value="all">All relationships</option></select><ChevronDown size={13}/></label></div>
        <div className="map-area">
          {!error && graph.nodes.length > 0 && <GraphCanvas graph={graph} selected={selected?.id} onSelect={node => void selectNode(node)} onNavigate={navigate}/ >}
          {loading && <div className={`loading-overlay ${graph.nodes.length ? 'quiet' : ''}`} role="status"><LoaderCircle size={19} className="spin"/>Finding connections…</div>}
          {error && !loading && <div className="error-state" role="alert"><span className="error-icon"><Search size={28}/></span><h2>{error}</h2><p>Try another spelling or explore one of these words.</p><div>{missing.map(s => <button key={s.text} onClick={() => navigate(s.text)}>{s.text}<ArrowUpRight size={13}/></button>)}</div></div>}
          {!loading && !error && graph.nodes.length === 0 && <div className="error-state"><h2>No meanings in this filter</h2><button onClick={() => setPart('all')}>Show all meanings</button></div>}
          <div className="map-caption"><span><i/>CONNECTED BY MEANING</span><span>{graph.nodes.length ? `${graph.nodes.length} nodes · ${graph.edges.length} connections` : 'WORD ATLAS'}</span></div>
        </div>
        <div className="explorer-footer"><span><Network size={13}/>{graph.truncated ? 'A focused view of this word’s connections. Expand a meaning to discover more.' : 'Every dot is a meaning. Every connection is a new direction.'}</span>{visibleMeanings.length > senseLimit && senseLimit < 32 && <button onClick={() => setSenseLimit(n => Math.min(n + 8, 32))}>More meanings<PlusSmall/></button>}</div>
      </main>
      <aside className="meaning-panel">
        <div className="panel-heading"><BookOpen size={17}/><h2>{selected ? 'A closer look' : 'The meanings'}</h2>{selected ? <button aria-label="Show all definitions" onClick={() => setSelected(undefined)}><X size={17}/></button> : <span>{visibleMeanings.length}</span>}</div>
        <div className="meaning-scroll">
          {selected ? <div className="meaning-detail"><button className="back-definitions" onClick={() => setSelected(undefined)}><ArrowLeft size={13}/>All definitions</button><span className="pos-label" style={{ color: COLORS[selected.pos] }}><i style={{ background: COLORS[selected.pos] }}/>{selected.pos}</span><h3>{selected.definition}</h3>{selected.examples.map(example => <blockquote key={example}>{example.replace(/^"|"$/g, '')}</blockquote>)}<span className="eyebrow section-eyebrow">WORDS WITH THIS MEANING</span><div className="synonym-list">{selected.synonyms.map(text => <button onClick={() => navigate(text)} key={text}>{text}<ArrowUpRight size={12}/></button>)}</div><button className="expand-button" disabled={expanding || loading || expanded.has(selected.id)} onClick={() => void expandMeaning(selected)}>{expanding ? <LoaderCircle size={15} className="spin"/> : expanded.has(selected.id) ? <Check size={15}/> : <Expand size={15}/>} {expanded.has(selected.id) ? 'Connections added to map' : 'Expand this meaning'} {!expanding && !expanded.has(selected.id) && <ArrowRight size={14}/>}</button><p className="detail-hint">Discover related meanings and the words connected to them.</p>{expandError && <p className="inline-error" role="alert">{expandError}</p>}</div> : <>
            <p className="panel-intro">A word can take more than one shape.<br/>Choose a meaning to look closer.</p>
            {visibleMeanings.map((m, i) => <article className="meaning-card" key={m.id}><button className="meaning-card-main" onClick={() => selectMeaning(m)}><span className="meaning-number" style={{ color: COLORS[m.pos], background: `${COLORS[m.pos]}15` }}>{i + 1}</span><span className="meaning-card-content"><span className="pos-label" style={{ color: COLORS[m.pos] }}>{m.pos}</span><span className="definition-text">{m.definition}</span>{m.examples.length > 0 && <span className="example-text">{m.examples[0].replace(/^"|"$/g, '')}</span>}</span></button><div className="card-synonyms">{m.synonyms.filter(text => text !== result?.word.text).slice(0, 3).map(text => <button key={text} onClick={() => navigate(text)}>{text}</button>)}{m.synonyms.filter(text => text !== result?.word.text).length > 3 && <button onClick={() => selectMeaning(m)}>+{m.synonyms.length - (m.synonyms.includes(result?.word.text ?? '') ? 1 : 0) - 3}</button>}</div></article>)}
            {!result && !loading && <p className="panel-intro">Search for a word to see its definitions here.</p>}
            {expandError && <p className="inline-error" role="alert">{expandError}</p>}
          </>}
        </div>
        <div className="panel-footer"><span className="legend-dot"/><p>Select a colored dot on the map<br/>to reveal its definition.</p></div>
      </aside>
    </div>
    {toast && <div className="toast" role="status"><Check size={16}/>{toast}</div>}
    {help && <div className="modal-backdrop" onClick={() => setHelp(false)}><section ref={helpRef} className="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={e => e.stopPropagation()}><button className="modal-close icon-button" aria-label="Close help" onClick={() => setHelp(false)}><X size={19}/></button><span className="brand-mark"><Network size={25}/></span><h2 id="help-title">Let one word lead to another.</h2><p>Word Atlas is a new browser-based recreation of the classic visual thesaurus experience.</p><ul><li><strong>Search a word</strong> to reveal its different meanings.</li><li><strong>Select a colored dot</strong> to read a definition and expand its relationships.</li><li><strong>Click a word</strong> to make it the center of a new map.</li><li><strong>Drag nodes or the background</strong> to move the map. Scroll to zoom.</li><li><strong>Press /</strong> to search, or Escape to close this window.</li></ul><p className="about-data">{stats?.words.toLocaleString()} words · {stats?.meanings.toLocaleString()} meanings<br/>English lexical data recovered from the supplied 2009 dictionary. Saved words stay in this browser. Pronunciation uses your browser’s voice, when available.</p><button className="expand-button" onClick={() => setHelp(false)}>Start exploring<ArrowRight size={16}/></button></section></div>}
  </div>;
}
function PlusSmall() { return <span aria-hidden="true" className="plus-small">+</span>; }
