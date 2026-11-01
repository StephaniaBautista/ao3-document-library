/** Extract only fields present in a typical AO3 export; never generate a summary. */
export function displaySummary(value, pdf = false) {
 if (typeof value !== 'string') return '';
 // Older imports appended the PDF annotation list after the extracted page.
 // The list starts with AO3's root and work URL; ordinary links are retained.
 const clean = value.replace(/\r\n?/g, '\n').replace(/\n\s*https?:\/\/(?:www\.)?archiveofourown\.org\/\s*\n\s*https?:\/\/(?:www\.)?archiveofourown\.org\/works\/\d+[^\n]*(?:\n[\s\S]*)?$/i, '').trim();
 return pdf ? clean.replace(/(?<!\n)\n(?!\n)/g, ' ') : clean;
}
export function parseAo3Header(raw) {
 const text = String(raw || '').slice(0, 60000).replace(/\r\n?/g, '\n');
 const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
 const fields = {};
 const mapping = { rating: 'rating', category: 'category', character: 'characters', fandom: 'fandom', relationship: 'relationship', 'additional tags': 'tags', 'archive warning': 'warnings', language: 'language' };
 const label = /^(Rating|Archive Warning|Category|Fandom|Relationship|Character|Additional Tags|Language|Stats):\s*(.*)$/i;
 let current = null;
 for (const line of lines) {
  if (/^(Summary|Notes|Chapter \d+)$/i.test(line)) break;
  const match = line.match(label);
  if (match) { current = mapping[match[1].toLowerCase()] || null; if (current) fields[current] = match[2]; continue; }
  if (current && !/^by\s/i.test(line) && !/archiveofourown\.org/i.test(line)) fields[current] += ` ${line}`;
 }
 const header = text.split(/\n\s*Summary\s*\n/i)[0];
 const words = header.match(/\bWords:\s*([\d,]+)/i);
 const chapters = header.match(/\bChapters:\s*(\d+)\s*\/\s*(\d+|\?)/i);
 if (words) fields.wordCount = Number(words[1].replace(/,/g, ''));
 if (chapters) { fields.chapterCount = Number(chapters[1]); if (chapters[2] !== '?') fields.totalChapters = Number(chapters[2]); }
 const link = text.match(/https?:\/\/(?:www\.)?archiveofourown\.org\/works\/(\d+)(?:[/?#][^\s]*)?/i);
 if (link) { fields.ao3Url = `https://archiveofourown.org/works/${link[1]}`; if (lines[0]) fields.title = lines[0].slice(0, 300); }
 const author = lines.find(line => /^by\s+\S/i.test(line));
 if (author) fields.author = author.replace(/^by\s+/i, '').slice(0, 300);
 const summaryIndex = lines.findIndex(line => /^summary$/i.test(line));
 if (summaryIndex !== -1) {
  const summary = [];
  const afterSummary = lines.slice(summaryIndex + 1);
  for (const [index, line] of afterSummary.entries()) {
   if (/^(Notes|Chapter\s+\d+|Chapter Text)$/i.test(line)) break;
   if (/^https?:\/\/(?:www\.)?archiveofourown\.org\/\S*$/i.test(line) && /^https?:\/\/(?:www\.)?archiveofourown\.org\/\S*$/i.test(afterSummary[index + 1] || '')) break;
   summary.push(line);
  }
  if (summary.length) fields.summary = summary.join('\n').slice(0, 12000);
 }
 return fields;
}
