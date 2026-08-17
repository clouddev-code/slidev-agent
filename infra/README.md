# slidev-agent infra (AWS CDK)

Deploys the Slidev Agent as a **Bedrock AgentCore Runtime** using the
`@aws-cdk/aws-bedrock-agentcore-alpha` L2 construct.

## Prerequisites

- Node.js 20+, npm
- AWS CDK v2.1102+ (hotswap support for AgentCore Runtime)
- The IAM principal used for `cdk deploy` needs `iam:CreateServiceLinkedRole`
  for AgentCore service-linked roles.
- A container engine (Docker / Finch / Podman) for the Docker image asset build.
- `linux/arm64` target — make sure buildx/Finch is configured for cross-arch
  builds if you are on a different host arch.
- Tavily API key stored in Secrets Manager:
  ```bash
  aws secretsmanager create-secret \
    --name slidev-agent/TAVILY_API_KEY \
    --secret-string "tvly-..."
  ```

## Deploy

```bash
cd infra
npm install

# Bootstrap once per account/region (if not already)
npx cdk bootstrap

# Deploy without S3 (initial bring-up before Amplify exists)
npx cdk deploy

# After Amplify Gen 2 has provisioned its storage bucket, redeploy with the
# bucket name so the runtime gets PutObject permission and SLIDES_BUCKET env:
npx cdk deploy -c slidesBucketName=<amplify-...-slidesbucket>
```

The stack outputs `SlidevAgentRuntimeArn` (and writes it to SSM
`/slidev-agent/agent-runtime-arn`) so the Amplify Lambda can read it at
build time.

## Context options

| key                | default                                | meaning                                  |
|--------------------|----------------------------------------|------------------------------------------|
| `slidesBucketName` | (none)                                 | Amplify Storage S3 bucket name           |
| `tavilySecretName` | `slidev-agent/TAVILY_API_KEY`          | Secrets Manager secret name              |
| `bedrockModelId`   | `us.anthropic.claude-opus-4-6-v1`      | Bedrock model id for the agent           |

## Iterating on the agent

Any change under `src/slidev_agent/` triggers a Docker rebuild on the next
`cdk deploy`. AgentCore creates a new immutable runtime version each time the
container image changes; the DEFAULT endpoint moves to the latest version.
