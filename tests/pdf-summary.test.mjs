import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPdfSummary, extractPdfSummaryPages } from '../lib/catalog/pdf-summary.mjs';
import { displaySummary, parseAo3Header } from '../lib/catalog/metadata.mjs';

const line = (str, x, y) => ({ str, transform: [1, 0, 0, 1, x, y] });
test('AO3 PDF summary ends when the less-indented story begins', () => {
 const lines = [line('Posted originally on the Archive of Our Own', 50, 800), line('Summary', 34, 500), line('The first line', 76, 450), line('continues here.', 76, 435), line('First line of the story.', 58, 350)];
 assert.equal(extractPdfSummary(lines), 'The first line continues here.');
 assert.equal(extractPdfSummary(lines.slice(0, -1)), undefined);
});
test('summary preserves multiple paragraphs and stops at notes', () => {
 const lines = [line('Posted originally on the Archive of Our Own', 50, 800), line('Summary', 34, 500), line('First paragraph.', 76, 450), line('Second paragraph.', 76, 420), line('Notes', 34, 380), line('Not the summary.', 76, 340)];
 assert.equal(extractPdfSummary(lines), 'First paragraph.\n\nSecond paragraph.');
 assert.equal(extractPdfSummary(lines.slice(1)), undefined);
});
test('summary on a later page and notes across a page break are recognized', () => {
 const header = [line('Posted originally on the Archive of Our Own', 50, 800), line('Additional Tags:', 47, 100)];
 const beginning = [line('Summary', 34, 200), line('A real summary', 76, 60), line('that continues', 76, 45)];
 const ending = [line('on the next page.', 76, 800), line('Notes', 34, 720), line('Not summary.', 76, 660)];
 assert.equal(extractPdfSummaryPages([header, beginning]), undefined);
 assert.equal(extractPdfSummaryPages([header, beginning, ending]), 'A real summary that continues on the next page.');
});
test('a chapter title on the following page is not added to the summary', () => {
 const first = [line('Posted originally on the Archive of Our Own', 50, 800), line('Summary', 34, 200), line('A short summary.', 76, 150)];
 const second = [line('A chapter title', 260, 800), line('Chapter Notes', 34, 750), line('Notes.', 76, 700)];
 assert.equal(extractPdfSummaryPages([first, second]), 'A short summary.');
});
test('a deliberately short summary page ends before the story on the next page', () => {
 const first = [line('Posted originally on the Archive of Our Own', 50, 800), line('Summary', 40, 670), line('The summary.', 66, 618)];
 const second = [line('Story begins here.', 66, 719)];
 assert.equal(extractPdfSummaryPages([first, second]), 'The summary.');
});
test('FicHub exports contain their summary between author and status', () => {
 const items = [line('Title', 77, 672), line('By: Author', 77, 630), line('The real summary', 77, 598), line('continues here.', 77, 581), line('Status: complete', 77, 531), line('Exported with the assistance of FicHub.net', 77, 288)];
 assert.equal(extractPdfSummary(items), 'The real summary continues here.');
 assert.equal(extractPdfSummary(items.filter(item => !item.str.includes('FicHub'))), undefined);
});
test('annotation URL lists are not appended to summaries', () => {
 const parsed = parseAo3Header('Summary\nA real summary.\nhttp://archiveofourown.org/\nhttp://archiveofourown.org/works/42');
 assert.equal(parsed.summary, 'A real summary.');
 assert.equal(parseAo3Header('Summary\nSee https://example.org for context.\nNotes').summary, 'See https://example.org for context.');
 assert.equal(displaySummary('A summary.\nhttp://archiveofourown.org/\nhttp://archiveofourown.org/works/42\nhttp://archiveofourown.org/tags/Tag'), 'A summary.');
 assert.equal(displaySummary('Line one\nline two\n\nNext paragraph.', true), 'Line one line two\n\nNext paragraph.');
 assert.equal(displaySummary('A summary.\nhttps://archiveofourown.org/works/42'), 'A summary.\nhttps://archiveofourown.org/works/42');
});
