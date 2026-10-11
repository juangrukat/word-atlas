import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { Maximize2, Minus, Plus, Pause, Play, Download } from 'lucide-react';
import type { Graph, GraphNode, GraphEdge } from './types';
import { meaningAnchors, separateLabels } from './layout';

export const COLORS = { noun: '#d47c46', verb: '#5b88bd', adjective: '#7c9d61', adverb: '#a381b3' };
interface SimNode extends GraphNode, d3.SimulationNodeDatum { width: number; height: number; anchorX: number; anchorY: number; }
interface SimEdge extends Omit<GraphEdge, 'source' | 'target'>, d3.SimulationLinkDatum<SimNode> { source: string | SimNode; target: string | SimNode; }
interface Props { graph: Graph; selected?: number; onSelect: (node: GraphNode) => void; onNavigate: (word: string) => void; }

/** Rectangular label protection, independent of D3's circular node collision. */
function labelProtection(nodes: SimNode[]): d3.Force<SimNode, SimEdge> {
  return (alpha: number) => {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = (a.x ?? 0) - (b.x ?? 0), dy = (a.y ?? 0) - (b.y ?? 0);
        const overlapX = (a.width + b.width) / 2 + 12 - Math.abs(dx);
        const overlapY = (a.height + b.height) / 2 + 12 - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;
        if (dx === 0) dx = i % 2 ? 0.1 : -0.1;
        if (dy === 0) dy = j % 2 ? 0.1 : -0.1;
        const strength = Math.max(alpha, 0.35) * 0.55;
        if (overlapX < overlapY) {
          const push = Math.sign(dx) * overlapX * strength;
          if (a.fx == null) a.vx = (a.vx ?? 0) + push;
          if (b.fx == null) b.vx = (b.vx ?? 0) - push;
        } else {
          const push = Math.sign(dy) * overlapY * strength;
          if (a.fy == null) a.vy = (a.vy ?? 0) + push;
          if (b.fy == null) b.vy = (b.vy ?? 0) - push;
        }
      }
    }
  };
}

