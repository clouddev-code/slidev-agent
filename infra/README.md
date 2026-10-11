# slidev-agent infra (AWS CDK)

Deploys the Slidev Agent as a **Bedrock AgentCore Runtime** using the
`aws-cdk-lib/aws-bedrockagentcore` L2 construct.

By default the agent calls **Claude Sonnet 5.5 on the Claude Platform**
(`claude-sonnet-5-5`) using Workload Identity Federation — no API key.
Set up the AWS account and Claude Console first; see
[../docs/claude-platform-sonnet-5-5-wif.md](../docs/claude-platform-sonnet-5-5-wif.md).

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

# Claude Platform WIF ids (gitignored). Replace REPLACE_ME with the values
# from Claude Console.
cp cdk.context.example.json cdk.context.json

# Bootstrap once per account/region (if not already)
npx cdk bootstrap

# Deploy the agent runtime and the frontend
# (the runtime stack creates its own slides bucket; output `SlidesBucketName`)
npx cdk deploy --all

# Agent runtime only
npx cdk deploy SlidevAgentRuntimeStack

# Or reuse an existing bucket (e.g. Amplify Gen 2 storage) instead:
npx cdk deploy --all -c slidesBucketName=<amplify-...-slidesbucket>
```

Generated slides are written to `s3://<SlidesBucketName>/jobs/<session-id>/slides.md`.
The stack-created bucket is retained on `cdk destroy`.

The stack outputs `SlidevAgentRuntimeArn` (and writes it to SSM
`/slidev-agent/agent-runtime-arn`) so the Amplify Lambda can read it at
build time.

## Frontend (SlidevAgentFrontendStack)

`web/` (Next.js, `output: 'standalone'`) runs on Lambda (arm64, container
image) with [Lambda Web Adapter](https://github.com/awslabs/aws-lambda-web-adapter)
behind a Function URL in response-streaming mode. `/api/copilotkit` relays
chat runs to the AgentCore Runtime (`web/lib/agentcore-agent.ts`).

- Login: Cognito managed login (authorization code + PKCE). `web/proxy.ts`
  checks the ID token cookie on every route except `/api/auth/*` and
  `/api/health`. The Function URL itself is public (`AuthType: NONE`).
- Self sign-up is disabled. Create users yourself:
  ```fish
  set -x POOL_ID (aws cloudformation describe-stacks --stack-name SlidevAgentFrontendStack --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text)
  aws cognito-idp admin-create-user --user-pool-id $POOL_ID --username you@example.com --user-attributes Name=email,Value=you@example.com Name=email_verified,Value=true
  ```
  A temporary password is emailed; you set a new one at first login.
- Open the `WebUrl` output.
- Preview: after generation the runtime runs `slidev build` (toolchain in
  `slidev/package.json`, baked into the runtime image) and uploads the site to
  `s3://<SlidesBucketName>/jobs/<run-id>/site/`. The frontend serves it at
  `/api/slides/<run-id>/` behind the same login.
- Limits: generation plus the preview build must finish within the Lambda
  timeout (15 min).
- The frontend stack imports the runtime ARN (`Fn::ImportValue`). If a change
  would replace the AgentCore Runtime, deploy fails while the import exists —
  destroy/redeploy the frontend stack around it.

## Context options

| key                | default                                | meaning                                  |
|--------------------|----------------------------------------|------------------------------------------|
| `slidesBucketName` | (none → stack creates a bucket)        | Existing S3 bucket to use instead        |
| `tavilySecretName` | `slidev-agent/TAVILY_API_KEY`          | Secrets Manager secret name              |
| `modelProvider`    | `anthropic`                            | `anthropic` (Claude Platform / WIF) or `bedrock` |
| `anthropicModelId` | `claude-sonnet-5-5`                    | Claude API model id                      |
| `executionRoleName`| `SlidevAgentRuntimeRole` (cdk.json)    | Fixed execution role name (federation rule subject) |
| `anthropicFederationRuleId` / `anthropicOrganizationId` / `anthropicServiceAccountId` / `anthropicWorkspaceId` | (required for `anthropic`) | WIF ids, put in `cdk.context.json` |
| `bedrockModelId`   | `us.anthropic.claude-opus-4-6-v1:0`    | Bedrock model id (`modelProvider=bedrock`) |

## Iterating on the agent

Any change under `src/slidev_agent/` triggers a Docker rebuild on the next
`cdk deploy`. AgentCore creates a new immutable runtime version each time the
container image changes; the DEFAULT endpoint moves to the latest version.
