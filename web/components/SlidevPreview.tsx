'use client';

import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { downloadData } from 'aws-amplify/storage';

/**
 * MVP preview: download slides.md text and render with react-markdown.
 * Slidev-specific syntax (`<v-click>`, `layout:` frontmatter) is left as-is
 * — this is a coarse preview, not a full Slidev render.
 */
export function SlidevPreview({ s3Key }: { s3Key: string }) {
  const [text, setText] = useState<string | null>(null);
  const [tab, setTab] = useState<'preview' | 'source'>('preview');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await downloadData({ path: s3Key }).result;
        const body = await result.body.text();
        if (!cancelled) setText(body);
      } catch (e) {
        if (!cancelled) setText(`(failed to load: ${String(e)})`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [s3Key]);

  if (text === null) {
    return (
      <section className="card">
        <p className="muted">Loading preview…</p>
      </section>
    );
  }

  // Strip the document frontmatter for the markdown preview tab
  const stripped = text.replace(/^---[\s\S]*?---\s*/, '');

  return (
    <section className="card">
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button
          type="button"
          className="primary"
          style={{ background: tab === 'preview' ? '#4f8cff' : '#1f2330' }}
          onClick={() => setTab('preview')}
        >
          Preview
        </button>
        <button
          type="button"
          className="primary"
          style={{ background: tab === 'source' ? '#4f8cff' : '#1f2330' }}
          onClick={() => setTab('source')}
        >
          Source
        </button>
      </div>
      {tab === 'preview' ? (
        <div className="preview">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{stripped}</ReactMarkdown>
        </div>
      ) : (
        <pre className="preview">{text}</pre>
      )}
    </section>
  );
}
