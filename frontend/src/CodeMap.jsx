import { useCallback, useEffect, useMemo, useState } from "react";
import dagre from "@dagrejs/dagre";

import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
} from "@xyflow/react";

import "@xyflow/react/dist/style.css";

import {
  Search,
  X,
  Code2,
  ShieldAlert,
  Sparkles,
  Loader2,
  FolderTree,
  FileCode2,
  ArrowLeft,
  Network,
  KeyRound,
} from "lucide-react";


const NODE_WIDTH = 190;
const NODE_HEIGHT = 72;


// ============================================================
// RELATION -> EDGE CLASS  (purely visual; relation text unchanged)
// ============================================================

function relationEdgeClass(relation) {
  const r = String(relation || "").toUpperCase();
  if (r === "CALLS") return "ca-edge-calls";
  if (r === "IMPORTS") return "ca-edge-imports";
  if (r === "CONTAINS") return "ca-edge-contains";
  return "";
}


// ============================================================
// CUSTOM GRAPH NODE
// ============================================================

function CustomNode({ data }) {

  const isFile =
    data.type === "file";

  const isClass =
    data.type === "class";

  const riskLevel = data.riskLevel
    ? String(data.riskLevel).toLowerCase()
    : null;

  return (
    <div
      className="ca-node"
      data-kind={data.type}
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
      </p>

      <Handle
        type="source"
        position={Position.Right}
      />

    </div>
  );
}


const nodeTypes = {
  custom: CustomNode,
};


// ============================================================
// DAGRE GRAPH LAYOUT
// ============================================================

