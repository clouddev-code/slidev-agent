'use client';

import { useEffect, useState } from 'react';
import { client } from '@/lib/amplify-client';
import { getUrl } from 'aws-amplify/storage';
import { SlidevPreview } from './SlidevPreview';

type JobStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';

interface JobView {
  id: string;
  topic: string;
  status: JobStatus;
  logs: (string | null)[] | null | undefined;
  s3Key?: string | null;
  errorMessage?: string | null;
  theme?: string | null;
  numSlides?: number | null;
  style?: string | null;
}

export function JobProgress({ id }: { id: string }) {
  const [job, setJob] = useState<JobView | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  useEffect(() => {
    const sub = client.models.SlideJob.observeQuery({
      filter: { id: { eq: id } },
    }).subscribe({
      next: ({ items }) => {
        const item = items[0];
        if (item) {
          setJob({
            id: item.id,
            topic: item.topic,
            status: (item.status ?? 'PENDING') as JobStatus,
            logs: item.logs,
            s3Key: item.s3Key,
            errorMessage: item.errorMessage,
            theme: item.theme,
            numSlides: item.numSlides,
            style: item.style,
          });
        }
      },
    });
    return () => sub.unsubscribe();
  }, [id]);

  useEffect(() => {
    if (job?.status === 'DONE' && job.s3Key) {
      getUrl({ path: job.s3Key, options: { expiresIn: 600 } })
        .then((r) => setDownloadUrl(r.url.toString()))
        .catch(() => setDownloadUrl(null));
    }
  }, [job?.status, job?.s3Key]);

  if (!job) {
    return <p className="muted">Loading…</p>;
  }

  const logs = (job.logs ?? []).filter((s): s is string => Boolean(s));

  return (
    <>
      <section className="card">
        <h3 style={{ marginTop: 0 }}>{job.topic}</h3>
        <p>
          <span className={`status ${job.status}`}>{job.status}</span>{' '}
          <span className="muted">
            {job.numSlides ?? '?'} slides · style: {job.style ?? '-'} · theme:{' '}
            {job.theme ?? '-'}
          </span>
        </p>

        {job.errorMessage && (
          <p style={{ color: 'var(--bad)' }}>{job.errorMessage}</p>
        )}

        {downloadUrl && (
          <p>
            <a href={downloadUrl} download="slides.md">
              ⬇ slides.md をダウンロード
            </a>
          </p>
        )}
      </section>

      <section className="card">
        <h4 style={{ marginTop: 0 }}>Progress</h4>
        <div className="logs">
          {logs.length === 0
            ? '(まだログがありません)'
            : logs.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      </section>

      {job.status === 'DONE' && job.s3Key && (
        <SlidevPreview s3Key={job.s3Key} />
      )}
    </>
  );
}
