import base64
import importlib.util
import io
import json
import os
import shutil
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import zipfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest.mock import patch
from main import Handler, extract_ao3_pdf_summary, extract_epub, extract_html_range, extract_pdf_page, extract_pdf_range, safe_xml, validate_source_url


def epub_fixture(href='chapter.xhtml', chapter=None):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as archive:
        archive.writestr('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>')
        archive.writestr('OEBPS/book.opf', f'''<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Story</dc:title><dc:creator>Author</dc:creator><dc:description>Original summary</dc:description></metadata><manifest><item id="c" href="{href}"/></manifest><spine><itemref idref="c"/></spine></package>''')
        archive.writestr('OEBPS/chapter.xhtml', chapter if chapter is not None else '<html><body><p>First paragraph.</p><script>ignore me</script><a href="https://archiveofourown.org/works/123">Link</a></body></html>')
    return buffer.getvalue()


class ExtractorTests(unittest.TestCase):
    def test_pdf_summary_requires_a_visible_end(self):
        header = 'Posted originally on the Archive of Our Own\nSummary\n\n'
        summary = '          First line\n          second line.\n\n'
        self.assertEqual(extract_ao3_pdf_summary(header + summary + '     First line of story.'), 'First line second line.')
        self.assertIsNone(extract_ao3_pdf_summary(header + summary))
        self.assertIsNone(extract_ao3_pdf_summary('Summary\n          A summary.\nNotes'))
        self.assertEqual(extract_ao3_pdf_summary([header + summary, '          continued here.\n\nNotes\n  Not summary.']), 'First line second line. continued here.')
        self.assertEqual(extract_ao3_pdf_summary([header + summary, '                  A chapter title\nChapter Notes\n    Notes']), 'First line second line.')
        fichub = 'Title\nBy: Author\nA real summary\ncontinues here.\nStatus: complete\nExported with the assistance of FicHub.net'
        self.assertEqual(extract_ao3_pdf_summary(fichub), 'A real summary continues here.')

    def test_html_reading_preserves_text_and_ignores_executable_markup(self):
        result = extract_html_range(b'<h1>Story</h1><p>Hello world.</p><script>secret()</script><p>Second paragraph.</p>', 0, 1)
        self.assertEqual(result['total'], 1)
        self.assertIn('Hello world.', result['pages'][0])
        self.assertIn('Second paragraph.', result['pages'][0])
        self.assertNotIn('secret()', result['pages'][0])

    def test_html_reading_chunks_without_losing_content(self):
        data = ('<p>' + 'abcde' * 20000 + '</p>').encode()
        first = extract_html_range(data, 0, 1)
        last = extract_html_range(data, 1, 10)
        self.assertEqual(first['total'], 3)
        self.assertEqual(''.join(first['pages'] + last['pages']), 'abcde' * 20000)
    def test_epub_extracts_metadata_and_ignores_script(self):
        data = extract_epub(epub_fixture())
        self.assertEqual(data['metadata']['description'], 'Original summary')
        self.assertIn('First paragraph.', data['text'])
        self.assertIn('archiveofourown.org/works/123', data['text'])
        self.assertNotIn('ignore me', data['text'])

    def test_first_section_matches_the_start_of_full_extraction(self):
        first = extract_epub(epub_fixture(), full=True, first_only=True)['pages']
        full = extract_epub(epub_fixture(), full=True)['pages']
        self.assertEqual(first, full[:len(first)])
        self.assertIn('First paragraph.', first[0])

    def test_epub_ranges_preserve_spine_and_report_unavailable_sections(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as archive:
            archive.writestr('META-INF/container.xml', '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>')
            archive.writestr('book.opf', '<package><manifest><item id="a" href="a.xhtml"/><item id="remote" href="https://example.invalid/x"/><item id="b" href="b.xhtml"/><item id="c" href="c.xhtml"/></manifest><spine><itemref idref="a"/><itemref idref="remote"/><itemref idref="missing"/><itemref idref="b"/><itemref idref="c"/></spine></package>')
            for name in ('a', 'b', 'c'):
                archive.writestr(name + '.xhtml', f'<html><body>Section {name}</body></html>')
        data = buffer.getvalue()
        preview = extract_epub(data, full=True, first_only=True)['pages']
        first = extract_epub(data, full=True, range_start=0, range_limit=1)
        self.assertIn('Section a', preview[0])
        self.assertEqual(first['total'], 5)
        self.assertEqual(first['pages'], preview)
        with self.assertRaisesRegex(ValueError, 'EPUB section unavailable'):
            extract_epub(data, full=True, range_start=1, range_limit=1)
        with self.assertRaisesRegex(ValueError, 'EPUB section unavailable'):
            extract_epub(data, full=True, range_start=2, range_limit=1)
        self.assertEqual(len(extract_epub(data, full=True, range_start=3, range_limit=2)['pages']), 2)

    def test_epub_navigation_maps_fragment_anchors_to_text_offsets(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as archive:
            archive.writestr('META-INF/container.xml', '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>')
            archive.writestr('book.opf', '<package><manifest><item id="nav" href="nav.xhtml" properties="nav"/><item id="a" href="a.xhtml"/><item id="b" href="b.xhtml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>')
            archive.writestr('nav.xhtml', '<html xmlns:epub="http://www.idpf.org/2007/ops"><nav epub:type="toc"><a href="a.xhtml">First</a><a href="b.xhtml#middle">Middle</a><a href="b.xhtml#last">Last</a><a href="b.xhtml">Second</a><a href="https://example.invalid/a">Remote</a></nav></html>')
            archive.writestr('a.xhtml', '<html><p>First</p></html>')
            archive.writestr('b.xhtml', '<html><p>🐈 Before</p><h1 id="middle">Middle text</h1><p id="last">Last text</p></html>')
        result = extract_epub(buffer.getvalue(), full=True, range_start=0, range_limit=1)
        self.assertEqual(result['chapters'], [{'title': 'First', 'page': 0}, {'title': 'Middle', 'page': 1, 'anchor': 'middle'}, {'title': 'Last', 'page': 1, 'anchor': 'last'}, {'title': 'Second', 'page': 1}])
        second = extract_epub(buffer.getvalue(), full=True, range_start=1, range_limit=1)
        offsets = {item['id']: item['offset'] for item in second['anchors']}
        for anchor, expected in [('middle', 'Middle text'), ('last', 'Last text')]:
            encoded = second['pages'][0].encode('utf-16-le')
            self.assertTrue(encoded[offsets[anchor] * 2:].decode('utf-16-le').lstrip().startswith(expected))

    def test_epub2_ncx_navigation_maps_sections_and_fragments(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as archive:
            archive.writestr('META-INF/container.xml', '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>')
            archive.writestr('book.opf', '<package><manifest><item id="toc" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="a" href="a.xhtml"/></manifest><spine><itemref idref="a"/></spine></package>')
            archive.writestr('toc.ncx', '<ncx><navMap><navPoint><navLabel><text>Chapter One</text></navLabel><content src="a.xhtml"/></navPoint><navPoint><navLabel><text>Chapter Two</text></navLabel><content src="a.xhtml#two"/></navPoint></navMap></ncx>')
            archive.writestr('a.xhtml', '<html><p>First</p><p id="two">Second</p></html>')
        result = extract_epub(buffer.getvalue(), full=True, range_start=0, range_limit=1)
        self.assertEqual(result['chapters'], [{'title': 'Chapter One', 'page': 0}, {'title': 'Chapter Two', 'page': 0, 'anchor': 'two'}])
        marker = next(item['offset'] for item in result['anchors'] if item['id'] == 'two')
        self.assertTrue(result['pages'][0][marker:].lstrip().startswith('Second'))

    def test_unsafe_xml_is_rejected(self):
        unsafe = '<!DOCTYPE x [<!ENTITY a "x">]><x>&a;</x>'
        for encoding in ('utf-8', 'utf-16', 'utf-16-le', 'utf-16-be'):
            with self.subTest(encoding=encoding), self.assertRaises(ValueError):
                safe_xml(unsafe.encode(encoding))

    def test_epub_chapters_preserve_supported_unicode_and_reject_invalid_bytes(self):
        chapter = '<html><body><p>Español, 日本語, café, 🐈.</p></body></html>'
        for encoding in ('utf-8', 'utf-8-sig', 'utf-16', 'utf-16-le', 'utf-16-be'):
            with self.subTest(encoding=encoding):
                pages = extract_epub(epub_fixture(chapter=chapter.encode(encoding)), full=True)['pages']
                self.assertIn('Español, 日本語, café, 🐈.', pages[0])
        with self.assertRaises(UnicodeDecodeError):
            extract_epub(epub_fixture(chapter=b'<html><body>\xff</body></html>'), full=True)

    def test_path_traversal_is_rejected(self):
        with self.assertRaises(ValueError):
            extract_epub(epub_fixture('../../../secret.xhtml'))

    def test_range_endpoint_validates_parameters_and_returns_requested_epub_sections(self):
        extractor = HTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=extractor.serve_forever, daemon=True)
        thread.start()
        origin = f'http://127.0.0.1:{extractor.server_port}'
        try:
            with patch.dict(os.environ, {'EXTRACTOR_TOKEN': 'test-extractor-secret'}):
                headers = {'Authorization': 'Bearer test-extractor-secret', 'Content-Type': 'application/epub+zip'}
                request = urllib.request.Request(f'{origin}/extract-range?start=0&limit=10', data=epub_fixture(), headers=headers)
                with urllib.request.urlopen(request, timeout=30) as response:
                    result = json.load(response)
                self.assertEqual((result['start'], result['total']), (0, 1))
                self.assertIn('First paragraph.', result['pages'][0])
                for query in ('start=-1&limit=10', 'start=0&limit=11', 'start=0&limit=1&limit=2', 'start=0&limit=1&extra=x'):
                    request = urllib.request.Request(f'{origin}/extract-range?{query}', data=epub_fixture(), headers=headers)
                    with self.assertRaises(urllib.error.HTTPError) as error:
                        urllib.request.urlopen(request, timeout=30)
                    self.assertEqual(error.exception.code, 422)
                    error.exception.close()
        finally:
            extractor.shutdown()
            extractor.server_close()
            thread.join(5)

    def test_source_url_must_match_the_configured_origin_and_exact_path(self):
        origin = 'https://library.example'
        validate_source_url('https://library.example/api/internal/extractor-file/story-1', origin)
        for url in ('https://attacker.example/api/internal/extractor-file/story-1',
                    'https://library.example@attacker.example/api/internal/extractor-file/story-1',
                    'https://library.example/api/internal/extractor-file/story-1?next=secret',
                    'http://library.example/api/internal/extractor-file/story-1',
                    'https://library.example/admin'):
            with self.assertRaises(ValueError):
                validate_source_url(url, origin)

    @unittest.skipUnless(importlib.util.find_spec('pypdf'), 'pypdf is required to test PDF pages')
    def test_extracts_only_the_requested_pdf_page_for_ocr(self):
        from pypdf import PdfReader, PdfWriter
        source = io.BytesIO()
        writer = PdfWriter()
        writer.add_blank_page(width=300, height=400)
        writer.add_blank_page(width=500, height=600)
        writer.write(source)
        result = extract_pdf_page(source.getvalue(), 2)
        output = PdfReader(io.BytesIO(base64.b64decode(result['pdf'])))
        self.assertEqual(len(output.pages), 1)
        self.assertEqual(float(output.pages[0].mediabox.width), 500)
        with self.assertRaises(ValueError):
            extract_pdf_page(source.getvalue(), 3)

    @unittest.skipUnless(importlib.util.find_spec('pypdf'), 'pypdf is required to test PDF pages')
    def test_pdf_range_returns_only_requested_pages(self):
        from pypdf import PdfWriter
        source = io.BytesIO()
        writer = PdfWriter()
        for _ in range(13):
            writer.add_blank_page(width=300, height=400)
        writer.write(source)
        result = extract_pdf_range(source.getvalue(), 10, 10)
        self.assertEqual(result['start'], 10)
        self.assertEqual(result['total'], 13)
        self.assertEqual(len(result['pages']), 3)

    @unittest.skipUnless(importlib.util.find_spec('pypdfium2'), 'pypdfium2 is required for PDF layout')
    def test_pdf_layout_preserves_text_and_positions_without_returning_the_source(self):
        from pypdf import PdfWriter
        from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
        writer = PdfWriter()
        page = writer.add_blank_page(width=300, height=400)
        font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
        page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
        stream = DecodedStreamObject()
        stream.set_data(b'BT /F1 16 Tf .75 0 0 .75 30 330 Tm (A simple story, with words.) Tj ET')
        page[NameObject('/Contents')] = writer._add_object(stream)
        source = io.BytesIO()
        writer.write(source)
        result = extract_pdf_range(source.getvalue(), 0, 1, layout=True)
        layout = result['layouts'][0]
        self.assertEqual((layout['width'], layout['height']), (300, 400))
        self.assertEqual(''.join(span['text'] for span in layout['spans']), 'A simple story, with words.')
        self.assertAlmostEqual(layout['spans'][0]['left'], 30, delta=1)
        self.assertTrue(50 < layout['spans'][0]['top'] < 80)
        self.assertAlmostEqual(layout['spans'][0]['height'], 12, delta=0.1)
        self.assertNotIn('pdf', result)
        self.assertNotIn('layouts', extract_pdf_range(source.getvalue(), 0, 1))
        extractor = HTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=extractor.serve_forever, daemon=True)
        thread.start()
        try:
            with patch.dict(os.environ, {'EXTRACTOR_TOKEN': 'test-extractor-secret'}):
                headers = {'Authorization': 'Bearer test-extractor-secret', 'Content-Type': 'application/pdf'}
                request = urllib.request.Request(f'http://127.0.0.1:{extractor.server_port}/extract-range?start=0&limit=1&layout=1', data=source.getvalue(), headers=headers)
                with urllib.request.urlopen(request, timeout=30) as response:
                    payload = json.load(response)
                self.assertEqual(payload['layouts'][0]['spans'][0]['text'], 'A simple story, with words.')
        finally:
            extractor.shutdown()
            extractor.server_close()
            thread.join(5)

    def test_large_epub_download_and_extraction(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, 'large.epub')
            with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_STORED) as archive:
                archive.writestr('META-INF/container.xml', '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>')
                archive.writestr('book.opf', '<package><manifest><item id="c" href="chapter.xhtml"/></manifest><spine><itemref idref="c"/></spine></package>')
                archive.writestr('chapter.xhtml', '<html><body><p>Text from a large EPUB.</p></body></html>')
                with archive.open('unused.bin', 'w', force_zip64=True) as extra:
                    for _ in range(51):
                        extra.write(bytes(1024 * 1024))
            size = os.path.getsize(path)
            self.assertGreater(size, 50 * 1024 * 1024)

            class Source(BaseHTTPRequestHandler):
                def log_message(self, *_args):
                    pass
                def do_GET(self):
                    if self.path != '/api/internal/extractor-file/story-1' or self.headers.get('Authorization') != 'Bearer test.ticket':
                        self.send_error(403)
                        return
                    self.send_response(200)
                    self.send_header('Content-Length', str(size))
                    self.end_headers()
                    with open(path, 'rb') as content:
                        shutil.copyfileobj(content, self.wfile, length=1024 * 1024)

            source = HTTPServer(('127.0.0.1', 0), Source)
            extractor = HTTPServer(('127.0.0.1', 0), Handler)
            threads = [threading.Thread(target=server.serve_forever, daemon=True) for server in (source, extractor)]
            for thread in threads:
                thread.start()
            origin = f'http://127.0.0.1:{source.server_port}'
            try:
                with patch.dict(os.environ, {'EXTRACTOR_TOKEN': 'test-extractor-secret', 'LIBRARY_ORIGIN': origin}):
                    payload = json.dumps({'url': f'{origin}/api/internal/extractor-file/story-1', 'token': 'test.ticket', 'size': size, 'fileType': 'epub'}).encode()
                    request = urllib.request.Request(f'http://127.0.0.1:{extractor.server_port}/extract-full-from-url', data=payload, headers={'Authorization': 'Bearer test-extractor-secret', 'Content-Type': 'application/json'})
                    with urllib.request.urlopen(request, timeout=30) as response:
                        result = json.load(response)
                    self.assertIn('Text from a large EPUB.', result['pages'][0])
                    request = urllib.request.Request(f'http://127.0.0.1:{extractor.server_port}/extract-range-from-url?start=0&limit=10', data=payload, headers={'Authorization': 'Bearer test-extractor-secret', 'Content-Type': 'application/json'})
                    with urllib.request.urlopen(request, timeout=30) as response:
                        result = json.load(response)
                    self.assertEqual(result['start'], 0)
                    self.assertEqual(result['total'], 1)
                    self.assertIn('Text from a large EPUB.', result['pages'][0])
            finally:
                for server in (source, extractor):
                    server.shutdown()
                    server.server_close()
                for thread in threads:
                    thread.join(5)


if __name__ == '__main__':
    unittest.main()
