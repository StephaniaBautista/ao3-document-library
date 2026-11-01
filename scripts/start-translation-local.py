#!/usr/bin/env python3
"""Start the local translator with the existing extractor credential."""
import os
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
values = {}
for line in (root / '.dev.vars').read_text().splitlines():
    if '=' in line and not line.lstrip().startswith('#'):
        key, value = line.split('=', 1)
        key, value = key.strip(), value.strip()
        if key in values:
            raise RuntimeError('Duplicate configuration entry: ' + key)
        values[key] = value[1:-1] if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'") else value
credential = values.get('EXTRACTOR_TOKEN', '')
if len(credential) < 32:
    raise RuntimeError('Configure EXTRACTOR_TOKEN before starting the translator.')
python = root / '.sites-runtime/translation-venv/bin/python'
os.environ['TRANSLATION_TOKEN'] = credential
os.execv(str(python), [str(python), str(root / 'services/translator/server.py')])
