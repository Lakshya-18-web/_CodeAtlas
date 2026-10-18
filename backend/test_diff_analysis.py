import unittest

import networkx as nx

from backend.diff_analysis import analyze_diff, parse_unified_diff


def make_baseline():
    """
    A small synthetic baseline mirroring the REAL graph.py / parser.py
    schema exactly: function nodes with type/name/file/line/end_line,
    CONTAINS/CALLS edges, plus the `analysis` list main.py always keeps
    alongside the graph (used here only for its "file" keys).
    """

    graph = nx.DiGraph()

    graph.add_node("auth.py", type="file")
    graph.add_node(
        "auth.py:login", type="function", name="login", file="auth.py",
        line=10, end_line=20,
    )
    graph.add_node(
        "auth.py:validate_user", type="function", name="validate_user",
        file="auth.py", line=22, end_line=30,
    )
    graph.add_edge("auth.py", "auth.py:login", relation="CONTAINS")
    graph.add_edge("auth.py", "auth.py:validate_user", relation="CONTAINS")
    graph.add_edge(
        "auth.py:login", "auth.py:validate_user", relation="CALLS"
    )

    graph.add_node("api.py", type="file")
    graph.add_node(
        "api.py:api_login", type="function", name="api_login",
        file="api.py", line=5, end_line=15,
    )
    graph.add_edge("api.py", "api.py:api_login", relation="CONTAINS")
    graph.add_edge(
        "api.py:api_login", "auth.py:login", relation="CALLS"
    )

    analysis = [
        {"file": "auth.py", "functions": [], "classes": []},
        {"file": "api.py", "functions": [], "classes": []},
    ]

    return graph, analysis


def diff_header(old_path, new_path, old_dev_null=False, new_dev_null=False):
    lines = [f"diff --git a/{old_path} b/{new_path}"]
    lines.append(f"--- {'/dev/null' if old_dev_null else 'a/' + old_path}")
    lines.append(f"+++ {'/dev/null' if new_dev_null else 'b/' + new_path}")
    return lines


