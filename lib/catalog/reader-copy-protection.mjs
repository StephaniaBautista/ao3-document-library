// These browser controls deter ordinary copying; they cannot protect delivered text
// from screenshots, developer tools, extensions, or access to the source file.
export function protectReaderDocument(document) {
  const style = document.createElement('style');
  style.textContent = 'html, body, body * { -webkit-user-select: none !important; user-select: none !important; -webkit-touch-callout: none !important; }';
  (document.head || document.documentElement).appendChild(style);

  const prevent = event => event.preventDefault();
  for (const type of ['copy', 'cut', 'dragstart', 'contextmenu']) {
    document.addEventListener(type, prevent, true);
  }
}
