import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("site_policy", ROOT / "scripts/check-site-policy.py")
site_policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(site_policy)


class ScreenshotProvenanceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.site = self.root / "docs/site"
        shutil.copytree(ROOT / "docs/site", self.site)
        for name in ("README.md", "README.en.md"):
            shutil.copyfile(ROOT / name, self.root / name)

    def errors(self):
        return site_policy.audit(self.root)

    def test_original_captures_pass(self):
        self.assertEqual(self.errors(), [])

    def test_modified_pixels_are_rejected(self):
        image = self.site / "assets/v10/admin-console.png"
        image.write_bytes(image.read_bytes() + b"modified")
        self.assertTrue(any("image digest does not match" in error for error in self.errors()))

    def test_missing_capture_manifest_is_rejected(self):
        (self.site / "assets/v10/web-capture-manifest.json").unlink()
        self.assertTrue(any("invalid capture provenance" in error for error in self.errors()))

    def test_capture_version_must_match(self):
        path = self.site / "assets/v10/web-capture-manifest.json"
        manifest = json.loads(path.read_text())
        manifest["product_version"] = "7.0.0"
        path.write_text(json.dumps(manifest))
        self.assertTrue(any("capture version must match" in error for error in self.errors()))

    def test_capture_dimensions_must_match(self):
        path = self.site / "assets/v10/android-capture-manifest.json"
        manifest = json.loads(path.read_text())
        manifest["width"] = 1
        path.write_text(json.dumps(manifest))
        self.assertTrue(any("dimensions do not match" in error for error in self.errors()))

    def test_example_data_must_be_disclosed(self):
        path = self.site / "en/index.html"
        path.write_text(path.read_text().replace("example data", "data"))
        self.assertTrue(any("must disclose example data" in error for error in self.errors()))

    def test_web_entry_cannot_fill_pending_windows_slot(self):
        path = self.site / "index.html"
        text = path.read_text().replace(
            '<p class="slot-empty">等待实际产品截图</p>',
            '<img src="assets/v10/remote-entry.png" alt="Web entry">',
        )
        path.write_text(text)
        self.assertTrue(any("empty slot v10-remote-window" in error for error in self.errors()))

    def test_current_landing_has_no_historical_featured_image(self):
        for name in ("index.html", "en/index.html"):
            self.assertNotIn("admin-dashboard-7.jpg", (self.site / name).read_text())
        for name in ("preview.html", "en/preview.html"):
            self.assertIn("admin-dashboard-7.jpg", (self.site / name).read_text())

    def test_windows_native_capture_requires_interactive_session(self):
        path = self.site / "assets/v10/windows-capture-manifest.json"
        manifest = json.loads(path.read_text())
        manifest["interactive"] = False
        path.write_text(json.dumps(manifest))
        self.assertTrue(any("interactive native Windows" in error for error in self.errors()))

    def test_windows_native_capture_requires_package_digest(self):
        path = self.site / "assets/v10/windows-capture-manifest.json"
        manifest = json.loads(path.read_text())
        manifest["package_sha256"] = "unknown"
        path.write_text(json.dumps(manifest))
        self.assertTrue(any("actual Windows package_sha256" in error for error in self.errors()))


if __name__ == "__main__":
    unittest.main()
