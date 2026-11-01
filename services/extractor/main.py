"""Isolated, read-only metadata extraction for library PDF and EPUB files."""
import base64
import hmac
import io
import json
import multiprocessing
import os
import posixpath
import re
import tempfile
import urllib.request
import zipfile
from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler, HTTPServer
from xml.etree import ElementTree
from urllib.parse import parse_qs, unquote, urlsplit

MAX_FILE = 50 * 1024 * 1024
MAX_ENTRY = 4 * 1024 * 1024
MAX_EXPANDED = 100 * 1024 * 1024


def decode_epub_text(data):
    # EPUB XML resources use UTF-8 or UTF-16; never replace invalid bytes,
    # because that would silently change the story before translation.
    if data.startswith((b'\xff\xfe', b'\xfe\xff')):
        text = data.decode('utf-16')
    elif data.startswith(b'\x00<'):
        text = data.decode('utf-16-be')
    elif data.startswith(b'<\x00'):
        text = data.decode('utf-16-le')
    else:
        text = data.decode('utf-8-sig')
    if '\x00' in text:
        raise ValueError('Invalid EPUB text encoding')
    return text


def safe_xml(data):
    if len(data) > MAX_ENTRY:
        raise ValueError('Unsafe XML')
    text = decode_epub_text(data)
    if '<!DOCTYPE' in text.upper() or '<!ENTITY' in text.upper():
        raise ValueError('Unsafe XML')
    return ElementTree.fromstring(text)


def extract_ao3_pdf_summary(layout):
    """Return a summary only when the layout identifies its end."""
    layouts = [layout] if isinstance(layout, str) else layout
    lines = [(page, line) for page, text in enumerate(layouts) for line in text.splitlines()]
    if not any(re.search(r'posted originally on the archive of our own', page, re.I) for page in layouts):
        if not any(re.search(r'exported with the assistance of fichub\.net', page, re.I) for page in layouts):
            return None
        start = next((i for i, (_, line) in enumerate(lines) if re.match(r'\s*by:\s*\S', line, re.I)), None)
        if start is None:
            return None
        end = next((i for i, (_, line) in enumerate(lines) if i > start and re.match(r'\s*status:\s*', line, re.I)), None)
        if end is None:
            return None
        text = ' '.join(line.strip() for _, line in lines[start + 1:end] if line.strip())
        return text[:12000] or None
    start = next((i for i, (_, line) in enumerate(lines) if re.fullmatch(r'\s*summary\s*:?\s*', line, re.I)), None)
    if start is None:
        return None
    content = []
    indent = None
    gaps = 0
    previous_page = None
    for i in range(start + 1, len(lines)):
        page, line = lines[i]
        if not line.strip():
            if content:
                gaps += 1
            continue
        left = len(line) - len(line.lstrip())
        if indent is None:
            indent = left
            if indent < 2:
                return None
        is_section = re.fullmatch(r'\s*(?:notes|chapter notes|chapter(?:\s+\d+)?(?:\s*:\s*.*)?|chapter text)\s*:?\s*', line, re.I)
        next_line = next((following for following_page, following in lines[i + 1:] if following_page == page and following.strip()), '')
        next_indent = len(next_line) - len(next_line.lstrip()) if next_line else indent
        next_is_section = re.fullmatch(r'\s*(?:notes|chapter notes|chapter(?:\s+\d+)?(?:\s*:\s*.*)?|chapter text)\s*:?\s*', next_line, re.I)
        chapter_title = previous_page is not None and page != previous_page and left >= indent + 8 and (next_is_section or next_indent < indent - 1)
        if (is_section and (left < indent or re.match(r'\s*chapter\s+\d+', line, re.I))) or left < indent - 1 or chapter_title:
            return ''.join(content).strip()[:12000] or None
        if content:
            content.append('\n\n' if page == previous_page and gaps >= 2 else ' ')
        content.append(line.strip())
        gaps = 0
        previous_page = page
    return None


