import { useMemo, useState } from "react";

import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
} from "@xyflow/react";

import "@xyflow/react/dist/style.css";

import {
  GitCompare,
  Upload,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  X,
  Network,
  FileCode2,
  Info,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

import {
  nodeTypes,
  buildFocusedGraph,
} from "./graphUtils.jsx";


// ============================================================
// STATUS -> EXISTING BADGE TONE
//
// Reuses the .ca-badge[data-tone] palette that already exists for
// risk/security (low/medium/high/info) rather than inventing new
// colors for change status.
// ============================================================

function statusTone(status) {
  if (status === "added") return "low";
  if (status === "deleted") return "high";
  if (status === "renamed") return "medium";
  return "info"; // modified
}

function statusLabel(status) {
  if (!status) return "Unknown";
  return status.charAt(0).toUpperCase() + status.slice(1);
}


export default function ChangeImpact({ repository }) {

  const [diffText, setDiffText] =
    useState("");

  const [depth, setDepth] =
    useState(2);

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState(null);

  const [result, setResult] =
    useState(null);

  const [showGraph, setShowGraph] =
    useState(false);

  const [warningsExpanded, setWarningsExpanded] =
    useState(false);


  // ============================================================
  // SUBMIT DIFF
  // ============================================================

  async function analyzeChanges() {

    if (!diffText.trim()) {
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setShowGraph(false);

    try {

      const response = await fetch("/api/impact/changes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          diff: diffText,
          depth,
        }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        throw new Error(
          data.error || "Failed to analyze changes"
        );
      }

      setResult(data);

    } catch (err) {

      console.error("Change impact analysis failed:", err);

      setError(
        err.message || "Failed to analyze changes"
      );

    } finally {

      setLoading(false);

    }

  }


  // ============================================================
  // UPLOAD A .diff / .patch FILE
  // ============================================================

  function handleFileUpload(file) {

    if (!file) return;

    const reader = new FileReader();

    reader.onload = (event) => {
      setDiffText(
        typeof event.target.result === "string"
          ? event.target.result
          : ""
      );
    };

    reader.readAsText(file);

  }


  function clearDiff() {
    setDiffText("");
    setResult(null);
    setError(null);
    setShowGraph(false);
  }


  // ============================================================
  // GRAPH DATA  (built once per result, reusing the shared utility)
  // ============================================================

  const graphElements = useMemo(() => {

    if (!result?.graph) {
      return { nodes: [], edges: [] };
    }

    return buildFocusedGraph(result.graph);

  }, [result]);


  // ============================================================
  // NO BASELINE ANALYZED YET
  // ============================================================

  if (!repository) {

    return (
      <div className="ca-page">
        <div className="ca-empty ca-empty-fill">
          <div className="ca-empty-icon">
            <GitCompare />
          </div>

          <h2 className="ca-empty-title">No baseline repository analyzed</h2>

          <p className="ca-empty-text">
            Change Impact Analysis compares a diff against an already
            analyzed repository. Analyze a repository from Overview
            first — it becomes the baseline this diff is compared
            against.
          </p>
        </div>
      </div>
    );
  }


  // ============================================================
  // MAIN UI
  // ============================================================

  const impactLevel = result?.impact_summary?.impact_level;
  const hasMatchedFiles = result?.files?.some((f) => f.matched_baseline);

  return (
    <div className="ca-page">

      <div className="ca-page-header">
        <div>
          <h1 className="ca-page-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <GitCompare size={19} style={{ color: "var(--ca-cyan)" }} />
            Change Impact
          </h1>

          <p className="ca-page-sub">
            Submit a unified git diff to see what it affects in{" "}
            <strong>{repository}</strong>, the currently analyzed
            baseline — without needing to re-upload a repository.
          </p>
        </div>
      </div>

      {/* =====================================================
          DIFF INPUT
      ===================================================== */}

      <div className="ca-card">
        <div className="ca-card-header">
          <div>
            <h3 className="ca-card-title">Paste or upload a diff</h3>
            <p className="ca-card-sub">
              A unified git diff (<code className="ca-mono">git diff</code> or{" "}
              <code className="ca-mono">git format-patch</code> output).
            </p>
          </div>

          <label className="ca-btn ca-btn-secondary ca-btn-sm" style={{ cursor: "pointer" }}>
            <input
              type="file"
              accept=".diff,.patch,.txt"
              className="hidden"
              onChange={(e) => {
                handleFileUpload(e.target.files[0]);
                e.target.value = "";
              }}
            />
            <Upload size={14} />
            Upload file
          </label>
        </div>

        <div className="ca-card-pad">

          <textarea
            value={diffText}
            onChange={(e) => setDiffText(e.target.value)}
            placeholder={
              "diff --git a/app/auth.py b/app/auth.py\n" +
              "--- a/app/auth.py\n" +
              "+++ b/app/auth.py\n" +
              "@@ -12,3 +12,4 @@\n" +
              " def login():\n" +
              "-    pass\n" +
              "+    pass  # updated"
            }
            spellCheck={false}
            className="ca-textarea ca-mono"
            style={{ minHeight: 220, resize: "vertical", lineHeight: 1.6 }}
          />

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 12,
              marginTop: 14,
            }}
          >

            <div className="ca-impact-toolbar" style={{ gap: 10 }}>
              <span className="ca-field-label" style={{ marginBottom: 0 }}>
                Depth
              </span>

              <div className="ca-segmented" role="group" aria-label="Impact depth">
                {[1, 2, 3].map((depthOption) => (
                  <button
                    key={depthOption}
                    aria-pressed={depth === depthOption}
                    onClick={() => setDepth(depthOption)}
                  >
                    {depthOption}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              {(diffText || result) && (
                <button onClick={clearDiff} className="ca-btn ca-btn-ghost ca-btn-sm">
                  <X size={14} />
                  Clear
                </button>
              )}

              <button
                onClick={analyzeChanges}
                disabled={!diffText.trim() || loading}
                className="ca-btn ca-btn-primary"
              >
                {loading ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <GitCompare size={15} />
                    Analyze Changes
                  </>
                )}
              </button>
            </div>

          </div>

        </div>
      </div>

      {/* =====================================================
          LOADING
      ===================================================== */}

      {loading && (
        <div className="ca-loading-line" style={{ padding: 32 }}>
          <span className="ca-spinner" />
          Mapping changes onto the dependency graph...
        </div>
      )}

      {/* =====================================================
          ERROR
      ===================================================== */}

      {error && !loading && (
        <div className="ca-alert" data-tone="error" style={{ marginTop: 16 }}>
          <AlertTriangle size={16} />
          <div className="ca-alert-body">{error}</div>
        </div>
      )}

      {/* =====================================================
          RESULTS
      ===================================================== */}

      {result && !loading && (
        <div className="ca-stack ca-section-gap">

          {!hasMatchedFiles ? (

            <div className="ca-card">
              <div className="ca-empty">
                <div className="ca-empty-icon">
                  <AlertTriangle />
                </div>
                <h2 className="ca-empty-title">No changes could be matched</h2>
                <p className="ca-empty-text">
                  None of the files in this diff were found in the
                  analyzed baseline. Check the warnings below — this
                  diff may target a different repository, or every
                  changed file may be new.
                </p>
              </div>
            </div>

          ) : (

            <>
              {/* SUMMARY */}

              <div className="ca-stat-grid">

                <div className="ca-stat" data-tone="info">
                  <div className="ca-stat-label">Changed Functions</div>
                  <div className="ca-stat-value ca-tabular">
                    {result.changed?.length || 0}
                  </div>
                </div>

                <div
                  className="ca-stat"
                  data-tone={
                    result.impact_summary.direct_count > 0 ? "high" : "info"
                  }
                >
                  <div className="ca-stat-label">Direct Impact</div>
                  <div className="ca-stat-value ca-tabular">
                    {result.impact_summary.direct_count}
                  </div>
                </div>

                <div
                  className="ca-stat"
                  data-tone={
                    result.impact_summary.indirect_count > 0 ? "medium" : "info"
                  }
                >
                  <div className="ca-stat-label">Indirect Impact</div>
                  <div className="ca-stat-value ca-tabular">
                    {result.impact_summary.indirect_count}
                  </div>
                </div>

                <div className="ca-stat">
                  <div className="ca-stat-label">Affected Files</div>
                  <div className="ca-stat-value ca-tabular">
                    {result.impact_summary.affected_file_count}
                  </div>
                </div>

                <div
                  className="ca-stat"
                  data-tone={
                    impactLevel === "High"
                      ? "high"
                      : impactLevel === "Medium"
                      ? "medium"
                      : "low"
                  }
                >
                  <div className="ca-stat-label">
                    <span>Impact Level</span>
                    <ShieldAlert size={14} />
                  </div>
                  <div className="ca-stat-value" style={{ fontSize: 20 }}>
                    {impactLevel}
                  </div>
                </div>

              </div>

              <div className="ca-chip-row">
                {result.impact_summary.reasons.map((reason, index) => (
                  <span key={index} className="ca-signal-chip">
                    {reason}
                  </span>
                ))}
              </div>

              <div className="ca-signal-note">
                <Info />
                <span>
                  Impact level is calculated from graph evidence
                  (dependents, affected files, risk of affected
                  functions) — it is a rule-based estimate, not an ML
                  prediction. Risk badges below come from CodeAtlas's
                  existing calibrated risk model.
                </span>
              </div>

              {/* WARNINGS */}

              {result.warnings?.length > 0 && (
                <div className="ca-card">
                  <button
                    onClick={() => setWarningsExpanded((v) => !v)}
                    className="ca-card-header"
                    style={{
                      width: "100%",
                      border: 0,
                      background: "transparent",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <AlertTriangle size={15} style={{ color: "var(--ca-medium-text)" }} />
                      <h3 className="ca-card-title">
                        {result.warnings.length} note
                        {result.warnings.length !== 1 ? "s" : ""} on this diff
                      </h3>
                    </div>
                    {warningsExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>

                  {warningsExpanded && (
                    <div className="ca-card-pad" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {result.warnings.map((warning, index) => (
                        <p key={index} className="ca-muted" style={{ fontSize: 13, margin: 0 }}>
                          {warning}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* CHANGED FILES */}

              <div className="ca-card">
                <div className="ca-card-header">
                  <h3 className="ca-card-title">Changed Files</h3>
                  <span className="ca-faint" style={{ fontSize: 12 }}>
                    {result.files.length} file{result.files.length !== 1 ? "s" : ""}
                  </span>
                </div>

                <div className="ca-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {result.files.map((file, index) => (
                    <div key={`${file.path}-${index}`} className="ca-impact-row" style={{ alignItems: "flex-start", flexDirection: "column", gap: 6, padding: "10px 12px" }}>

                      <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
                        <FileCode2 size={14} style={{ color: "var(--ca-cyan)", flexShrink: 0 }} />
                        <span className="ca-impact-row-name" style={{ fontWeight: 600 }}>
                          {file.path}
                        </span>
                        <span className="ca-badge" data-tone={statusTone(file.status)}>
                          {statusLabel(file.status)}
                        </span>
                        {!file.matched_baseline && (
                          <span className="ca-badge" data-tone="muted">
                            Not in baseline
                          </span>
                        )}
                      </div>

                      {file.changed_functions?.length > 0 && (
                        <p className="ca-faint" style={{ fontSize: 12, margin: 0, paddingLeft: 22 }}>
                          {file.changed_functions.length} function
                          {file.changed_functions.length !== 1 ? "s" : ""} changed
                        </p>
                      )}

                      {file.unmapped_ranges?.length > 0 && (
                        <p className="ca-faint" style={{ fontSize: 12, margin: 0, paddingLeft: 22 }}>
                          {file.unmapped_ranges.length} changed line range
                          {file.unmapped_ranges.length !== 1 ? "s" : ""} outside any function
                          {" "}({file.unmapped_ranges.map((r) => (
                            r.start === r.end ? `L${r.start}` : `L${r.start}-${r.end}`
                          )).join(", ")})
                        </p>
                      )}

                    </div>
                  ))}
                </div>
              </div>

              {/* CHANGED FUNCTIONS */}

              {result.changed?.length > 0 && (
                <div className="ca-card ca-card-pad">
                  <div className="ca-field-label">
                    Changed Functions ({result.changed.length})
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {result.changed.map((item) => (
                      <div key={item.id} className="ca-impact-row">
                        <span className="ca-impact-row-name">
                          {item.type === "function" ? `${item.name}()` : item.name}
                        </span>
                        <span className="ca-faint" style={{ fontSize: 11 }}>
                          {item.file}
                        </span>
                        <span className="ca-badge" data-tone={statusTone(item.change_status)}>
                          {statusLabel(item.change_status)}
                        </span>
                        {item.risk_level && (
                          <span className="ca-badge" data-tone={item.risk_level.toLowerCase()}>
                            {item.risk_level}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* DIRECT / INDIRECT IMPACT */}

              <div className="ca-card ca-card-pad">
                <div className="ca-field-label">
                  Direct Impact ({result.impact_summary.direct_count})
                </div>

                {result.direct.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 16 }}>
                    {result.direct.map((item) => (
                      <div key={item.id} className="ca-impact-row">
                        <span className="ca-impact-row-name">
                          {item.type === "function" ? `${item.name}()` : item.name}
                        </span>
                        <span className="ca-faint" style={{ fontSize: 11 }}>
                          caused by {item.caused_by?.length || 0} change
                          {item.caused_by?.length !== 1 ? "s" : ""}
                        </span>
                        {item.risk_level && (
                          <span className="ca-badge" data-tone={item.risk_level.toLowerCase()}>
                            {item.risk_level}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="ca-impact-empty" style={{ marginBottom: 16 }}>
                    No direct dependents
                  </div>
                )}

                <div className="ca-field-label">
                  Indirect Impact ({result.impact_summary.indirect_count})
                </div>

                {result.indirect.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {result.indirect.map((item) => (
                      <div key={item.id} className="ca-impact-row">
                        <span className="ca-impact-row-name">
                          {item.type === "function" ? `${item.name}()` : item.name}
                        </span>
                        <span className="ca-impact-distance">hop {item.distance}</span>
                        {item.risk_level && (
                          <span className="ca-badge" data-tone={item.risk_level.toLowerCase()}>
                            {item.risk_level}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="ca-impact-empty">
                    No indirect dependents within depth {depth}
                  </div>
                )}
              </div>

              {/* AFFECTED FILES */}

              {result.affected_files.length > 0 && (
                <div className="ca-card ca-card-pad">
                  <div className="ca-field-label">
                    Affected Files ({result.affected_files.length})
                  </div>
                  <div className="ca-impact-files">
                    {result.affected_files.map((filePath) => (
                      <span key={filePath} className="ca-path" style={{ wordBreak: "break-all" }}>
                        {filePath}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* GRAPH TOGGLE */}

              {graphElements.nodes.length > 0 && (
                <div className="ca-card">
                  <button
                    onClick={() => setShowGraph((v) => !v)}
                    className="ca-card-header"
                    style={{ width: "100%", border: 0, background: "transparent", cursor: "pointer", textAlign: "left" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Network size={15} style={{ color: "var(--ca-cyan)" }} />
                      <h3 className="ca-card-title">Impact Graph</h3>
                    </div>
                    {showGraph ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>

                  {showGraph && (
                    <div style={{ position: "relative", height: 440, borderTop: "1px solid var(--ca-border)" }}>

                      <div className="ca-map-legend">
                        <div className="ca-legend">
                          <span className="ca-legend-item" data-kind="file" style={{ color: "var(--ca-cyan)" }}>
                            Changed
                          </span>
                          <span className="ca-legend-item" data-kind="class">Direct</span>
                          <span className="ca-legend-item" data-kind="function">Indirect</span>
                        </div>
                      </div>

                      <ReactFlow
                        nodes={graphElements.nodes}
                        edges={graphElements.edges}
                        nodeTypes={nodeTypes}
                        fitView
                        fitViewOptions={{ padding: 0.2 }}
                        proOptions={{ hideAttribution: true }}
                      >
                        <Background gap={22} size={1} />
                        <Controls />
                        <MiniMap pannable zoomable />
                      </ReactFlow>

                    </div>
                  )}
                </div>
              )}

              <div className="ca-footnote">
                <span>
                  <CheckCircle2 size={12} />
                  Computed against the currently analyzed baseline —
                  nothing in this diff was executed.
                </span>
              </div>

            </>
          )}

        </div>
      )}

    </div>
  );
}
