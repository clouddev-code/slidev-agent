import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * Lambda triggered by DynamoDB Streams (`SlideJob` INSERT/MODIFY).
 * Invokes Bedrock AgentCore Runtime via SigV4, then drives the SlideJob
 * record through RUNNING → DONE/FAILED with progressive log appends.
 */
export const generateSlides = defineFunction({
  name: 'generate-slides',
  entry: './handler.ts',
  timeoutSeconds: 900,
  memoryMB: 1024,
  runtime: 20,
  // Co-locate with the data stack so DynamoDB Streams wiring is in-stack.
  resourceGroupName: 'data',
  environment: {
    AGENT_RUNTIME_ARN: secret('AGENT_RUNTIME_ARN'),
    AWS_REGION_AGENTCORE: 'us-east-1',
  },
});
