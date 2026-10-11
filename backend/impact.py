"""Impact Analysis.

Traces the EXISTING CodeAtlas call/dependency graph (the same
networkx.DiGraph built by backend/graph.py) to estimate what else could
be affected by changing a given function or class node.

No new graph architecture is introduced here. This module only
traverses the CALLS / IMPORTS edges that backend/graph.py already
produces, the same edge types /api/graph/node/{id} already reads.
"""

from collections import deque, defaultdict


# ============================================================
# BFS OVER A SINGLE EDGE RELATION
# ============================================================

def _bfs_distances(graph, start_id, relation, reverse, max_depth):
    """
    Breadth-first search over edges tagged with `relation`
    ("CALLS" or "IMPORTS"), starting at start_id, up to max_depth hops.

    reverse=True  walks incoming edges (who points AT start_id) —
                  used to find callers / dependents.
    reverse=False walks outgoing edges (what start_id points AT) —
                  used to find dependencies.

    Returns (distances, edges):
      distances: {node_id: hop_count}, excluding start_id itself. Each
                 node is kept at the SHORTEST distance it was first
                 discovered at, so cycles and diamond-shaped call
                 graphs never produce duplicates or infinite loops.
      edges:     [(source_id, target_id, relation)] in the ORIGINAL
                 graph's edge direction (caller -> callee), i.e. the
                 real CALLS/IMPORTS edges that were actually walked to
                 discover each node. This is what lets the frontend
                 draw a correctly-directed focused impact graph.
    """

    distances = {}
    discovered_edges = []
    queue = deque([(start_id, 0)])
    visited = {start_id}

    while queue:

        current_id, depth = queue.popleft()

        if depth >= max_depth:
            continue

        if reverse:
            edge_view = graph.in_edges(current_id, data=True)
            pairs = [
                (source, current_id)
                for source, _, data in edge_view
                if data.get("relation") == relation
            ]
        else:
            edge_view = graph.out_edges(current_id, data=True)
            pairs = [
                (current_id, target)
                for _, target, data in edge_view
                if data.get("relation") == relation
            ]

        for edge_source, edge_target in pairs:

            neighbor_id = edge_source if reverse else edge_target

            if neighbor_id in visited:
                continue

            visited.add(neighbor_id)
            distances[neighbor_id] = depth + 1
            discovered_edges.append(
                (edge_source, edge_target, relation)
            )
            queue.append((neighbor_id, depth + 1))

    return distances, discovered_edges


# ============================================================
# NODE SUMMARY
# ============================================================

def _node_summary(graph, node_id, role, distance=None):

    if node_id not in graph.nodes:
        return None

    data = graph.nodes[node_id]

    summary = {
        "id": node_id,
        "name": data.get("name", node_id),
        "type": data.get("type", "unknown"),
        "file": data.get("file", ""),
        "role": role,
    }

    if distance is not None:
        summary["distance"] = distance

    return summary


# ============================================================
# COMPUTE IMPACT
# ============================================================