def extract_pdf(data):
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data) if isinstance(data, bytes) else data, strict=False)
    if reader.is_encrypted or not reader.pages:
        raise ValueError('PDF unavailable')
    page = reader.pages[0]
    text = page.extract_text() or ''
    links = []
    for annotation in page.get('/Annots', []):
        obj = annotation.get_object()
        action = obj.get('/A')
        if action:
            uri = action.get_object().get('/URI')
            if uri:
                links.append(str(uri))
    layouts = []
    description = None
    for index in range(min(len(reader.pages), 30)):
        layouts.append(reader.pages[index].extract_text(extraction_mode='layout') or '')
        description = extract_ao3_pdf_summary(layouts)
        if description:
            break
        if index >= 7 and not any(re.search(r'posted originally on the archive of our own', text, re.I) or re.search(r'^\s*summary\s*:?\s*$', text, re.I | re.M) for text in layouts):
            break
    return {'text': (text + '\n' + '\n'.join(links))[:100000], 'metadata': {'description': description} if description else {}}


class TextParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.hidden = 0
        self.position = 0
        self.anchors = {}

    def append(self, value):
        self.parts.append(value)
        self.position += len(value.encode('utf-16-le')) // 2

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.hidden += 1
        if not self.hidden:
            for name, value in attrs:
                if name in ('id', 'name') and value and len(value) <= 256 and len(self.anchors) < 5000:
                    self.anchors.setdefault(value, self.position)
        if tag in ('p', 'div', 'h1', 'h2', 'h3', 'li', 'br'):
            self.append('\n')
        if tag == 'a':
            for name, value in attrs:
                if name == 'href' and value and 'archiveofourown.org/works/' in value:
                    self.append('\n' + value + '\n')

    def handle_endtag(self, tag):
        if tag in ('script', 'style') and self.hidden:
            self.hidden -= 1
        if tag in ('p', 'div', 'h1', 'h2', 'h3', 'li'):
            self.append('\n')

    def handle_data(self, data):
        if not self.hidden:
            self.append(data)


