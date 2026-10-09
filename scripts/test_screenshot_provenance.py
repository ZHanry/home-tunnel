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
        image = self.site / "assets/13.0.0/desktop-workbench-light.png"
        image.write_bytes(image.read_bytes() + b"modified")
        self.assertTrue(any("image digest does not match" in error for error in self.errors()))

    def test_missing_capture_manifest_is_rejected(self):
        (self.site / "assets/13.0.0/desktop-capture-manifest.json").unlink()
        self.assertTrue(any("invalid capture provenance" in error for error in self.errors()))

    def test_capture_version_must_match(self):
        path = self.site / "assets/13.0.0/desktop-capture-manifest.json"
        manifest = json.loads(path.read_text())
        manifest["product_version"] = "7.0.0"
        path.write_text(json.dumps(manifest))
        self.assertTrue(any("capture version must match" in error for error in self.errors()))

    def test_capture_dimensions_must_match(self):
        path = self.site / "assets/13.0.0/desktop-capture-manifest.json"
        manifest = json.loads(path.read_text())
        manifest["captures"][0]["width"] = 1
        path.write_text(json.dumps(manifest))
        self.assertTrue(any("dimensions do not match" in error for error in self.errors()))

    def test_example_data_must_be_disclosed(self):
        path = self.site / "en/index.html"
        path.write_text(path.read_text().replace("example data", "data"))
        self.assertTrue(any("must disclose example data" in error for error in self.errors()))

    def test_current_pages_never_reuse_historical_screenshots(self):
        for name in ("index.html", "en/index.html", "preview.html", "en/preview.html"):
            text=(self.site/name).read_text()
            self.assertNotRegex(text,r'v10/|rc12/|admin-dashboard-7|desktop\.jpg')
    def test_component_preview_does_not_claim_installed_app_acceptance(self):
        path=self.site/"assets/13.0.0/desktop-capture-manifest.json"
        manifest=json.loads(path.read_text())
        manifest["installed_application"]=True
        path.write_text(json.dumps(manifest))
        self.assertTrue(any("cannot claim installed-app" in error for error in self.errors()))

    def test_public_release_copy_keeps_objective_verification_scope(self):
        path = self.site / "index.html"
        text = path.read_text()
        path.write_text(text.replace("未运行", ""))
        self.assertTrue(any("incomplete verification" in error for error in self.errors()))
        path.write_text(text + "<p>负责人豁免</p>")
        self.assertTrue(any("banned claim" in error for error in self.errors()))


if __name__ == "__main__":
    unittest.main()