function getLayoutedElements(
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
// RISK BADGE
// ============================================================

function RiskBadge({ level }) {

  const normalized =
    String(level || "Low").toLowerCase();

  return (
    <span className="ca-badge ca-badge-dot" data-tone={normalized}>
      {level || "Low"}
    </span>
  );
}


// ============================================================
// RISK COLOR  (icon color only; logic unchanged)
// ============================================================

function getRiskColor(level) {

  const normalized =
    String(level || "Low").toLowerCase();

  if (normalized === "high") {
    return "var(--ca-high-text)";
  }

  if (normalized === "medium") {
    return "var(--ca-medium-text)";
  }

  return "var(--ca-low-text)";
}


function getFileStats(selectedNode) {

  const localNodes =
    selectedNode?.local_graph?.nodes || [];

  const localEdges =
    selectedNode?.local_graph?.edges || [];

  const functions =
    localNodes.filter(
      (node) => node.type === "function"
    ).length;

  const classes =
    localNodes.filter(
      (node) => node.type === "class"
    ).length;

  const imports =
    localEdges.filter(
      (edge) =>
        String(
          edge.relation || edge.type || ""
        ).toUpperCase() === "IMPORTS"
    ).length;

  const calls =
    localEdges.filter(
      (edge) =>
        String(
          edge.relation || edge.type || ""
        ).toUpperCase() === "CALLS"
    ).length;

  const contains =
    localEdges.filter(
      (edge) =>
        String(
          edge.relation || edge.type || ""
        ).toUpperCase() === "CONTAINS"
    ).length;

  return {
    functions,
    classes,
    symbols: functions + classes,
    imports,
    calls,
    contains,
  };
}


// ============================================================
// SECRET LOOKUP (file -> findings), built from the same
// secretReport the Dashboard/Security pages already use.
// ============================================================

function buildSecretFileSet(secretReport) {
  const set = new Set();
  (secretReport?.findings || []).forEach((finding) => {
    if (finding?.file) set.add(finding.file);
  });
  return set;
}


// ============================================================
// MAIN CODE MAP
// ============================================================

export default function CodeMap({
  repository,
  secretReport,
}) {

  const [view, setView] =
    useState("files");

  const [currentFile, setCurrentFile] =
    useState(null);

  const [files, setFiles] =
    useState([]);

  const [nodes, setNodes] =
    useState([]);

  const [edges, setEdges] =
    useState([]);

  const [selectedNode, setSelectedNode] =
    useState(null);

  const [risks, setRisks] =
    useState([]);

  const [search, setSearch] =
    useState("");

  const [loading, setLoading] =
    useState(true);

  const [graphLoading, setGraphLoading] =
    useState(false);

  const [riskLoading, setRiskLoading] =
    useState(false);

  const [aiExplanation, setAiExplanation] =
    useState(null);

  const [explaining, setExplaining] =
    useState(false);

  const [error, setError] =
    useState(null);


  // ============================================================
  // LOAD FILE-LEVEL OVERVIEW
  // ============================================================

  useEffect(() => {

    if (!repository) {

      setFiles([]);
      setNodes([]);
      setEdges([]);
      setSelectedNode(null);
      setCurrentFile(null);
      setView("files");
      setLoading(false);

      return;
    }


    async function loadFiles() {

      try {

        setLoading(true);
        setError(null);

        const response =
          await fetch(
            "/api/graph/files"
          );

        const data =
          await response.json();

        if (
          !response.ok ||
          data.error
        ) {

          throw new Error(
            data.error ||
            "Failed to load files"
          );

        }

        setFiles(
          data.files || []
        );

      } catch (err) {

        console.error(err);

        setError(
          err.message ||
          "Failed to load codebase"
        );

      } finally {

        setLoading(false);

      }

    }


    loadFiles();

  }, [repository]);


  // ============================================================
  // LOAD RISK DATA
  // ============================================================

  useEffect(() => {

    async function loadRisks() {

      setRiskLoading(true);

      try {

        const response =
          await fetch(
            "/api/risk"
          );

        const data =
          await response.json();

        if (!data.error) {

          setRisks(
            Array.isArray(data)
              ? data
              : []
          );

        }

      } catch (err) {

        console.error(
          "Could not load risk predictions:",
          err
        );

      } finally {

        setRiskLoading(false);

      }

    }


    loadRisks();

  }, []);


  // ============================================================
  // SECRET FILE SET  (derived, no new request)
  // ============================================================

  const secretFiles = useMemo(
    () => buildSecretFileSet(secretReport),
    [secretReport]
  );


  // ============================================================
  // RISK LOOKUP BY NODE ID (for coloring graph nodes)
  // ============================================================

  const riskById = useMemo(() => {
    const map = new Map();
    risks.forEach((item) => {
      if (item?.id) map.set(item.id, item);
    });
    return map;
  }, [risks]);


  // ============================================================
  // BUILD REACT FLOW GRAPH
  // ============================================================

  function buildGraph(
    rawNodes = [],
    rawEdges = []
  ) {

    const formattedNodes =
      rawNodes.map((node) => {

        const risk = riskById.get(node.id);

        return {

          id: node.id,

          type: "custom",

          data: {

            label:
              node.type === "file"
                ? node.name ||
                  node.file ||
                  node.id

                : node.type === "function"
                ? `${node.name}()`

                : node.name ||
                  node.id,

            type: node.type,

            riskLevel:
              node.type === "function" && risk
                ? risk.risk_level
                : null,

            hasSecret:
              node.type === "file" &&
              secretFiles.has(node.file || node.id),

          },

          position: {
            x: 0,
            y: 0,
          },

        };
      });


    const formattedEdges =
      rawEdges

        .map(
          (edge, index) => ({

            id:
              `edge-${index}-${edge.source}-${edge.target}`,

            source:
              edge.source,

            target:
              edge.target,

            label:
              edge.relation ||
              edge.type,

            type:
              "smoothstep",

            className:
              relationEdgeClass(
                edge.relation || edge.type
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


  // ============================================================
  // OPEN FILE
  // ============================================================

  const openFile =
    useCallback(
      async (file) => {

        try {

          setGraphLoading(true);
          setError(null);
          setSelectedNode(null);
          setAiExplanation(null);
          setCurrentFile(file);
          setSearch("");
          setView("file");


          const response =
            await fetch(
              `/api/graph/file/${encodeURIComponent(
                file.id
              )}`
            );

          const data =
            await response.json();


          if (
            !response.ok ||
            data.error
          ) {

            throw new Error(
              data.error ||
              "Failed to load file graph"
            );

          }


          const graph =
            buildGraph(
              data.nodes || [],
              data.edges || []
            );


          setNodes(
            graph.nodes
          );

          setEdges(
            graph.edges
          );

        } catch (err) {

          console.error(err);

          setError(
            err.message ||
            "Failed to load file"
          );

        } finally {

          setGraphLoading(false);

        }

      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [riskById, secretFiles]
    );


  // ============================================================
  // OPEN SELECTED FUNCTION / CLASS
  // ============================================================

  const openNode =
    useCallback(
      async (nodeId) => {

        try {

          setGraphLoading(true);
          setAiExplanation(null);


          const response =
            await fetch(
              `/api/graph/node/${encodeURIComponent(
                nodeId
              )}`
            );


          const data =
            await response.json();


          if (
            !response.ok ||
            data.error
          ) {

            throw new Error(
              data.error ||
              "Failed to load node"
            );

          }


          const risk =
            risks.find(
              (item) =>
                item.id === nodeId
            ) ||
            risks.find(
              (item) =>
                item.file ===
                  data.file &&
                item.function ===
                  data.name
            ) ||
            null;


          setSelectedNode({

            ...data,

            risk,

          });


          // ----------------------------------------------------
          // Local graph
          // ----------------------------------------------------

          if (
            data.local_graph
          ) {

            const graph =
              buildGraph(
                data.local_graph.nodes ||
                  [],
                data.local_graph.edges ||
                  []
              );


            setNodes(
              graph.nodes
            );

            setEdges(
              graph.edges
            );

          }


          setView("node");

        } catch (err) {

          console.error(
            "Could not load node details:",
            err
          );

          setError(
            err.message ||
            "Failed to load node"
          );

        } finally {

          setGraphLoading(false);

        }

      },

      // eslint-disable-next-line react-hooks/exhaustive-deps
      [risks, riskById, secretFiles]
    );


  // ============================================================
  // REACT FLOW CLICK
  // ============================================================

  const onNodeClick =
    useCallback(
      (_, node) => {

        openNode(
          node.id
        );

      },
      [openNode]
    );


  // ============================================================
  // GO BACK
  // ============================================================

  async function goBack() {

    if (
      view === "node" &&
      currentFile
    ) {

      await openFile(
        currentFile
      );

      return;
    }


    setSelectedNode(null);
    setCurrentFile(null);
    setView("files");
    setNodes([]);
    setEdges([]);
    setSearch("");

  }


  // ============================================================
  // GEMINI EXPLANATION
  // ============================================================

  async function explainWithAI() {

    if (
      !selectedNode?.id
    ) {

      return;
    }


    setExplaining(true);
    setAiExplanation(null);


    try {

      const response =
        await fetch(
          `/api/risk/explain/${encodeURIComponent(
            selectedNode.id
          )}`
        );


      const data =
        await response.json();


      if (
        !response.ok ||
        data.error
      ) {

        throw new Error(
          data.error ||
          "Failed to generate explanation"
        );

      }


      setAiExplanation(
        data.explanation
      );

    } catch (err) {

      console.error(
        "Gemini explanation failed:",
        err
      );

      setAiExplanation(
        "AI explanation is currently unavailable. Please try again."
      );

    } finally {

      setExplaining(false);

    }

  }


  // ============================================================
  // SEARCH FILES / SYMBOLS
  // ============================================================

  const filteredFiles =
    useMemo(() => {

      const q =
        search
          .trim()
          .toLowerCase();

      if (!q) {
        return files;
      }


      return files.filter(
        (file) =>
          String(
            file.name || ""
          )
            .toLowerCase()
            .includes(q) ||

          String(
            file.file || ""
          )
            .toLowerCase()
            .includes(q) ||

          String(
            file.id || ""
          )
            .toLowerCase()
            .includes(q)
      );

    }, [
      files,
      search,
    ]);


  // Dim (not remove) non-matching nodes during a graph search, so edges
  // never dangle — the previous behavior filtered nodes out entirely.
  const searchQuery = useMemo(
    () => search.trim().toLowerCase(),
    [search]
  );

  const visibleNodes = useMemo(() => {
    if (!searchQuery || view !== "file") {
      return nodes;
    }

    return nodes.map((node) => {
      const matches = String(node.data?.label || "")
        .toLowerCase()
        .includes(searchQuery);

      return {
        ...node,
        className: matches ? "" : "is-dim",
      };
    });
  }, [nodes, searchQuery, view]);

  const visibleEdges = useMemo(() => {
    if (!searchQuery || view !== "file") {
      return edges;
    }

    const matchingIds = new Set(
      nodes
        .filter((node) =>
          String(node.data?.label || "")
            .toLowerCase()
            .includes(searchQuery)
        )
        .map((node) => node.id)
    );

    return edges.map((edge) => {
      const active =
        matchingIds.has(edge.source) || matchingIds.has(edge.target);

      return {
        ...edge,
        className: `${edge.className || ""} ${
          active ? "" : "ca-edge-dim"
        }`.trim(),
      };
    });
  }, [edges, nodes, searchQuery, view]);


  // ============================================================
  // NO REPOSITORY
  // ============================================================

  if (!repository) {

    return (

      <div className="ca-map">
        <div className="ca-empty ca-empty-fill">
          <div className="ca-empty-icon">
            <FolderTree />
          </div>

          <h2 className="ca-empty-title">No repository analyzed</h2>

          <p className="ca-empty-text">
            Analyze a repository from the Overview page first. The Code Map
            will then show that repository only.
          </p>
        </div>
      </div>

    );
  }


  // ============================================================
  // LOADING
  // ============================================================

  if (loading) {

    return (

      <div className="ca-map">
        <div className="ca-loading-line">
          <span className="ca-spinner" />
          Loading codebase...
        </div>
      </div>

    );

  }


  // ============================================================
  // ERROR
  // ============================================================

  if (
    error &&
    !files.length
  ) {

    return (

      <div className="ca-map">
        <div className="ca-empty ca-empty-fill">
          <div className="ca-empty-icon">
            <ShieldAlert style={{ color: "var(--ca-high-text)" }} />
          </div>

          <h2 className="ca-empty-title" style={{ color: "var(--ca-high-text)" }}>
            Backend connection failed
          </h2>

          <p className="ca-empty-text">{error}</p>
        </div>
      </div>

    );

  }


  // ============================================================
  // MAIN UI
  // ============================================================

  return (

    <div className="ca-map">

      {/* ======================================================
          HEADER
      ====================================================== */}

      <div className="ca-map-header">

        {view !== "files" && (
          <button
            onClick={goBack}
            className="ca-btn ca-btn-secondary ca-btn-icon"
            title="Go back"
          >
            <ArrowLeft size={16} />
          </button>
        )}

        <div className="ca-map-heading">
          <h1 className="ca-map-title">
            <Network />
            Code Map
          </h1>

          <p className="ca-map-stats">

            {view === "files"

              ? `${files.length.toLocaleString()} files · ${risks.length.toLocaleString()} functions analyzed`

              : view === "file"

              ? `Symbols inside ${currentFile?.name || "this file"}`

              : "Local relationships, risk, and source code"

            }

          </p>
        </div>

        <div className="ca-search ca-search-sm">
          <Search />
          <input
            value={search}
            onChange={(e) =>
              setSearch(e.target.value)
            }
            placeholder={
              view === "files"
                ? "Search files..."
                : "Search symbols..."
            }
          />
        </div>

      </div>


      {/* ======================================================
          BREADCRUMB
      ====================================================== */}

      <div className="ca-breadcrumb">

        <button
          onClick={() => {
            setSelectedNode(null);
            setCurrentFile(null);
            setView("files");
            setNodes([]);
            setEdges([]);
            setSearch("");
          }}
        >
          Repository
        </button>

        {currentFile && (
          <>
            <span className="ca-breadcrumb-sep">/</span>

            <button onClick={() => openFile(currentFile)}>
              {currentFile.file || currentFile.id}
            </button>
          </>
        )}

        {selectedNode && (
          <>
            <span className="ca-breadcrumb-sep">/</span>

            <span aria-current="page">
              {selectedNode.name || selectedNode.id}
            </span>
          </>
        )}

      </div>


      {/* ======================================================
          BODY
      ====================================================== */}

      <div className="ca-map-body">

        <div className="ca-map-canvas">

          {/* ====================================================
              REPOSITORY FILE VIEW
          ==================================================== */}

          {view === "files" && (

            <div className="ca-map-scroll">

              {filteredFiles.length === 0 ? (

                <div className="ca-empty ca-empty-fill">
                  <div className="ca-empty-icon">
                    <Code2 />
                  </div>
                  <p className="ca-empty-text">No files found.</p>
                </div>

              ) : (

                <>
                  <div style={{ marginBottom: 16 }}>
                    <p className="ca-muted" style={{ fontSize: 13, margin: 0 }}>
                      {filteredFiles.length.toLocaleString()} files
                    </p>
                    <p className="ca-faint" style={{ fontSize: 12, marginTop: 4 }}>
                      Click a file to inspect its functions and classes.
                    </p>
                  </div>

                  <div className="ca-file-grid">
                    {filteredFiles.map((file) => {
                      const filePath = file.file || file.id;
                      const flagged = secretFiles.has(filePath);

                      return (
                        <button
                          key={file.id}
                          onClick={() => openFile(file)}
                          className="ca-file-card"
                        >
                          <div className="ca-file-card-head">
                            <FolderTree />
                            <span className="ca-file-card-name">
                              {file.name || file.id}
                            </span>
                          </div>

                          <span className="ca-path" style={{ wordBreak: "break-all" }}>
                            {filePath}
                          </span>

                          <div className="ca-file-card-meta">
                            <span>{file.symbol_count ?? 0} symbols</span>

                            {flagged && (
                              <span className="ca-badge" data-tone="medium">
                                <KeyRound size={11} />
                                Secrets
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>

              )}

            </div>

          )}


          {/* ====================================================
              FILE / NODE GRAPH VIEW
          ==================================================== */}

          {view !== "files" && (

            <>

              {graphLoading ? (
                <div className="ca-map-overlay">
                  <div className="ca-loading-line">
                    <span className="ca-spinner" />
                    Loading graph...
                  </div>
                </div>
              ) : null}


              {visibleNodes.length === 0 ? (

                <div className="ca-empty ca-empty-fill">
                  <div className="ca-empty-icon">
                    <Code2 />
                  </div>
                  <p className="ca-empty-text">
                    No matching symbols in this view.
                  </p>
                </div>

              ) : (

                <>
                  <div className="ca-map-legend">
                    <div className="ca-legend">
                      <span className="ca-legend-item" data-kind="file">File</span>
                      <span className="ca-legend-item" data-kind="class">Class</span>
                      <span className="ca-legend-item" data-kind="function">Function</span>
                      <span className="ca-legend-item" data-level="high">High risk</span>
                      <span className="ca-legend-item" data-level="medium">Medium risk</span>
                    </div>
                  </div>

                  <ReactFlow
                    nodes={visibleNodes}
                    edges={visibleEdges}
                    nodeTypes={nodeTypes}
                    onNodeClick={onNodeClick}
                    fitView
                    fitViewOptions={{
                      padding: 0.2,
                    }}
                    proOptions={{
                      hideAttribution: true,
                    }}
                  >

                    <Background gap={22} size={1} />
                    <Controls />
                    <MiniMap pannable zoomable />

                  </ReactFlow>
                </>

              )}

            </>

          )}


          {/* ====================================================
              ERROR BANNER
          ==================================================== */}

          {error && files.length > 0 && (
            <div
              className="ca-alert"
              data-tone="error"
              style={{
                position: "absolute",
                bottom: 16,
                left: 16,
                zIndex: 20,
                maxWidth: 420,
              }}
            >
              <ShieldAlert size={15} />
              <div className="ca-alert-body">{error}</div>
            </div>
          )}

        </div>


        {/* ====================================================
            SELECTED NODE PANEL
        ==================================================== */}

        {selectedNode && (

          <div className="ca-inspector">

            <div className="ca-inspector-head">

              <div style={{ minWidth: 0 }}>
                <p className="ca-inspector-kind">
                  {selectedNode.type === "file" ? "Selected file" : "Selected symbol"}
                </p>

                <h3 className="ca-inspector-title ca-truncate">
                  {selectedNode.type === "function"
                    ? `${selectedNode.name}()`
                    : selectedNode.name || selectedNode.id}
                </h3>
              </div>

              <button
                onClick={() => {
                  setSelectedNode(null);
                  setAiExplanation(null);
                }}
                className="ca-btn ca-btn-ghost ca-btn-icon ca-btn-sm"
              >
                <X size={16} />
              </button>

            </div>

            <div className="ca-inspector-body">

              {/* ------------------------------------------------
                  FILE
              ------------------------------------------------- */}

              <div>
                <div className="ca-field-label">File</div>
                <p className="ca-path" style={{ wordBreak: "break-all" }}>
                  {selectedNode.file || selectedNode.id}
                </p>
              </div>

              {secretFiles.has(selectedNode.file) && (
                <div className="ca-alert" data-tone="warn">
                  <KeyRound size={15} />
                  <div className="ca-alert-body">
                    This file has possible secrets detected. See Security for
                    details.
                  </div>
                </div>
              )}


              {/* ------------------------------------------------
                  FILE DETAILS
              ------------------------------------------------- */}

              {selectedNode.type === "file" && (
                <>
                  <div className="ca-kv-grid">
                    <div className="ca-kv">
                      <div className="ca-kv-label">File Type</div>
                      <div className="ca-kv-value" style={{ fontSize: 14 }}>Python file</div>
                    </div>
                  </div>

                  <div>
                    <div className="ca-field-label">Path</div>
                    <p className="ca-path" style={{ wordBreak: "break-all" }}>
                      {selectedNode.id}
                    </p>
                  </div>

                  <div>
                    <div className="ca-field-label">Codebase Statistics</div>

                    {(() => {
                      const stats = getFileStats(selectedNode);

                      return (
                        <div className="ca-kv-grid">
                          <div className="ca-kv">
                            <div className="ca-kv-label">Symbols</div>
                            <div className="ca-kv-value">
                              {stats.symbols || currentFile?.symbol_count || 0}
                            </div>
                          </div>

                          <div className="ca-kv">
                            <div className="ca-kv-label">Functions</div>
                            <div className="ca-kv-value">{stats.functions}</div>
                          </div>

                          <div className="ca-kv">
                            <div className="ca-kv-label">Classes</div>
                            <div className="ca-kv-value">{stats.classes}</div>
                          </div>

                          <div className="ca-kv">
                            <div className="ca-kv-label">Imports</div>
                            <div className="ca-kv-value">
                              {stats.imports || selectedNode.dependencies?.length || 0}
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  <div>
                    <div className="ca-field-label">Relationships</div>

                    {(() => {
                      const stats = getFileStats(selectedNode);

                      return (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                            <span className="ca-muted">Contains</span>
                            <span>{stats.contains || stats.symbols}</span>
                          </div>

                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                            <span className="ca-muted">Imports</span>
                            <span>{stats.imports || selectedNode.dependencies?.length || 0}</span>
                          </div>

                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                            <span className="ca-muted">Calls</span>
                            <span>{stats.calls}</span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  <div>
                    <div className="ca-field-label">Symbols in this file</div>

                    {selectedNode.local_graph?.nodes?.filter(
                      (node) => node.type === "function" || node.type === "class"
                    ).length > 0 ? (
                      <ul className="ca-ref-list">
                        {selectedNode.local_graph.nodes
                          .filter((node) => node.type === "function" || node.type === "class")
                          .map((symbol) => (
                            <li key={symbol.id} className="ca-ref" data-dir="dep">
                              {symbol.type === "function" ? `${symbol.name}()` : symbol.name}
                            </li>
                          ))}
                      </ul>
                    ) : (
                      <p className="ca-faint" style={{ fontSize: 13 }}>
                        No functions or classes detected.
                      </p>
                    )}
                  </div>
                </>
              )}


              {/* ------------------------------------------------
                  FUNCTION DETAILS
              ------------------------------------------------- */}

              {selectedNode.type === "function" && (
                <>

                  <div>
                    <div className="ca-field-label">Lines</div>
                    <p className="ca-prose" style={{ fontSize: 13 }}>
                      {selectedNode.line} - {selectedNode.end_line}
                    </p>
                  </div>


                  {/* RISK */}

                  <div
                    className="ca-signal"
                    data-level={selectedNode.risk?.risk_level?.toLowerCase()}
                  >

                    <div className="ca-signal-head">
                      <span>
                        <ShieldAlert
                          size={15}
                          style={{ color: getRiskColor(selectedNode.risk?.risk_level) }}
                        />
                        ML Risk Analysis
                      </span>

                      {selectedNode.risk && (
                        <RiskBadge level={selectedNode.risk.risk_level} />
                      )}
                    </div>

                    {riskLoading ? (
                      <div className="ca-loading-line" style={{ padding: 16 }}>
                        <span className="ca-spinner" />
                        Loading risk prediction...
                      </div>
                    ) : selectedNode.risk ? (
                      <div className="ca-signal-body">

                        {/*
                          Risk Index only — risk probability is
                          intentionally not shown in the primary UI,
                          preserved from the original implementation.
                        */}

                        <div className="ca-kv">
                          <div className="ca-kv-label">Risk Index</div>
                          <div className="ca-kv-value">
                            {Number(selectedNode.risk.risk_score || 0).toFixed(0)}
                            <span className="ca-faint" style={{ fontSize: 12, marginLeft: 4 }}>
                              / 100
                            </span>
                          </div>
                        </div>

                        {selectedNode.risk.reasons?.length > 0 && (
                          <div>
                            <div className="ca-field-label">Model Signals</div>

                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                              {selectedNode.risk.reasons.slice(0, 4).map((reason, index) => (
                                <div key={index} className="ca-signal-chip">
                                  {reason}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <button
                          onClick={explainWithAI}
                          disabled={explaining}
                          className="ca-btn ca-btn-ai ca-btn-block"
                        >
                          {explaining ? (
                            <>
                              <Loader2 size={15} className="animate-spin" />
                              Gemini is analyzing...
                            </>
                          ) : (
                            <>
                              <Sparkles size={15} />
                              Explain Risk with AI
                            </>
                          )}
                        </button>

                        {aiExplanation && (
                          <div className="ca-ai-block">
                            <div className="ca-ai-block-head">
                              <Sparkles size={13} />
                              Gemini Risk Explanation
                            </div>
                            {aiExplanation}
                          </div>
                        )}

                      </div>
                    ) : (
                      <div style={{ padding: 16 }}>
                        <p className="ca-faint" style={{ fontSize: 12.5 }}>
                          No ML risk prediction is available for this node.
                        </p>
                      </div>
                    )}

                  </div>


                  {/* CALLERS */}

                  <div>
                    <div className="ca-field-label">Callers</div>

                    {selectedNode.callers?.length > 0 ? (
                      <ul className="ca-ref-list">
                        {selectedNode.callers.map((caller) => (
                          <li key={caller} className="ca-ref" data-dir="in">
                            {caller}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="ca-faint" style={{ fontSize: 13 }}>No local callers</p>
                    )}
                  </div>


                  {/* CALLEES */}

                  <div>
                    <div className="ca-field-label">Callees</div>

                    {selectedNode.callees?.length > 0 ? (
                      <ul className="ca-ref-list">
                        {selectedNode.callees.map((callee) => (
                          <li key={callee} className="ca-ref" data-dir="out">
                            {callee}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="ca-faint" style={{ fontSize: 13 }}>No local callees</p>
                    )}
                  </div>


                  {/* DEPENDENCIES */}

                  <div>
                    <div className="ca-field-label">Dependencies</div>

                    {selectedNode.dependencies?.length > 0 ? (
                      <ul className="ca-ref-list">
                        {selectedNode.dependencies.map((dependency) => (
                          <li key={dependency} className="ca-ref" data-dir="dep">
                            {dependency}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="ca-faint" style={{ fontSize: 13 }}>No dependencies</p>
                    )}
                  </div>


                  {/* SOURCE CODE */}

                  <div>
                    <div className="ca-field-label">Source Code</div>
                    <pre className="ca-code">
                      {selectedNode.code || "No source available"}
                    </pre>
                  </div>

                </>
              )}


              {/* ------------------------------------------------
                  CLASS DETAILS
              ------------------------------------------------- */}

              {selectedNode.type === "class" && (
                <div>
                  <div className="ca-field-label">Symbol Type</div>
                  <p className="ca-prose" style={{ fontSize: 13 }}>Python class</p>
                </div>
              )}

            </div>

          </div>

        )}

      </div>

    </div>

  );
}
