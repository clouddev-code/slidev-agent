import Link from 'next/link';
import { Nav } from '@/components/Nav';

export default function Home() {
  return (
    <>
      <Nav />
      <section className="card">
        <h2>自然言語からSlidevプレゼンを自動生成</h2>
        <p className="muted">
          トピックを入れるだけで、Strands Agents のマルチエージェントが
          Web 検索 → スライド構成 → Slidev Markdown 生成 →
          16:9 枠内検証 まで自動でやります。
        </p>
        <p>
          <Link href="/generate" className="primary" style={{ display: 'inline-block', padding: '10px 18px', background: '#4f8cff', color: 'white', borderRadius: 8 }}>
            生成をはじめる →
          </Link>
        </p>
      </section>

      <section className="card">
        <h3>Architecture</h3>
        <ul>
          <li>Bedrock AgentCore Runtime — Strands Graph (planner → researcher → writer → validator)</li>
          <li>Amplify Gen 2 (Cognito + AppSync + S3)</li>
          <li>DynamoDB Streams で非同期キック / AppSync subscription で進捗反映</li>
        </ul>
      </section>
    </>
  );
}
