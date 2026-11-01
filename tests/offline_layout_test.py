import io
import sys
import unittest
from pathlib import Path

from PIL import Image
from pypdf import PdfWriter

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'services/extractor'))
from main import extract_pdf_range  # noqa: E402


class BlankPageDetectionTests(unittest.TestCase):
    def test_empty_page_preserves_dimensions_and_is_marked_blank(self):
        writer = PdfWriter()
        writer.add_blank_page(width=612, height=792)
        output = io.BytesIO()
        writer.write(output)
        page = extract_pdf_range(output.getvalue(), 0, 1, layout=True)['layouts'][0]
        self.assertTrue(page['blank'])
        self.assertEqual(page['spans'], [])
        self.assertEqual((page['width'], page['height']), (612, 792))

    def test_image_only_page_is_not_treated_as_blank(self):
        output = io.BytesIO()
        Image.new('RGB', (30, 30), 'white').save(output, format='PDF')
        page = extract_pdf_range(output.getvalue(), 0, 1, layout=True)['layouts'][0]
        self.assertFalse(page['blank'])
        self.assertEqual(page['spans'], [])


if __name__ == '__main__':
    unittest.main()
