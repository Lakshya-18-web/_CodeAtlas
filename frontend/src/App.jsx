import { useState, useEffect } from "react";
import "./index.css";
import "./App.css";
import {
  Sun,
  Moon,
  LayoutDashboard,
  Network,
  ShieldAlert,
  ShieldCheck,
  KeyRound,
  AlertTriangle,
  MessageSquare,
  Upload,
  FolderGit2,
  FolderTree,
  Loader2,
  Compass,
  Gauge,
  Sparkles,
  Menu,
  X,
} from "lucide-react";

import CodeMap from "./CodeMap";
import RiskView from "./RiskView";
import Security from "./Security";
import AskCodebase from "./AskCodebase";
import logoMark from "./assets/codeatlas-mark.png";

// Real, server-driven analysis stages. CodeAtlas has no progress-percentage
// API, so this never fakes a percentage — it only marks each stage as the
// request it belongs to starts and finishes.
const ANALYSIS_STAGES = [
  { id: "upload", label: "Uploading repository" },
  { id: "analyze", label: "Parsing files and building the dependency graph" },
  { id: "risk", label: "Loading ML risk predictions" },
];

function App() {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem("codeatlas-theme") || "dark";
  });

  useEffect(() => {
    localStorage.setItem("codeatlas-theme", theme);
  }, [theme]);

  const [activePage, setActivePage] = useState("Dashboard");

  const [stats, setStats] = useState({
    files: 0,
    nodes: 0,
    edges: 0,
    highRisk: 0,
    mediumRisk: 0,
    lowRisk: 0,
    secrets: 0,
  });

  const [repository, setRepository] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [analysisStage, setAnalysisStage] = useState("");
  const [error, setError] = useState("");
  const [secretReport, setSecretReport] = useState(null);
  const [secretsAcknowledged, setSecretsAcknowledged] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  async function analyzeRepository(file) {
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".zip")) {
      setError("Please upload a ZIP file.");
      return;
    }

    setUploading(true);
    setAnalysisStage("upload");
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      setAnalysisStage("analyze");

      const response = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        throw new Error(data.error || "Analysis failed");
      }

      // --------------------------------------------------------
      // Get ML risk results for the newly analyzed repository
      // --------------------------------------------------------

      setAnalysisStage("risk");

      let highRiskCount = 0;
      let mediumRiskCount = 0;
      let lowRiskCount = 0;

      try {
        const riskResponse = await fetch("/api/risk");
        const riskData = await riskResponse.json();

        if (Array.isArray(riskData)) {
          highRiskCount = riskData.filter(
            (item) => item.risk_level === "High"
          ).length;
          mediumRiskCount = riskData.filter(
            (item) => item.risk_level === "Medium"
          ).length;
          lowRiskCount = riskData.filter(
            (item) => item.risk_level === "Low"
          ).length;
        }
      } catch (riskError) {
        console.error(
          "Could not load risk predictions:",
          riskError
        );
      }

      // --------------------------------------------------------
      // Update dashboard statistics
      // --------------------------------------------------------

      setStats({
        files: data.files,
        nodes: data.nodes,
        edges: data.edges,
        highRisk: highRiskCount,
        mediumRisk: mediumRiskCount,
        lowRisk: lowRiskCount,
        secrets: data.secrets?.total || 0,
      });

      setSecretReport(data.secrets || null);
      setSecretsAcknowledged(!(data.secrets?.total > 0));

      // This is the source of truth for the current
      // frontend session.
      setRepository(file.name);

      // Repositories containing possible secrets require an explicit choice.
      // Continuing uses the same upload and never changes its files.
      setActivePage(
        data.secrets?.total > 0 ? "Dashboard" : "Code Map"
      );
    } catch (err) {
      setError(
        err.message || "Analysis failed"
      );
    } finally {
      setUploading(false);
      setAnalysisStage("");
    }
  }

  const hasRepository = Boolean(repository);
  const canExplore = hasRepository && secretsAcknowledged;

  function openPage(page) {
    if (!hasRepository && page !== "Dashboard") {
      setActivePage("Dashboard");
      setError(
        "Analyze a repository before opening this view."
      );
      return;
    }

    // Security stays reachable even before the secrets prompt is
    // acknowledged — it IS the review step for those findings.
    if (
      !secretsAcknowledged &&
      page !== "Dashboard" &&
      page !== "Security"
    ) {
      setActivePage("Dashboard");
      setError("Review the detected secrets and choose whether to continue.");
      return;
    }

    setError("");
    setActivePage(page);
    setMobileMenuOpen(false);
  }

  const navItems = [
    {
      page: "Dashboard",
      label: "Overview",
      icon: <LayoutDashboard size={16} />,
      alwaysEnabled: true,
    },
    {
      page: "Code Map",
      label: "Code Map",
      icon: <Network size={16} />,
    },
    {
      page: "Risk View",
      label: "Risk View",
      icon: <Gauge size={16} />,
    },
    {
      page: "Security",
      label: "Security",
      icon: <ShieldCheck size={16} />,
      bypassSecretsGate: true,
    },
    {
      page: "Ask Codebase",
      label: "Ask Codebase",
      icon: <MessageSquare size={16} />,
    },
  ];

  return (
    <div data-theme={theme} className="ca-shell">

      {/* ==========================================================
          HEADER — horizontal navigation
      ========================================================== */}

      <header className="ca-header">

        <div className="ca-header-brand">
          <img
            src={logoMark}
            alt="CodeAtlas"
            className="ca-brand-mark"
          />

          <div className="ca-brand-text">
            <div className="ca-brand-name">CodeAtlas</div>
            <div className="ca-brand-sub">Navigate. Understand. Predict.</div>
          </div>
        </div>

        <nav className="ca-header-nav" aria-label="Primary">
          {navItems.map((item) => {
            const disabled = item.alwaysEnabled
              ? false
              : item.bypassSecretsGate
              ? !hasRepository
              : !canExplore;

            return (
              <NavItem
                key={item.page}
                icon={item.icon}
                label={item.label}
                active={activePage === item.page}
                disabled={disabled}
                onClick={() => openPage(item.page)}
              />
            );
          })}
        </nav>

        <button
          className="ca-nav-toggle"
          onClick={() => setMobileMenuOpen((open) => !open)}
          aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileMenuOpen}
        >
          {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
        </button>

        <div className="ca-header-actions">
          {repository && (
            <span className="ca-repo-chip" title={repository}>
              <FolderGit2 />
              <span>{repository}</span>
            </span>
          )}

          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="ca-btn ca-btn-secondary ca-btn-icon"
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>

          <label className="cursor-pointer">
            <input
              type="file"
              accept=".zip"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                analyzeRepository(e.target.files[0]);
                e.target.value = "";
              }}
            />

            <span
              className={`ca-btn ca-btn-primary ${
                uploading ? "opacity-60 cursor-not-allowed" : ""
              }`}
            >
              {uploading ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Upload size={15} />
                  Analyze Repository
                </>
              )}
            </span>
          </label>
        </div>

      </header>

      {/* ==========================================================
          MOBILE NAV PANEL — collapses the nav below the header
      ========================================================== */}

      {mobileMenuOpen && (
        <div className="ca-mobile-nav-panel">
          {navItems.map((item) => {
            const disabled = item.alwaysEnabled
              ? false
              : item.bypassSecretsGate
              ? !hasRepository
              : !canExplore;

            return (
              <NavItem
                key={item.page}
                icon={item.icon}
                label={item.label}
                active={activePage === item.page}
                disabled={disabled}
                onClick={() => openPage(item.page)}
              />
            );
          })}

          <div className="ca-repo-card" style={{ marginTop: 8 }}>
            <FolderGit2 />

            <div className="ca-repo-text">
              <div className="ca-repo-name">
                {repository || "No repository loaded"}
              </div>

              {repository && (
                <div className="ca-repo-meta">
                  {stats.files} files analyzed
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==========================================================
          MAIN CONTENT — now uses the full width freed by the sidebar
      ========================================================== */}

      <div className="ca-content">
        {activePage === "Dashboard" && (
          <Dashboard
            stats={stats}
            repository={repository}
            uploading={uploading}
            error={error}
            onAnalyze={analyzeRepository}
            onNavigate={openPage}
            secretReport={secretReport}
            onContinue={() => {
              setSecretsAcknowledged(true);
              setError("");
              setActivePage("Code Map");
            }}
          />
        )}

        {activePage === "Code Map" && (
          <CodeMap repository={repository} secretReport={secretReport} />
        )}

        {activePage === "Risk View" && <RiskView />}

        {activePage === "Security" && (
          <Security
            repository={repository}
            secretReport={secretReport}
            stats={stats}
          />
        )}

        {activePage === "Ask Codebase" && <AskCodebase />}
      </div>

      {/* ==========================================================
          ANALYSIS OVERLAY — only stages the app actually knows about
      ========================================================== */}

      {uploading && (
        <div className="ca-analysis-overlay">
          <div className="ca-analysis-card">
            <div className="ca-analysis-logo">
              <img src={logoMark} alt="" />
            </div>

            <h3 className="ca-analysis-title">Analyzing your repository</h3>
            <p className="ca-analysis-sub">
              This can take a moment for larger codebases.
            </p>

            <ul className="ca-stage-list">
              {ANALYSIS_STAGES.map((stage, index) => {
                const currentIndex = ANALYSIS_STAGES.findIndex(
                  (s) => s.id === analysisStage
                );
                const state =
                  currentIndex === -1
                    ? "pending"
                    : index < currentIndex
                    ? "done"
                    : index === currentIndex
                    ? "active"
                    : "pending";

                return (
                  <li key={stage.id} data-state={state}>
                    {stage.label}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

    </div>
  );
}


// ============================================================
// DASHBOARD
// ============================================================

function Dashboard({
  stats,
  repository,
  uploading,
  error,
  onAnalyze,
  onNavigate,
  secretReport,
  onContinue,
}) {
  const hasRepository = Boolean(repository);
  const totalFunctions =
    stats.highRisk + stats.mediumRisk + stats.lowRisk;

  // --------------------------------------------------------
  // Empty state: nothing analyzed yet
  // --------------------------------------------------------

  if (!hasRepository) {
    return (
      <div className="ca-landing">
        <div className="ca-landing-inner">
          <img src={logoMark} alt="CodeAtlas" className="ca-landing-logo" />

          <h1 className="ca-landing-title">CodeAtlas</h1>
          <p className="ca-landing-tagline">
            Navigate. Understand. Predict.
          </p>

          <p className="ca-landing-text">
            Upload a Python repository to start understanding your codebase —
            structure, ML-predicted risk, detected secrets, and a
            repository-grounded AI assistant.
          </p>

          {error && (
            <div className="ca-alert" data-tone="error" style={{ marginTop: 20, textAlign: "left" }}>
              <AlertTriangle size={16} />
              <div className="ca-alert-body">{error}</div>
            </div>
          )}

          <label className="cursor-pointer">
            <input
              type="file"
              accept=".zip"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                onAnalyze(e.target.files[0]);
                e.target.value = "";
              }}
            />

            <div className="ca-dropzone">
              {uploading ? (
                <Loader2 size={26} className="animate-spin ca-faint" />
              ) : (
                <Upload size={26} className="ca-faint" />
              )}

              <span className="ca-btn ca-btn-primary ca-btn-lg">
                {uploading ? "Analyzing..." : "Analyze Repository"}
              </span>

              <span className="ca-dropzone-hint">
                .zip of a Python repository
              </span>
            </div>
          </label>

          <ul className="ca-pillars">
            <li><Compass /> Understand</li>
            <li><Network size={13} /> Visualize</li>
            <li><Gauge size={13} /> Assess</li>
            <li><ShieldCheck size={13} /> Secure</li>
            <li><Sparkles size={13} /> Ask</li>
          </ul>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------
  // Repository analyzed
  // --------------------------------------------------------

  return (
    <div className="ca-page">

      <div className="ca-page-header">
        <div>
          <h1 className="ca-page-title">Repository Overview</h1>
          <p className="ca-page-sub">
            Understand your Python codebase, its dependencies and its risks.
          </p>
        </div>
      </div>

      {error && (
        <div className="ca-alert" data-tone="error" style={{ marginBottom: 16 }}>
          <AlertTriangle size={16} />
          <div className="ca-alert-body">{error}</div>
        </div>
      )}

      <div className="ca-stat-grid">
        <div className="ca-stat">
          <div className="ca-stat-label">Files</div>
          <div className="ca-stat-value ca-tabular">{stats.files}</div>
        </div>

        <div className="ca-stat">
          <div className="ca-stat-label">Nodes</div>
          <div className="ca-stat-value ca-tabular">{stats.nodes}</div>
        </div>

        <div className="ca-stat">
          <div className="ca-stat-label">Relationships</div>
          <div className="ca-stat-value ca-tabular">{stats.edges}</div>
        </div>

        <div className="ca-stat" data-tone={stats.highRisk > 0 ? "high" : "info"}>
          <div className="ca-stat-label">
            <span>High Risk</span>
            <ShieldAlert size={14} />
          </div>
          <div className="ca-stat-value ca-tabular">{stats.highRisk}</div>
        </div>

        <div className="ca-stat" data-tone={stats.secrets > 0 ? "medium" : "info"}>
          <div className="ca-stat-label">
            <span>Exposed Secrets</span>
            <KeyRound size={14} />
          </div>
          <div className="ca-stat-value ca-tabular">{stats.secrets}</div>
        </div>
      </div>

      {secretReport?.total > 0 && (
        <div className="ca-card ca-section-gap" style={{ borderColor: "var(--ca-medium-border)" }}>
          <div className="ca-card-pad">
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 12 }}>
                <AlertTriangle size={20} className="ca-faint" style={{ color: "var(--ca-medium-text)", flexShrink: 0, marginTop: 2 }} />

                <div>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--ca-medium-text)" }}>
                    {secretReport.total} possible secret{secretReport.total === 1 ? "" : "s"} detected
                  </h3>

                  <p className="ca-muted" style={{ fontSize: 13, margin: "4px 0 0" }}>
                    Found in {secretReport.files_affected} file{secretReport.files_affected === 1 ? "" : "s"}.
                    Values are masked and the repository was not modified.
                  </p>

                  <div className="ca-chip-row" style={{ marginTop: 10 }}>
                    {Object.entries(secretReport.by_type || {}).map(([type, count]) => (
                      <span key={type} className="ca-badge" data-tone="medium">
                        {type}: {count}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <button
                onClick={onContinue}
                className="ca-btn ca-btn-warn"
                style={{ flexShrink: 0 }}
              >
                Continue with same repo
              </button>
            </div>

            <div
              style={{
                marginTop: 14,
                paddingTop: 12,
                borderTop: "1px solid var(--ca-medium-border)",
                maxHeight: 190,
                overflow: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {secretReport.findings.map((finding, index) => (
                <div
                  key={`${finding.file}-${finding.line}-${index}`}
                  style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, minWidth: 0 }}
                >
                  <KeyRound size={13} style={{ color: "var(--ca-medium-text)", flexShrink: 0 }} />
                  <span className="ca-truncate" style={{ color: "var(--ca-text-2)", flexShrink: 1, minWidth: 0 }}>
                    {finding.file}:{finding.line}
                  </span>
                  <span className="ca-faint" style={{ flexShrink: 0 }}>{finding.label}</span>
                  <code className="ca-secret" style={{ marginLeft: "auto" }}>
                    {finding.masked_value}
                  </code>
                </div>
              ))}
            </div>

            <button
              onClick={() => onNavigate("Security")}
              className="ca-btn ca-btn-ghost ca-btn-sm"
              style={{ marginTop: 10 }}
            >
              <ShieldCheck size={14} />
              Review in Security
            </button>
          </div>
        </div>
      )}

      <div className="ca-overview-grid ca-section-gap">

        <div className="ca-card">
          <div className="ca-card-header">
            <div>
              <h3 className="ca-card-title">Dependency Graph</h3>
              <p className="ca-card-sub">Visualize relationships inside your codebase.</p>
            </div>

            <button
              onClick={() => onNavigate("Code Map")}
              className="ca-btn ca-btn-ghost ca-btn-sm"
            >
              Open Code Map →
            </button>
          </div>

          <div className="ca-empty ca-empty-fill">
            <div className="ca-empty-icon">
              <FolderTree />
            </div>

            <h3 className="ca-empty-title">Repository analyzed</h3>

            <p className="ca-empty-text">
              {stats.files} files · {stats.nodes} nodes · {stats.edges} relationships
            </p>

            <button
              onClick={() => onNavigate("Code Map")}
              className="ca-btn ca-btn-primary"
            >
              Explore Code Map
            </button>
          </div>
        </div>

        <div className="ca-stack">

          <div className="ca-card ca-card-pad">
            <h3 className="ca-section-title">Risk Summary</h3>

            {totalFunctions > 0 ? (
              <>
                <div className="ca-risk-dist">
                  <span
                    data-level="high"
                    style={{ flexBasis: `${(stats.highRisk / totalFunctions) * 100}%` }}
                  />
                  <span
                    data-level="medium"
                    style={{ flexBasis: `${(stats.mediumRisk / totalFunctions) * 100}%` }}
                  />
                  <span
                    data-level="low"
                    style={{ flexBasis: `${(stats.lowRisk / totalFunctions) * 100}%` }}
                  />
                </div>

                <div className="ca-legend">
                  <span className="ca-legend-item" data-level="high">High · {stats.highRisk}</span>
                  <span className="ca-legend-item" data-level="medium">Medium · {stats.mediumRisk}</span>
                  <span className="ca-legend-item" data-level="low">Low · {stats.lowRisk}</span>
                </div>
              </>
            ) : (
              <p className="ca-faint" style={{ fontSize: 12.5 }}>
                No risk predictions available yet.
              </p>
            )}
          </div>

          <div className="ca-card ca-card-pad">
            <h3 className="ca-section-title">Security Summary</h3>

            {secretReport ? (
              <>
                <div className="ca-stat" data-tone={secretReport.total > 0 ? "medium" : "low"} style={{ marginBottom: 10 }}>
                  <div className="ca-stat-label">Possible secrets</div>
                  <div className="ca-stat-value ca-tabular">{secretReport.total}</div>
                  <div className="ca-stat-hint">
                    {secretReport.total > 0
                      ? `${secretReport.files_affected} file${secretReport.files_affected === 1 ? "" : "s"} affected`
                      : "No secrets detected by the current scanner"}
                  </div>
                </div>

                <button
                  onClick={() => onNavigate("Security")}
                  className="ca-btn ca-btn-secondary ca-btn-sm ca-btn-block"
                >
                  Open Security
                </button>
              </>
            ) : (
              <p className="ca-faint" style={{ fontSize: 12.5 }}>
                No security scan data available yet.
              </p>
            )}
          </div>

        </div>
      </div>

      <div className="ca-card ca-section-gap ca-card-pad">
        <h3 className="ca-section-title">Quick Actions</h3>

        <div className="ca-action-grid">
          <button className="ca-action" onClick={() => onNavigate("Code Map")}>
            <span className="ca-action-icon"><Network size={16} /></span>
            <span>
              <div className="ca-action-title">Code Map</div>
              <div className="ca-action-sub">Explore structure &amp; dependencies</div>
            </span>
          </button>

          <button className="ca-action" onClick={() => onNavigate("Risk View")}>
            <span className="ca-action-icon"><Gauge size={16} /></span>
            <span>
              <div className="ca-action-title">Risk View</div>
              <div className="ca-action-sub">ML-predicted function risk</div>
            </span>
          </button>

          <button className="ca-action" onClick={() => onNavigate("Security")}>
            <span className="ca-action-icon"><ShieldCheck size={16} /></span>
            <span>
              <div className="ca-action-title">Security</div>
              <div className="ca-action-sub">Review detected secrets</div>
            </span>
          </button>

          <button className="ca-action" data-kind="ai" onClick={() => onNavigate("Ask Codebase")}>
            <span className="ca-action-icon"><MessageSquare size={16} /></span>
            <span>
              <div className="ca-action-title">Ask Codebase</div>
              <div className="ca-action-sub">Repository-grounded AI answers</div>
            </span>
          </button>
        </div>
      </div>

    </div>
  );
}


// ============================================================
// NAV ITEM
// ============================================================

function NavItem({ icon, label, active, onClick, disabled = false }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-current={active ? "page" : undefined}
      title={
        disabled
          ? "Analyze a repository before opening this view"
          : label
      }
      className={`ca-nav-item ${active ? "is-active" : ""}`}
    >
      {icon}
      <span className="ca-nav-text">{label}</span>
    </button>
  );
}


export default App;
