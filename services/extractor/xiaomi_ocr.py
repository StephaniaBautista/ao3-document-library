"""Local Xiaomi-OCR-0 inference; page data never leaves the host's model server."""
import base64
import io
import json
import os
import urllib.request
from contextlib import closing
from urllib.parse import urlsplit

MAX_IMAGE_PIXELS = 20_000_000
MAX_MODEL_RESPONSE = 1024 * 1024


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def normalize_image(data):
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
    with Image.open(io.BytesIO(data)) as source:
        if source.width * source.height > MAX_IMAGE_PIXELS:
            raise ValueError('Image too large')
        image = source.convert('RGB')
    image.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
    output = io.BytesIO()
    image.save(output, 'PNG')
    return output.getvalue()


def render_pdf_page(data, page_number):
    import pypdfium2 as pdfium
    with pdfium.PdfDocument(data) as document:
        if page_number < 1 or page_number > len(document):
            raise ValueError('Invalid page')
        with closing(document[page_number - 1]) as page:
            width, height = page.get_size()
            if width <= 0 or height <= 0 or width > 10000 or height > 10000:
                raise ValueError('Invalid page dimensions')
            scale = min(150 / 72, 2048 / max(width, height))
            with closing(page.render(scale=scale)) as bitmap:
                image = bitmap.to_pil().convert('RGB')
        output = io.BytesIO()
        image.save(output, 'PNG')
        return output.getvalue()


def infer(image_bytes):
    base = os.environ.get('XIAOMI_OCR_LOCAL_URL', 'http://127.0.0.1:8000/v1').rstrip('/')
    url = urlsplit(base)
    if url.scheme != 'http' or url.hostname not in ('localhost', '127.0.0.1', '::1') or url.username or url.password or url.query or url.fragment or url.path != '/v1':
        raise ValueError('OCR model must be a local inference server')
    model = os.environ.get('XIAOMI_OCR_MODEL', 'xiaomi-research/Xiaomi-OCR-0')
    payload = {'model': model, 'messages': [{'role': 'user', 'content': [
        {'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,' + base64.b64encode(normalize_image(image_bytes)).decode('ascii')}},
        {'type': 'text', 'text': 'Extract the text in the image.'},
    ]}], 'max_tokens': 4096, 'temperature': 0, 'top_p': 0.8, 'presence_penalty': 0.0, 'repetition_penalty': 1.0, 'chat_template_kwargs': {'enable_thinking': False}}
    request = urllib.request.Request(base + '/chat/completions', data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'}, method='POST')
    # Refuse redirects to avoid leaking document images to a remote endpoint.
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=120) as response:
        raw = response.read(MAX_MODEL_RESPONSE + 1)
    if len(raw) > MAX_MODEL_RESPONSE:
        raise ValueError('OCR response too large')
    result = json.loads(raw)
    choice = result['choices'][0]
    text = choice['message']['content']
    if choice.get('finish_reason') != 'stop' or not isinstance(text, str) or len(text) > 100000:
        raise ValueError('Incomplete OCR response')
    return {'text': text.strip()}
