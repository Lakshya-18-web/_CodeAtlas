import unittest

import networkx as nx

from backend.impact import compute_change_impact, compute_impact


def build_graph():
    """
    Mirrors the real graph.py schema. Chain:

        login() <- api_login() <- handle_request() <- route()
                 <- api_login_legacy()

    Plus validate_user() (a dependency of login(), unaffected by the
    changeset), an isolated lonely() function, and a 2-node cycle
    (helper_a <-> helper_b) to prove duplicate-path / cycle safety
    when MULTIPLE changed nodes are analyzed together.
    """

    g = nx.DiGraph()

    def node(node_id, **attrs):
        g.add_node(node_id, **attrs)

    def edge(source, target, relation):
        g.add_edge(source, target, relation=relation)

    node("auth.py:login", type="function", name="login", file="auth.py")
    node("auth.py:validate_user", type="function", name="validate_user", file="auth.py")
    node("api.py:api_login", type="function", name="api_login", file="api.py")
    node("api.py:api_login_legacy", type="function", name="api_login_legacy", file="api.py")
    node("server.py:handle_request", type="function", name="handle_request", file="server.py")
    node("router.py:route", type="function", name="route", file="router.py")
    node("server.py:lonely", type="function", name="lonely", file="server.py")
    node("server.py:helper_a", type="function", name="helper_a", file="server.py")
    node("server.py:helper_b", type="function", name="helper_b", file="server.py")

    edge("auth.py:login", "auth.py:validate_user", "CALLS")
    edge("api.py:api_login", "auth.py:login", "CALLS")
    edge("api.py:api_login_legacy", "auth.py:login", "CALLS")
    edge("server.py:handle_request", "api.py:api_login", "CALLS")
    edge("router.py:route", "server.py:handle_request", "CALLS")
    edge("server.py:helper_a", "server.py:helper_b", "CALLS")
    edge("server.py:helper_b", "server.py:helper_a", "CALLS")

    return g


def risk(level, prob):
    return {"risk_level": level, "risk_probability": prob}


