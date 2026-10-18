"""Offline integration check for release tags and tracked-source diffs."""

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "collect.py"


def load_collect():
    spec = importlib.util.spec_from_file_location("collect", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class BaselineTests(unittest.TestCase):
    """The implicit baseline follows the newest declared engine, not a single-record rule."""

    def setUp(self):
        self.collect = load_collect()

    def test_highest_release_single_and_multi(self):
        self.assertEqual(self.collect.highest_release({"0.1.7-rc.2": "compatible"}), "0.1.7-rc.2")
        self.assertEqual(
            self.collect.highest_release({"0.2.0-rc.2": "compatible", "0.2.1-rc.2": "compatible"}),
            "0.2.1-rc.2",
        )

    def test_release_outranks_its_own_prereleases(self):
        self.assertGreater(self.collect.semver_key("0.2.1"), self.collect.semver_key("0.2.1-rc.2"))
        self.assertGreater(self.collect.semver_key("0.2.1-rc.2"), self.collect.semver_key("0.2.1-alpha.5"))
        self.assertGreater(self.collect.semver_key("0.2.0-rc.2"), self.collect.semver_key("0.2.0-rc.1"))
        with self.assertRaises(ValueError):
            self.collect.semver_key("^0.2.1-rc.2")

    def test_empty_records_are_an_error(self):
        with self.assertRaises(ValueError):
            self.collect.highest_release({})

    def test_cli_rejects_an_empty_release_record(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = Path(scratch)
            (root / "package.json").write_text(json.dumps({
                "name": "fixture",
                "dsh": {"compatibility": {"dshReleases": {}}},
            }), encoding="utf-8")
            result = subprocess.run(
                [sys.executable, str(SCRIPT), "--target", "dsh-v0.2.1-rc.2", "--out", str(root / "out")],
                cwd=root, capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertIn("cannot determine baseline", result.stderr)


class CollectTests(unittest.TestCase):
    def test_default_baseline_and_source_diff_ignore_git_metadata(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = Path(scratch)
            repo = root / "upstream"
            repo.mkdir()

            def git(*args: str) -> None:
                subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True, text=True)

            git("init", "-q")
            git("config", "user.email", "review@example.invalid")
            git("config", "user.name", "Review")
            (repo / "package.json").write_text(json.dumps({
                "name": "fixture",
                "dsh": {"compatibility": {"dshReleases": {"0.1.7-rc.2": "compatible"}}},
            }), encoding="utf-8")
            (repo / "src").mkdir()
            (repo / "src" / "app.ts").write_text("old\n", encoding="utf-8")
            git("add", ".")
            git("commit", "-qm", "baseline")
            git("tag", "dsh-v0.1.7-rc.2")
            (repo / "src" / "app.ts").write_text("new\n", encoding="utf-8")
            git("add", ".")
            git("commit", "-qm", "target")
            git("tag", "dsh-v0.1.7-rc.3")

            for tag, expected in (
                ("dsh-v0.1.7-rc.2", ""),
                ("dsh-v0.1.7-rc.3", "M\tsrc/app.ts\n"),
            ):
                output = root / tag
                result = subprocess.run(
                    [sys.executable, str(SCRIPT), "--target", tag, "--repo", repo.as_uri(), "--out", str(output)],
                    cwd=repo, capture_output=True, text=True,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
                self.assertEqual(manifest["baseline"], "dsh-v0.1.7-rc.2")
                self.assertEqual((output / "changed-files.txt").read_text(encoding="utf-8"), expected)
                diff = (output / "diff.txt").read_text(encoding="utf-8")
                self.assertNotIn(".git/", diff)
                self.assertEqual("src/app.ts" in diff, bool(expected))


if __name__ == "__main__":
    unittest.main()
