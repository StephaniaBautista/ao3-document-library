import { parseAo3Header, type Ao3Metadata } from './metadata.mjs';
import { readableDomText } from './dom-text';
import { extractPdfSummaryPages } from './pdf-summary.mjs';

async function extractPdfMetadata(source: { data: ArrayBuffer } | { url: string }): Promise<Ao3Metadata> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  const task = pdfjs.getDocument({ ...source, disableStream: true, disableAutoFetch: true });
  try {
   const pdf = await task.promise, page = await pdf.getPage(1), content = await page.getTextContent();
   let text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('');
   if (text.trim().length < 20) {
    const viewport = page.getViewport({ scale: 1.5 }), canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d'); if (!context) throw new Error('OCR unavailable');
    await page.render({ canvasContext: context, viewport, canvas }).promise;
    const res = await fetch('/api/ocr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: canvas.toDataURL('image/jpeg', 0.8).split(',')[1] }) });
    if (!res.ok) throw new Error('OCR unavailable');
    const data = await res.json() as { text?: string }; text = data.text || '';
   }
   const links = await page.getAnnotations();
   const parsed = parseAo3Header(`${text}\n${links.map(link => link.url || '').join('\n')}`);
   // Position information is lost in plain PDF text, so only keep a summary
   // when the export's layout shows where it ends.
   const pages = [content.items];
   parsed.summary = extractPdfSummaryPages(pages);
   for (let index = 2; !parsed.summary && index <= Math.min(pdf.numPages, 30); index++) {
    pages.push((await (await pdf.getPage(index)).getTextContent()).items);
    parsed.summary = extractPdfSummaryPages(pages);
   }
   return parsed;
  } finally { await task.destroy(); }
}

export async function extractPdfMetadataFromUrl(url: string): Promise<Ao3Metadata> {
 return extractPdfMetadata({ url });
}

export async function extractMetadata(file: Blob, type: 'pdf' | 'epub'): Promise<Ao3Metadata> {
 const bytes = await file.arrayBuffer();
 if (type === 'pdf') return extractPdfMetadata({ data: bytes });
 const { default: ePub } = await import('epubjs');
 const book = ePub(bytes);
 try {
  await book.ready;
  const packageMetadata = await book.loaded.metadata;
  const sections: import('epubjs/types/section').default[] = [];
  book.spine.each((section: import('epubjs/types/section').default) => sections.push(section));
  let text = '';
  for (const section of sections.slice(0, 2)) {
   if (/^[a-z][a-z0-9+.-]*:/i.test(section.href) || section.href.startsWith('//')) throw new Error('Invalid EPUB');
   await section.load(book.load.bind(book));
   const clone = section.contents.cloneNode(true) as Element;
   clone.querySelectorAll('script, style').forEach(element => element.remove());
   text += `${readableDomText(clone)}\n${Array.from(clone.querySelectorAll('a[href]')).map(link => link.getAttribute('href')).join('\n')}\n`;
   section.unload();
  }
  const parsed = parseAo3Header(text);
  return { ...parsed, title: parsed.title || packageMetadata.title || undefined, author: parsed.author || packageMetadata.creator || undefined, summary: parsed.summary || packageMetadata.description || undefined, language: parsed.language || packageMetadata.language || undefined };
 } finally { book.destroy(); }
}