def extract_epub(data, full=False, first_only=False, range_start=None, range_limit=None):
    with zipfile.ZipFile(io.BytesIO(data) if isinstance(data, bytes) else data) as archive:
        entries = archive.infolist()
        if len(entries) > 10000 or sum(entry.file_size for entry in entries) > MAX_EXPANDED:
            raise ValueError('EPUB expands beyond processing limit')
        def read(name):
            info = archive.getinfo(name)
            if info.file_size > MAX_ENTRY or info.flag_bits & 1:
                raise ValueError('EPUB entry unavailable')
            return archive.read(info)
        container = safe_xml(read('META-INF/container.xml'))
        rootfile = next((x.attrib.get('full-path') for x in container.iter() if x.tag.endswith('rootfile')), None)
        if not rootfile:
            raise ValueError('EPUB package missing')
        rootfile = posixpath.normpath(rootfile)
        if rootfile.startswith('../') or rootfile.startswith('/'):
            raise ValueError('Invalid EPUB package path')
        package = safe_xml(read(rootfile))
        metadata = {}
        for entry in package.iter():
            name = entry.tag.rsplit('}', 1)[-1]
            if name in ('title', 'creator', 'description', 'language') and entry.text and name not in metadata:
                metadata[name] = entry.text.strip()[:12000]
        manifest = {x.attrib.get('id'): x.attrib.get('href') for x in package.iter() if x.tag.endswith('item') and x.attrib.get('id')}
        spine = [x.attrib.get('idref') for x in package.iter() if x.tag.endswith('itemref')]
        paths = []
        for item_id in spine if full else spine[:2]:
            href = manifest.get(item_id)
            if not href or re.match(r'^[a-z][a-z0-9+.-]*:', href, re.I) or href.startswith('//'):
                # Preserve the spine index for full translation. The first
                # readable section may still be returned, but a later missing
                # or remote section must never be silently reported as done.
                if full:
                    paths.append(None)
                continue
            path = posixpath.normpath(posixpath.join(posixpath.dirname(rootfile), unquote(href.split('#')[0])))
            if path.startswith('../') or path.startswith('/'):
                raise ValueError('Invalid EPUB path')
            paths.append(path)
        selected = paths[range_start:range_start + range_limit] if range_start is not None else paths
        sections = []
        section_anchors = []
        for path in selected:
            if path is None:
                raise ValueError('EPUB section unavailable')
            parser = TextParser()
            parser.feed(decode_epub_text(read(path)))
            section = ''.join(parser.parts)
            sections.append(section)
            section_anchors.append([{'id': key, 'offset': offset} for key, offset in parser.anchors.items()])
            if first_only and section.strip():
                break
        if full:
            result = {'pages': sections}
            if range_start is not None:
                result.update({'start': range_start, 'total': len(paths)})
                if len(section_anchors) == 1:
                    result['anchors'] = section_anchors[0]
                try:
                    chapters, seen = [], set()
                    def add_chapter(href, label, navigation_path):
                        if not label or not href or re.match(r'^[a-z][a-z0-9+.-]*:', href, re.I) or href.startswith('//'):
                            return
                        parts = urlsplit(href)
                        if parts.query or parts.netloc or parts.scheme:
                            return
                        target = posixpath.normpath(posixpath.join(posixpath.dirname(navigation_path), unquote(parts.path)))
                        fragment = unquote(parts.fragment)
                        if target not in paths or len(fragment) > 256:
                            return
                        index = paths.index(target)
                        key = (index, fragment)
                        if key not in seen:
                            chapter = {'title': label, 'page': index}
                            if fragment:
                                chapter['anchor'] = fragment
                            chapters.append(chapter)
                            seen.add(key)
                    nav = next((x for x in package.iter() if x.tag.endswith('item') and 'nav' in x.attrib.get('properties', '').split()), None)
                    if nav is not None:
                        nav_href = nav.attrib.get('href', '')
                        if re.match(r'^[a-z][a-z0-9+.-]*:', nav_href, re.I) or nav_href.startswith('//'):
                            raise ValueError('Invalid EPUB navigation')
                        nav_path = posixpath.normpath(posixpath.join(posixpath.dirname(rootfile), unquote(nav_href)))
                        if nav_path.startswith('../') or nav_path.startswith('/'):
                            raise ValueError('Invalid EPUB navigation')
                        doc = safe_xml(read(nav_path))
                        toc = next((x for x in doc.iter() if x.tag.endswith('nav') and any('toc' in value.split() for key, value in x.attrib.items() if key.rsplit('}', 1)[-1] == 'type')), None)
                        for anchor in toc.iter() if toc is not None else []:
                            href = anchor.attrib.get('href', '')
                            label = ' '.join(''.join(anchor.itertext()).split())[:200]
                            if not anchor.tag.endswith('a'):
                                continue
                            add_chapter(href, label, nav_path)
                            if len(chapters) >= 500:
                                break
                        result['chapters'] = chapters
                    else:
                        # EPUB 2 stores its table of contents in an NCX file.
                        ncx = next((x for x in package.iter() if x.tag.endswith('item') and x.attrib.get('media-type') == 'application/x-dtbncx+xml'), None)
                        if ncx is not None:
                            href = ncx.attrib.get('href', '')
                            if not href or re.match(r'^[a-z][a-z0-9+.-]*:', href, re.I) or href.startswith('//'):
                                raise ValueError('Invalid EPUB navigation')
                            ncx_path = posixpath.normpath(posixpath.join(posixpath.dirname(rootfile), unquote(href)))
                            if ncx_path.startswith('../') or ncx_path.startswith('/'):
                                raise ValueError('Invalid EPUB navigation')
                            doc = safe_xml(read(ncx_path))
                            for point in (x for x in doc.iter() if x.tag.endswith('navPoint')):
                                content = next((x for x in point if x.tag.endswith('content')), None)
                                label_node = next((x for x in point if x.tag.endswith('navLabel')), None)
                                target_href = content.attrib.get('src', '') if content is not None else ''
                                label = ' '.join(''.join(label_node.itertext()).split())[:200] if label_node is not None else ''
                                add_chapter(target_href, label, ncx_path)
                                if len(chapters) >= 500:
                                    break
                            result['chapters'] = chapters
                except (KeyError, ValueError, ElementTree.ParseError, UnicodeError):
                    result['chapters'] = []
            return result
        return {'text': '\n'.join(sections)[:100000], 'metadata': metadata}


