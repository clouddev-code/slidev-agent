'use client';

import { Authenticator } from '@aws-amplify/ui-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Nav } from '@/components/Nav';
import { client } from '@/lib/amplify-client';

interface Row {
  id: string;
  topic: string;
  status: string | null | undefined;
  createdAt?: string | null;
}

export default function DashboardPage() {
  const [items, setItems] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sub = client.models.SlideJob.observeQuery().subscribe({
      next: ({ items }) => {
        const sorted = [...items].sort((a, b) =>
          (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
        );
        setItems(
          sorted.map((i) => ({
            id: i.id,
            topic: i.topic,
            status: i.status,
            createdAt: i.createdAt,
          })),
        );
        setLoading(false);
      },
    });
    return () => sub.unsubscribe();
  }, []);

  return (
    <Authenticator>
      <Nav />
      <h2>履歴</h2>
      {loading ? (
        <p className="muted">Loading…</p>
      ) : items.length === 0 ? (
        <p className="muted">
          まだ生成履歴がありません。<Link href="/generate">最初の1本を作る →</Link>
        </p>
      ) : (
        <div className="list">
          {items.map((i) => (
            <Link key={i.id} href={`/jobs/${i.id}`} className="list-item">
              <div>
                <div style={{ fontWeight: 600 }}>{i.topic}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {i.createdAt ? new Date(i.createdAt).toLocaleString() : ''}
                </div>
              </div>
              <span className={`status ${i.status ?? 'PENDING'}`}>
                {i.status ?? 'PENDING'}
              </span>
            </Link>
          ))}
        </div>
      )}
    </Authenticator>
  );
}
