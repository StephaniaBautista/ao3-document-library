#!/usr/bin/env python3
"""Install the pinned local English-to-Spanish model and runtime."""
import hashlib
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import venv
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / '.sites-runtime'
MODEL_URL = 'https://argos-net.com/v1/translate-en_es-1_0.argosmodel'
MODEL_SHA256 = 'd698d0ef87ad70d5d184b7fa6965905bf4368f09a2bb9ffb165a79bac96af0c4'
FILES = ('en_es/sentencepiece.model', 'en_es/model/model.bin', 'en_es/model/shared_vocabulary.txt', 'en_es/metadata.json')


def main():
    RUNTIME.mkdir(parents=True, exist_ok=True)
    target = RUNTIME / 'translation-model'
    if all((target / item).is_file() for item in FILES):
        print('The translation model is already installed.')
    else:
        with tempfile.TemporaryDirectory(dir=RUNTIME) as directory:
            temp = Path(directory)
            archive = temp / 'model.argosmodel'
            digest = hashlib.sha256()
            with urllib.request.urlopen(MODEL_URL, timeout=60) as response, archive.open('wb') as output:
                total = 0
                while chunk := response.read(1024 * 1024):
                    total += len(chunk)
                    if total > 150 * 1024 * 1024:
                        raise RuntimeError('The translation model is larger than expected.')
                    digest.update(chunk)
                    output.write(chunk)
            if digest.hexdigest() != MODEL_SHA256:
                raise RuntimeError('Translation model checksum did not match; it was not installed.')
            with ZipFile(archive) as package:
                for name in FILES:
                    info = package.getinfo(name)
                    if info.is_dir() or info.file_size > 250 * 1024 * 1024:
                        raise RuntimeError('Invalid translation model file.')
                    destination = temp / 'model' / name
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    with package.open(info) as source, destination.open('wb') as output:
                        shutil.copyfileobj(source, output)
            if target.exists():
                raise RuntimeError('Incomplete translation model directory already exists; inspect it before retrying.')
            os.replace(temp / 'model', target)
        print('English-to-Spanish model installed.')
    virtualenv = RUNTIME / 'translation-venv'
    venv.create(virtualenv, with_pip=True)
    python = virtualenv / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    subprocess.run([str(python), '-m', 'pip', 'install', '-r', str(ROOT / 'services/translator/requirements.txt')], check=True)
    print('Start the translator with: python3 scripts/start-translation-local.py')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Translation setup failed: {error}', file=sys.stderr)
        sys.exit(1)
