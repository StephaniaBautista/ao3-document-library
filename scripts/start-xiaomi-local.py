#!/usr/bin/env python3
"""Start the project-local Xiaomi OCR model and extractor for development."""
import os
import json
import re
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / '.sites-runtime' / 'xiaomi'
OLLAMA = RUNTIME / 'ollama'
PYTHON = ROOT / '.sites-runtime' / 'xiaomi-venv' / 'bin' / 'python'
VARS = ROOT / '.dev.vars'
MODEL_URL = 'http://127.0.0.1:11435'
EXTRACTOR_URL = 'http://127.0.0.1:8765'


def verify_pdf_dependency():
    requirements = (ROOT / 'services/extractor/requirements.txt').read_text()
    match = re.search(r'^pypdf==([^\s]+)$', requirements, re.MULTILINE)
    if not match:
        raise RuntimeError('The extractor must pin a pypdf version.')
    result = subprocess.run(
        [str(PYTHON), '-c', "import importlib.metadata; print(importlib.metadata.version('pypdf'))"],
        capture_output=True, text=True, check=False,
    )
    if result.returncode or result.stdout.strip() != match.group(1):
        raise RuntimeError('The local extractor dependencies are out of date. Run .sites-runtime/xiaomi-venv/bin/python -m pip install -r services/extractor/requirements.txt before restarting.')


def read_configuration():
    if not VARS.exists():
        raise RuntimeError('Create .dev.vars and configure BETTER_AUTH_URL first.')
    text = VARS.read_text()
    values = {}
    for line in text.splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            key, value = line.split('=', 1)
            key, value = key.strip(), value.strip()
            if key in values:
                raise RuntimeError('Duplicate .dev.vars entry: ' + key)
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
                value = value[1:-1]
            values[key] = value
    url = urlsplit(values.get('BETTER_AUTH_URL', ''))
    if url.scheme != 'http' or url.hostname not in ('localhost', '127.0.0.1') or url.username or url.password or url.path not in ('', '/') or url.query or url.fragment:
        raise RuntimeError('BETTER_AUTH_URL must be the exact localhost origin for local OCR.')
    if values.get('EXTRACTOR_URL') and values['EXTRACTOR_URL'].rstrip('/') != EXTRACTOR_URL:
        raise RuntimeError('Existing EXTRACTOR_URL points elsewhere; it was not changed.')
    token = values.get('EXTRACTOR_TOKEN') or secrets.token_urlsafe(32)
    if len(token) < 32 or any(c.isspace() for c in token):
        raise RuntimeError('EXTRACTOR_TOKEN must be at least 32 characters without whitespace.')
    additions = []
    if not values.get('EXTRACTOR_URL'):
        if 'EXTRACTOR_URL' in values:
            raise RuntimeError('Remove the empty EXTRACTOR_URL entry and retry.')
        additions.append('EXTRACTOR_URL=' + EXTRACTOR_URL)
    if not values.get('EXTRACTOR_TOKEN'):
        if 'EXTRACTOR_TOKEN' in values:
            raise RuntimeError('Remove the empty EXTRACTOR_TOKEN entry and retry.')
        additions.append('EXTRACTOR_TOKEN=' + token)
    if additions:
        # Atomic replacement prevents partially written credentials.
        fd, temporary = tempfile.mkstemp(prefix='.dev.vars-', dir=ROOT)
        try:
            with os.fdopen(fd, 'w') as output:
                output.write(text.rstrip('\n') + '\n' + '\n'.join(additions) + '\n')
            os.chmod(temporary, 0o600)
            os.replace(temporary, VARS)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    return token, values['BETTER_AUTH_URL'].rstrip('/')


def main():
    if not OLLAMA.is_file() or not PYTHON.is_file():
        raise RuntimeError('Local OCR runtime is missing. Follow the setup steps in README.md.')
    verify_pdf_dependency()
    for port in (11435, 8765):
        with socket.socket() as sock:
            if sock.connect_ex(('127.0.0.1', port)) == 0:
                raise RuntimeError(f'Local port {port} is already in use.')
    token, origin = read_configuration()
    env = os.environ.copy()
    env.update({'OLLAMA_HOST': '127.0.0.1:11435', 'OLLAMA_MODELS': str(RUNTIME / 'models'), 'OLLAMA_NO_CLOUD': '1'})
    processes = []
    try:
        processes.append(subprocess.Popen([str(OLLAMA), 'serve'], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
        for _ in range(100):
            if processes[0].poll() is not None:
                raise RuntimeError('The local model server stopped during startup.')
            try:
                with urllib.request.urlopen(MODEL_URL + '/api/tags', timeout=1) as response:
                    available = json.load(response).get('models', [])
                if not any(item.get('name') == 'longwayxu/xiaomi-ocr-0:bf16' for item in available):
                    raise RuntimeError('The local Xiaomi model has not been downloaded.')
                break
            except OSError:
                time.sleep(0.1)
        else:
            raise RuntimeError('The local model server did not start.')
        env.update({'EXTRACTOR_HOST': '127.0.0.1', 'PORT': '8765', 'EXTRACTOR_TOKEN': token, 'LIBRARY_ORIGIN': origin,
                    'XIAOMI_OCR_LOCAL_URL': MODEL_URL + '/v1', 'XIAOMI_OCR_MODEL': 'longwayxu/xiaomi-ocr-0:bf16'})
        processes.append(subprocess.Popen([str(PYTHON), str(ROOT / 'services/extractor/main.py')], cwd=ROOT / 'services/extractor', env=env))
        print('Xiaomi OCR and extractor started locally. Restart the development server if .dev.vars changed. Press Ctrl+C to stop.', flush=True)
        while all(process.poll() is None for process in processes):
            time.sleep(0.5)
        raise RuntimeError('A local OCR process stopped unexpectedly.')
    finally:
        for process in reversed(processes):
            if process.poll() is None:
                process.terminate()
        for process in processes:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
