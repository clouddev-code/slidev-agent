"use client";

import { CopilotChat } from "@copilotkit/react-core/v2";
import { useSlidevToolRenderers } from "@/components/ToolActivity";

export default function Home() {
  useSlidevToolRenderers();

  return (
    <main style={{ height: "100vh" }}>
      <CopilotChat agentId="slidev-agent" welcomeScreen={false} />
    </main>
  );
}
