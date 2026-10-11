#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { SlidevAgentFrontendStack } from '../lib/slidev-agent-frontend-stack';
import { SlidevAgentRuntimeStack } from '../lib/slidev-agent-runtime-stack';

const app = new cdk.App();

function requiredContext(key: string): string {
  const value = app.node.tryGetContext(key);
  if (typeof value !== 'string' || value === '' || value.includes('REPLACE_ME')) {
    throw new Error(`context '${key}' を設定してください（cdk.context.json に書くか、-c ${key}=... で渡す）`);
  }
  return value;
}

// 'anthropic' (default): Claude Platform via Workload Identity Federation.
// 'bedrock': Amazon Bedrock InvokeModel.
const modelProvider = app.node.tryGetContext('modelProvider') ?? 'anthropic';
if (modelProvider !== 'anthropic' && modelProvider !== 'bedrock') {
  throw new Error(`context 'modelProvider' must be 'anthropic' or 'bedrock' (got '${modelProvider}')`);
}

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

const runtimeStack = new SlidevAgentRuntimeStack(app, 'SlidevAgentRuntimeStack', {
  env,
  description: 'Bedrock AgentCore Runtime + Execution Role for slidev-agent',
  // Optionally reuse an existing bucket (e.g. Amplify Storage):
  //   cdk deploy -c slidesBucketName=amplify-...slidesbucket
  // If omitted, the stack creates its own slides bucket.
  slidesBucketName: app.node.tryGetContext('slidesBucketName'),
  tavilyApiKey: {
    providerName: app.node.tryGetContext('tavilyApiKeyProvider') ?? 'tavily-api-key',
    // Optional: pin the read grant to the exact backing secret.
    secretArn: app.node.tryGetContext('tavilyApiKeySecretArn'),
  },
  modelProvider,
  ...(modelProvider === 'anthropic'
    ? {
        // WIF ids live in cdk.context.json (gitignored); see cdk.context.example.json.
        anthropic: {
          modelId: app.node.tryGetContext('anthropicModelId') ?? 'claude-sonnet-5-5',
          executionRoleName: requiredContext('executionRoleName'),
          federationRuleId: requiredContext('anthropicFederationRuleId'),
          organizationId: requiredContext('anthropicOrganizationId'),
          serviceAccountId: requiredContext('anthropicServiceAccountId'),
          workspaceId: requiredContext('anthropicWorkspaceId'),
        },
      }
    : {
        bedrockModelId:
          app.node.tryGetContext('bedrockModelId') ?? 'us.anthropic.claude-opus-4-6-v1:0',
      }),
});

new SlidevAgentFrontendStack(app, 'SlidevAgentFrontendStack', {
  env,
  description: 'Next.js frontend on Lambda (Lambda Web Adapter) + Cognito for slidev-agent',
  runtime: runtimeStack.runtime,
  slidesBucket: runtimeStack.slidesBucket,
});
