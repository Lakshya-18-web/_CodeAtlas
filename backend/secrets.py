"""Local secret detection for uploaded repositories.

Findings never contain the complete secret. The scanner is intentionally
read-only: redaction is applied only to CodeAtlas' in-memory analysis copy.
"""

from collections import Counter
from pathlib import Path
import re


IGNORED_DIRECTORIES = {
    ".git", ".hg", ".svn", "node_modules", "venv", ".venv",
    "dist", "build", "__pycache__", ".next", "coverage",
}
IGNORED_FILES = {"package-lock.json", "yarn.lock", "pnpm-lock.yaml"}
MAX_FILE_BYTES = 1_000_000


PATTERNS = [
    ("Private Key", "Private key", re.compile(
        r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?"
        r"-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----"
    )),
    ("API Key", "AWS access key", re.compile(r"(?<![A-Z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Z0-9])")),
    ("API Key", "Google API key", re.compile(r"AIza[0-9A-Za-z_-]{35}")),
    ("API Key", "OpenAI API key", re.compile(r"sk-(?:proj-)?[A-Za-z0-9_-]{20,}")),
    ("API Key", "Anthropic API key", re.compile(r"sk-ant-[A-Za-z0-9_-]{20,}")),
    ("Token", "GitHub token", re.compile(r"gh(?:p|o|u|s|r)_[A-Za-z0-9]{30,255}")),
    ("Token", "Slack token", re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}")),
    ("API Key", "Stripe secret key", re.compile(r"sk_(?:live|test)_[A-Za-z0-9]{16,}")),
    ("Token", "JWT", re.compile(r"eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}")),
    ("Credential", "Credential in URL", re.compile(
        r"(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp)://[^\s:/]+:(?P<secret>[^\s@/]+)@",
        re.IGNORECASE,
    )),
    ("Password", "Password", re.compile(
        r"(?i)(?:password|passwd|pwd)\s*[:=]\s*['\"]?(?P<secret>[^'\"\s,;}{]{6,})"
    )),
    ("API Key", "API key", re.compile(
        r"(?i)(?:api[_-]?key|apikey|secret[_-]?key|client[_-]?secret|access[_-]?key)\s*[:=]\s*['\"]?(?P<secret>[^'\"\s,;}{]{8,})"
    )),
    ("Token", "Access token", re.compile(
        r"(?i)(?:access[_-]?token|auth[_-]?token|bearer[_-]?token)\s*[:=]\s*['\"]?(?P<secret>[^'\"\s,;}{]{8,})"
    )),
]


def _looks_binary(path: Path) -> bool:
    try:
        with path.open("rb") as handle:
            return b"\0" in handle.read(2048)
    except OSError:
        return True


def _masked(value: str) -> str:
    compact = value.replace("\n", "")
    if "PRIVATE KEY" in compact:
        return "-----BEGIN … PRIVATE KEY----- [REDACTED]"
    if len(compact) <= 8:
        return "••••••••"
    return f"{compact[:4]}…{compact[-4:]}"


def _secret_value(match: re.Match) -> str:
    return match.groupdict().get("secret") or match.group(0)


def scan_repository(repo_path: str) -> dict:
    root = Path(repo_path).resolve()
    findings = []
    seen = set()

    for path in root.rglob("*"):
        if not path.is_file():
            continue
        relative = path.relative_to(root)
        if any(part in IGNORED_DIRECTORIES for part in relative.parts):
            continue
        if path.name in IGNORED_FILES:
            continue
        try:
            if path.stat().st_size > MAX_FILE_BYTES or _looks_binary(path):
                continue
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue

        for category, label, pattern in PATTERNS:
            for match in pattern.finditer(text):
                value = _secret_value(match)
                value_start = match.start("secret") if "secret" in match.groupdict() else match.start()
                line = text.count("\n", 0, value_start) + 1
                key = (relative.as_posix(), line, category, value)
                if key in seen:
                    continue
                seen.add(key)
                findings.append({
                    "type": category,
                    "label": label,
                    "file": relative.as_posix(),
                    "line": line,
                    "masked_value": _masked(value),
                })

    findings.sort(key=lambda item: (item["file"].lower(), item["line"], item["type"]))
    counts = Counter(item["type"] for item in findings)
    return {
        "total": len(findings),
        "files_affected": len({item["file"] for item in findings}),
        "by_type": dict(sorted(counts.items())),
        "findings": findings,
    }


def redact_text(text: str) -> str:
    """Mask secrets before code is exposed through graph or RAG responses."""
    redacted = text
    for _, _, pattern in PATTERNS:
        def replace(match):
            if "secret" in match.groupdict():
                start, end = match.span("secret")
                local_start = start - match.start()
                local_end = end - match.start()
                return match.group(0)[:local_start] + "[REDACTED]" + match.group(0)[local_end:]
            return "[REDACTED SECRET]"
        redacted = pattern.sub(replace, redacted)
    return redacted


def redact_analysis(parsed_files: list[dict]) -> list[dict]:
    for file_data in parsed_files:
        for function in file_data.get("functions", []):
            function["code"] = redact_text(function.get("code", ""))
    return parsed_files