def extract_full_pdf(data, first_only=False):
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data) if isinstance(data, bytes) else data, strict=False)
    if reader.is_encrypted or not reader.pages:
        raise ValueError('PDF unavailable')
    pages = reader.pages[:1] if first_only else reader.pages
    return {'pages': [page.extract_text() or '' for page in pages]}


def extract_pdf_range(data, start, limit, layout=False):
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data) if isinstance(data, bytes) else data, strict=False)
    if reader.is_encrypted or not reader.pages:
        raise ValueError('PDF unavailable')
    total = len(reader.pages)
    pages = [reader.pages[i].extract_text() or '' for i in range(start, min(start + limit, total))]
    result = {'start': start, 'total': total, 'pages': pages}
    if layout:
        result['layouts'] = extract_pdf_layouts(data, start, min(start + limit, total))
    return result


def extract_pdf_layouts(data, start, end):
    # Only text and geometry leave the extractor; the original PDF remains private.
    import ctypes
    import math
    import pypdfium2 as pdfium
    import pypdfium2.raw as raw
    from contextlib import closing
    if hasattr(data, 'seek'):
        data.seek(0)
        data = data.read()
    layouts = []
    with pdfium.PdfDocument(data) as document:
        for index in range(start, end):
            with closing(document[index]) as page, closing(page.get_textpage()) as textpage:
                width, height = page.get_size()
                if not 0 < width <= 10000 or not 0 < height <= 10000:
                    raise ValueError('Invalid page dimensions')
                spans = []
                # A page with no PDF objects is truly blank. An image-only
                # page must still go through OCR, not be silently discarded.
                blank = next(page.get_objects(), None) is None
                if textpage.count_chars() > 100000:
                    layouts.append(None)
                    continue
                for i in range(textpage.count_chars()):
                    char = chr(raw.FPDFText_GetUnicode(textpage, i) or 0)
                    if char in ('\x00', '\r', '\n'):
                        continue
                    left, bottom, right, top = textpage.get_charbox(i, loose=True)
                    matrix = raw.FS_MATRIX()
                    if not raw.FPDFText_GetMatrix(textpage, i, ctypes.byref(matrix)):
                        continue
                    size = raw.FPDFText_GetFontSize(textpage, i) * math.hypot(matrix.c, matrix.d)
                    if not (0 < size <= 1000):
                        continue
                    if char.isspace():
                        if spans:
                            spans[-1]['text'] += char
                        continue
                    if spans and abs(spans[-1]['baseline'] - bottom) < size * 0.25 and abs(spans[-1]['height'] - size) < size * 0.15 and left >= spans[-1]['right'] - size * 0.4 and left - spans[-1]['right'] < size * 2:
                        spans[-1]['text'] += char
                        spans[-1]['right'] = max(spans[-1]['right'], right)
                    else:
                        obj = textpage.get_textobj(i)
                        name = obj.get_font().get_base_name() if obj else ''
                        spans.append({'text': char, 'left': left, 'top': height - top,
                                      'height': size, 'right': right, 'baseline': bottom,
                                      'font': name[:200]})
                for span in spans:
                    span['width'] = max(0, span.pop('right') - span['left'])
                    span.pop('baseline')
                layouts.append({'width': width, 'height': height, 'spans': spans, 'blank': blank})
    return layouts


def extract_pdf_page(data, page_number):
    from pypdf import PdfReader, PdfWriter
    reader = PdfReader(io.BytesIO(data) if isinstance(data, bytes) else data, strict=False)
    if reader.is_encrypted or page_number < 1 or page_number > len(reader.pages):
        raise ValueError('PDF page unavailable')
    writer = PdfWriter()
    writer.add_page(reader.pages[page_number - 1])
    output = io.BytesIO()
    writer.write(output)
    page = output.getvalue()
    if len(page) > 7 * 1024 * 1024:
        raise ValueError('PDF page exceeds OCR service limit')
    return {'pdf': base64.b64encode(page).decode('ascii')}


