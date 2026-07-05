#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { SlidevAgentRuntimeStack } from '../lib/slidev-agent-runtime-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

new SlidevAgentRuntimeStack(app, 'SlidevAgentRuntimeStack', {
  env,
  description: 'Bedrock AgentCore Runtime + Execution Role for slidev-agent',
  // Pass the Amplify Storage bucket name (or ARN prefix) at deploy time:
  //   cdk deploy -c slidesBucketName=amplify-...slidesbucket
  // If omitted, the runtime is deployed without S3 grant (you can attach it later).
  slidesBucketName: app.node.tryGetContext('slidesBucketName'),
  tavilySecretName: app.node.tryGetContext('tavilySecretName') ?? 'slidev-agent/TAVILY_API_KEY',
  bedrockModelId:
    app.node.tryGetContext('bedrockModelId') ?? 'us.anthropic.claude-opus-4-6-v1:0',
});
