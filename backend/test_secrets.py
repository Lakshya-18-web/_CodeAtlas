import tempfile
import unittest
from pathlib import Path

from backend.secrets import redact_text, scan_repository


class SecretScannerTests(unittest.TestCase):
    def test_detects_and_masks_common_secrets(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, "settings.py").write_text(
                'API_KEY = "AIza' + 'A' * 35 + '"\n'
                'PASSWORD = "correct-horse"\n'
                'token = "sk-proj-' + 'B' * 32 + '"\n',
                encoding="utf-8",
            )
            result = scan_repository(directory)
            self.assertEqual(result["total"], 3)
            serialized = str(result)
            self.assertNotIn("correct-horse", serialized)
            self.assertNotIn("AIza" + "A" * 35, serialized)

    def test_redacts_without_changing_source_repository(self):
        source = 'password = "very-secret-password"'
        self.assertIn("[REDACTED]", redact_text(source))
        self.assertIn("very-secret-password", source)


if __name__ == "__main__":
    unittest.main()