class ChangeImpactTests(unittest.TestCase):

    def test_single_changed_function_matches_compute_impact(self):
        """
        compute_change_impact() with ONE changed node should find the
        same direct/indirect set as the existing v1 compute_impact() —
        proving it reuses the same traversal rather than diverging.
        """

        g = build_graph()

        single = compute_impact(g, "auth.py:login", depth=3)
        changeset = compute_change_impact(
            g, [{"id": "auth.py:login", "status": "modified"}], depth=3
        )

        single_direct = sorted(i["id"] for i in single["direct"])
        single_indirect = sorted(i["id"] for i in single["indirect"])
        change_direct = sorted(i["id"] for i in changeset["direct"])
        change_indirect = sorted(i["id"] for i in changeset["indirect"])

        self.assertEqual(single_direct, change_direct)
        self.assertEqual(single_indirect, change_indirect)

    def test_multiple_changed_functions_merge_and_dedupe(self):
        g = build_graph()

        result = compute_change_impact(
            g,
            [
                {"id": "auth.py:login", "status": "modified"},
                {"id": "auth.py:validate_user", "status": "modified"},
            ],
            depth=3,
        )

        direct_ids = {i["id"] for i in result["direct"]}
        indirect_ids = {i["id"] for i in result["indirect"]}

        # api_login / api_login_legacy are direct callers of login().
        self.assertIn("api.py:api_login", direct_ids)
        self.assertIn("api.py:api_login_legacy", direct_ids)
        # handle_request and route are indirect.
        self.assertIn("server.py:handle_request", indirect_ids)
        self.assertIn("router.py:route", indirect_ids)

        # validate_user has no callers other than login() (which is
        # itself a changed node, so it's excluded from "affected").
        self.assertNotIn("auth.py:validate_user", direct_ids)
        self.assertNotIn("auth.py:validate_user", indirect_ids)

        # Neither changed function appears in its own impact lists.
        self.assertNotIn("auth.py:login", direct_ids | indirect_ids)
        self.assertNotIn("auth.py:validate_user", direct_ids | indirect_ids)

    def test_direct_and_indirect_propagation_depth(self):
        g = build_graph()

        depth1 = compute_change_impact(
            g, [{"id": "auth.py:login", "status": "modified"}], depth=1
        )
        depth3 = compute_change_impact(
            g, [{"id": "auth.py:login", "status": "modified"}], depth=3
        )

        self.assertEqual(len(depth1["indirect"]), 0)
        self.assertTrue(len(depth3["indirect"]) >= 2)

    def test_cycle_does_not_hang_or_duplicate_with_multiple_changes(self):
        g = build_graph()

        result = compute_change_impact(
            g,
            [
                {"id": "server.py:helper_a", "status": "modified"},
                {"id": "server.py:helper_b", "status": "modified"},
            ],
            depth=3,
        )

        # Both are changed nodes; since each is the other's only
        # caller, and both are excluded as "changed", direct/indirect
        # must end up empty, not hang or duplicate.
        self.assertEqual(result["direct"], [])
        self.assertEqual(result["indirect"], [])

    def test_duplicate_traversal_paths_collapse_to_shortest_distance(self):
        g = build_graph()

        result = compute_change_impact(
            g, [{"id": "auth.py:login", "status": "modified"}], depth=3
        )

        by_id = {i["id"]: i for i in (result["direct"] + result["indirect"])}

        self.assertEqual(by_id["api.py:api_login"]["distance"], 1)
        self.assertEqual(by_id["server.py:handle_request"]["distance"], 2)
        self.assertEqual(by_id["router.py:route"]["distance"], 3)
        # api_login must not ALSO appear in indirect.
        indirect_ids = {i["id"] for i in result["indirect"]}
        self.assertNotIn("api.py:api_login", indirect_ids)

    def test_caused_by_links_affected_node_to_its_changed_source(self):
        g = build_graph()

        result = compute_change_impact(
            g,
            [
                {"id": "auth.py:login", "status": "modified"},
                {"id": "server.py:lonely", "status": "modified"},
            ],
            depth=2,
        )

        by_id = {i["id"]: i for i in (result["direct"] + result["indirect"])}

        self.assertEqual(
            by_id["api.py:api_login"]["caused_by"], ["auth.py:login"]
        )

    def test_risk_integration_when_available(self):
        g = build_graph()

        risk_by_id = {
            "api.py:api_login": risk("High", 0.81),
        }

        result = compute_change_impact(
            g,
            [{"id": "auth.py:login", "status": "modified"}],
            risk_by_id=risk_by_id,
            depth=2,
        )

        high_risk_ids = {i["id"] for i in result["impact_summary"]["high_risk_affected"]}
        self.assertIn("api.py:api_login", high_risk_ids)

    def test_graceful_without_risk_data(self):
        g = build_graph()

        result = compute_change_impact(
            g, [{"id": "auth.py:login", "status": "modified"}], depth=2,
        )

        self.assertEqual(result["impact_summary"]["high_risk_affected"], [])
        for item in result["direct"]:
            self.assertNotIn("risk_level", item)

    def test_deleted_function_status_is_preserved_and_impact_computed(self):
        g = build_graph()

        result = compute_change_impact(
            g, [{"id": "auth.py:login", "status": "deleted"}], depth=2,
        )

        self.assertEqual(result["changed"][0]["change_status"], "deleted")
        direct_ids = {i["id"] for i in result["direct"]}
        self.assertIn("api.py:api_login", direct_ids)
        self.assertIn("api.py:api_login_legacy", direct_ids)

    def test_unmappable_or_nonexistent_node_is_skipped_not_fabricated(self):
        g = build_graph()

        result = compute_change_impact(
            g,
            [
                {"id": "auth.py:login", "status": "modified"},
                {"id": "ghost.py:does_not_exist", "status": "modified"},
            ],
            depth=2,
        )

        self.assertEqual(result["skipped"], ["ghost.py:does_not_exist"])
        changed_ids = {c["id"] for c in result["changed"]}
        self.assertEqual(changed_ids, {"auth.py:login"})

    def test_all_nodes_unmappable_returns_safe_empty_result(self):
        g = build_graph()

        result = compute_change_impact(
            g, [{"id": "ghost.py:nope", "status": "modified"}], depth=2,
        )

        self.assertEqual(result["direct"], [])
        self.assertEqual(result["indirect"], [])
        self.assertEqual(result["impact_summary"]["impact_level"], "Low")
        self.assertEqual(result["skipped"], ["ghost.py:nope"])

    def test_focused_graph_includes_changed_node_with_role(self):
        g = build_graph()

        result = compute_change_impact(
            g, [{"id": "auth.py:login", "status": "modified"}], depth=2,
        )

        graph_nodes = {n["id"]: n for n in result["graph"]["nodes"]}
        self.assertEqual(graph_nodes["auth.py:login"]["role"], "changed")
        self.assertEqual(
            graph_nodes["auth.py:login"]["change_status"], "modified"
        )


if __name__ == "__main__":
    unittest.main()
