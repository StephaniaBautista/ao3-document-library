import JSZip from 'jszip';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, beginText, endText, pushGraphicsState, popGraphicsState, setFontAndSize, setCharacterSqueeze, setTextMatrix, showText, type PDFFont, type PDFName } from 'pdf-lib';

type Span = { text: string; left: number; top: number; width: number; height: number; font: string };
type Page = { text: string; layout?: { width: number; height: number; spans: Span[]; blank?: boolean } | null };
type Story = { title: string; author?: string | null; language?: string; pages: Page[] };
type ExportResult = { blob: Blob; filename: string };
const fonts = ['NotoSans-Regular','NotoSans-Bold','NotoSans-Italic','NotoSans-BoldItalic','NotoSerif-Regular','NotoSerif-Bold','NotoSerif-Italic','NotoSerif-BoldItalic'];

function escapeXml(value: unknown) {
 const s = String(value);
 if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(s)) throw new Error('El texto contiene caracteres que no se pueden incluir en el archivo.');
 return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]!));
}
function filename(title: string, ext: string) { return `${title.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 100) || 'historia'} - español.${ext}`; }
function number(value: number) { if (!Number.isFinite(value) || Math.abs(value) > 100000) throw new Error('La posición de texto del documento no es válida.'); return value; }
function chooseFont(span: Span) {
 const sans = /sans|arial|helvetica/i.test(span.font);
 const bold = /bold/i.test(span.font), italic = /italic|oblique/i.test(span.font);
 return `Noto${sans ? 'Sans' : 'Serif'}-${bold && italic ? 'BoldItalic' : bold ? 'Bold' : italic ? 'Italic' : 'Regular'}`;
}
function svgPage(page: Page) {
 if (!page.layout) throw new Error('No se encontró el diseño de la página.');
 const { width, height, spans } = page.layout;
 const lines = spans.filter(span => span.text.trim()).map(span => {
  const font = /sans|arial|helvetica/i.test(span.font) ? 'sans-serif' : 'serif';
  const weight = /bold/i.test(span.font) ? 'bold' : 'normal', style = /italic|oblique/i.test(span.font) ? 'italic' : 'normal';
  return `<text x="${number(span.left)}" y="${number(span.top)}" dominant-baseline="hanging" font-family="${font}" font-size="${number(span.height)}" font-weight="${weight}" font-style="${style}" textLength="${Math.max(1, number(span.width))}" lengthAdjust="spacingAndGlyphs" xml:space="preserve">${escapeXml(span.text)}</text>`;
 }).join('');
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${number(width)}" height="${number(height)}" viewBox="0 0 ${number(width)} ${number(height)}" aria-hidden="true">${lines}</svg>`;
}

export async function epub(story: Story): Promise<ExportResult> {
 if (!story.pages.length) throw new Error('No hay páginas para exportar.');
 const zip = new JSZip();
 zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
 zip.file('META-INF/container.xml', '<?xml version="1.0" encoding="utf-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
 const title = escapeXml(story.title), author = escapeXml(story.author || 'Autor desconocido');
 const fixed = story.pages.every(page => !!page.layout && Array.isArray(page.layout.spans));
 const nav: string[] = [], manifest: string[] = [], spine: string[] = [];
 for (let i = 0; i < story.pages.length; i++) {
  const page = story.pages[i], name = `page-${String(i + 1).padStart(5, '0')}.xhtml`;
  nav.push(`<li><a href="${name}">Página ${i + 1}</a></li>`);
  manifest.push(`<item id="p${i}" href="${name}" media-type="application/xhtml+xml"${fixed ? ' properties="svg"' : ''}/>`);
  spine.push(`<itemref idref="p${i}"/>`);
  const viewport = page.layout ? `<meta name="viewport" content="width=${number(page.layout.width)},height=${number(page.layout.height)}"/>` : '';
  const body = page.layout ? `${svgPage(page)}<div class="a11y">${page.layout.spans.filter(span => span.text.trim()).map(span => `<p>${escapeXml(span.text)}</p>`).join('')}</div>` : `<article>${escapeXml(page.text)}</article>`;
  zip.file(`OEBPS/${name}`, `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" lang="es" xml:lang="es"><head><title>${title} - ${i + 1}</title>${viewport}<style>html,body{margin:0;padding:0}svg{display:block;max-width:100%;height:auto}.a11y{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}article{white-space:pre-wrap;overflow-wrap:break-word;line-height:1.6}</style></head><body>${body}</body></html>`);
 }
 const identifier = crypto.randomUUID();
 zip.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="es" xml:lang="es"><head><title>Índice</title></head><body><nav epub:type="toc" id="toc"><h1>${title}</h1><ol>${nav.join('')}</ol></nav></body></html>`);
 zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" prefix="rendition: http://www.idpf.org/vocab/rendition/#"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">urn:uuid:${identifier}</dc:identifier><dc:title>${title}</dc:title><dc:creator>${author}</dc:creator><dc:language>es</dc:language><dc:description>Traducción automática.</dc:description><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}</meta>${fixed ? '<meta property="rendition:layout">pre-paginated</meta>' : ''}</metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${manifest.join('')}</manifest><spine>${spine.join('')}</spine></package>`);
 const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip', compression: 'DEFLATE', compressionOptions: { level: 6 } });
 return { blob, filename: filename(story.title, 'epub') };
}

