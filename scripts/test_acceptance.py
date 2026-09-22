import json
import unittest
from pathlib import Path


class AcceptanceLedgerTests(unittest.TestCase):
    def test_original_and_extended_cases_and_platform_matrix_are_complete(self):
        value = json.loads((Path(__file__).resolve().parents[1] / "docs/8.0/acceptance.json").read_text(encoding="utf-8"))
        expected = {f"{prefix}{index:02d}" for prefix, count in {"A": 14, "S": 12, "P": 12, "M": 10, "I": 10, "O": 10, "E": 12}.items() for index in range(1, count + 1)}
        self.assertEqual({row["id"] for row in value["cases"]}, expected)
        self.assertEqual(len(value["cases"]), 80)
        self.assertEqual(len({(row["controller"], row["host"]) for row in value["platform_matrix"]}), 40)
        for row in [*value["cases"], *value["platform_matrix"]]:
            self.assertIn(row["status"], ["passed", "failed", "not_verified"])
            if row["status"] != "not_verified":
                self.assertTrue(row["evidence"], "Measured results require an evidence reference")


if __name__ == "__main__":
    unittest.main()
