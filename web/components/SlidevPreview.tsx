"use client";

import { useState } from "react";
import { UseAgentUpdate, useAgent } from "@copilotkit/react-core/v2";

// Local dev: the Slidev dev server. Deployed: unset, the built site is used.
const SLIDEV_DEV_URL = process.env.NEXT_PUBLIC_SLIDEV_URL;

export function SlidevPreview() {
  const [reloadKey, setReloadKey] = useState(0);
  const { agent } = useAgent({ agentId: "slidev-agent", updates: [UseAgentUpdate.OnStateChanged] });
  const jobId = (agent.state as { previewJobId?: string } | undefined)?.previewJobId;
  const previewUrl = jobId ? `/api/slides/${jobId}/` : SLIDEV_DEV_URL;

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
            href={previewUrl}
            target="_blank"
            rel="noreferrer"
          >
            新しいタブで開く
          </a>
        </div>
      </div>
      {previewUrl ? (
        <iframe
          key={reloadKey}
          className="slidev-preview__frame"
          src={previewUrl}
          title="Slidev preview"
          // Untrusted generated content: scripts only, opaque origin.
          sandbox={jobId ? "allow-scripts" : undefined}
        />
      ) : (
        <p className="slidev-preview__empty">スライドを生成するとここに表示されます。</p>
      )}
    </div>
  );
}
