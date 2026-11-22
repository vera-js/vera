/**
 * The retainer path of a surviving object, read from a V8 heap snapshot: the shortest chain of edges from the GC roots
 * to each object asked about. Used by `measure.mjs` when a count is not zero, so the failure
 * itself names what holds the component (a CI runner's snapshot file is gone with the runner).
 */
import { readFileSync } from 'node:fs';

/** Up to `limit` targets, each with its shortest path (`nodeName --edgeName-->` steps, root first) and its direct holders. */
export const retainerPaths = (file, held, limit = 2) => {
  const snapshot = JSON.parse(readFileSync(file, 'utf8'));
  const { node_fields: nodeFields, edge_fields: edgeFields, node_types: [nodeTypes], edge_types: [edgeTypes] } = snapshot.snapshot.meta;
  const { nodes, edges, strings } = snapshot;
  const nodeSize = nodeFields.length;
  const edgeSize = edgeFields.length;
  const at = { type: nodeFields.indexOf('type'), name: nodeFields.indexOf('name'), edgeCount: nodeFields.indexOf('edge_count') };
  const edgeAt = { type: edgeFields.indexOf('type'), name: edgeFields.indexOf('name_or_index'), to: edgeFields.indexOf('to_node') };
  const count = nodes.length / nodeSize;
  /** Reverse edges: for each node, the (from node, edge) pairs that point at it, weak edges left out. */
  const firstEdge = new Uint32Array(count + 1);
  for (let n = 0; n < count; n++) firstEdge[n + 1] = firstEdge[n] + nodes[n * nodeSize + at.edgeCount];
  const into = Array.from({ length: count }, () => []);
  for (let n = 0; n < count; n++)
    for (let e = firstEdge[n]; e < firstEdge[n + 1]; e++) {
      const type = edgeTypes[edges[e * edgeSize + edgeAt.type]];
      if (type === 'weak') continue;
      into[edges[e * edgeSize + edgeAt.to] / nodeSize].push(n, e);
    }
  const nameOf = (n) => `${nodeTypes[nodes[n * nodeSize + at.type]]}:${strings[nodes[n * nodeSize + at.name]]}`;
  const edgeName = (e) => {
    const type = edgeTypes[edges[e * edgeSize + edgeAt.type]];
    const raw = edges[e * edgeSize + edgeAt.name];
    return type === 'element' || type === 'hidden' ? `[${raw}]` : `${type}:${strings[raw]}`;
  };
  /**
   * The targets: `held.className` names the constructor; `held.weakRefsIn` names a global array of WeakRefs, whose live
   * targets are the objects asked about — the only way to pick out a minified class's instances.
   */
  const edgesOf = (n) => {
    const list = [];
    for (let e = firstEdge[n]; e < firstEdge[n + 1]; e++) list.push(e);
    return list;
  };
  const toOf = (e) => edges[e * edgeSize + edgeAt.to] / nodeSize;
  const named = (e, name) => edgeTypes[edges[e * edgeSize + edgeAt.type]] === 'property' && strings[edges[e * edgeSize + edgeAt.name]] === name;
  const targets = [];
  if (held.className !== undefined) {
    for (let n = 0; n < count && targets.length < limit; n++)
      if (nodeTypes[nodes[n * nodeSize + at.type]] === 'object' && strings[nodes[n * nodeSize + at.name]] === held.className) targets.push(n);
  } else {
    const arrays = new Set();
    for (let n = 0; n < count; n++) for (const e of edgesOf(n)) if (named(e, held.weakRefsIn)) arrays.add(toOf(e));
    for (const array of arrays)
      for (const e of edgesOf(array)) {
        if (edgeTypes[edges[e * edgeSize + edgeAt.type]] !== 'element') continue;
        for (const w of edgesOf(toOf(e)))
          if (edgeTypes[edges[w * edgeSize + edgeAt.type]] === 'weak' && targets.length < limit && !targets.includes(toOf(w))) targets.push(toOf(w));
      }
  }
  /** Breadth-first from the target back towards node 0 (the snapshot's synthetic root). */
  return targets.map((target) => {
    const via = new Map([[target, null]]);
    const queue = [target];
    for (let q = 0; q < queue.length && !via.has(0); q++) {
      const n = queue[q];
      const list = into[n];
      for (let i = 0; i < list.length; i += 2) {
        const from = list[i];
        if (!via.has(from)) {
          via.set(from, [n, list[i + 1]]);
          queue.push(from);
        }
      }
    }
    if (!via.has(0)) return { path: ['(no strong path from the root)'], holders: [] };
    const path = [];
    for (let n = 0; n !== target; ) {
      const [next, e] = via.get(n);
      path.push(`${nameOf(n)} --${edgeName(e)}-->`);
      n = next;
    }
    path.push(nameOf(target));
    /** Every direct holder too: the shortest path can run through a root (a stack slot) that hides the real one. */
    const holders = [];
    for (let i = 0; i < into[target].length && holders.length < 8; i += 2) holders.push(`${nameOf(into[target][i])} --${edgeName(into[target][i + 1])}-->`);
    return { path, holders };
  });
};
