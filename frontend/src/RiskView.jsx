import { useEffect, useMemo, useState } from "react";
import {
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  Loader2,
  ChevronDown,
  ChevronUp,
  Search,
  BrainCircuit,
  Activity,
} from "lucide-react";

export default function RiskView() {
  const [risks, setRisks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState("All");

  // Gemini explanation state
  const [explanations, setExplanations] = useState({});
  const [explaining, setExplaining] = useState(null);
  const [expanded, setExpanded] = useState(null);

  // ---------------------------------------------------------
  // Load ML risk predictions
  // ---------------------------------------------------------

  useEffect(() => {
    async function loadRisks() {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch("/api/risk");

        if (!response.ok) {
          throw new Error(
            `Risk API returned ${response.status}`
          );
        }

        const data = await response.json();

        if (!Array.isArray(data)) {
          throw new Error(
            data?.error || "Invalid risk response"
          );
        }

        setRisks(data);
      } catch (err) {
        console.error("Failed to load risks:", err);
        setError(
          err.message ||
            "Unable to load ML risk analysis."
        );
      } finally {
        setLoading(false);
      }
    }

    loadRisks();
  }, []);

  // ---------------------------------------------------------
  // Gemini explanation
  // ---------------------------------------------------------

  async function explainWithAI(nodeId) {
    setExplaining(nodeId);
    setExpanded(nodeId);

    try {
      const response = await fetch(
        `/api/risk/explain/${encodeURIComponent(nodeId)}`
      );

      const data = await response.json();

      if (!response.ok || data.error) {
        throw new Error(
          data.error ||
            "Failed to generate explanation"
        );
      }

      setExplanations((prev) => ({
        ...prev,
        [nodeId]: data.explanation,
      }));
    } catch (err) {
      console.error(
        "Gemini explanation failed:",
        err
      );

      setExplanations((prev) => ({
        ...prev,
        [nodeId]:
          "AI explanation is currently unavailable. Please try again.",
      }));
    } finally {
      setExplaining(null);
    }
  }

  // ---------------------------------------------------------
  // Risk counts
  // ---------------------------------------------------------

  const high = risks.filter(
    (r) => r.risk_level === "High"
  ).length;

  const medium = risks.filter(
    (r) => r.risk_level === "Medium"
  ).length;

  const low = risks.filter(
    (r) => r.risk_level === "Low"
  ).length;

  // ---------------------------------------------------------
  // Overall statistics
  // ---------------------------------------------------------

  const averageRisk = useMemo(() => {
    if (!risks.length) return 0;

    const total = risks.reduce(
      (sum, risk) =>
        sum + Number(risk.risk_probability || 0),
      0
    );

    return total / risks.length;
  }, [risks]);

  const maxRisk = useMemo(() => {
    if (!risks.length) return 0;

    return Math.max(
      ...risks.map((risk) =>
        Number(risk.risk_probability || 0)
      )
    );
  }, [risks]);

  // ---------------------------------------------------------
  // Search + filtering + sorting
  // ---------------------------------------------------------

  const filteredRisks = useMemo(() => {
    const query = search.trim().toLowerCase();

    const filtered = risks.filter((risk) => {
      const matchesSearch =
        !query ||
        String(risk.function || "")
          .toLowerCase()
          .includes(query) ||
        String(risk.file || "")
          .toLowerCase()
          .includes(query) ||
        String(risk.id || "")
          .toLowerCase()
          .includes(query);

      const matchesFilter =
        riskFilter === "All" ||
        risk.risk_level === riskFilter;

      return matchesSearch && matchesFilter;
    });

    const order = {
      High: 3,
      Medium: 2,
      Low: 1,
    };

    return [...filtered].sort((a, b) => {
      const levelDifference =
        (order[b.risk_level] || 0) -
        (order[a.risk_level] || 0);

      if (levelDifference !== 0) {
        return levelDifference;
      }

      return (
        Number(b.risk_probability || 0) -
        Number(a.risk_probability || 0)
      );
    });
  }, [risks, search, riskFilter]);

  // ---------------------------------------------------------
  // Loading
  // ---------------------------------------------------------

  if (loading) {
    return (
      <div className="ca-page">
        <div className="ca-loading-line" style={{ minHeight: 400, flexDirection: "column" }}>
          <div
            className="ca-empty-icon"
            style={{ borderColor: "var(--ca-violet-border)", background: "var(--ca-violet-bg)" }}
          >
            <Loader2 size={22} className="animate-spin" style={{ color: "var(--ca-violet-text)" }} />
          </div>

          <div style={{ textAlign: "center" }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: "var(--ca-text)", margin: 0 }}>
              Running ML risk analysis
            </p>
            <p className="ca-faint" style={{ fontSize: 12, marginTop: 4 }}>
              Analyzing structural and graph features...
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------
  // Error
  // ---------------------------------------------------------

  if (error) {
    return (
      <div className="ca-page">
        <div className="ca-card" style={{ borderColor: "var(--ca-high-border)", background: "var(--ca-high-bg-soft)" }}>
          <div className="ca-empty">
            <div className="ca-empty-icon" style={{ borderColor: "var(--ca-high-border)" }}>
              <ShieldAlert style={{ color: "var(--ca-high-text)" }} />
            </div>

            <h2 className="ca-empty-title">Risk analysis unavailable</h2>
            <p className="ca-empty-text">{error}</p>
            <p className="ca-faint" style={{ fontSize: 12 }}>
              Make sure the CodeAtlas backend is running.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------
  // UI
  // ---------------------------------------------------------

  return (
    <div className="ca-page">

      {/* =====================================================
          HEADER
      ===================================================== */}

      <div className="ca-page-header">
        <div>
          <h1 className="ca-page-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <ShieldAlert size={19} style={{ color: "var(--ca-cyan)" }} />
            Risk View
          </h1>

          <p className="ca-page-sub">
            Machine-learning risk predictions for functions based on
            structural and graph-level code features.
          </p>

          <div className="ca-model-strip">
            <span className="ca-badge" data-tone="ai">
              <BrainCircuit size={13} />
              Logistic Regression
            </span>

            <span className="ca-badge" data-tone="info">
              <Activity size={13} />
              Isotonic Calibration
            </span>

            <span className="ca-faint" style={{ fontSize: 12 }}>
              {risks.length} functions analyzed
            </span>
          </div>
        </div>
      </div>

      {/* =====================================================
          SUMMARY CARDS
      ===================================================== */}

      <div className="ca-stat-grid">

        <div className="ca-stat" data-tone="high">
          <div className="ca-stat-label">
            <span>High Risk</span>
            <AlertTriangle size={14} />
          </div>
          <div className="ca-stat-value ca-tabular">{high}</div>
          <div className="ca-stat-hint">
            {risks.length ? `${((high / risks.length) * 100).toFixed(1)}% of functions` : "0%"}
          </div>
        </div>

        <div className="ca-stat" data-tone="medium">
          <div className="ca-stat-label">
            <span>Medium Risk</span>
            <AlertTriangle size={14} />
          </div>
          <div className="ca-stat-value ca-tabular">{medium}</div>
          <div className="ca-stat-hint">
            {risks.length ? `${((medium / risks.length) * 100).toFixed(1)}% of functions` : "0%"}
          </div>
        </div>

        <div className="ca-stat" data-tone="low">
          <div className="ca-stat-label">
            <span>Low Risk</span>
            <CheckCircle2 size={14} />
          </div>
          <div className="ca-stat-value ca-tabular">{low}</div>
          <div className="ca-stat-hint">
            {risks.length ? `${((low / risks.length) * 100).toFixed(1)}% of functions` : "0%"}
          </div>
        </div>

        <div className="ca-stat">
          <div className="ca-stat-label">Functions Analyzed</div>
          <div className="ca-stat-value ca-tabular">{risks.length}</div>
          <div className="ca-stat-hint">Static analysis coverage</div>
        </div>

        <div className="ca-stat">
          <div className="ca-stat-label">Average Risk</div>
          <div className="ca-stat-value ca-tabular">{(averageRisk * 100).toFixed(2)}%</div>
          <div className="ca-stat-hint">Mean calibrated probability</div>
        </div>

        <div className="ca-stat">
          <div className="ca-stat-label">Highest Risk</div>
          <div className="ca-stat-value ca-tabular">{(maxRisk * 100).toFixed(2)}%</div>
          <div className="ca-stat-hint">Maximum predicted probability</div>
        </div>

      </div>

      {/* =====================================================
          FILTER BAR
      ===================================================== */}

      <div className="ca-risk-toolbar">

        <div className="ca-search ca-search-wide">
          <Search />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search function, file or symbol..."
          />
        </div>

        <div className="ca-chip-row">
          {[
            { key: "All", count: risks.length },
            { key: "High", count: high },
            { key: "Medium", count: medium },
            { key: "Low", count: low },
          ].map(({ key, count }) => (
            <button
              key={key}
              onClick={() => setRiskFilter(key)}
              className="ca-chip"
              data-tone={key === "All" ? undefined : key.toLowerCase()}
              aria-pressed={riskFilter === key}
            >
              {key}
              <span className="ca-chip-count">{count}</span>
            </button>
          ))}
        </div>

      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <p className="ca-faint" style={{ fontSize: 12, margin: 0 }}>
          Showing <span className="ca-muted">{filteredRisks.length}</span> of{" "}
          <span className="ca-muted">{risks.length}</span> functions
        </p>

        <p className="ca-faint" style={{ fontSize: 12, margin: 0 }}>
          Sorted by risk severity
        </p>
      </div>

      {/* =====================================================
          FUNCTION TABLE
      ===================================================== */}

      <div className="ca-table-wrap">

        <div className="ca-risk-head">
          <div>Function</div>
          <div>File</div>
          <div>Risk</div>
          <div>ML Signals</div>
          <div>Probability</div>
          <div>AI</div>
        </div>

        {filteredRisks.map((risk) => {

          const nodeId = risk.id;
          const isExplaining = explaining === nodeId;
          const isExpanded = expanded === nodeId;
          const explanation = explanations[nodeId];

          const probability = Number(risk.risk_probability || 0);
          const riskIndex = Number(
            risk.risk_index ?? risk.risk_score ?? probability * 100
          );

          const levelKey = String(risk.risk_level || "Low").toLowerCase();

          return (
            <div key={nodeId}>

              {/* MAIN ROW */}

              <div className="ca-risk-row" data-level={levelKey}>

                <div className="ca-col-wide" style={{ minWidth: 0 }}>
                  <p className="ca-risk-fn ca-truncate">
                    {risk.function || "Module"}
                  </p>
                  <p className="ca-risk-id ca-mono">{nodeId}</p>
                </div>

                <div className="ca-truncate" title={risk.file} style={{ fontSize: 13, color: "var(--ca-text-2)" }}>
                  {risk.file}
                </div>

                <div>
                  <span className="ca-badge ca-badge-dot" data-tone={levelKey}>
                    {risk.risk_level}
                  </span>
                </div>

                <div className="ca-col-wide ca-signal-list">
                  {risk.reasons && risk.reasons.length > 0 ? (
                    risk.reasons.slice(0, 2).map((reason, index) => (
                      <span key={index} title={reason}>{reason}</span>
                    ))
                  ) : (
                    <span className="ca-faint">No strong signals</span>
                  )}
                </div>

                <div className="ca-prob">
                  <span className="ca-prob-value">{(probability * 100).toFixed(1)}%</span>

                  <div className="ca-prob-track">
                    <div
                      className="ca-prob-fill"
                      style={{ width: `${Math.min(probability * 100, 100)}%` }}
                    />
                  </div>

                  <p className="ca-prob-index">Index {riskIndex.toFixed(1)}/100</p>
                </div>

                <div>
                  <button
                    onClick={() =>
                      explanation
                        ? setExpanded(isExpanded ? null : nodeId)
                        : explainWithAI(nodeId)
                    }
                    disabled={isExplaining}
                    className="ca-btn ca-btn-ai ca-btn-sm"
                  >
                    {isExplaining ? (
                      <>
                        <Loader2 size={13} className="animate-spin" />
                        Thinking...
                      </>
                    ) : explanation ? (
                      <>
                        {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        AI Explanation
                      </>
                    ) : (
                      <>
                        <Sparkles size={13} />
                        Explain
                      </>
                    )}
                  </button>
                </div>

              </div>

              {/* GEMINI EXPLANATION */}

              {isExpanded && explanation && (
                <div className="ca-risk-explain">
                  <div className="ca-ai-block">
                    <div className="ca-ai-block-head" style={{ justifyContent: "space-between" }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <Sparkles size={14} />
                        Gemini Analysis
                      </span>

                      <span className="ca-faint" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                        Explanation only
                      </span>
                    </div>

                    {explanation}
                  </div>
                </div>
              )}

            </div>
          );
        })}

        {/* EMPTY SEARCH STATE */}

        {filteredRisks.length === 0 && risks.length > 0 && (
          <div className="ca-empty">
            <div className="ca-empty-icon">
              <Search />
            </div>

            <p className="ca-empty-text">No functions match your search.</p>

            <button
              onClick={() => {
                setSearch("");
                setRiskFilter("All");
              }}
              className="ca-btn ca-btn-ghost ca-btn-sm"
            >
              Clear filters
            </button>
          </div>
        )}

        {/* EMPTY STATE */}

        {risks.length === 0 && (
          <div className="ca-empty">
            <div className="ca-empty-icon">
              <ShieldAlert />
            </div>

            <p className="ca-empty-text">No risk predictions available.</p>
            <p className="ca-faint" style={{ fontSize: 12 }}>Analyze a repository first.</p>
          </div>
        )}

      </div>

      {/* =====================================================
          FOOTER
      ===================================================== */}

      {risks.length > 0 && (
        <div className="ca-footnote">
          <span>
            {risks.length} functions analyzed using the CodeAtlas calibrated ML risk model.
          </span>

          <span>
            <Sparkles size={12} />
            Gemini explains predictions; it does not determine risk.
          </span>
        </div>
      )}

    </div>
  );
}
