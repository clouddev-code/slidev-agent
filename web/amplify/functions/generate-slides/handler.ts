/**
 * generate-slides Lambda
 *
 * Triggered by DynamoDB Streams on the `SlideJob` table.
 * For every newly inserted SlideJob:
 *   1. Update status PENDING → RUNNING
 *   2. Invoke Bedrock AgentCore Runtime (slidev-agent), streaming SSE chunks
 *   3. Append every meaningful event to `SlideJob.logs`
 *   4. On completion, set status DONE + s3Key (or FAILED + errorMessage)
 *
 * AppSync mutations are sent over IAM-signed GraphQL using fetch + SigV4
 * (kept dependency-free; aws-amplify on Node would be heavier).
 */

import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from '@aws-sdk/client-bedrock-agentcore';
import type { DynamoDBStreamHandler, DynamoDBRecord } from 'aws-lambda';
import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { SignatureV4 } from '@smithy/signature-v4';
import { HttpRequest } from '@smithy/protocol-http';

const REGION =
  process.env.AWS_REGION_AGENTCORE || process.env.AWS_REGION || 'us-east-1';
const RUNTIME_ARN = process.env.AGENT_RUNTIME_ARN;
const APPSYNC_URL = process.env.APPSYNC_API_URL;
const SLIDES_BUCKET = process.env.SLIDES_BUCKET;

const agentcore = new BedrockAgentCoreClient({ region: REGION });

// --- AppSync helpers --------------------------------------------------------

interface SlideJobUpdate {
  id: string;
  status?: 'RUNNING' | 'DONE' | 'FAILED';
  s3Key?: string;
  logs?: string[];
  errorMessage?: string;
}

const UPDATE_MUTATION = /* GraphQL */ `
  mutation UpdateSlideJob($input: UpdateSlideJobInput!) {
    updateSlideJob(input: $input) {
      id
      status
    }
  }
`;

async function appsyncMutate(
  query: string,
  variables: Record<string, unknown>,
): Promise<void> {
  if (!APPSYNC_URL) throw new Error('APPSYNC_API_URL env not set');
  const url = new URL(APPSYNC_URL);
  const body = JSON.stringify({ query, variables });
  const request = new HttpRequest({
    hostname: url.hostname,
    path: url.pathname,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host: url.hostname,
    },
    body,
  });
  const signer = new SignatureV4({
    credentials: defaultProvider(),
    region: REGION,
    service: 'appsync',
    sha256: Sha256,
  });
  const signed = await signer.sign(request);
  const res = await fetch(`https://${signed.hostname}${signed.path}`, {
    method: 'POST',
    headers: signed.headers as Record<string, string>,
    body: signed.body as string,
  });
  if (!res.ok) {
    throw new Error(
      `AppSync mutation failed (${res.status}): ${await res.text()}`,
    );
  }
  const json = (await res.json()) as { errors?: unknown };
  if (json.errors) {
    throw new Error(`AppSync mutation errors: ${JSON.stringify(json.errors)}`);
  }
}

async function updateJob(input: SlideJobUpdate): Promise<void> {
  await appsyncMutate(UPDATE_MUTATION, { input });
}

// --- DynamoDB stream record → SlideJob view --------------------------------

interface SlideJobInput {
  id: string;
  topic: string;
  numSlides: number;
  style: string;
  theme: string;
  language: string;
  status: string;
  owner?: string;
}

function fromImage(image: Record<string, unknown> | undefined): SlideJobInput | null {
  if (!image) return null;
  const get = (k: string): string | undefined => {
    const v = image[k] as Record<string, string> | undefined;
    if (!v) return undefined;
    return v.S ?? v.N ?? undefined;
  };
  const id = get('id');
  const topic = get('topic');
  if (!id || !topic) return null;
  return {
    id,
    topic,
    numSlides: Number(get('numSlides') ?? '10'),
    style: get('style') ?? 'technical',
    theme: get('theme') ?? 'penguin',
    language: get('language') ?? 'ja',
    status: get('status') ?? 'PENDING',
    owner: get('owner'),
  };
}

// --- Run a single job through AgentCore -----------------------------------