def extract_html_range(data, start, limit):
    raw = data.read() if hasattr(data, 'read') else data
    parser = TextParser()
    parser.feed(decode_epub_text(raw))
    text = ''.join(parser.parts).strip()
    # Bound responses while retaining all source text in sequential chunks.
    chunks = [text[i:i + 40000] for i in range(0, len(text), 40000)] or ['']
    return {'start': start, 'total': len(chunks), 'pages': chunks[start:start + limit]}


def worker(data, file_type, full, first_only, page_number, range_start, range_limit, layout, connection):
    try:
        try:
            import resource
            resource.setrlimit(resource.RLIMIT_CPU, (120, 120))
            resource.setrlimit(resource.RLIMIT_AS, (1536 * 1024 * 1024, 1536 * 1024 * 1024))
        except (ImportError, ValueError, OSError):
            pass
        with open(data, 'rb') if isinstance(data, str) else io.BytesIO(data) as source:
            result = extract_html_range(source, range_start or 0, range_limit or 1) if file_type == 'html' else extract_pdf_page(source, page_number) if page_number is not None else extract_pdf_range(source, range_start, range_limit, layout=layout) if range_start is not None and file_type == 'pdf' else extract_full_pdf(source, first_only=first_only) if full and file_type == 'pdf' else extract_pdf(source) if file_type == 'pdf' else extract_epub(source, full=full, first_only=first_only, range_start=range_start, range_limit=range_limit)
        connection.send((True, result))
    except Exception:
        connection.send((False, None))
    finally:
        connection.close()


def ocr_worker(data, image, page_number, connection):
    try:
        try:
            import resource
            resource.setrlimit(resource.RLIMIT_CPU, (120, 120))
            resource.setrlimit(resource.RLIMIT_AS, (1536 * 1024 * 1024, 1536 * 1024 * 1024))
        except (ImportError, ValueError, OSError):
            pass
        from xiaomi_ocr import infer, render_pdf_page
        page = data if image else render_pdf_page(data, page_number)
        connection.send((True, infer(page)))
    except Exception:
        connection.send((False, None))
    finally:
        connection.close()


