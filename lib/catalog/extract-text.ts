export { splitTranslationText } from './text-chunks.mjs';
import { splitTranslationText } from './text-chunks.mjs';

export async function* extractTranslationSegments(file: { id: string; type: 'pdf' | 'epub' }): AsyncGenerator<string> {
 if (file.type === 'pdf') {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  const task = pdfjs.getDocument({ url: `/api/catalog/stories/${encodeURIComponent(file.id)}/file`, disableStream: true, disableAutoFetch: true });
  try {
   const pdf = await task.promise;
   for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    let text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('');
    if (text.trim().length < 20) {
     const viewport = page.getViewport({ scale: 1.5 });
     const canvas = document.createElement('canvas');
     canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
     const context = canvas.getContext('2d');
     if (!context) throw new Error("Could not prepare the page for OCR.");
     await page.render({ canvasContext: context, viewport, canvas }).promise;
     const image = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
     const result = await fetch('/api/ocr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image }) });
     if (!result.ok) throw new Error("Could not recognize a scanned page.");
     const ocr = await result.json() as { text?: string };
     text = ocr.text || '';
    }
    for (const chunk of splitTranslationText(text)) yield chunk;
   }
  } finally { await task.destroy(); }
 } else {
  const response = await fetch(`/api/catalog/stories/${encodeURIComponent(file.id)}/file`);
  if (!response.ok) throw new Error('Could not open the file.');
  const bytes = await response.arrayBuffer();
  const { default: ePub } = await import('epubjs');
  const book = ePub(bytes);
  try {
   await book.ready;
   const sections: import('epubjs/types/section').default[] = [];
   book.spine.each((section: import('epubjs/types/section').default) => sections.push(section));
   for (const section of sections) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(section.href) || section.href.startsWith('//')) throw new Error('The EPUB contains an external reference.');
    await section.load(book.load.bind(book));
    const clone = section.contents.cloneNode(true) as Element;
    clone.querySelectorAll('script, style').forEach(element => element.remove());
    const blocks = Array.from(clone.querySelectorAll('p, h1, h2, h3, h4, li, blockquote')).filter(element => !element.parentElement?.closest('p, h1, h2, h3, h4, li, blockquote'));
    const text = blocks.length ? blocks.map(element => element.textContent?.trim()).filter(Boolean).join('\n\n') : clone.textContent || '';
    section.unload();
    for (const chunk of splitTranslationText(text)) yield chunk;
   }
  } finally { book.destroy(); }
 }
}