async function runJob(job: SlideJobInput): Promise<void> {
  if (!RUNTIME_ARN) throw new Error('AGENT_RUNTIME_ARN env not set');
  if (!SLIDES_BUCKET) throw new Error('SLIDES_BUCKET env not set');

  const sessionId = `slidev-${job.id}-${Math.random().toString(36).slice(2, 12)}`.padEnd(34, '0');
  const s3Key = `jobs/${job.id}/slides.md`;
  const outputUri = `s3://${SLIDES_BUCKET}/${s3Key}`;

  await updateJob({
    id: job.id,
    status: 'RUNNING',
    logs: [`▸ Invoking AgentCore Runtime (session ${sessionId})`],
  });

  const cmd = new InvokeAgentRuntimeCommand({
    agentRuntimeArn: RUNTIME_ARN,
    runtimeSessionId: sessionId,
    payload: new TextEncoder().encode(
      JSON.stringify({
        topic: job.topic,
        num_slides: job.numSlides,
        style: job.style,
        theme: job.theme,
        language: job.language,
        job_id: job.id,
        output_path: outputUri,
        user_id: job.owner,
      }),
    ),
    contentType: 'application/json',
    accept: 'text/event-stream',
  });

  const collectedLogs: string[] = [];
  const flush = async (): Promise<void> => {
    if (collectedLogs.length === 0) return;
    const batch = collectedLogs.splice(0, collectedLogs.length);
    await updateJob({ id: job.id, logs: batch });
  };

  try {
    const response = await agentcore.send(cmd);
    if (!response.response) {
      throw new Error('AgentCore returned no response stream');
    }
    let buffer = '';
    let lastFlush = Date.now();
    for await (const chunk of response.response as AsyncIterable<Uint8Array>) {
      buffer += new TextDecoder().decode(chunk);
      // SSE event boundary is a blank line
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLine = block
          .split('\n')
          .find((l) => l.startsWith('data:'));
        if (!dataLine) continue;
        const payload = dataLine.replace(/^data:\s?/, '').trim();
        if (!payload) continue;
        try {
          const evt = JSON.parse(payload) as {
            type?: string;
            node_id?: string;
            text?: string;
            message?: string;
            output_path?: string;
            status?: string;
          };
          const log = formatEvent(evt);
          if (log) collectedLogs.push(log);
          if (evt.type === 'error' && evt.message) {
            throw new Error(evt.message);
          }
        } catch (parseErr) {
          // Plain text chunk
          collectedLogs.push(payload.slice(0, 200));
        }
      }
      if (Date.now() - lastFlush > 1500) {
        await flush();
        lastFlush = Date.now();
      }
    }
    await flush();
    await updateJob({
      id: job.id,
      status: 'DONE',
      s3Key,
      logs: ['✓ Generation complete'],
    });
  } catch (err) {
    await flush();
    const message = err instanceof Error ? err.message : String(err);
    await updateJob({
      id: job.id,
      status: 'FAILED',
      errorMessage: message.slice(0, 800),
      logs: [`✗ ${message.slice(0, 200)}`],
    });
    throw err;
  }
}

function formatEvent(evt: {
  type?: string;
  node_id?: string;
  text?: string;
  message?: string;
  output_path?: string;
  status?: string;
}): string | null {
  switch (evt.type) {
    case 'node_start':
      return `▸ ${evt.node_id} started`;
    case 'node_done':
      return `✓ ${evt.node_id} done`;
    case 'node_text':
      if (!evt.text) return null;
      return `${evt.node_id}: ${evt.text.slice(0, 160)}`;
    case 'result':
      return `✓ result: ${evt.status ?? 'completed'} (${evt.output_path ?? ''})`;
    case 'error':
      return `✗ ${evt.message ?? 'error'}`;
    default:
      return null;
  }
}

// --- Lambda entrypoint ------------------------------------------------------

export const handler: DynamoDBStreamHandler = async (event) => {
  for (const record of event.Records as DynamoDBRecord[]) {
    if (record.eventName !== 'INSERT') continue;
    const newImage = record.dynamodb?.NewImage as
      | Record<string, unknown>
      | undefined;
    const job = fromImage(newImage);
    if (!job) continue;
    if (job.status !== 'PENDING') continue;
    try {
      await runJob(job);
    } catch (err) {
      console.error(`Job ${job.id} failed:`, err);
    }
  }
};
