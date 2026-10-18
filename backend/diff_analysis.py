"""Diff Analysis — Git Diff-Based Impact Analysis.

Parses a unified git diff / patch and maps the OLD-side changed line
ranges onto the ALREADY-ANALYZED baseline repository (the same graph
and analysis structures POST /api/analyze already builds).

Why the OLD side?
A unified diff hunk header "@@ -old_start,old_count +new_start,new_count @@"
always gives an unambiguous line range in the file BEFORE the change.
Since the baseline graph was built from that "before" code, old-side
line numbers map directly onto each function node's stored
`line`/`end_line` — no need to parse or even possess the "after"
version of the file.

This module never executes diff/patch content and never reads or
writes anything on disk — it only compares structured text against the
already-parsed baseline (current_graph / current_analysis).
"""

import re
from collections import defaultdict


_DIFF_GIT_RE = re.compile(r"^diff --git a/(.+?) b/(.+)$")
_HUNK_RE = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")
_RENAME_FROM_RE = re.compile(r"^rename from (.+)$")
_RENAME_TO_RE = re.compile(r"^rename to (.+)$")

# Defensive cap on how many files a single diff may touch, independent
# of the byte-size cap enforced at the API layer — keeps a pathological
# diff (many tiny files) from doing unbounded work here too.
MAX_FILES_PER_DIFF = 500


# ============================================================
# PARSE
# ============================================================

def parse_unified_diff(diff_text):
    """
    Parse a unified git diff into a list of per-file change records:

        {
            "old_path": str | None,   # None for a newly added file
            "new_path": str | None,   # None for a deleted file
            "status": "added" | "deleted" | "modified" | "renamed",
            "hunks": [ {"old_start": int, "old_count": int}, ... ],
        }

    Deliberately minimal: this extracts only what impact mapping needs
    (which file, which OLD-side line ranges changed, and the change
    status) — it does not reconstruct full before/after file content.

    Never raises. An empty or unrecognized diff simply yields [].
    """

    if diff_text is None or not isinstance(diff_text, str):
        return []

    if not diff_text.strip():
        return []

    lines = diff_text.replace("\r\n", "\n").split("\n")

    files = []
    current = None

    for line in lines:

        git_match = _DIFF_GIT_RE.match(line)

        if git_match:

            if current is not None:
                files.append(current)

            if len(files) >= MAX_FILES_PER_DIFF:
                break

            old_path, new_path = git_match.group(1), git_match.group(2)

            current = {
                "old_path": old_path,
                "new_path": new_path,
                "status": "modified",
                "hunks": [],
            }

            continue

        if current is None:
            # Content before any "diff --git" line (stray text, mbox
            # headers, etc.) is not attributable to a file — ignore it
            # rather than guessing.
            continue

        if line.startswith("--- /dev/null"):
            current["old_path"] = None
            current["status"] = "added"
            continue

        if line.startswith("+++ /dev/null"):
            current["new_path"] = None
            current["status"] = "deleted"
            continue

        if _RENAME_FROM_RE.match(line) or _RENAME_TO_RE.match(line):
            current["status"] = "renamed"
            continue

        hunk_match = _HUNK_RE.match(line)

        if hunk_match:

            old_start = int(hunk_match.group(1))

            old_count = (
                int(hunk_match.group(2))
                if hunk_match.group(2) is not None
                else 1
            )

            current["hunks"].append(
                {
                    "old_start": old_start,
                    "old_count": old_count,
                }
            )

    if current is not None:
        files.append(current)

    return files


# ============================================================
# PATH HANDLING
# ============================================================

def _normalize_path(path):
    """
    Strip standard git "a/"/"b/" diff prefixes and reject unsafe paths.

    Returns None for an absolute path or a path containing a ".."
    segment — such a path is never trusted or used, even though this
    module never performs filesystem access with it. This path is
    reported as skipped by the caller, never silently followed.
    """

    if not path:
        return None

    path = path.strip().replace("\\", "/")

    if path.startswith("a/") or path.startswith("b/"):
        path = path[2:]

    if not path or path.startswith("/"):
        return None

    if ".." in path.split("/"):
        return None

    return path


def _match_baseline_path(diff_path, baseline_paths):
    """
    Match a diff-supplied path against the baseline's actual file paths.

    Exact match is tried first. Falling back to a match by the LONGEST
    shared path suffix handles the common case where the analyzed
    baseline came from a "Download ZIP" archive with an extra top-level
    wrapper folder (e.g. "myrepo-main/src/app.py" in the baseline vs.
    "src/app.py" in a diff generated from a plain git checkout).

    Returns the matching baseline path, or None if nothing matches.
    """

    if diff_path is None:
        return None

    if diff_path in baseline_paths:
        return diff_path

    diff_parts = diff_path.split("/")

    best_match = None
    best_score = 0

    for baseline_path in baseline_paths:

        baseline_parts = baseline_path.split("/")

        score = 0
        i, j = len(diff_parts) - 1, len(baseline_parts) - 1

        while i >= 0 and j >= 0 and diff_parts[i] == baseline_parts[j]:
            score += 1
            i -= 1
            j -= 1

        # Require at least the filename itself to match, and prefer
        # the longest suffix match among candidates.
        if score > 0 and score > best_score:
            best_score = score
            best_match = baseline_path

    return best_match


