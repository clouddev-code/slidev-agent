import {
  AbstractAgent,
  EventType,
  type BaseEvent,
  type Message,
  type RunAgentInput,
} from "@ag-ui/client";
import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import { Observable } from "rxjs";

/** Events streamed by `slidev_agent.runtime` (see src/slidev_agent/runtime.py). */
type RuntimeEvent =
  | { type: "node_start"; node_id: string }
  | { type: "node_text"; node_id: string; text: string }
  | { type: "node_done"; node_id: string }
  | { type: "result"; status: string; output_path: string }
  | { type: "preview"; site_uri: string }
  | { type: "preview_error"; message: string }
  | { type: "error"; message: string };

const NODE_LABELS: Record<string, string> = {
  planner: "構成の計画",
  researcher: "Web調査",
  writer: "スライド執筆",
  validator: "レイアウト検証",
};

// AgentCore requires runtimeSessionId to be at least 33 characters.
const MIN_SESSION_ID_LENGTH = 33;

const client = new BedrockAgentCoreClient({});

/**
 * AG-UI agent that relays a CopilotKit run to the deployed AgentCore Runtime.
 *
 * The runtime speaks its own SSE format, so each graph node is surfaced as a
 * step plus one assistant text message.
 */
export class AgentCoreRuntimeAgent extends AbstractAgent {
  private runtimeArn: string;

  constructor(runtimeArn: string) {
    super();
    this.runtimeArn = runtimeArn;
  }

  clone() {
    const cloned = super.clone();
    cloned.runtimeArn = this.runtimeArn;
    return cloned;
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      const abort = new AbortController();
      const emit = (event: BaseEvent) => subscriber.next(event);

      this.relay(input, abort.signal, emit)
        .catch((err: unknown) => {
          if (abort.signal.aborted) return;
          emit({
            type: EventType.RUN_ERROR,
            message: err instanceof Error ? err.message : String(err),
          } as BaseEvent);
        })
        .finally(() => subscriber.complete());

      return () => abort.abort();
    });
  }

  private async relay(
    input: RunAgentInput,
    signal: AbortSignal,
    emit: (event: BaseEvent) => void,
  ): Promise<void> {
    const { threadId, runId } = input;
    emit({ type: EventType.RUN_STARTED, threadId, runId } as BaseEvent);

    const topic = lastUserText(input.messages);
    if (!topic) {
      emit({ type: EventType.RUN_ERROR, message: "トピックを入力してください" } as BaseEvent);
      return;
    }

    const res = await client.send(
      new InvokeAgentRuntimeCommand({
        agentRuntimeArn: this.runtimeArn,
        runtimeSessionId: threadId.padEnd(MIN_SESSION_ID_LENGTH, "0"),
        contentType: "application/json",
        accept: "text/event-stream",
        payload: new TextEncoder().encode(
          // The runtime builds a static Slidev site served by app/api/slides.
          JSON.stringify({ topic, job_id: runId, preview_base: `/api/slides/${runId}/` }),
        ),
      }),
      { abortSignal: signal },
    );
    if (!res.response) throw new Error("AgentCore Runtime returned an empty response");

    // node_id -> open assistant message id
    const openMessages = new Map<string, string>();
    const startNode = (nodeId: string) => {
      const messageId = crypto.randomUUID();
      openMessages.set(nodeId, messageId);
      emit({ type: EventType.STEP_STARTED, stepName: nodeId } as BaseEvent);
      emit({ type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" } as BaseEvent);
      emit({
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId,
        delta: `**${NODE_LABELS[nodeId] ?? nodeId}**\n\n`,
      } as BaseEvent);
      return messageId;
    };
    const say = (text: string) => {
      const messageId = crypto.randomUUID();
      emit({ type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" } as BaseEvent);
      emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: text } as BaseEvent);
      emit({ type: EventType.TEXT_MESSAGE_END, messageId } as BaseEvent);
    };
    const endNode = (nodeId: string) => {
      const messageId = openMessages.get(nodeId);
      if (!messageId) return;
      openMessages.delete(nodeId);
      emit({ type: EventType.TEXT_MESSAGE_END, messageId } as BaseEvent);
      emit({ type: EventType.STEP_FINISHED, stepName: nodeId } as BaseEvent);
    };

    for await (const event of parseSse(res.response as AsyncIterable<Uint8Array>)) {
      switch (event.type) {
        case "node_start":
          endNode(event.node_id);
          startNode(event.node_id);
          break;
        case "node_text": {
          if (!event.text) break;
          const messageId = openMessages.get(event.node_id) ?? startNode(event.node_id);
          emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: event.text } as BaseEvent);
          break;
        }
        case "node_done":
          endNode(event.node_id);
          break;
        case "result":
          say(`スライドを生成しました: \`${event.output_path}\`\n\nプレビューを作成しています…`);
          break;
        case "preview":
          // SlidevPreview reads previewJobId from the agent state.
          emit({ type: EventType.STATE_SNAPSHOT, snapshot: { previewJobId: runId } } as BaseEvent);
          say("プレビューを表示しました。");
          break;
        case "preview_error":
          say(`プレビューの作成に失敗しました: ${event.message}`);
          break;
        case "error":
          for (const nodeId of [...openMessages.keys()]) endNode(nodeId);
          emit({ type: EventType.RUN_ERROR, message: event.message } as BaseEvent);
          return;
      }
    }

    for (const nodeId of [...openMessages.keys()]) endNode(nodeId);
    emit({ type: EventType.RUN_FINISHED, threadId, runId } as BaseEvent);
  }
}

function lastUserText(messages: Message[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "user") continue;
    const text =
      typeof message.content === "string"
        ? message.content
        : message.content
            .map((part) => (part.type === "text" ? part.text : ""))
            .join("");
    return text.trim() || undefined;
  }
  return undefined;
}

/** Parse `data: {...}` SSE lines into runtime events, skipping unknown types. */
async function* parseSse(stream: AsyncIterable<Uint8Array>): AsyncGenerator<RuntimeEvent> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const event = parseDataLine(line);
      if (event) yield event;
    }
  }
  const event = parseDataLine(buffer + decoder.decode());
  if (event) yield event;
}

function parseDataLine(line: string): RuntimeEvent | undefined {
  if (!line.startsWith("data:")) return undefined;
  try {
    const event = JSON.parse(line.slice("data:".length).trim());
    return typeof event?.type === "string" ? (event as RuntimeEvent) : undefined;
  } catch {
    return undefined;
  }
}
