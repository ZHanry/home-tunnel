import copy
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import distribution

ROOT = Path(__file__).resolve().parents[1]


class DistributionTests(unittest.TestCase):
    def test_unpromoted_channel_matches_published_9_0_0(self):
        dist = distribution.load(ROOT)
        self.assertEqual(distribution.validate_distribution(dist, root=ROOT), [])
        self.assertEqual(distribution.projection_errors(dist, root=ROOT), [])
        self.assertEqual(dist["channels"]["stable"]["version"], "9.0.0")
        self.assertFalse(dist["channels"]["candidate"]["downloads_published"])
        self.assertEqual(dist["development_line"], "10.0.0")

    def test_projection_is_idempotent(self):
        before = (ROOT / "releases.json").read_text(encoding="utf-8")
        distribution.project(ROOT)
        self.assertEqual((ROOT / "releases.json").read_text(encoding="utf-8"), before)
        self.assertEqual(
            json.loads((ROOT / "docs" / "site" / "candidate.json").read_text(encoding="utf-8")),
            distribution.load(ROOT)["channels"]["candidate"],
        )

    def test_promotion_and_invented_downloads_fail_closed(self):
        dist = distribution.load(ROOT)
        promoted = copy.deepcopy(dist)
        promoted["channels"]["candidate"]["promotion_status"] = "promoted"
        self.assertTrue(distribution.validate_distribution(promoted, root=ROOT))
        published = copy.deepcopy(dist)
        published["channels"]["candidate"]["downloads_published"] = True
        self.assertTrue(distribution.validate_distribution(published, root=ROOT))
        drifted = copy.deepcopy(dist)
        drifted["channels"]["stable"]["version"] = "10.0.0"
        self.assertTrue(any("snapshot" in item for item in distribution.validate_distribution(drifted, root=ROOT)))


if __name__ == "__main__":
    unittest.main()
