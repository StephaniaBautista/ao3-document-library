"""Local, authenticated translation service. It never fetches external URLs."""
import hmac
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import ctranslate2
import sentencepiece

ROOT = Path(__file__).resolve().parents[2]
MODEL = Path(os.environ.get('LOCAL_TRANSLATION_MODEL', ROOT / '.sites-runtime/translation-model/en_es'))
TOKEN = os.environ.get('TRANSLATION_TOKEN', '')
if len(TOKEN) < 32:
    raise RuntimeError('TRANSLATION_TOKEN must be configured with at least 32 characters')
tokenizer = sentencepiece.SentencePieceProcessor(model_file=str(MODEL / 'sentencepiece.model'))
translator = ctranslate2.Translator(str(MODEL / 'model'), device='cpu', inter_threads=1, intra_threads=2)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_POST(self):
        if self.path != '/translate' or not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + TOKEN):
            self.send_error(403)
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if self.headers.get('Content-Type') != 'application/json' or not 0 < length <= 100000:
                raise ValueError('Invalid request')
            body = json.loads(self.rfile.read(length))
            texts = body.get('texts')
            if body.get('source') != 'en' or body.get('target') != 'es' or not isinstance(texts, list) or not 1 <= len(texts) <= 128 or any(not isinstance(t, str) or not t.strip() or len(t) > 1000 for t in texts):
                raise ValueError('Invalid translation input')
            encoded = [tokenizer.encode(text, out_type=str) for text in texts]
            if any(len(tokens) > 240 for tokens in encoded):
                raise ValueError('Text exceeds model input limit')
            result = translator.translate_batch(encoded, beam_size=4, max_input_length=240, max_decoding_length=768)
            if len(result) != len(texts) or any(not item.hypotheses or len(item.hypotheses[0]) >= 768 for item in result):
                raise ValueError('Incomplete translation')
            translated = [tokenizer.decode(item.hypotheses[0]).strip() for item in result]
            if any(not item for item in translated):
                raise ValueError('Empty translation')
            payload = json.dumps({'texts': translated}, ensure_ascii=False).encode('utf-8')
        except (ValueError, TypeError, KeyError, json.JSONDecodeError):
            self.send_error(422)
            return
        except Exception:
            self.send_error(503)
            return
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


if __name__ == '__main__':
    HTTPServer(('127.0.0.1', int(os.environ.get('TRANSLATION_PORT', '8766'))), Handler).serve_forever()
