"use client";

import type { ReactElement } from "react";
import { useRenderTool } from "@copilotkit/react-core/v2";

const TOOL_LABELS: Record<string, string> = {
  web_search: "Web検索",
  web_extract: "ページ内容の取得",
  write_slidev_markdown: "スライドの書き出し",
  validate_slides_fit: "レイアウト検証",
};

type ToolArgs = Record<string, unknown>;

interface ToolCallRenderProps {
  name: string;
  args: ToolArgs;
  status: "inProgress" | "executing" | "complete";
  result?: string;
}

function safeParse(result: string | undefined): Record<string, unknown> | null {
  if (!result) return null;
  try {
    const parsed = JSON.parse(result);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function describeInProgress(name: string, args: ToolArgs): string {
  switch (name) {
    case "web_search": {
      const query = asString(args.query);
      return query ? `🔍 「${query}」を検索中…` : "🔍 Web検索を準備中…";
    }
    case "web_extract": {
      const url = asString(args.url);
      return url ? `📄 ${url} を取得中…` : "📄 ページ内容を取得中…";
    }
    case "write_slidev_markdown":
      return "📝 スライドを書き出し中…";
    case "validate_slides_fit":
      return "📐 スライドのレイアウトを検証中…";
    default:
      return `⚙️ ${TOOL_LABELS[name] ?? name} を実行中…`;
  }
}

function renderComplete(name: string, args: ToolArgs, result: string | undefined): ReactElement {
  const label = TOOL_LABELS[name] ?? name;
  const data = safeParse(result);

  switch (name) {
    case "web_search": {
      const results = Array.isArray(data?.results) ? (data.results as Record<string, unknown>[]) : [];
      return (
        <div className="tool-activity">
          <div className="tool-activity__title">
            ✅ {label} — {results.length}件ヒット
          </div>
          {results.length > 0 && (
            <ul className="tool-activity__list">
              {results.slice(0, 5).map((r, i) => (
                <li key={i}>
                  <a href={asString(r.url)} target="_blank" rel="noreferrer">
                    {asString(r.title) || asString(r.url)}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    }
    case "web_extract": {
      const ok = data?.success !== false;
      return (
        <div className="tool-activity">
          {ok ? "✅" : "⚠️"} {label}{ok ? "完了" : "失敗"}: {asString(args.url)}
        </div>
      );
    }
    case "write_slidev_markdown": {
      const ok = data?.success !== false;
      const content = asString(args.slides_content);
      const path = asString(data?.path);
      return (
        <div className="tool-activity">
          <div className="tool-activity__title">
            {ok ? "✅" : "⚠️"} {label}{ok ? "完了" : "失敗"}
            {path ? `（${path}）` : ""}
          </div>
          {content && <pre className="tool-activity__preview">{content}</pre>}
        </div>
      );
    }
    case "validate_slides_fit": {
      return (
        <div className="tool-activity">
          {data?.all_fit ? "✅" : "⚠️"} {asString(data?.message) ?? `${label}完了`}
        </div>
      );
    }
    default:
      return <div className="tool-activity">✅ {label}完了</div>;
  }
}

/** Registers Japanese progress/result UI for every Slidev Agent tool call in the chat stream. */
export function useSlidevToolRenderers() {
  useRenderTool(
    {
      name: "*",
      render: (props: ToolCallRenderProps) => {
        const { name, status, args, result } = props;
        if (status !== "complete") {
          return (
            <div className="tool-activity tool-activity--pending">
              <span className="tool-activity__spinner" aria-hidden="true" />
              {describeInProgress(name, args)}
            </div>
          );
        }
        return renderComplete(name, args, result);
      },
    },
    [],
  );
}
