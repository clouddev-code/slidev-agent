"""Slidev slide overflow validation tool.

Heuristically estimates whether each generated slide fits within the
default Slidev 16:9 canvas. The estimates are intentionally conservative
so that the agent can catch likely overflow cases and regenerate them
before the user sees a broken slide.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from strands import tool


def _read_markdown(path_or_uri: str) -> str | None:
    """Read Slidev markdown from local path or `s3://` URI.

    Returns None if the resource cannot be located.
    """
    if path_or_uri.startswith("s3://"):
        try:
            import boto3

            parsed = urlparse(path_or_uri)
            bucket = parsed.netloc
            key = parsed.path.lstrip("/")
            if not bucket or not key:
                return None
            obj = boto3.client("s3").get_object(Bucket=bucket, Key=key)
            return obj["Body"].read().decode("utf-8")
        except Exception:
            return None
    p = Path(path_or_uri)
    if not p.exists():
        return None
    return p.read_text(encoding="utf-8")

# Per-layout content budget. Values are tuned for Slidev's default 16:9
# canvas with default font sizing. Each "row" roughly corresponds to one
# visible body line; a heading or code fence weighs slightly more or less.
LAYOUT_LIMITS: dict[str, dict[str, int]] = {
    "cover": {"max_rows": 12, "max_chars": 70},
    "intro": {"max_rows": 14, "max_chars": 70},
    "center": {"max_rows": 18, "max_chars": 80},
    "section": {"max_rows": 8, "max_chars": 60},
    "new-section": {"max_rows": 8, "max_chars": 60},
    "statement": {"max_rows": 10, "max_chars": 60},
    "fact": {"max_rows": 10, "max_chars": 60},
    "quote": {"max_rows": 14, "max_chars": 80},
    "two-cols": {"max_rows": 22, "max_chars": 45},
    "two-cols-header": {"max_rows": 20, "max_chars": 45},
    "text-image": {"max_rows": 18, "max_chars": 50},
    "text-window": {"max_rows": 18, "max_chars": 50},
    "presenter": {"max_rows": 14, "max_chars": 70},
    "end": {"max_rows": 10, "max_chars": 70},
    "default": {"max_rows": 22, "max_chars": 90},
}


@dataclass
class _Slide:
    index: int
    layout: str
    body: str
    frontmatter: str = ""


@dataclass
class _Metrics:
    index: int
    layout: str
    estimated_rows: float
    max_rows: int
    longest_line_chars: int
    max_chars: int
    overflows: bool
    reasons: list[str] = field(default_factory=list)
    suggestions: list[str] = field(default_factory=list)
    title: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "slide_index": self.index,
            "title": self.title,
            "layout": self.layout,
            "estimated_rows": round(self.estimated_rows, 1),
            "max_rows": self.max_rows,
            "longest_line_chars": self.longest_line_chars,
            "max_chars_per_line": self.max_chars,
            "overflows": self.overflows,
            "reasons": self.reasons,
            "suggestions": self.suggestions,
        }


_PRESENTER_NOTE_RE = re.compile(r"<!--.*?-->", flags=re.DOTALL)
_DOC_FM_RE = re.compile(r"^---\s*\n.*?\n---\s*\n", flags=re.DOTALL)
_SLIDE_FM_RE = re.compile(
    r"^---\s*\n((?:[A-Za-z][\w-]*\s*:.*\n)+)---\s*\n",
    flags=re.MULTILINE,
)
_LAYOUT_RE = re.compile(r"^layout\s*:\s*(\S+)", flags=re.MULTILINE)


def _parse_slides(markdown: str) -> list[_Slide]:
    """Split a Slidev document into individual slides with their layout.

    Slidev allows two slide-boundary forms:
      1. A bare ``---`` line acting as a separator
      2. A ``---\\n<key: val>+\\n---`` block that is itself the start of
         the next slide (with per-slide frontmatter)

    Both must be recognised, and either may appear consecutively.
    """
    text = markdown.lstrip()
    m = _DOC_FM_RE.match(text)
    if m:
        text = text[m.end() :]

    frontmatters: dict[int, str] = {}

    def _capture(match: re.Match[str]) -> str:
        idx = len(frontmatters)
        frontmatters[idx] = match.group(1)
        return f"\n<<<SLIDE_FM_{idx}>>>\n"

    text = _SLIDE_FM_RE.sub(_capture, text)
    # Replace bare separator lines with a sentinel so we can split on a
    # single token type below.
    text = re.sub(r"^---\s*$", "<<<SLIDE_BREAK>>>", text, flags=re.MULTILINE)

    tokens = re.split(r"(<<<SLIDE_(?:FM_\d+|BREAK)>>>)", text)

    slides: list[_Slide] = []
    pending_layout = "default"
    pending_fm = ""

    # Any prologue text before the first marker is treated as slide 1
    # only if it has real content.
    prologue = tokens[0].strip() if tokens else ""
    if prologue:
        slides.append(
            _Slide(index=1, layout="default", body=prologue, frontmatter="")
        )

    i = 1
    while i < len(tokens):
        marker = tokens[i]
        body = tokens[i + 1] if i + 1 < len(tokens) else ""
        i += 2

        fm_match = re.match(r"<<<SLIDE_FM_(\d+)>>>", marker)
        if fm_match:
            fm_text = frontmatters[int(fm_match.group(1))]
            layout_match = _LAYOUT_RE.search(fm_text)
            layout = layout_match.group(1).strip() if layout_match else "default"
            pending_layout = layout
            pending_fm = fm_text
        # else: bare break marker — keep pending_layout from previous fm
        # only if no body has been emitted yet; otherwise reset to default.

        body_stripped = body.strip()
        if body_stripped:
            slides.append(
                _Slide(
                    index=len(slides) + 1,
                    layout=pending_layout,
                    body=body_stripped,
                    frontmatter=pending_fm,
                )
            )
            pending_layout = "default"
            pending_fm = ""

    return slides


def _extract_title(body: str) -> str:
    for line in body.split("\n"):
        stripped = line.strip()
        if stripped.startswith("#"):
            return stripped.lstrip("#").strip()[:80]
    return ""


def _estimate_rows(body: str, max_chars: int) -> tuple[float, int, list[str]]:
    """Estimate rendered "row" count and flag content reasons.

    Returns (estimated_rows, longest_line_chars, reasons).
    """
    body = _PRESENTER_NOTE_RE.sub("", body)
    lines = body.split("\n")

    rows = 0.0
    longest = 0
    in_code = False
    in_mermaid_or_diagram = False
    code_lines = 0
    table_rows = 0
    has_long_line = False

    for raw in lines:
        line = raw.rstrip()
        stripped = line.strip()

        # Code fence handling
        fence = re.match(r"^```(\w*)", stripped)
        if fence:
            lang = fence.group(1).lower()
            if not in_code:
                in_code = True
                in_mermaid_or_diagram = lang in {"mermaid", "plantuml", "graphviz", "dot"}
                rows += 0.5  # opening fence + spacing
            else:
                in_code = False
                in_mermaid_or_diagram = False
                rows += 0.5  # closing fence + spacing
            continue

        if in_code:
            code_lines += 1
            if in_mermaid_or_diagram:
                # Mermaid/diagrams render with significantly more vertical space.
                rows += 0.6
            else:
                # Code blocks usually render with slightly tighter line-height.
                rows += 0.95
            longest = max(longest, len(line))
            continue

        if not stripped:
            rows += 0.4
            continue

        longest = max(longest, len(line))

        # Table row
        if "|" in stripped and stripped.count("|") >= 2:
            # separator line ---|---
            if re.match(r"^\|?[\s\-:|]+\|?$", stripped):
                rows += 0.6
            else:
                rows += 1.1
            table_rows += 1
            continue

        # Headings render larger than body text.
        heading = re.match(r"^(#{1,6})\s", stripped)
        if heading:
            level = len(heading.group(1))
            if level == 1:
                rows += 2.4
            elif level == 2:
                rows += 1.9
            elif level == 3:
                rows += 1.5
            else:
                rows += 1.2
            continue

        # Two-column separator (Slidev specific)
        if stripped == "::right::" or stripped == "::left::":
            rows += 0.3
            continue

        # Plain / list line: account for soft-wrap based on max_chars.
        # Use visual width approximation (CJK chars count as 2).
        visual = _visual_width(line)
        if visual > max_chars:
            has_long_line = True
        wrapped = max(1, math.ceil(visual / max(20, max_chars)))
        # List items have slight extra spacing
        if re.match(r"^\s*([-*+]|\d+\.)\s", line):
            rows += wrapped + 0.05
        else:
            rows += wrapped

    if in_code:
        # Unclosed fence — penalise so user notices.
        rows += 1

    reasons: list[str] = []
    if code_lines > 18:
        reasons.append(f"コードブロックが大きすぎる可能性 ({code_lines}行)")
    if table_rows > 8:
        reasons.append(f"テーブルの行数が多すぎる可能性 ({table_rows}行)")
    if has_long_line:
        reasons.append("折り返しが発生しうる長い行が含まれています")
    if in_mermaid_or_diagram or re.search(r"```mermaid", body):
        reasons.append("Mermaid 図はレンダリング後の高さが大きくなりがちです")

    return rows, longest, reasons


_CJK_RE = re.compile(
    r"[　-ヿ㐀-䶿一-鿿豈-﫿＀-￯]"
)


def _visual_width(text: str) -> int:
    """Approximate visual width: CJK / fullwidth characters count as 2."""
    width = 0
    for ch in text:
        if _CJK_RE.match(ch):
            width += 2
        else:
            width += 1
    return width


def _split_two_cols(body: str) -> tuple[str, str] | None:
    """Split a two-cols slide body into left/right halves if possible."""
    parts = re.split(r"^::right::\s*$", body, maxsplit=1, flags=re.MULTILINE)
    if len(parts) != 2:
        return None
    left = parts[0]
    # Also support ::left:: prefix
    left = re.sub(r"^::left::\s*$", "", left, flags=re.MULTILINE)
    return left.strip(), parts[1].strip()


def _evaluate(slide: _Slide) -> _Metrics:
    limits = LAYOUT_LIMITS.get(slide.layout, LAYOUT_LIMITS["default"])
    max_rows = limits["max_rows"]
    max_chars = limits["max_chars"]

    title = _extract_title(slide.body)

    if slide.layout in {"two-cols", "two-cols-header"}:
        cols = _split_two_cols(slide.body)
        if cols is not None:
            left_rows, left_long, left_reasons = _estimate_rows(cols[0], max_chars)
            right_rows, right_long, right_reasons = _estimate_rows(cols[1], max_chars)
            estimated = max(left_rows, right_rows)
            longest = max(left_long, right_long)
            reasons = list(dict.fromkeys(left_reasons + right_reasons))
            if slide.layout == "two-cols-header":
                # Header content lives above ::right::; subtract by adding a
                # nominal header weight back to budget.
                estimated += 2.0
        else:
            estimated, longest, reasons = _estimate_rows(slide.body, max_chars)
    else:
        estimated, longest, reasons = _estimate_rows(slide.body, max_chars)

    overflows = estimated > max_rows or longest > max_chars * 1.6

    suggestions: list[str] = []
    if overflows:
        suggestions.append("内容を 2 枚以上のスライドに分割する")
        suggestions.append("箇条書きを最大 5-6 項目に絞り、語尾や修飾語を削る")
        if any("コードブロック" in r for r in reasons):
            suggestions.append("コードを抜粋・要約するか、別スライドに切り出す")
        if any("テーブル" in r for r in reasons):
            suggestions.append("テーブルの行/列を減らすか、要点だけにする")
        if any("Mermaid" in r for r in reasons):
            suggestions.append("Mermaid 図を簡素化するか、別スライドに分離する")
        if longest > max_chars * 1.6:
            suggestions.append(f"1 行が長すぎます (max {max_chars} 推奨)。改行や要約で短縮")
        if slide.layout == "default" and estimated > max_rows:
            suggestions.append("レイアウトを two-cols / two-cols-header に変更し横展開する")

    return _Metrics(
        index=slide.index,
        layout=slide.layout,
        estimated_rows=estimated,
        max_rows=max_rows,
        longest_line_chars=longest,
        max_chars=max_chars,
        overflows=overflows,
        reasons=reasons,
        suggestions=suggestions,
        title=title,
    )


@tool
def validate_slides_fit(
    output_path: str = "./output/slides.md",
    slides_content: str | None = None,
) -> dict[str, Any]:
    """
    Validate that each generated Slidev slide is likely to fit within the
    default 16:9 canvas. Use this AFTER `write_slidev_markdown` and, if any
    slide overflows, regenerate the offending slides more concisely and
    re-save before stopping.

    Args:
        output_path: Path to the saved Slidev markdown to validate.
            Ignored if `slides_content` is provided.
        slides_content: Optional raw Slidev markdown to validate directly,
            useful for pre-flight checks before writing to disk.

    Returns:
        A dictionary containing:
        - success: True if validation completed (does NOT mean all slides fit)
        - all_fit: True only when every slide is within its budget
        - total_slides: total number of slides analysed
        - overflow_count: number of slides flagged as likely overflowing
        - overflow_slide_indices: 1-based indices of slides to regenerate
        - slides: per-slide metrics (layout, estimated_rows, reasons, suggestions)
        - message: human-readable summary
    """
    try:
        if slides_content is None:
            markdown = _read_markdown(output_path)
            if markdown is None:
                return {
                    "success": False,
                    "all_fit": False,
                    "message": f"File not found or unreadable: {output_path}",
                    "total_slides": 0,
                    "overflow_count": 0,
                    "overflow_slide_indices": [],
                    "slides": [],
                }
        else:
            markdown = slides_content

        slides = _parse_slides(markdown)
        if not slides:
            return {
                "success": False,
                "all_fit": False,
                "message": "No slides found in the document.",
                "total_slides": 0,
                "overflow_count": 0,
                "overflow_slide_indices": [],
                "slides": [],
            }

        metrics = [_evaluate(s) for s in slides]
        overflow = [m for m in metrics if m.overflows]

        if overflow:
            preview = ", ".join(f"#{m.index}({m.layout})" for m in overflow[:5])
            message = (
                f"{len(overflow)}/{len(metrics)} 枚が枠内に収まらない可能性があります: "
                f"{preview}{'...' if len(overflow) > 5 else ''}. "
                "該当スライドを分割・要約して再生成してください。"
            )
        else:
            message = f"全 {len(metrics)} 枚が枠内に収まる見込みです。"

        return {
            "success": True,
            "all_fit": not overflow,
            "total_slides": len(metrics),
            "overflow_count": len(overflow),
            "overflow_slide_indices": [m.index for m in overflow],
            "slides": [m.to_dict() for m in metrics],
            "message": message,
        }
    except Exception as e:  # pragma: no cover - defensive
        return {
            "success": False,
            "all_fit": False,
            "message": f"Validation failed: {e}",
            "total_slides": 0,
            "overflow_count": 0,
            "overflow_slide_indices": [],
            "slides": [],
        }
