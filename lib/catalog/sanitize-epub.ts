/** Prevent embedded EPUB markup from executing or silently loading remote resources. */
export function sanitizeEpubDocument(document: Document) {
 document.querySelectorAll('script, iframe, object, embed, base, meta[http-equiv]').forEach(element => element.remove());
 for (const element of Array.from(document.querySelectorAll('*'))) {
  for (const attribute of Array.from(element.attributes)) {
   const name = attribute.name.toLowerCase(), value = attribute.value.trim();
   if (name.startsWith('on') || name === 'srcset' || ((name === 'src' || name === 'href' || name === 'xlink:href' || name === 'poster') && (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//'))) || (name === 'style' && /url\s*\(|@import/i.test(value))) element.removeAttribute(attribute.name);
  }
  if (element.tagName.toLowerCase() === 'style' && /url\s*\(|@import/i.test(element.textContent || '')) element.remove();
 }
}
