/** Preserve readable block boundaries while ignoring executable/hidden markup. */
export function readableDomText(root: Node): string {
 return readableDomContent(root).text;
}

export function readableDomContent(root: Node): { text: string; anchors: { id: string; offset: number }[] } {
 const blocks = new Set(['address', 'article', 'aside', 'blockquote', 'br', 'dd', 'div', 'dl', 'dt', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'li', 'main', 'p', 'section', 'tr']);
 const ignored = new Set(['script', 'style', 'noscript', 'iframe', 'object', 'embed', 'svg']);
 const parts: string[] = [];
 const positions = new Map<string, number>(); let length = 0;
 const append = (value: string) => { parts.push(value); length += value.length; };
 function visit(node: Node) {
  if (node.nodeType === 3) { append(node.nodeValue || ''); return; }
  if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) return;
  const tag = node.nodeType === 1 ? (node as Element).localName?.toLowerCase() : '';
  if (tag && ignored.has(tag)) return;
  if (node.nodeType === 1) for (const id of [(node as Element).getAttribute('id'), (node as Element).getAttribute('name')]) if (id && id.length <= 256 && positions.size < 5000 && !positions.has(id)) positions.set(id, length);
  if (tag && blocks.has(tag)) append('\n');
  for (const child of Array.from(node.childNodes)) visit(child);
  if (tag && blocks.has(tag)) append('\n');
 }
 visit(root);
 const raw = parts.join('');
 const anchors: { id: string; offset: number }[] = [];
 let cursor = 0, normalized = 0, newlines = 0;
 for (const [id, offset] of positions) {
  while (cursor < offset) {
   if (raw[cursor++] === '\n') { newlines++; if (newlines <= 2) normalized++; }
   else { newlines = 0; normalized++; }
  }
  anchors.push({ id, offset: normalized });
 }
 return { text: raw.replace(/\n{3,}/g, '\n\n'), anchors };
}
