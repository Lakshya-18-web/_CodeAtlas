import { useMemo, useState } from "react";
import {
  ShieldCheck,
  ShieldAlert,
  KeyRound,
  Search,
  Info,
  FolderTree,
} from "lucide-react";

// CodeAtlas' only existing security signal is the local secret scanner in
// backend/secrets.py, returned as `secrets` on POST /api/analyze. There is
// no backend/security_scanner.py and no severity/category/remediation
// fields, so none are shown here — only what scan_repository() returns:
// total, files_affected, by_type{}, and findings[] of
// { type, label, file, line, masked_value }.

const TYPE_FILTERS = ["All", "API Key", "Token", "Password", "Credential", "Private Key"];

export default function Security({ repository, secretReport, stats }) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [selected, setSelected] = useState(null);

  const findings = secretReport?.findings || [];

  const availableTypes = useMemo(() => {
    const present = new Set(findings.map((f) => f.type));
    return TYPE_FILTERS.filter((t) => t === "All" || present.has(t));
  }, [findings]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return findings.filter((f) => {
      const matchesType = typeFilter === "All" || f.type === typeFilter;

      const matchesSearch =
        !q ||
        String(f.file || "").toLowerCase().includes(q) ||
        String(f.label || "").toLowerCase().includes(q) ||
        String(f.type || "").toLowerCase().includes(q);

      return matchesType && matchesSearch;
    });
  }, [findings, search, typeFilter]);

  // ----------------------------------------------------------
  // No repository analyzed yet
  // ----------------------------------------------------------

  if (!repository) {
    return (
      <div className="ca-page">
        <div className="ca-empty ca-empty-fill">
          <div className="ca-empty-icon">
            <ShieldCheck />
          </div>

          <h2 className="ca-empty-title">No repository analyzed</h2>
          <p className="ca-empty-text">
            Analyze a repository from the Overview page to run the secret
            scanner against it.
          </p>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------------
  // No scan data at all (analyze response had no `secrets` field)
  // ----------------------------------------------------------

  if (!secretReport) {
    return (
      <div className="ca-page">
        <div className="ca-page-header">
          <div>
            <h1 className="ca-page-title">Security</h1>
            <p className="ca-page-sub">Repository secret scan results.</p>
          </div>
        </div>

        <div className="ca-alert" data-tone="warn">
          <ShieldAlert size={16} />
          <div className="ca-alert-body">
            No security scan data was returned for this repository.
          </div>
        </div>
      </div>
    );
  }

  const byType = secretReport.by_type || {};
  const hasFindings = secretReport.total > 0;

  return (
    <div className="ca-page">

      <div className="ca-page-header">
        <div>
          <h1 className="ca-page-title">Security</h1>
          <p className="ca-page-sub">
            Local secret-detection results for this repository. Findings are
            file and line matches from pattern scanning, not a guarantee the
            codebase is secure.
          </p>
        </div>
      </div>

      <div className="ca-stat-grid">
        <div className="ca-stat" data-tone={hasFindings ? "medium" : "low"}>
          <div className="ca-stat-label">
            <span>Possible Secrets</span>
            <KeyRound size={14} />
          </div>
          <div className="ca-stat-value ca-tabular">{secretReport.total}</div>
          <div className="ca-stat-hint">Total pattern matches</div>
        </div>

        <div className="ca-stat">
          <div className="ca-stat-label">Files Affected</div>
          <div className="ca-stat-value ca-tabular">{secretReport.files_affected}</div>
          <div className="ca-stat-hint">
            of {stats?.files ?? "—"} files analyzed
          </div>
        </div>

        {Object.entries(byType).map(([type, count]) => (
          <div className="ca-stat" key={type}>
            <div className="ca-stat-label">{type}</div>
            <div className="ca-stat-value ca-tabular">{count}</div>
          </div>
        ))}
      </div>

      <div className="ca-signal-note ca-section-gap">
        <Info />
        <span>
          Security findings and ML risk predictions are separate signals.
          A function can be flagged as high risk with no secrets nearby, or
          contain a possible secret with low predicted risk.
        </span>
      </div>

      {!hasFindings ? (
        <div className="ca-card ca-section-gap">
          <div className="ca-empty">
            <div className="ca-empty-icon">
              <ShieldCheck />
            </div>

            <h2 className="ca-empty-title">No security findings detected</h2>
            <p className="ca-empty-text">
              The current scanner did not match any known secret patterns in
              this repository.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="ca-sec-toolbar">
            <div className="ca-search ca-search-wide">
              <Search />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by file, label or type..."
              />
            </div>

            <div className="ca-chip-row">
              {availableTypes.map((type) => (
                <button
                  key={type}
                  className="ca-chip"
                  aria-pressed={typeFilter === type}
                  onClick={() => setTypeFilter(type)}
                >
                  {type}
                  {type !== "All" && (
                    <span className="ca-chip-count">{byType[type] || 0}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="ca-sec-layout">

            <div className="ca-table-wrap">
              <div className="ca-finding-head">
                <div>Type</div>
                <div>File</div>
                <div>Label</div>
                <div>Value</div>
              </div>

              <div className="ca-finding-list">
                {filtered.map((finding, index) => {
                  const key = `${finding.file}-${finding.line}-${finding.type}-${index}`;
                  const isSelected = selected === key;

                  return (
                    <button
                      key={key}
                      className={`ca-finding-row ${isSelected ? "is-selected" : ""}`}
                      data-severity="medium"
                      onClick={() => setSelected(isSelected ? null : key)}
                    >
                      <span>
                        <span className="ca-badge" data-tone="medium">
                          {finding.type}
                        </span>
                      </span>

                      <span className="ca-col-wide">
                        <div className="ca-finding-title ca-mono">
                          {finding.file}
                        </div>
                        <div className="ca-finding-sub">Line {finding.line}</div>
                      </span>

                      <span className="ca-finding-sub">{finding.label}</span>

                      <span>
                        <code className="ca-secret">{finding.masked_value}</code>
                      </span>
                    </button>
                  );
                })}

                {filtered.length === 0 && (
                  <div className="ca-empty">
                    <div className="ca-empty-icon">
                      <Search />
                    </div>
                    <p className="ca-empty-text">
                      No findings match your search or filter.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <SelectedFindingDetail
              findingKey={selected}
              findings={filtered}
            />

          </div>
        </>
      )}

    </div>
  );
}


function SelectedFindingDetail({ findingKey, findings }) {
  const index = findings.findIndex((f, i) => {
    const key = `${f.file}-${f.line}-${f.type}-${i}`;
    return key === findingKey;
  });

  const finding = index >= 0 ? findings[index] : null;

  if (!finding) {
    return (
      <div className="ca-finding-detail">
        <div className="ca-empty">
          <div className="ca-empty-icon">
            <FolderTree />
          </div>
          <p className="ca-empty-text">
            Select a finding to see its details.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="ca-finding-detail">
      <div className="ca-inspector-head">
        <div>
          <div className="ca-inspector-kind">{finding.type}</div>
          <div className="ca-inspector-title">{finding.label}</div>
        </div>

        <span className="ca-badge" data-tone="medium">
          Line {finding.line}
        </span>
      </div>

      <div className="ca-finding-detail-body">
        <div>
          <div className="ca-field-label">Affected file</div>
          <p className="ca-path" style={{ wordBreak: "break-all" }}>
            {finding.file}
          </p>
        </div>

        <div>
          <div className="ca-field-label">Line</div>
          <p className="ca-prose" style={{ fontSize: 13 }}>{finding.line}</p>
        </div>

        <div>
          <div className="ca-field-label">Masked value</div>
          <code className="ca-secret">{finding.masked_value}</code>
        </div>

        <div className="ca-alert" data-tone="info">
          <Info size={16} />
          <div className="ca-alert-body">
            This value is masked in memory; the repository on disk was not
            modified by the scan.
          </div>
        </div>
      </div>
    </div>
  );
}
