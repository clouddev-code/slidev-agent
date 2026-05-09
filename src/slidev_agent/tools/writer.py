"""Slidev Markdown writer tool.

Writes generated Slidev presentations either to local disk or S3.
The path is auto-detected from the URI scheme (`s3://...` triggers S3
upload via boto3, otherwise treated as a local filesystem path).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from strands import tool


def _build_full_content(slides_content: str, theme: str, title: str) -> str:
    frontmatter = (
        "---\n"
        f"theme: {theme}\n"
        f"title: {title}\n"
        "transition: slide-left\n"
        "mdc: true\n"
        "---\n\n"
    )
    return frontmatter + slides_content.lstrip()


def _write_s3(uri: str, body: str) -> dict[str, Any]:
    import boto3

    parsed = urlparse(uri)
    bucket = parsed.netloc
    key = parsed.path.lstrip("/")
    if not bucket or not key:
        return {
            "success": False,
            "path": uri,
            "message": f"Invalid S3 URI: {uri}",
        }

    s3 = boto3.client("s3")
    s3.put_object(
        Bucket=bucket,
        Key=key,
        Body=body.encode("utf-8"),
        ContentType="text/markdown; charset=utf-8",
    )
    return {
        "success": True,
        "path": uri,
        "bytes": len(body),
        "message": f"Successfully wrote {len(body)} characters to s3://{bucket}/{key}",
    }


def _write_local(path_str: str, body: str) -> dict[str, Any]:
    output_file = Path(path_str)
    output_file.parent.mkdir(parents=True, exist_ok=True)
    output_file.write_text(body, encoding="utf-8")
    return {
        "success": True,
        "path": str(output_file.resolve()),
        "bytes": len(body),
        "message": f"Successfully wrote {len(body)} characters to {output_file}",
    }


@tool
def write_slidev_markdown(
    slides_content: str,
    output_path: str = "./output/slides.md",
    theme: str = "penguin",
    title: str = "Presentation",
) -> dict[str, Any]:
    """
    Write Slidev-formatted Markdown content to either S3 or the local filesystem.

    Args:
        slides_content: The main content of the slides in Slidev Markdown format.
            Each slide should be separated by '---' with proper frontmatter.
            Do NOT include the initial frontmatter header - it will be added automatically.
        output_path: Either an `s3://bucket/key` URI or a local path.
            Defaults to './output/slides.md' for CLI usage.
        theme: Slidev theme to use. Default is 'penguin'.
            Popular themes: penguin, default, seriph, apple-basic, shibainu, bricks.
        title: Title of the presentation for metadata.

    Returns:
        A dictionary containing:
        - success: Whether the file was written successfully
        - path: The absolute path or s3 URI
        - bytes: Bytes written
        - message: Status message
    """
    full_content = _build_full_content(slides_content, theme, title)
    try:
        if output_path.startswith("s3://"):
            return _write_s3(output_path, full_content)
        return _write_local(output_path, full_content)
    except Exception as e:  # pragma: no cover - defensive
        return {
            "success": False,
            "path": output_path,
            "message": f"Failed to write file: {e}",
        }
