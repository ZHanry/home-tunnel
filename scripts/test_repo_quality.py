import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("check_site_policy", Path(__file__).with_name("check-site-policy.py"))
check_site_policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check_site_policy)


class RepoQualityTests(unittest.TestCase):
    def test_site_policy_passes_on_this_tree(self):
        self.assertEqual(check_site_policy.audit(ROOT), [])

    def test_workflows_cover_this_repository_only(self):
        pages = (ROOT / ".github" / "workflows" / "pages.yml").read_text(encoding="utf-8")
        codeql = (ROOT / ".github" / "workflows" / "codeql.yml").read_text(encoding="utf-8")
        self.assertIn("persist-credentials: false", pages)
        self.assertIn("check-v10-evidence.py --status", pages)
        self.assertIn("fonts-noto-cjk", pages)
        self.assertIn("fc-list :lang=zh family", pages)
        self.assertIn("github.event_name == 'push'", pages)
        self.assertNotIn("contents: write", pages)
        self.assertIn("javascript-typescript", codeql)
        self.assertIn("python", codeql)
        self.assertNotIn("java-kotlin", codeql)
        self.assertNotIn("c-cpp", codeql)
        self.assertIn("build-mode: none", codeql)

    def test_remote_settings_are_not_applied(self):
        settings = json.loads((ROOT / "docs" / "governance" / "recommended-repository-settings.json").read_text(encoding="utf-8"))
        self.assertIs(settings["apply"], False)
        self.assertIn("remote-desktop", settings["topics"])
        self.assertIn("frp", settings["topics"])
        self.assertIn("Build and validate Pages", settings["branch_protection"]["required_status_checks"])
        self.assertFalse(settings["pages"]["deploy_on_pull_request"])


if __name__ == "__main__":
    unittest.main()
