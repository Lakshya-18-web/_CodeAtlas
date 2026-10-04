import { useState } from "react";
import {
  MessageSquare,
  Send,
  Sparkles,
  FileCode2,
  AlertCircle,
} from "lucide-react";

export default function AskCodebase() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState(null);
  const [loading, setLoading] = useState(false);
  const [askedQuestion, setAskedQuestion] = useState("");

  async function askQuestion() {
    if (!question.trim()) return;

    const sentQuestion = question.trim();

    setLoading(true);
    setAnswer(null);
    setAskedQuestion(sentQuestion);

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: sentQuestion,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail ||
          data.error ||
          "Ask API request failed."
        );
      }

      setAnswer(data);

    } catch (error) {
      setAnswer({
        answer: null,
        sources: [],
        pending: false,
        error: error.message,
      });
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      askQuestion();
    }
  }

  const hasAnswer =
    answer &&
    typeof answer.answer === "string" &&
    answer.answer.trim().length > 0;

  const backendError =
    answer?.llm_error ||
    answer?.error ||
    null;

  const retrievalLabel = answer?.retrieval_backend
    ? /tf.?idf|local/i.test(answer.retrieval_backend)
      ? "Local TF-IDF retrieval"
      : "Gemini retrieval"
    : null;

  const retrievalState = answer?.retrieval_backend
    ? /tf.?idf|local/i.test(answer.retrieval_backend)
      ? "local"
      : "ok"
    : null;

  return (
    <div className="ca-ask">

      {/* ===================================================
          HEADER
      =================================================== */}

      <div className="ca-ask-head">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            className="ca-empty-icon"
            style={{ width: 32, height: 32, borderColor: "var(--ca-violet-border)", background: "var(--ca-violet-bg)" }}
          >
            <MessageSquare size={16} style={{ color: "var(--ca-violet-text)" }} />
          </span>

          <div>
            <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Ask Codebase</h1>
            <p className="ca-faint" style={{ margin: 0, fontSize: 12.5 }}>
              Repository-grounded AI assistant — ask about functions, dependencies and architecture.
            </p>
          </div>
        </div>

        {retrievalLabel && (
          <span className="ca-status-pill" data-state={retrievalState}>
            {retrievalLabel}
          </span>
        )}
      </div>

      {/* ===================================================
          THREAD
      =================================================== */}

      <div className="ca-ask-thread">
        <div className="ca-ask-column">

          {/* Empty state */}
          {!answer && !loading && (
            <div className="ca-ask-empty">
              <div className="ca-ask-empty-icon">
                <Sparkles />
              </div>

              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
                Understand your codebase
              </h2>

              <p className="ca-faint" style={{ fontSize: 13, maxWidth: 420 }}>
                Ask about functions, dependencies, architecture or how
                different parts of this repository work.
              </p>

              <div className="ca-ask-suggest">
                {[
                  "How does authentication work?",
                  "Which functions are the riskiest?",
                  "Summarize the overall architecture",
                ].map((item) => (
                  <button
                    key={item}
                    onClick={() => setQuestion(item)}
                    className="ca-suggest"
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <>
              {askedQuestion && (
                <div className="ca-msg-user">
                  <div className="ca-msg-label">You asked</div>
                  <p className="ca-msg-user-text">{askedQuestion}</p>
                </div>
              )}

              <div className="ca-thinking">
                <span className="ca-spinner" />
                CodeAtlas is analyzing your codebase...
              </div>
            </>
          )}

          {/* Result */}
          {answer && !loading && (
            <div className="ca-fade-in">

              <div className="ca-msg-user">
                <div className="ca-msg-label">You asked</div>
                <p className="ca-msg-user-text">{askedQuestion}</p>
              </div>

              <div className="ca-msg-ai">
                <div className="ca-msg-ai-head">
                  <span className="ca-msg-ai-name">
                    <Sparkles />
                    CodeAtlas
                  </span>

                  {retrievalLabel && (
                    <span className="ca-status-pill" data-state={retrievalState}>
                      {retrievalLabel}
                    </span>
                  )}

                  <span
                    className="ca-status-pill"
                    data-state={answer.llm_ok ? "ok" : "error"}
                  >
                    {answer.llm_ok ? "Gemini OK" : "Gemini failed"}
                  </span>
                </div>

                {hasAnswer ? (
                  <p className="ca-prose">{answer.answer}</p>
                ) : backendError ? (
                  <div className="ca-alert" data-tone="error">
                    <AlertCircle size={16} />
                    <div className="ca-alert-body">
                      <div className="ca-alert-title">
                        CodeAtlas could not generate an answer
                      </div>
                      <p style={{ margin: "4px 0 0", fontSize: 13 }}>
                        Repository context was retrieved, but the AI did not
                        return a usable response.
                      </p>

                      <details className="ca-details">
                        <summary>Technical details</summary>
                        <pre>{backendError}</pre>
                      </details>
                    </div>
                  </div>
                ) : (
                  <div className="ca-alert" data-tone="warn">
                    <AlertCircle size={16} />
                    <div className="ca-alert-body">
                      The repository context was retrieved, but the AI did
                      not return an answer.
                    </div>
                  </div>
                )}

                {/* Sources */}
                {answer.sources?.length > 0 && (
                  <div className="ca-sources">
                    <div className="ca-field-label">Sources</div>

                    <div className="ca-source-grid">
                      {answer.sources.map((source, index) => (
                        <div
                          key={
                            source.node_id ||
                            `${source.file}-${source.name}-${index}`
                          }
                          className="ca-source"
                        >
                          <FileCode2 />

                          <div style={{ minWidth: 0 }}>
                            <div className="ca-source-path">
                              {typeof source === "string"
                                ? source
                                : source.file || source.node_id}
                            </div>

                            {typeof source !== "string" && source.name && (
                              <div className="ca-source-meta">
                                {source.type || "symbol"} · {source.name}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

            </div>
          )}

        </div>
      </div>

      {/* ===================================================
          COMPOSER
      =================================================== */}

      <div className="ca-composer">
        <div className="ca-composer-box">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything about your codebase..."
            rows={1}
          />

          <button
            onClick={askQuestion}
            disabled={!question.trim() || loading}
            className="ca-btn ca-btn-ai ca-btn-icon"
          >
            <Send size={15} />
          </button>
        </div>

        <p className="ca-composer-hint">
          Enter to ask · Shift + Enter for new line
        </p>
      </div>

    </div>
  );
}