# ============================================================
# MAP DIFF -> BASELINE FUNCTIONS
# ============================================================

def analyze_diff(diff_text, graph, analysis):
    """
    Parse `diff_text` and map every changed line range onto the
    baseline `graph` / `analysis` (the same structures POST /api/analyze
    already produces).

    Returns:
        {
            "files": [
                {
                    "path": str,
                    "status": "added" | "modified" | "deleted" | "renamed",
                    "matched_baseline": bool,
                    "changed_functions": [node_id, ...],
                    "unmapped_ranges": [{"start": int, "end": int}, ...],
                },
                ...
            ],
            "changed_nodes": [{"id": node_id, "status": "modified" | "deleted"}, ...],
            "warnings": [str, ...],
        }

    Never raises for malformed, empty, or partially-unmappable diffs —
    always returns a structured result, with warnings describing any
    uncertainty, per the "report uncertainty, never fabricate" rule.
    Class nodes are not individually mapped (classes have no stored
    `end_line` in the current graph schema, and the rest of CodeAtlas's
    Impact Analysis is function-level too) — a change inside a class
    body still maps correctly to the METHOD (function node) whose own
    line range it falls within.
    """

    warnings = []

    try:
        file_changes = parse_unified_diff(diff_text)
    except Exception as exc:
        # Defensive: parse_unified_diff is regex-based and should not
        # raise, but a malformed diff must never fail the endpoint.
        return {
            "files": [],
            "changed_nodes": [],
            "warnings": [f"Could not parse the provided diff: {exc}"],
        }

    if not file_changes:
        return {
            "files": [],
            "changed_nodes": [],
            "warnings": ["No changes were found in the provided diff."],
        }

    baseline_paths = {
        item.get("file")
        for item in (analysis or [])
        if item.get("file")
    }

    functions_by_file = defaultdict(list)

    for node_id, data in graph.nodes(data=True):

        if data.get("type") != "function":
            continue

        functions_by_file[data.get("file")].append(
            (node_id, data.get("line"), data.get("end_line"))
        )

    result_files = []
    changed_nodes = {}

    for change in file_changes:

        status = change["status"]
        diff_path = change["old_path"] or change["new_path"]
        normalized = _normalize_path(diff_path)

        if normalized is None:

            warnings.append(
                f"Skipped an unsafe or unreadable file path in the diff "
                f"({diff_path!r})."
            )

            continue

        # --------------------------------------------------------
        # Newly added file: no baseline node exists yet, so no
        # downstream impact can be computed for it. Reported, not
        # fabricated.
        # --------------------------------------------------------

        if status == "added":

            result_files.append(
                {
                    "path": normalized,
                    "status": "added",
                    "matched_baseline": False,
                    "changed_functions": [],
                    "unmapped_ranges": [],
                }
            )

            warnings.append(
                f"'{normalized}' is new in this diff. CodeAtlas cannot "
                f"compute downstream impact for code with no existing "
                f"callers in the analyzed baseline."
            )

            continue

        matched_path = _match_baseline_path(normalized, baseline_paths)

        if matched_path is None:

            result_files.append(
                {
                    "path": normalized,
                    "status": status,
                    "matched_baseline": False,
                    "changed_functions": [],
                    "unmapped_ranges": [],
                }
            )

            warnings.append(
                f"'{normalized}' was not found in the analyzed baseline "
                f"repository. It may be renamed, or this diff targets a "
                f"different repository than the one currently analyzed."
            )

            continue

        file_functions = functions_by_file.get(matched_path, [])

        changed_function_ids = []
        unmapped_ranges = []

        if status == "deleted":

            # Every function that existed in this baseline file no
            # longer exists after the change.
            for node_id, _, _ in file_functions:

                changed_function_ids.append(node_id)
                changed_nodes[node_id] = "deleted"

            if not file_functions:
                warnings.append(
                    f"'{matched_path}' was deleted, but no functions were "
                    f"found for it in the analyzed baseline."
                )

        else:

            # modified / renamed: map each hunk's OLD-side line range
            # onto overlapping baseline functions.
            for hunk in change["hunks"]:

                old_start = hunk["old_start"]
                old_count = hunk["old_count"]

                if old_count <= 0:

                    # A pure insertion within an existing file has no
                    # "old" range to overlap against a function — the
                    # insertion point is still reported, as unmapped.
                    unmapped_ranges.append(
                        {"start": old_start, "end": old_start}
                    )

                    continue

                range_start = old_start
                range_end = old_start + old_count - 1

                matched_any = False

                for node_id, line, end_line in file_functions:

                    if line is None or end_line is None:
                        continue

                    if range_start <= end_line and range_end >= line:

                        matched_any = True

                        if node_id not in changed_function_ids:
                            changed_function_ids.append(node_id)

                        changed_nodes[node_id] = "modified"

                if not matched_any:
                    unmapped_ranges.append(
                        {"start": range_start, "end": range_end}
                    )

        result_files.append(
            {
                "path": matched_path,
                "status": status,
                "matched_baseline": True,
                "changed_functions": changed_function_ids,
                "unmapped_ranges": unmapped_ranges,
            }
        )

    return {
        "files": result_files,
        "changed_nodes": [
            {"id": node_id, "status": node_status}
            for node_id, node_status in changed_nodes.items()
        ],
        "warnings": warnings,
    }