export async function pdf(story: Story): Promise<ExportResult> {
 if (!story.pages.length) throw new Error('No hay páginas para exportar.');
 const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
 doc.setTitle(story.title); doc.setAuthor(story.author || ''); doc.setSubject('Traducción automática al español');
 const used = new Set(story.pages.flatMap(page => page.layout?.spans.map(chooseFont) || ['NotoSerif-Regular']));
 const loaded = new Map<string, PDFFont>();
 const characterSets = new Map<string, Set<number>>();
 for (const name of used) {
  if (!fonts.includes(name)) throw new Error('Fuente no disponible.');
  const response = await fetch(`/reader-fonts/${name}.ttf`);
  if (!response.ok) throw new Error('La fuente necesaria para el PDF no está disponible sin conexión.');
  const font = await doc.embedFont(await response.arrayBuffer(), { subset: true });
  loaded.set(name, font); characterSets.set(name, new Set(font.getCharacterSet()));
 }
 for (const source of story.pages) {
  if (source.layout) {
   const { width, height, spans } = source.layout;
   const page = doc.addPage([number(width), number(height)]), keys = new Map<string, PDFName>();
   for (const span of spans) {
    if (!span.text.trim()) continue;
    const name = chooseFont(span), font = loaded.get(name);
    if (!font) throw new Error('Fuente no disponible.');
    const supported = characterSets.get(name)!;
    for (const char of span.text) if (!supported.has(char.codePointAt(0)!)) throw new Error('El PDF no puede representar algunos caracteres de la historia.');
    let key = keys.get(name); if (!key) { key = page.node.newFontDictionary(font.name, font.ref); keys.set(name, key); }
    const size = number(span.height), naturalWidth = font.widthOfTextAtSize(span.text, size);
    if (!(size > 0 && naturalWidth > 0 && span.width > 0)) throw new Error('No se pudo ajustar una línea de texto en el PDF.');
    page.pushOperators(pushGraphicsState(), beginText(), setFontAndSize(key, size), setCharacterSqueeze(100 * number(span.width) / naturalWidth), setTextMatrix(1, 0, 0, 1, number(span.left), number(height - span.top - size * .83)), showText(font.encodeText(span.text)), endText(), popGraphicsState());
   }
  } else {
   const font = loaded.get('NotoSerif-Regular')!, supported = characterSets.get('NotoSerif-Regular')!;
   for (const char of source.text) if (char !== '\n' && char !== '\r' && !supported.has(char.codePointAt(0)!)) throw new Error('El PDF no puede representar algunos caracteres de la historia.');
   const size = 12, width = 595, height = 842, margin = 50, lineHeight = 19; let page = doc.addPage([width, height]), y = height - margin;
   for (const paragraph of source.text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/u).filter(Boolean)) {
     const next = line ? `${line} ${word}` : word;
     if (font.widthOfTextAtSize(next, size) > width - margin * 2 && line) { page.drawText(line, { x: margin, y, font, size }); y -= lineHeight; line = word; }
     else line = next;
     if (font.widthOfTextAtSize(line, size) > width - margin * 2) throw new Error('Una palabra no cabe en el PDF.');
     if (y < margin) { page = doc.addPage([width, height]); y = height - margin; }
    }
    if (line) page.drawText(line, { x: margin, y, font, size });
    y -= lineHeight; if (y < margin) { page = doc.addPage([width, height]); y = height - margin; }
   }
  }
 }
 const bytes = await doc.save();
 return { blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }), filename: filename(story.title, 'pdf') };
}