def compute_impact(graph, node_id, depth=2, risk_by_id=None):
    """
    Compute direct/indirect impact, dependencies, affected files, a
    rule-based impact summary, and a focused impact graph (nodes +
    edges) for `node_id`.

    risk_by_id: optional {node_id: prediction_dict} taken straight from
    the EXISTING RiskPredictor output (the same dicts /api/risk
    returns). Used only to annotate already-affected nodes with their
    already-computed risk level — this introduces no new ML model.
    """

    if node_id not in graph.nodes:

        return {
            "error": "Node not found"
        }

    risk_by_id = risk_by_id or {}

    # Depth is always clamped into the supported 1-3 range rather than
    # rejected, so a bad query param degrades gracefully instead of
    # breaking the existing experience.
    try:
        depth = int(depth)
    except (TypeError, ValueError):
        depth = 2

    depth = max(1, min(3, depth))

    # --------------------------------------------------------
    # DIRECT + INDIRECT IMPACT
    #
    # "Who is affected if node_id changes?" = who CALLS node_id,
    # transitively, up to `depth` hops. This walks CALLS edges
    # backward from node_id.
    # --------------------------------------------------------

    caller_distances, caller_edges = _bfs_distances(
        graph,
        node_id,
        relation="CALLS",
        reverse=True,
        max_depth=depth,
    )

    direct_ids = [
        affected_id
        for affected_id, distance in caller_distances.items()
        if distance == 1
    ]

    indirect_ids = [
        affected_id
        for affected_id, distance in caller_distances.items()
        if distance > 1
    ]

    # --------------------------------------------------------
    # DEPENDENCIES
    #
    # "What does node_id itself rely on?" — direct CALLS + IMPORTS
    # targets only, matching the existing /api/graph/node contract
    # (callees/dependencies are a direct relationship there too).
    # --------------------------------------------------------

    dependency_edges = [
        (node_id, target, data.get("relation"))
        for _, target, data in graph.out_edges(node_id, data=True)
        if data.get("relation") in ("CALLS", "IMPORTS")
    ]

    dependency_ids = list(
        dict.fromkeys(target for _, target, _ in dependency_edges)
    )

    # --------------------------------------------------------
    # BUILD NODE SUMMARIES (+ existing risk annotation)
    # --------------------------------------------------------

    def summarize(ids, role, distances=None):

        results = []

        for affected_id in ids:

            summary = _node_summary(
                graph,
                affected_id,
                role=role,
                distance=(distances or {}).get(affected_id),
            )

            if summary is None:
                # Node referenced by an edge but missing from the
                # graph (shouldn't happen, but never let a dangling
                # reference break impact analysis).
                continue

            risk = risk_by_id.get(affected_id)

            if risk is not None:
                summary["risk_level"] = risk.get("risk_level")
                summary["risk_probability"] = risk.get("risk_probability")

            results.append(summary)

        return results

    direct = summarize(direct_ids, "direct", caller_distances)
    indirect = summarize(indirect_ids, "indirect", caller_distances)
    dependencies = summarize(dependency_ids, "dependency")

    # --------------------------------------------------------
    # AFFECTED FILES
    # --------------------------------------------------------

    affected_files = sorted(
        {
            item["file"]
            for item in (direct + indirect)
            if item.get("file")
        }
    )

    # --------------------------------------------------------
    # HIGH-RISK AFFECTED COMPONENTS
    # --------------------------------------------------------

    high_risk_affected = [
        item
        for item in (direct + indirect)
        if item.get("risk_level") == "High"
    ]

    # --------------------------------------------------------
    # RULE-BASED IMPACT LEVEL
    #
    # Explainable graph evidence only (counts + presence of high-risk
    # affected components) — this is NOT a new ML model.
    # --------------------------------------------------------

    direct_count = len(direct)
    indirect_count = len(indirect)
    total_affected = direct_count + indirect_count
    affected_file_count = len(affected_files)
    high_risk_count = len(high_risk_affected)

    reasons = []

    if direct_count:
        reasons.append(
            f"{direct_count} direct dependent"
            f"{'s' if direct_count != 1 else ''}"
        )

    if indirect_count:
        reasons.append(
            f"{indirect_count} indirect dependent"
            f"{'s' if indirect_count != 1 else ''} "
            f"within {depth} hop{'s' if depth != 1 else ''}"
        )

    if affected_file_count:
        reasons.append(
            f"{affected_file_count} affected file"
            f"{'s' if affected_file_count != 1 else ''}"
        )

    if high_risk_count:
        reasons.append(
            f"{high_risk_count} high-risk affected "
            f"function{'s' if high_risk_count != 1 else ''}"
        )

    if not reasons:
        reasons.append(
            "No dependents found within the selected depth"
        )

    if (
        total_affected >= 8
        or affected_file_count >= 5
        or (high_risk_count > 0 and total_affected >= 3)
    ):
        impact_level = "High"

    elif (
        total_affected >= 3
        or affected_file_count >= 2
        or high_risk_count > 0
    ):
        impact_level = "Medium"

    else:
        impact_level = "Low"

    # --------------------------------------------------------
    # FOCUSED IMPACT GRAPH
    #
    # A small, ready-to-render node/edge set for the UI's visual
    # impact map: the selected node, everything direct/indirect/
    # dependency, and the real graph edges that connect them.
    # --------------------------------------------------------

    selected_summary = _node_summary(graph, node_id, role="selected")

    graph_nodes_by_id = {}

    for item in [selected_summary] + direct + indirect + dependencies:

        if item is None:
            continue

        # A node already added under a higher-priority role (e.g.
        # "selected") keeps that role rather than being overwritten.
        if item["id"] not in graph_nodes_by_id:
            graph_nodes_by_id[item["id"]] = item

    graph_edges = []
    seen_edges = set()

    for edge_source, edge_target, relation in (
        caller_edges + dependency_edges
    ):

        edge_key = (edge_source, edge_target, relation)

        if edge_key in seen_edges:
            continue

        seen_edges.add(edge_key)

        graph_edges.append(
            {
                "source": edge_source,
                "target": edge_target,
                "relation": relation,
            }
        )

    return {
        "id": node_id,
        "depth": depth,

        "direct": direct,
        "indirect": indirect,
        "dependencies": dependencies,

        "affected_files": affected_files,

        "impact_summary": {
            "direct_count": direct_count,
            "indirect_count": indirect_count,
            "affected_file_count": affected_file_count,
            "high_risk_affected": high_risk_affected,
            "impact_level": impact_level,
            "reasons": reasons,
        },

        "graph": {
            "nodes": list(graph_nodes_by_id.values()),
            "edges": graph_edges,
        },
    }


