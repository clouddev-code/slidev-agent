"use client";

import { CopilotChat } from "@copilotkit/react-core/v2";
import { useSlidevToolRenderers } from "@/components/ToolActivity";
import { SlidevPreview } from "@/components/SlidevPreview";

export default function Home() {
  useSlidevToolRenderers();

  return (
    <main className="app-layout">
      <div className="app-layout__chat">
        <CopilotChat agentId="slidev-agent" welcomeScreen={false} />
      </div>
      <SlidevPreview />
    </main>
  );
}
