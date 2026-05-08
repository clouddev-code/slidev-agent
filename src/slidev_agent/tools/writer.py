"""Slidev Markdown writer tool."""

import os
from pathlib import Path
from typing import Any

from strands import tool


@tool
def write_slidev_markdown(
    slides_content: str,
    output_path: str = "./output/slides.md",
    theme: str = "penguin",
    title: str = "Presentation",
) -> dict[str, Any]:
    """
    Write Slidev-formatted Markdown content to a file.

    Args:
        slides_content: The main content of the slides in Slidev Markdown format.
            Each slide should be separated by '---' with proper frontmatter.
            Do NOT include the initial frontmatter header - it will be added automatically.
        output_path: Path where the file will be saved. Default is './output/slides.md'.
        theme: Slidev theme to use. Default is 'default'.
            Popular themes: penguin, default, seriph, apple-basic, shibainu, bricks.
        title: Title of the presentation for metadata.

    Returns:
        A dictionary containing:
        - success: Whether the file was written successfully
        - path: The absolute path to the written file
        - message: Status message
    """
    # Create the frontmatter header
    frontmatter = f"""---
theme: {theme}
title: {title}
transition: slide-left
mdc: true
---

"""

    # Combine frontmatter with content
    full_content = frontmatter + slides_content.lstrip()

    # Ensure the output directory exists
    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)

    try:
        # Write the file
        output_file.write_text(full_content, encoding="utf-8")

        return {
            "success": True,
            "path": str(output_file.resolve()),
            "message": f"Successfully wrote {len(full_content)} characters to {output_file}",
        }
    except Exception as e:
        return {
            "success": False,
            "path": str(output_file.resolve()),
            "message": f"Failed to write file: {str(e)}",
        }
