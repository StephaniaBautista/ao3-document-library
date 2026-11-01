import io
import json
import os
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest.mock import patch

from PIL import Image
from pypdf import PdfWriter
from main import Handler
from xiaomi_ocr import infer, render_pdf_page


class ModelHandler(BaseHTTPRequestHandler):
    finish_reason = 'stop'
    last_request = None

    def log_message(self, *_args):
        pass

    def do_POST(self):
        ModelHandler.last_request = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        payload = json.dumps({'choices': [{'finish_reason': ModelHandler.finish_reason, 'message': {'content': 'Scanned sample'}}]}).encode()
        self.send_response(200)
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def jpeg():
    result = io.BytesIO()
    Image.new('RGB', (100, 100), 'white').save(result, 'JPEG')
    return result.getvalue()


def pdf():
    result = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=300)
    writer.add_blank_page(width=400, height=600)
    writer.write(result)
    return result.getvalue()


class XiaomiOcrTests(unittest.TestCase):
    def setUp(self):
        self.model = HTTPServer(('127.0.0.1', 0), ModelHandler)
        self.thread = threading.Thread(target=self.model.serve_forever, daemon=True)
        self.thread.start()
        self.env = patch.dict(os.environ, {'XIAOMI_OCR_LOCAL_URL': f'http://127.0.0.1:{self.model.server_port}/v1', 'XIAOMI_OCR_MODEL': 'xiaomi-research/Xiaomi-OCR-0', 'EXTRACTOR_TOKEN': 'test-extractor-secret'})
        self.env.start()
        ModelHandler.finish_reason = 'stop'

    def tearDown(self):
        self.env.stop()
        self.model.shutdown()
        self.model.server_close()
        self.thread.join(5)

    def test_model_request_uses_image_and_rejects_truncated_output(self):
        self.assertEqual(infer(jpeg()), {'text': 'Scanned sample'})
        request = ModelHandler.last_request
        self.assertEqual(request['model'], 'xiaomi-research/Xiaomi-OCR-0')
        self.assertTrue(request['messages'][0]['content'][0]['image_url']['url'].startswith('data:image/png;base64,'))
        ModelHandler.finish_reason = 'length'
        with self.assertRaises(ValueError):
            infer(jpeg())
        with patch.dict(os.environ, {'XIAOMI_OCR_LOCAL_URL': 'https://remote.example/v1'}), self.assertRaises(ValueError):
            infer(jpeg())

    def test_renders_only_the_selected_pdf_page(self):
        first, second = render_pdf_page(pdf(), 1), render_pdf_page(pdf(), 2)
        with Image.open(io.BytesIO(first)) as a, Image.open(io.BytesIO(second)) as b:
            self.assertGreater(b.width, a.width)
        with self.assertRaises(ValueError):
            render_pdf_page(pdf(), 3)

    def test_authenticated_extractor_accepts_images_and_pdf_pages(self):
        extractor = HTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=extractor.serve_forever, daemon=True)
        thread.start()
        origin = f'http://127.0.0.1:{extractor.server_port}'
        try:
            for path, data, mime in [('/ocr-image', jpeg(), 'image/jpeg'), ('/ocr-pdf?page=2', pdf(), 'application/pdf')]:
                request = urllib.request.Request(origin + path, data=data, headers={'Authorization': 'Bearer test-extractor-secret', 'Content-Type': mime})
                with urllib.request.urlopen(request, timeout=30) as response:
                    self.assertEqual(json.load(response), {'text': 'Scanned sample'})
            request = urllib.request.Request(origin + '/ocr-image', data=jpeg(), headers={'Content-Type': 'image/jpeg'})
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(request, timeout=30)
            self.assertEqual(error.exception.code, 403)
            error.exception.close()
        finally:
            extractor.shutdown()
            extractor.server_close()
            thread.join(5)

    def test_signed_pdf_source_is_rendered_and_untrusted_origins_are_rejected(self):
        document = pdf()
        class SourceHandler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass
            def do_GET(self):
                if self.path != '/api/internal/extractor-file/story-1' or self.headers.get('Authorization') != 'Bearer test.ticket':
                    self.send_error(403)
                    return
                self.send_response(200)
                self.send_header('Content-Length', str(len(document)))
                self.end_headers()
                self.wfile.write(document)
        source, extractor = HTTPServer(('127.0.0.1', 0), SourceHandler), HTTPServer(('127.0.0.1', 0), Handler)
        threads = [threading.Thread(target=server.serve_forever, daemon=True) for server in (source, extractor)]
        for thread in threads:
            thread.start()
        origin = f'http://127.0.0.1:{source.server_port}'
        target = f'http://127.0.0.1:{extractor.server_port}/ocr-pdf-from-url'
        try:
            with patch.dict(os.environ, {'LIBRARY_ORIGIN': origin}):
                payload = {'url': origin + '/api/internal/extractor-file/story-1', 'token': 'test.ticket', 'size': len(document), 'fileType': 'pdf', 'page': 2}
                def request():
                    return urllib.request.Request(target, data=json.dumps(payload).encode(), headers={'Authorization': 'Bearer test-extractor-secret', 'Content-Type': 'application/json'})
                with urllib.request.urlopen(request(), timeout=30) as response:
                    self.assertEqual(json.load(response), {'text': 'Scanned sample'})
                payload['url'] = 'http://127.0.0.1:1/api/internal/extractor-file/story-1'
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(request(), timeout=30)
                self.assertEqual(error.exception.code, 422)
                error.exception.close()
        finally:
            for server in (source, extractor):
                server.shutdown()
                server.server_close()
            for thread in threads:
                thread.join(5)


if __name__ == '__main__':
    unittest.main()