export function GraphCanvas({ graph, selected, onSelect, onNavigate }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const previous = useRef(new Map<string, { x: number; y: number }>());
  const viewState = useRef<{ root: string; width: number; height: number; transform: d3.ZoomTransform } | undefined>(undefined);
  const callbacks = useRef({ onSelect, onNavigate });
  callbacks.current = { onSelect, onNavigate };
  const controls = useRef<{ fit: () => void; zoom: (factor: number) => void; pause: (paused: boolean) => void } | undefined>(undefined);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused); pausedRef.current = paused;
  const [size, setSize] = useState({ width: 900, height: 650 });
  useEffect(() => {
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    if (wrapperRef.current) observer.observe(wrapperRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!svgRef.current || !graph.nodes.length) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    const viewport = svg.append('g');
    const background = viewport.append('g').attr('class', 'cluster-shapes');
    const linksLayer = viewport.append('g');
    const nodesLayer = viewport.append('g');
    const { anchors, radius } = meaningAnchors(graph.nodes);
    const counts = new Map<number, number>();
    const nodes: SimNode[] = graph.nodes.map(n => {
      const anchor = anchors.get(n.kind === 'meaning' ? n.senseId ?? -1 : n.group ?? -1) ?? { x: 0, y: 0 };
      const ordinal = counts.get(n.group ?? 0) ?? 0;
      counts.set(n.group ?? 0, ordinal + 1);
      const angle = ordinal * 2.399963;
      const offset = n.kind === 'meaning' ? (n.related ? 70 : 0) : 75 + ordinal % 3 * 12;
      const old = previous.current.get(n.id);
      return { ...n, x: n.root ? 0 : old?.x ?? anchor.x + Math.cos(angle) * offset,
        y: n.root ? 0 : old?.y ?? anchor.y + Math.sin(angle) * offset,
        width: n.kind === 'meaning' ? 34 : n.label.length * (n.root ? 11 : 7.4) + (n.root ? 46 : 28),
        height: n.root ? 48 : n.kind === 'meaning' ? 34 : 28,
        anchorX: anchor.x, anchorY: anchor.y, ...(n.root ? { fx: 0, fy: 0 } : {}) };
    });
    const links: SimEdge[] = graph.edges.map(e => ({ ...e }));
    const groups = d3.groups(nodes.filter(n => !n.root), n => n.kind === 'meaning' ? n.senseId ?? 0 : n.group ?? 0);
    const hulls = background.selectAll('path').data(groups).join('path')
      .attr('fill', d => COLORS[d[1].find(n => n.pos)?.pos ?? 'noun'])
      .attr('fill-opacity', 0.035).attr('stroke', d => COLORS[d[1].find(n => n.pos)?.pos ?? 'noun'])
      .attr('stroke-opacity', 0.1).attr('stroke-width', 1);
    const edge = linksLayer.selectAll('line').data(links).join('line')
      .attr('stroke', e => e.type === '!' ? '#bd6670' : '#a8b4aa')
      .attr('stroke-opacity', 0.65).attr('stroke-width', 1.15)
      .attr('stroke-dasharray', e => ['word-sense', 'synonym'].includes(e.type) ? null : '4 5')
      .attr('marker-end', e => ['word-sense', 'synonym', '!', '&', '$', '^'].includes(e.type) ? null : 'url(#relation-arrow)');
    svg.append('defs').append('marker').attr('id', 'relation-arrow').attr('viewBox', '0 0 10 10')
      .attr('refX', 25).attr('refY', 5).attr('markerWidth', 6).attr('markerHeight', 6).attr('orient', 'auto')
      .append('path').attr('d', 'M 0 1 L 9 5 L 0 9').attr('fill', 'none').attr('stroke', '#8b9e8d').attr('stroke-width', 1.5);
    edge.append('title').text(e => e.label);
    const group = nodesLayer.selectAll<SVGGElement, SimNode>('g').data(nodes).join('g')
      .attr('class', n => `map-node ${n.kind}${n.root ? ' root' : ''}`)
      .attr('data-node-id', n => n.id).attr('data-kind', n => n.kind)
      .attr('tabindex', 0).attr('role', 'button')
      .attr('aria-label', n => n.kind === 'meaning' ? `${n.pos} meaning: ${n.definition}. Select to inspect and expand.` : `Explore ${n.label}`)
      .on('click', (event: MouseEvent, n) => {
        event.stopPropagation();
        if (n.kind === 'meaning') callbacks.current.onSelect(n);
        else if (!n.root) callbacks.current.onNavigate(n.label);
      })
      .on('keydown', (event: KeyboardEvent, n) => {
        if (!['Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        if (n.kind === 'meaning') callbacks.current.onSelect(n);
        else if (!n.root) callbacks.current.onNavigate(n.label);
      });
    group.append('title').text(n => n.kind === 'meaning' ? n.definition ?? n.label : `${n.label} · click to explore`);
    group.filter(n => n.kind === 'word').append('rect')
      .attr('x', n => -n.width / 2).attr('y', n => -n.height / 2)
      .attr('width', n => n.width).attr('height', n => n.height).attr('rx', n => n.root ? 12 : 7)
      .attr('fill', n => n.root ? '#203d34' : '#fafbf7')
      .attr('stroke', n => n.root ? '#203d34' : '#e0e6dc').attr('stroke-width', 0.8);
    group.filter(n => n.kind === 'meaning').append('circle').attr('class', 'meaning-halo')
      .attr('r', 17).attr('fill', n => COLORS[n.pos ?? 'noun']).attr('fill-opacity', 0.13);
    group.filter(n => n.kind === 'meaning').append('circle').attr('r', 7)
      .attr('fill', n => COLORS[n.pos ?? 'noun']).attr('stroke', '#fff').attr('stroke-width', 2);
    group.filter(n => n.kind === 'word' && !n.root).append('circle')
      .attr('cx', n => -n.width / 2 + 12).attr('r', 2.5).attr('fill', n => COLORS[n.pos ?? 'noun']);
    group.filter(n => n.kind === 'word').append('text').text(n => n.label)
      .attr('x', n => n.root ? 0 : 5).attr('y', 1).attr('dominant-baseline', 'middle').attr('text-anchor', 'middle')
      .attr('fill', n => n.root ? '#fff' : '#34463c').attr('font-size', n => n.root ? 24 : 13)
      .attr('font-family', n => n.root ? 'Georgia, serif' : 'Arial, sans-serif').attr('font-weight', n => n.root ? 400 : 500);
    const simulation = d3.forceSimulation<SimNode>(nodes)
      .randomSource(d3.randomLcg(0.42)).alphaDecay(0.025).velocityDecay(0.45)
      .force('links', d3.forceLink<SimNode, SimEdge>(links).id(n => n.id)
        .distance(e => e.type === 'word-sense' ? radius : e.type === 'synonym' ? 72 : 120)
        .strength(e => e.type === 'word-sense' ? 0.25 : e.type === 'synonym' ? 0.25 : 0.12))
      .force('charge', d3.forceManyBody<SimNode>().strength(n => n.root ? -350 : n.kind === 'meaning' ? -95 : -55).distanceMax(400))
      .force('x', d3.forceX<SimNode>(n => n.anchorX).strength(n => n.root ? 0 : n.kind === 'meaning' ? 0.16 : 0.035))
      .force('y', d3.forceY<SimNode>(n => n.anchorY).strength(n => n.root ? 0 : n.kind === 'meaning' ? 0.16 : 0.035))
      .force('labels', labelProtection(nodes));
    const draw = () => {
      separateLabels(nodes);
      edge.attr('x1', e => (e.source as SimNode).x ?? 0).attr('y1', e => (e.source as SimNode).y ?? 0)
        .attr('x2', e => (e.target as SimNode).x ?? 0).attr('y2', e => (e.target as SimNode).y ?? 0);
      group.attr('transform', n => `translate(${n.x},${n.y})`);
      hulls.attr('d', ([, members]) => {
        const points: [number, number][] = members.flatMap(n => {
          const x = n.x ?? 0, y = n.y ?? 0, w = n.width / 2 + 20, h = n.height / 2 + 24;
          return [[x - w, y - h], [x + w, y - h], [x + w, y + h], [x - w, y + h]] as [number, number][];
        });
        const hull = d3.polygonHull(points);
        return hull ? d3.line<[number, number]>().curve(d3.curveCatmullRomClosed.alpha(0.6))(hull) : null;
      });
      for (const n of nodes) previous.current.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
    };
    // Settle a deterministic starting arrangement before displaying the map.
    simulation.stop();
    for (let i = 0; i < 85; i++) simulation.tick();
    draw();
    simulation.on('tick', draw);
    const zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.18, 3.5])
      .filter((event: MouseEvent) => !event.button && (!event.ctrlKey || event.type === 'wheel'))
      .on('zoom', event => {
        viewport.attr('transform', event.transform.toString());
        viewState.current = { root: graph.nodes.find(n => n.root)?.id ?? '', width: size.width, height: size.height, transform: event.transform };
      });
    svg.call(zoom).on('dblclick.zoom', null);
    const fit = (minimumScale = 0) => {
      const x0 = d3.min(nodes, n => (n.x ?? 0) - n.width / 2)! - 35;
      const x1 = d3.max(nodes, n => (n.x ?? 0) + n.width / 2)! + 35;
      const y0 = d3.min(nodes, n => (n.y ?? 0) - n.height / 2)! - 35;
      const y1 = d3.max(nodes, n => (n.y ?? 0) + n.height / 2)! + 35;
      const scale = Math.min(1.35, (size.width - 70) / (x1 - x0), (size.height - 100) / (y1 - y0));
      const transform = d3.zoomIdentity.translate(size.width / 2, size.height / 2 - 8).scale(Math.max(0.18, minimumScale, scale)).translate(minimumScale ? 0 : -(x0 + x1) / 2, minimumScale ? 0 : -(y0 + y1) / 2);
      svg.call(zoom.transform, transform);
    };
    const savedView = viewState.current;
    if (savedView && savedView.root === (graph.nodes.find(n => n.root)?.id ?? '') && savedView.width === size.width && savedView.height === size.height) svg.call(zoom.transform, savedView.transform);
    else fit(0.8);
    controls.current = { fit: () => fit(), zoom: factor => svg.transition().duration(180).call(zoom.scaleBy, factor), pause: stop => { if (stop) simulation.stop(); else simulation.alpha(0.2).restart(); } };
    const drag = d3.drag<SVGGElement, SimNode>()
      .on('start', (event, n) => { event.sourceEvent.stopPropagation(); if (!event.active && !pausedRef.current) simulation.alphaTarget(0.1).restart(); n.fx = n.x; n.fy = n.y; })
      .on('drag', (event, n) => { n.fx = event.x; n.fy = event.y; n.x = event.x; n.y = event.y; draw(); })
      .on('end', (event, n) => { if (!event.active) simulation.alphaTarget(0); if (!n.root) { n.fx = null; n.fy = null; } });
    group.call(drag);
    if (!paused && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) simulation.alpha(0.15).restart();
    return () => { simulation.stop(); svg.on('.zoom', null); };
  }, [graph, size.width, size.height]);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll<SVGGElement, SimNode>('.map-node').classed('selected', n => n.senseId === selected);
    svg.selectAll<SVGCircleElement, SimNode>('.meaning-halo').attr('r', n => n.senseId === selected ? 21 : 17)
      .attr('fill-opacity', n => n.senseId === selected ? 0.28 : 0.13)
      .attr('stroke', n => n.senseId === selected ? COLORS[n.pos ?? 'noun'] : 'none').attr('stroke-width', 1);
  }, [selected, graph]);

  function download() {
    if (!svgRef.current) return;
    const copy = svgRef.current.cloneNode(true) as SVGSVGElement;
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    copy.setAttribute('width', String(size.width)); copy.setAttribute('height', String(size.height));
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('width', '100%'); rect.setAttribute('height', '100%'); rect.setAttribute('fill', '#f7f8f4');
    copy.prepend(rect);
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }));
    const a = document.createElement('a'); a.href = url; a.download = `word-atlas-${graph.nodes.find(n => n.root)?.label.replace(/[^\p{L}\p{N}-]/gu, '-') ?? 'map'}.svg`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="graph-canvas" ref={wrapperRef}>
    <svg ref={svgRef} width="100%" height="100%" viewBox={`0 0 ${size.width} ${size.height}`} aria-label="Interactive word and meaning map" />
    <div className="map-help"><span className="help-dot"/>Click a word to explore · drag to move · scroll to zoom</div>
    <div className="map-controls" aria-label="Map controls">
      <button title="Zoom in" aria-label="Zoom in" onClick={() => controls.current?.zoom(1.25)}><Plus size={17}/></button>
      <button title="Zoom out" aria-label="Zoom out" onClick={() => controls.current?.zoom(0.8)}><Minus size={17}/></button>
      <span className="control-divider"/>
      <button title="Fit map" aria-label="Fit map" onClick={() => controls.current?.fit()}><Maximize2 size={16}/></button>
      <button title={paused ? 'Resume animation' : 'Pause animation'} aria-label={paused ? 'Resume animation' : 'Pause animation'} onClick={() => { controls.current?.pause(!paused); setPaused(!paused); }}>{paused ? <Play size={15}/> : <Pause size={15}/>}</button>
      <button title="Download map as SVG" aria-label="Download map as SVG" onClick={download}><Download size={16}/></button>
    </div>
  </div>;
}
