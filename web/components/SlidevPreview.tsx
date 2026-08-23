"use client";

import { useState } from "react";

const SLIDEV_URL = process.env.NEXT_PUBLIC_SLIDEV_URL ?? "http://localhost:3030";

export function SlidevPreview() {
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <div className="slidev-preview">
      <div className="slidev-preview__header">
        <span className="slidev-preview__title">Slidev プレビュー</span>
        <div className="slidev-preview__actions">
          <button
            type="button"
            className="slidev-preview__button"
            onClick={() => setReloadKey((key) => key + 1)}
          >
            再読み込み
          </button>
          <a
            className="slidev-preview__button"
            href={SLIDEV_URL}
            target="_blank"
            rel="noreferrer"
          >
            新しいタブで開く
          </a>
        </div>
      </div>
      <iframe
        key={reloadKey}
        className="slidev-preview__frame"
        src={SLIDEV_URL}
        title="Slidev preview"
      />
    </div>
  );
}
