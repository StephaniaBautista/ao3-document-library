// AO3's PDF export indents the summary further than the story body. Require an
// observable boundary so that an unfinished page is never mistaken for a summary.
export function extractPdfSummary(items) {
 return extractPdfSummaryPages([items]);
}

export function extractPdfSummaryPages(pages) {
 const lines = [];
 for (const [page, items] of pages.entries()) for (const item of items) {
  if (!item || typeof item.str !== 'string' || !item.str.trim() || !Array.isArray(item.transform)) continue;
  const x = item.transform[4], y = item.transform[5];
  if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
  const previous = lines.at(-1);
  if (previous && previous.page === page && Math.abs(previous.y - y) < 2) previous.text += ` ${item.str.trim()}`;
  else lines.push({ x, y, page, text: item.str.trim() });
 }
 if (!lines.some(line => /posted originally on the archive of our own/i.test(line.text))) {
  if (!lines.some(line => /exported with the assistance of fichub\.net/i.test(line.text))) return undefined;
  const by = lines.findIndex(line => /^by:\s*\S/i.test(line.text));
  const status = lines.findIndex((line, index) => index > by && /^status:\s*/i.test(line.text));
  if (by < 0 || status <= by + 1) return undefined;
  const summary = [];
  for (const [index, line] of lines.slice(by + 1, status).entries()) {
   const previous = lines[by + index];
   if (index) summary.push(previous.page === line.page && previous.y - line.y > 25 ? '\n\n' : ' ');
   summary.push(line.text);
  }
  return summary.join('').trim().slice(0, 12000) || undefined;
 }
 const start = lines.findIndex(line => /^summary\s*:?$/i.test(line.text));
 if (start < 0 || !lines[start + 1]) return undefined;
 const indent = lines[start + 1].x;
 if (indent <= lines[start].x + 8) return undefined;
 const result = [];
 let ended = false, previousY = null, previousPage = null;
 for (let i = start + 1; i < lines.length; i++) {
  const line = lines[i], next = lines[i + 1];
  const section = /^(notes|chapter notes|chapter(?:\s+\d+)?(?:\s*:\s*.*)?|chapter text)\s*:?$/i;
  const nextIsSection = next && next.page === line.page && (section.test(next.text) || next.x < indent - 8);
  const chapterTitle = previousPage !== null && line.page !== previousPage && line.x > indent + 30 && nextIsSection;
  // Some AO3 exports put the entire summary on its own page, followed by a
  // forced break even though most of that page remains blank.
  const forcedPageBreak = previousPage !== null && line.page !== previousPage && previousY > 250 && line.y > previousY + 10;
  if ((section.test(line.text) && (line.x < indent - 4 || /^chapter\s+\d+/i.test(line.text))) || line.x < indent - 8 || chapterTitle || forcedPageBreak) { ended = true; break; }
  if (previousY !== null && previousPage === line.page && previousY - line.y > 22) result.push('\n\n');
  else if (result.length) result.push(' ');
  result.push(line.text);
  previousY = line.y;
  previousPage = line.page;
 }
 return ended && result.length ? result.join('').trim().slice(0, 12000) : undefined;
}
