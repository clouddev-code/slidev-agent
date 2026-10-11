"""Build the generated deck into a static Slidev site on S3 for the web preview.

The Slidev toolchain (`slidev/package.json`) is installed at `SLIDEV_DIR` in the
AgentCore Runtime image. The site is uploaded next to the markdown:
`s3://bucket/jobs/{job_id}/slides.md` -> `s3://bucket/jobs/{job_id}/site/`.
"""

from __future__ import annotations

import mimetypes
import os
import re
import subprocess
import tempfile
from pathlib import Path

import boto3

SLIDEV_DIR = Path(os.getenv("SLIDEV_DIR", "/opt/slidev"))
BUILD_TIMEOUT_SECONDS = 600

# The web app serves the site with `CSP: sandbox allow-scripts` (opaque origin),
# where touching Web Storage throws SecurityError and Slidev renders nothing.
# Replace the throwing storages with in-memory ones before any bundle runs.
_STORAGE_SHIM = (
    "<script>(()=>{for(const n of[\"localStorage\",\"sessionStorage\"]){"
    "try{window[n]}catch{const m=new Map();"
    "Object.defineProperty(window,n,{configurable:true,value:{"
    "get length(){return m.size},key:i=>[...m.keys()][i]??null,"
    "getItem:k=>m.has(String(k))?m.get(String(k)):null,"
    "setItem:(k,v)=>{m.set(String(k),String(v))},"
    "removeItem:k=>{m.delete(String(k))},clear:()=>{m.clear()}}})}}})()</script>"
)


def inject_storage_shim(index_html: str) -> str:
    """Insert the Web Storage shim as the first element of `<head>`."""
    patched, count = re.subn(
        r"<head[^>]*>", lambda m: m.group(0) + _STORAGE_SHIM, index_html, count=1
    )
    if not count:
        raise RuntimeError("slidev build output has no <head> to inject the storage shim")
    return patched


def build_site(markdown_uri: str, base: str) -> str:
    """Run `slidev build` for an S3 markdown file and upload the site.

    `base` is the URL path the site is served under (must end with `/`).
    Returns the S3 URI prefix of the uploaded site.
    """
    if not markdown_uri.startswith("s3://"):
        raise ValueError(f"preview build needs an s3:// markdown path: {markdown_uri}")
    bucket, key = markdown_uri.removeprefix("s3://").split("/", 1)
    prefix = f"{key.rsplit('/', 1)[0]}/site/"
    s3 = boto3.client("s3")

    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        # Themes/addons resolve from the deck's directory.
        (work / "node_modules").symlink_to(SLIDEV_DIR / "node_modules")
        # slidev-theme-penguin's CSS fails lightningcss minification.
        (work / "vite.config.mjs").write_text(
            'export default { build: { cssMinify: "esbuild" } }\n'
        )
        s3.download_file(bucket, key, str(work / "slides.md"))

        proc = subprocess.run(
            [
                "node",
                str(SLIDEV_DIR / "node_modules/@slidev/cli/bin/slidev.mjs"),
                "build",
                "slides.md",
                "--base",
                base,
                "--out",
                "dist",
            ],
            cwd=work,
            capture_output=True,
            text=True,
            timeout=BUILD_TIMEOUT_SECONDS,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"slidev build failed: {(proc.stderr or proc.stdout)[-1000:]}")

        dist = work / "dist"
        index = dist / "index.html"
        index.write_text(inject_storage_shim(index.read_text()))
        for path in dist.rglob("*"):
            if not path.is_file():
                continue
            content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            s3.upload_file(
                str(path),
                bucket,
                prefix + path.relative_to(dist).as_posix(),
                ExtraArgs={"ContentType": content_type},
            )

    return f"s3://{bucket}/{prefix}"
