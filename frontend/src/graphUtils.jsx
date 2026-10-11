// ============================================================
// SHARED GRAPH UTILITIES
//
// Extracted from CodeMap.jsx so the dagre layout, custom node
// rendering, and edge-relation styling have exactly ONE
// implementation, reused by both CodeMap's own graph/node/Impact
// Analysis views AND the new Change Impact page (ChangeImpact.jsx).
// Nothing in this file depends on CodeMap's component state — every
// export here is a pure function or a presentational component.
// ============================================================

import dagre from "@dagrejs/dagre";
import { Handle, Position } from "@xyflow/react";
import { FileCode2, Code2, KeyRound } from "lucide-react";


export const NODE_WIDTH = 190;
export const NODE_HEIGHT = 72;


// ============================================================
// RELATION -> EDGE CLASS  (purely visual; relation text unchanged)
// ============================================================

export function relationEdgeClass(relation) {
  const r = String(relation || "").toUpperCase();
  if (r === "CALLS") return "ca-edge-calls";
  if (r === "IMPORTS") return "ca-edge-imports";
  if (r === "CONTAINS") return "ca-edge-contains";
  return "";
}


// ============================================================
// CUSTOM GRAPH NODE
// ============================================================

export function CustomNode({ data }) {

  const isFile =
    data.type === "file";

  const isClass =
    data.type === "class";

  const riskLevel = data.riskLevel
    ? String(data.riskLevel).toLowerCase()
    : null;

  // Only set on nodes rendered as part of a focused Impact Analysis /
  // Change Impact graph (see buildFocusedGraph below). Undefined on
  // every other graph CodeMap already draws, so this never affects
  // the normal file/node views.
  const impactRole = data.role || undefined;

  return (
    <div
      className="ca-node"
      data-kind={data.type}
      data-role={impactRole}
    >

      <Handle
        type="target"
        position={Position.Left}
      />

      <div className="ca-node-head">

        {isFile ? (
          <FileCode2 />
        ) : (
          <Code2 />
        )}

        <span className="ca-node-label">
          {data.label}
        </span>

        {riskLevel && (
          <span
            className="ca-node-risk"
            data-level={riskLevel}
            title={`${data.riskLevel} risk`}
          />
        )}

        {data.hasSecret && (
          <KeyRound
            size={12}
            style={{ color: "var(--ca-medium-text)", flexShrink: 0 }}
          />
        )}

      </div>

      <p className="ca-node-kind">
        {isFile
          ? "Python file"
          : isClass
          ? "Class"
          : "Function"}
        {impactRole === "indirect" && data.distance
          ? ` · hop ${data.distance}`
          : ""}
        {impactRole === "selected" ? " · selected" : ""}
        {impactRole === "changed"
          ? ` · changed${data.changeStatus ? ` (${data.changeStatus})` : ""}`
          : ""}
      </p>

      <Handle
        type="source"
        position={Position.Right}
      />

    </div>
  );
}


export const nodeTypes = {
  custom: CustomNode,
};


// ============================================================
// DAGRE GRAPH LAYOUT
// ============================================================

export function getLayoutedElements(
  nodes,
  edges
) {

  if (!nodes.length) {
    return {
      nodes: [],
      edges,
    };
  }

  const graph =
    new dagre.graphlib.Graph();

  graph.setDefaultEdgeLabel(
    () => ({})
  );

  graph.setGraph({
    rankdir: "LR",
    nodesep: 70,
    ranksep: 130,
    marginx: 30,
    marginy: 30,
  });

  nodes.forEach((node) => {

    graph.setNode(
      node.id,
      {
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      }
    );

  });

  edges.forEach((edge) => {

    if (
      graph.hasNode(edge.source) &&
      graph.hasNode(edge.target)
    ) {

      graph.setEdge(
        edge.source,
        edge.target
      );

    }

  });

  dagre.layout(graph);

  return {

    nodes: nodes.map((node) => {

      const position =
        graph.node(node.id);

      return {
        ...node,

        position: position
          ? {
              x:
                position.x -
                NODE_WIDTH / 2,

              y:
                position.y -
                NODE_HEIGHT / 2,
            }
          : {
              x: 0,
              y: 0,
            },
      };

    }),

    edges,
  };
}


// ============================================================
// BUILD FOCUSED GRAPH
//
// Converts the focused graph payload returned by either
// GET /api/impact/{id} or POST /api/impact/changes (see
// backend/impact.py — both share the identical
// { nodes: [{id,name,type,file,role,distance,risk_level,
//            change_status,...}], edges: [{source,target,relation}] }
// shape) into the same ReactFlow node/edge shape buildGraph() (in
// CodeMap.jsx) already produces, reusing the SAME dagre layout and
// edge-relation styling — one rendering path for every graph view in
// the app, not a second one per feature.
// ============================================================

export function buildFocusedGraph(focusedGraph) {

  const rawNodes = focusedGraph?.nodes || [];
  const rawEdges = focusedGraph?.edges || [];

  const formattedNodes = rawNodes.map((node) => ({

    id: node.id,

    type: "custom",

    data: {

      label:
        node.type === "function"
          ? `${node.name}()`
          : node.name || node.id,

      type: node.type,

      role: node.role,

      distance: node.distance,

      changeStatus: node.change_status,

      riskLevel: node.risk_level || null,

    },

    position: {
      x: 0,
      y: 0,
    },

  }));

  const formattedEdges = rawEdges

    .map(
      (edge, index) => ({

        id:
          `focused-edge-${index}-${edge.source}-${edge.target}`,

        source:
          edge.source,

        target:
          edge.target,

        label:
          edge.relation,

        type:
          "smoothstep",

        className:
          relationEdgeClass(
            edge.relation
          ),

      })
    )

    .filter(
      (edge) =>
        formattedNodes.some(
          (node) =>
            node.id ===
            edge.source
        ) &&
        formattedNodes.some(
          (node) =>
            node.id ===
            edge.target
        )
    );

  return getLayoutedElements(
    formattedNodes,
    formattedEdges
  );
}
