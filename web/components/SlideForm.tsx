'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { client } from '@/lib/amplify-client';

const STYLES = ['technical', 'business', 'educational', 'pitch'] as const;
type Style = (typeof STYLES)[number];

export function SlideForm() {
  const router = useRouter();
  const [topic, setTopic] = useState('');
  const [numSlides, setNumSlides] = useState(10);
  const [style, setStyle] = useState<Style>('technical');
  const [theme, setTheme] = useState('penguin');
  const [language, setLanguage] = useState('ja');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const { data, errors } = await client.models.SlideJob.create({
        topic: topic.trim(),
        numSlides,
        style,
        theme,
        language,
        status: 'PENDING',
      });
      if (errors?.length) throw new Error(errors[0].message);
      if (!data) throw new Error('No SlideJob returned');
      router.push(`/jobs/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  return (
    <form className="card" onSubmit={submit}>
      <label htmlFor="topic">Topic</label>
      <textarea
        id="topic"
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        placeholder="例: Amazon Bedrock AgentCore の概要"
        required
      />

      <div className="row" style={{ marginTop: 16 }}>
        <div>
          <label htmlFor="num">Slides</label>
          <input
            id="num"
            type="number"
            min={3}
            max={30}
            value={numSlides}
            onChange={(e) => setNumSlides(Number(e.target.value))}
          />
        </div>
        <div>
          <label htmlFor="style">Style</label>
          <select
            id="style"
            value={style}
            onChange={(e) => setStyle(e.target.value as Style)}
          >
            {STYLES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        <div>
          <label htmlFor="theme">Theme</label>
          <input
            id="theme"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="language">Language</label>
          <select
            id="language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          >
            <option value="ja">日本語</option>
            <option value="en">English</option>
          </select>
        </div>
      </div>

      {error && (
        <p style={{ color: 'var(--bad)', marginTop: 12 }}>{error}</p>
      )}

      <div style={{ marginTop: 20 }}>
        <button type="submit" className="primary" disabled={submitting}>
          {submitting ? 'Submitting…' : 'Generate'}
        </button>
      </div>
    </form>
  );
}