def validate_source_url(url, origin):
    source, allowed = urlsplit(url), urlsplit(origin)
    if (allowed.scheme not in ('http', 'https') or not allowed.hostname or allowed.username or allowed.password
            or allowed.path not in ('', '/') or allowed.query or allowed.fragment
            or (allowed.scheme == 'http' and allowed.hostname not in ('localhost', '127.0.0.1'))
            or source.scheme != allowed.scheme or source.netloc != allowed.netloc or source.query or source.fragment
            or not re.fullmatch(r'/api/internal/extractor-file/[\w-]{1,128}', source.path)):
        raise ValueError('Invalid source')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def download_to_temporary(url, token, size, origin):
    validate_source_url(url, origin)
    if not isinstance(token, str) or not re.fullmatch(r'[\w.-]{1,512}', token) or not isinstance(size, int) or isinstance(size, bool) or size <= 0:
        raise ValueError('Invalid download request')
    request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token})
    path = None
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=120) as response:
            if response.status != 200:
                raise ValueError('Source unavailable')
            received = 0
            with tempfile.NamedTemporaryFile(prefix='extract-', delete=False) as output:
                path = output.name
                while True:
                    chunk = response.read(min(1024 * 1024, size - received + 1))
                    if not chunk:
                        break
                    received += len(chunk)
                    if received > size:
                        raise ValueError('Unexpected source size')
                    output.write(chunk)
            if received != size:
                raise ValueError('Incomplete source')
        return path
    except Exception:
        if path:
            os.unlink(path)
        raise


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass  # Never log filenames, document content, or authorization headers.

    def do_POST(self):
        expected = os.environ.get('EXTRACTOR_TOKEN', '')
        if not expected or not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + expected):
            self.send_error(403)
            return
        parsed = urlsplit(self.path)
        path = parsed.path
        from_url = path in ('/extract-from-url', '/extract-full-from-url', '/extract-first-from-url', '/extract-page-from-url', '/extract-range-from-url', '/ocr-pdf-from-url')
        ocr = path in ('/ocr-image', '/ocr-pdf', '/ocr-pdf-from-url')
        file_type = {'application/pdf': 'pdf', 'application/epub+zip': 'epub', 'text/html': 'html'}.get(self.headers.get('Content-Type', ''))
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            length = 0
        if path not in ('/extract', '/extract-full', '/extract-first', '/extract-range', '/extract-from-url', '/extract-full-from-url', '/extract-first-from-url', '/extract-page-from-url', '/extract-range-from-url', '/ocr-image', '/ocr-pdf', '/ocr-pdf-from-url') or length <= 0 or length > (8192 if from_url else 6 * 1024 * 1024 if path == '/ocr-image' else MAX_FILE) or (from_url and self.headers.get('Content-Type') != 'application/json') or (not from_url and path == '/ocr-image' and self.headers.get('Content-Type') != 'image/jpeg') or (not from_url and path == '/ocr-pdf' and file_type != 'pdf') or (not from_url and not ocr and not file_type):
            self.send_error(400)
            return
        temporary = None
        page_number = None
        range_start = range_limit = None
        layout = False
        try:
            if path in ('/extract-range', '/extract-range-from-url'):
                query = parse_qs(parsed.query, keep_blank_values=True, strict_parsing=True)
                if set(query) not in ({'start', 'limit'}, {'start', 'limit', 'layout'}) or ('layout' in query and query['layout'] != ['1']) or len(query['start']) != 1 or len(query['limit']) != 1 or not re.fullmatch(r'\d{1,9}', query['start'][0]) or not re.fullmatch(r'\d{1,2}', query['limit'][0]):
                    raise ValueError('Invalid range')
                range_start, range_limit = int(query['start'][0]), int(query['limit'][0])
                layout = 'layout' in query
                if not 1 <= range_limit <= 10:
                    raise ValueError('Invalid range')
            elif path == '/ocr-pdf':
                query = parse_qs(parsed.query, keep_blank_values=True, strict_parsing=True)
                if set(query) != {'page'} or len(query['page']) != 1 or not re.fullmatch(r'\d{1,6}', query['page'][0]):
                    raise ValueError('Invalid page')
                page_number = int(query['page'][0])
                if not 1 <= page_number <= 100000:
                    raise ValueError('Invalid page')
            elif parsed.query:
                raise ValueError('Unexpected query')
            data = self.rfile.read(length)
            if from_url:
                request = json.loads(data)
                if not isinstance(request, dict) or request.get('fileType') not in ('pdf', 'epub', 'html'):
                    raise ValueError('Invalid source')
                file_type = request['fileType']
                if path in ('/extract-page-from-url', '/ocr-pdf-from-url'):
                    page_number = request.get('page')
                    if file_type != 'pdf' or not isinstance(page_number, int) or isinstance(page_number, bool) or not 1 <= page_number <= 100000:
                        raise ValueError('Invalid page')
                temporary = download_to_temporary(request.get('url', ''), request.get('token', ''), request.get('size'), os.environ.get('LIBRARY_ORIGIN', ''))
                data = temporary
        except Exception:
            self.send_error(422)
            return
        parent, child = multiprocessing.Pipe(False)
        first_only = path in ('/extract-first', '/extract-first-from-url')
        full = first_only or path in ('/extract-full', '/extract-full-from-url', '/extract-range', '/extract-range-from-url')
        process = multiprocessing.Process(target=ocr_worker, args=(data, path == '/ocr-image', page_number, child)) if ocr else multiprocessing.Process(target=worker, args=(data, file_type, full, first_only, page_number, range_start, range_limit, layout, child))
        ok, result = False, None
        try:
            process.start()
            child.close()
            if parent.poll(150):
                try:
                    ok, result = parent.recv()
                except EOFError:
                    pass
        finally:
            if process.is_alive():
                process.terminate()
            if process.pid:
                process.join(5)
            parent.close()
            child.close()
            if temporary:
                os.unlink(temporary)
        if not ok:
            self.send_error(422)
            return
        payload = json.dumps(result, ensure_ascii=False).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(payload)


if __name__ == '__main__':
    HTTPServer((os.environ.get('EXTRACTOR_HOST', '0.0.0.0'), int(os.environ.get('PORT', '8080'))), Handler).serve_forever()
