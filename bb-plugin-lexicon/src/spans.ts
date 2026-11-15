// The DOM-free half of painting: joining the text nodes of a paragraph into one
// string to match, and finding the nodes a match runs over. Generic over what a
// "node" and an "owner" are, so the tests run it on plain objects.

/** A text node as the walker meets it: its text and the paragraph it belongs to. */
export interface Piece<N, O> {
  node: N;
  data: string;
  owner: O;
}

/** One paragraph's text, and where each of its text nodes starts in it. */
export interface Chunk<N, O> {
  text: string;
  owner: O;
  nodes: { node: N; start: number; length: number }[];
}

/** Joins consecutive pieces with the same owner into one chunk, so a phrase may run across nested elements (`pinned **folders**`) but never across a paragraph's edge. */
export function joinChunks<N, O>(pieces: Iterable<Piece<N, O>>): Chunk<N, O>[] {
  const chunks: Chunk<N, O>[] = [];
  let current: Chunk<N, O> | null = null;
  for (const { node, data, owner } of pieces) {
    if (!data) continue;
    if (!current || current.owner !== owner) {
      current = { text: "", owner, nodes: [] };
      chunks.push(current);
    }
    current.nodes.push({ node, start: current.text.length, length: data.length });
    current.text += data;
  }
  return chunks;
}

/** Where `[start, end)` of a chunk's text lies: the first and last node and the offsets in them. Null for an empty or out-of-range span. */
export function locate<N>(nodes: readonly { node: N; start: number; length: number }[], start: number, end: number): { first: N; startOffset: number; last: N; endOffset: number } | null {
  if (end <= start) return null;
  let first = -1;
  let last = -1;
  for (let i = 0; i < nodes.length; i++) {
    const entry = nodes[i]!;
    if (first < 0 && start < entry.start + entry.length) first = i;
    if (end <= entry.start + entry.length) {
      last = i;
      break;
    }
  }
  if (first < 0 || last < 0) return null;
  const a = nodes[first]!;
  const b = nodes[last]!;
  return { first: a.node, startOffset: start - a.start, last: b.node, endOffset: end - b.start };
}

/** The items no other item contains: repainting a paragraph repaints what is inside it, so a dirty paragraph inside another dirty one is not repainted twice. */
export function outermost<T>(items: readonly T[], contains: (outer: T, inner: T) => boolean): T[] {
  return items.filter((item) => !items.some((other) => other !== item && contains(other, item) && !contains(item, other)));
}