class DiffParsingTests(unittest.TestCase):

    def test_single_modified_function(self):
        graph, analysis = make_baseline()

        diff = "\n".join(
            diff_header("auth.py", "auth.py") + [
                "@@ -12,3 +12,4 @@",
                " def login():",
                "-    pass",
                "+    pass  # changed",
                "+    pass",
            ]
        )

        result = analyze_diff(diff, graph, analysis)

        self.assertEqual(len(result["files"]), 1)
        self.assertEqual(result["files"][0]["path"], "auth.py")
        self.assertEqual(result["files"][0]["status"], "modified")
        self.assertIn("auth.py:login", result["files"][0]["changed_functions"])
        self.assertEqual(
            result["changed_nodes"],
            [{"id": "auth.py:login", "status": "modified"}],
        )

    def test_multiple_changed_functions_same_file(self):
        graph, analysis = make_baseline()

        diff = "\n".join(
            diff_header("auth.py", "auth.py") + [
                "@@ -10,5 +10,5 @@",
                " ...",
                "@@ -25,3 +25,3 @@",
                " ...",
            ]
        )

        result = analyze_diff(diff, graph, analysis)
        changed_ids = {c["id"] for c in result["changed_nodes"]}

        self.assertIn("auth.py:login", changed_ids)
        self.assertIn("auth.py:validate_user", changed_ids)

    def test_added_file_has_no_baseline_mapping(self):
        graph, analysis = make_baseline()

        diff = "\n".join(
            diff_header("new_module.py", "new_module.py", old_dev_null=True) + [
                "@@ -0,0 +1,10 @@",
                "+def brand_new(): pass",
            ]
        )

        result = analyze_diff(diff, graph, analysis)

        self.assertEqual(result["files"][0]["status"], "added")
        self.assertFalse(result["files"][0]["matched_baseline"])
        self.assertEqual(result["files"][0]["changed_functions"], [])
        self.assertEqual(result["changed_nodes"], [])
        self.assertTrue(
            any("new" in w.lower() for w in result["warnings"])
        )

    def test_deleted_file_marks_all_its_functions_deleted(self):
        graph, analysis = make_baseline()

        diff = "\n".join(
            diff_header("api.py", "api.py", new_dev_null=True) + [
                "@@ -1,15 +0,0 @@",
                "-def api_login(): pass",
            ]
        )

        result = analyze_diff(diff, graph, analysis)

        self.assertEqual(result["files"][0]["status"], "deleted")
        self.assertIn("api.py:api_login", result["files"][0]["changed_functions"])
        self.assertEqual(
            result["changed_nodes"],
            [{"id": "api.py:api_login", "status": "deleted"}],
        )

    def test_changed_lines_with_no_function_mapping(self):
        graph, analysis = make_baseline()

        # Line 2 is above login() (10-20) and validate_user() (22-30):
        # a module-level import change, intentionally unmappable.
        diff = "\n".join(
            diff_header("auth.py", "auth.py") + [
                "@@ -1,2 +1,3 @@",
                " import os",
                "+import sys",
            ]
        )

        result = analyze_diff(diff, graph, analysis)

        self.assertEqual(result["files"][0]["changed_functions"], [])
        self.assertEqual(len(result["files"][0]["unmapped_ranges"]), 1)
        self.assertEqual(result["changed_nodes"], [])

    def test_renamed_file(self):
        graph, analysis = make_baseline()

        diff = "\n".join([
            "diff --git a/auth.py b/authentication.py",
            "similarity index 95%",
            "rename from auth.py",
            "rename to authentication.py",
            "--- a/auth.py",
            "+++ b/authentication.py",
            "@@ -10,3 +10,3 @@",
            " ...",
        ])

        result = analyze_diff(diff, graph, analysis)

        self.assertEqual(result["files"][0]["status"], "renamed")
        self.assertIn("auth.py:login", result["files"][0]["changed_functions"])

    def test_empty_diff(self):
        graph, analysis = make_baseline()

        result = analyze_diff("", graph, analysis)

        self.assertEqual(result["files"], [])
        self.assertEqual(result["changed_nodes"], [])
        self.assertTrue(len(result["warnings"]) >= 1)

    def test_malformed_diff_does_not_raise(self):
        graph, analysis = make_baseline()

        result = analyze_diff(
            "this is not a diff at all\njust some random text\n####",
            graph,
            analysis,
        )

        self.assertEqual(result["files"], [])
        self.assertEqual(result["changed_nodes"], [])

    def test_none_diff_does_not_raise(self):
        graph, analysis = make_baseline()
        result = analyze_diff(None, graph, analysis)
        self.assertEqual(result["files"], [])

    def test_path_traversal_attempt_is_skipped(self):
        graph, analysis = make_baseline()

        diff = "\n".join(
            diff_header("../../etc/passwd", "../../etc/passwd") + [
                "@@ -1,1 +1,1 @@",
                "-x",
                "+y",
            ]
        )

        result = analyze_diff(diff, graph, analysis)

        self.assertEqual(result["files"], [])
        self.assertEqual(result["changed_nodes"], [])
        self.assertTrue(
            any("unsafe" in w.lower() for w in result["warnings"])
        )

    def test_absolute_path_is_skipped(self):
        graph, analysis = make_baseline()

        diff = "\n".join(
            diff_header("/etc/passwd", "/etc/passwd") + [
                "@@ -1,1 +1,1 @@",
                "-x",
                "+y",
            ]
        )

        result = analyze_diff(diff, graph, analysis)
        self.assertEqual(result["files"], [])

    def test_wrapper_folder_prefix_mismatch_still_matches(self):
        """
        Baseline paths include a ZIP wrapper folder (as real CodeAtlas
        analyses do), while the diff — generated from a plain git
        checkout — does not. Matching must fall back to path suffix.
        """

        graph = nx.DiGraph()
        graph.add_node("myrepo-main/auth.py", type="file")
        graph.add_node(
            "myrepo-main/auth.py:login", type="function", name="login",
            file="myrepo-main/auth.py", line=10, end_line=20,
        )
        analysis = [{"file": "myrepo-main/auth.py", "functions": [], "classes": []}]

        diff = "\n".join(
            diff_header("auth.py", "auth.py") + [
                "@@ -10,3 +10,3 @@",
                " ...",
            ]
        )

        result = analyze_diff(diff, graph, analysis)

        self.assertTrue(result["files"][0]["matched_baseline"])
        self.assertEqual(result["files"][0]["path"], "myrepo-main/auth.py")
        self.assertIn(
            "myrepo-main/auth.py:login",
            result["files"][0]["changed_functions"],
        )

    def test_unmatched_file_reports_uncertainty_not_fabrication(self):
        graph, analysis = make_baseline()

        diff = "\n".join(
            diff_header("completely_unrelated_file.py", "completely_unrelated_file.py") + [
                "@@ -1,3 +1,3 @@",
                " ...",
            ]
        )

        result = analyze_diff(diff, graph, analysis)

        self.assertFalse(result["files"][0]["matched_baseline"])
        self.assertEqual(result["files"][0]["changed_functions"], [])
        self.assertTrue(len(result["warnings"]) >= 1)


if __name__ == "__main__":
    unittest.main()
