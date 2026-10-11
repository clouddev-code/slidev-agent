import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";
import { NextRequest } from "next/server";
import { AgentCoreRuntimeAgent } from "@/lib/agentcore-agent";

const serviceAdapter = new ExperimentalEmptyAdapter();

// Deployed: relay to the AgentCore Runtime. Local: the AG-UI dev server.
const slidevAgent = process.env.AGENT_RUNTIME_ARN
  ? new AgentCoreRuntimeAgent(process.env.AGENT_RUNTIME_ARN)
  : new HttpAgent({ url: process.env.AGENT_URL ?? "http://localhost:8000/" });

const runtime = new CopilotRuntime({
  agents: {
    "slidev-agent": slidevAgent,
  },
});

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};