# ============================================================
# COMPUTE CHANGE IMPACT  (Change Impact Intelligence)
#
# Aggregates impact across an entire changeset (multiple changed
# functions at once, e.g. from a git diff), reusing the EXACT SAME
# traversal primitives as compute_impact() above (_bfs_distances,
# _node_summary) — no separate or duplicated graph-walking logic.
# ============================================================

def compute_change_impact(graph, changed_nodes, risk_by_id=None, depth=2):
    """
    changed_nodes: [{"id": node_id, "status": "modified" | "deleted"}, ...]
                   Typically produced by backend/diff_analysis.py from a
                   parsed git diff. A node_id not present in `graph` is
                   skipped (reported in "skipped"), never fabricated.

    risk_by_id: the same existing RiskPredictor output dict every other
                endpoint uses. No new ML model is introduced here — the
                impact_level below is rule-based graph evidence, exactly
                like compute_impact()'s.

    Returns a dict shaped like compute_impact()'s, plus:
      "changed":  per-changed-node summaries (with "change_status")
      "skipped":  changed_nodes ids that don't exist in the baseline graph
    Each affected node also carries "caused_by": the list of changed
    node ids whose propagation reached it — the "concise,
    evidence-grounded" link between a change and its downstream effect.
    """

    risk_by_id = risk_by_id or {}

    try:
        depth = int(depth)
    except (TypeError, ValueError):
        depth = 2

    depth = max(1, min(3, depth))

    valid_changed = []
    skipped = []

    for item in (changed_nodes or []):

        node_id = item.get("id")
        status = item.get("status", "modified")

        if node_id in graph.nodes:
            valid_changed.append({"id": node_id, "status": status})
        else:
            skipped.append(node_id)

    if not valid_changed:

        return {
            "changed": [],
            "direct": [],
            "indirect": [],
            "affected_files": [],
            "impact_summary": {
                "direct_count": 0,
                "indirect_count": 0,
                "affected_file_count": 0,
                "high_risk_affected": [],
                "impact_level": "Low",
                "reasons": [
                    "No changed functions could be matched to the "
                    "analyzed baseline."
                ],
            },
            "graph": {"nodes": [], "edges": []},
            "skipped": skipped,
        }

    # --------------------------------------------------------
    # Merge reverse-CALLS BFS from EVERY changed node.
    #
    # A node's overall distance is the SHORTEST distance from ANY
    # changed node (so a diamond-shaped dependency never gets
    # double-counted), and "caused_by" names every changed node whose
    # propagation reaches it.
    # --------------------------------------------------------

    merged_distances = {}
    merged_causes = defaultdict(set)
    merged_edges = []
    seen_edges = set()

    for change in valid_changed:

        node_id = change["id"]

        distances, edges = _bfs_distances(
            graph,
            node_id,
            relation="CALLS",
            reverse=True,
            max_depth=depth,
        )

        for affected_id, distance in distances.items():

            if (
                affected_id not in merged_distances
                or distance < merged_distances[affected_id]
            ):
                merged_distances[affected_id] = distance

            merged_causes[affected_id].add(node_id)

        for edge_source, edge_target, relation in edges:

            edge_key = (edge_source, edge_target, relation)

            if edge_key not in seen_edges:
                seen_edges.add(edge_key)
                merged_edges.append((edge_source, edge_target, relation))

    # A changed function is never ALSO listed as "affected by" the
    # changeset, even if another changed function happens to call it.
    changed_ids = {change["id"] for change in valid_changed}

    for changed_id in changed_ids:
        merged_distances.pop(changed_id, None)
        merged_causes.pop(changed_id, None)

    direct_ids = [
        node_id
        for node_id, distance in merged_distances.items()
        if distance == 1
    ]

    indirect_ids = [
        node_id
        for node_id, distance in merged_distances.items()
        if distance > 1
    ]

    def summarize(ids):

        results = []

        for affected_id in ids:

            role = (
                "direct"
                if merged_distances[affected_id] == 1
                else "indirect"
            )

            summary = _node_summary(
                graph,
                affected_id,
                role=role,
                distance=merged_distances[affected_id],
            )

            if summary is None:
                continue

            summary["caused_by"] = sorted(merged_causes[affected_id])

            risk = risk_by_id.get(affected_id)

            if risk is not None:
                summary["risk_level"] = risk.get("risk_level")
                summary["risk_probability"] = risk.get("risk_probability")

            results.append(summary)

        return results

    direct = summarize(direct_ids)
    indirect = summarize(indirect_ids)

    affected_files = sorted(
        {
            item["file"]
            for item in (direct + indirect)
            if item.get("file")
        }
    )

    high_risk_affected = [
        item
        for item in (direct + indirect)
        if item.get("risk_level") == "High"
    ]

    direct_count = len(direct)
    indirect_count = len(indirect)
    total_affected = direct_count + indirect_count
    affected_file_count = len(affected_files)
    high_risk_count = len(high_risk_affected)
    changed_count = len(valid_changed)

    reasons = []

    if changed_count:
        reasons.append(
            f"{changed_count} changed function"
            f"{'s' if changed_count != 1 else ''}"
        )

    if direct_count:
        reasons.append(
            f"{direct_count} direct dependent"
            f"{'s' if direct_count != 1 else ''}"
        )

    if indirect_count:
        reasons.append(
            f"{indirect_count} indirect dependent"
            f"{'s' if indirect_count != 1 else ''} "
            f"within {depth} hop{'s' if depth != 1 else ''}"
        )

    if affected_file_count:
        reasons.append(
            f"{affected_file_count} affected file"
            f"{'s' if affected_file_count != 1 else ''}"
        )

    if high_risk_count:
        reasons.append(
            f"{high_risk_count} high-risk affected "
            f"function{'s' if high_risk_count != 1 else ''}"
        )

    if not reasons:
        reasons.append(
            "No dependents found for the changed functions within "
            "the selected depth"
        )

    # Thresholds are scaled up slightly from compute_impact()'s
    # single-node ones, since a changeset naturally touches more nodes
    # — still explainable graph evidence only, not a new ML model.
    if (
        total_affected >= 10
        or affected_file_count >= 6
        or (high_risk_count > 0 and total_affected >= 4)
    ):
        impact_level = "High"

    elif (
        total_affected >= 4
        or affected_file_count >= 2
        or high_risk_count > 0
    ):
        impact_level = "Medium"

    else:
        impact_level = "Low"

    # --------------------------------------------------------
    # Focused graph: changed nodes (role="changed", + change_status)
    # plus everything direct/indirect, and the real traversed edges.
    # --------------------------------------------------------

    changed_summaries = []

    for change in valid_changed:

        summary = _node_summary(graph, change["id"], role="changed")

        if summary is None:
            continue

        summary["change_status"] = change["status"]

        risk = risk_by_id.get(change["id"])

        if risk is not None:
            summary["risk_level"] = risk.get("risk_level")
            summary["risk_probability"] = risk.get("risk_probability")

        changed_summaries.append(summary)

    graph_nodes_by_id = {}

    for item in changed_summaries + direct + indirect:

        if item["id"] not in graph_nodes_by_id:
            graph_nodes_by_id[item["id"]] = item

    graph_edges = [
        {"source": source, "target": target, "relation": relation}
        for source, target, relation in merged_edges
    ]

    return {
        "changed": changed_summaries,
        "direct": direct,
        "indirect": indirect,
        "affected_files": affected_files,
        "impact_summary": {
            "direct_count": direct_count,
            "indirect_count": indirect_count,
            "affected_file_count": affected_file_count,
            "high_risk_affected": high_risk_affected,
            "impact_level": impact_level,
            "reasons": reasons,
        },
        "graph": {
            "nodes": list(graph_nodes_by_id.values()),
            "edges": graph_edges,
        },
        "skipped": skipped,
    }
