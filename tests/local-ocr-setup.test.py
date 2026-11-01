import importlib.util
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('local_ocr', Path(__file__).resolve().parents[1] / 'scripts/start-xiaomi-local.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class LocalConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.previous = module.ROOT, module.VARS
        module.ROOT = Path(self.directory.name)
        module.VARS = module.ROOT / '.dev.vars'

    def tearDown(self):
        module.ROOT, module.VARS = self.previous
        self.directory.cleanup()

    def test_generates_a_stable_private_token_without_changing_other_values(self):
        module.VARS.write_text('BETTER_AUTH_URL=http://127.0.0.1:5173\nEXAMPLE=preserved\n')
        first, origin = module.read_configuration()
        second, _ = module.read_configuration()
        self.assertEqual(first, second)
        self.assertGreaterEqual(len(first), 32)
        self.assertEqual(origin, 'http://127.0.0.1:5173')
        self.assertIn('EXAMPLE=preserved\n', module.VARS.read_text())
        self.assertEqual(os.stat(module.VARS).st_mode & 0o777, 0o600)

    def test_refuses_to_replace_an_existing_external_service(self):
        original = 'BETTER_AUTH_URL=http://localhost:5173\nEXTRACTOR_URL=https://extractor.example\n'
        module.VARS.write_text(original)
        with self.assertRaises(RuntimeError):
            module.read_configuration()
        self.assertEqual(module.VARS.read_text(), original)

    def test_outdated_pdf_dependency_prevents_startup(self):
        requirements = module.ROOT / 'services/extractor/requirements.txt'
        requirements.parent.mkdir(parents=True)
        requirements.write_text('pypdf==6.21.4\n')
        with patch.object(module.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout='6.10.0\n')):
            with self.assertRaisesRegex(RuntimeError, 'dependencies are out of date'):
                module.verify_pdf_dependency()
        with patch.object(module.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout='6.21.4\n')):
            module.verify_pdf_dependency()


if __name__ == '__main__':
    unittest.main()
