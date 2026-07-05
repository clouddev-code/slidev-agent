import { defineBackend } from '@aws-amplify/backend';
import { Stack } from 'aws-cdk-lib';
import { Effect, Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { EventSourceMapping, StartingPosition } from 'aws-cdk-lib/aws-lambda';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage } from './storage/resource';
import { generateSlides } from './functions/generate-slides/resource';

const backend = defineBackend({
  auth,
  data,
  storage,
  generateSlides,
});

const lambdaFn = backend.generateSlides.resources.lambda;
const slideJobTable = backend.data.resources.tables['SlideJob'];
const tableStack = Stack.of(slideJobTable);

// ----------------------------------------------------------------------------
// 1) DynamoDB Streams → Lambda
// ----------------------------------------------------------------------------

// DescribeStream/GetRecords/GetShardIterator support resource-level scoping to
// the specific stream ARN. ListStreams is account-level only and must use `*`.
const streamPolicy = new Policy(tableStack, 'GenerateSlidesStreamPolicy', {
  statements: [
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'dynamodb:DescribeStream',
        'dynamodb:GetRecords',
        'dynamodb:GetShardIterator',
      ],
      resources: [slideJobTable.tableStreamArn!],
    }),
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['dynamodb:ListStreams'],
      resources: ['*'],
    }),
  ],
});
lambdaFn.role?.attachInlinePolicy(streamPolicy);

const mapping = new EventSourceMapping(
  tableStack,
  'SlideJobStreamMapping',
  {
    target: lambdaFn,
    eventSourceArn: slideJobTable.tableStreamArn,
    startingPosition: StartingPosition.LATEST,
    batchSize: 1,
  },
);
mapping.node.addDependency(streamPolicy);

// ----------------------------------------------------------------------------
// 2) Bedrock AgentCore InvokeAgentRuntime
// ----------------------------------------------------------------------------

lambdaFn.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: [
      'bedrock-agentcore:InvokeAgentRuntime',
      'bedrock-agentcore:InvokeAgentRuntimeForUser',
    ],
    // Constrain by env var at deploy time if you want; wildcard keeps it
    // working across runtime versions/endpoints.
    resources: ['*'],
  }),
);

// ----------------------------------------------------------------------------
// 3) AppSync mutations (updateSlideJob) — IAM auth via SigV4
// ----------------------------------------------------------------------------

const apiId = backend.data.resources.cfnResources.cfnGraphqlApi.attrApiId;
lambdaFn.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ['appsync:GraphQL'],
    resources: [
      `arn:aws:appsync:${tableStack.region}:${tableStack.account}:apis/${apiId}/*`,
    ],
  }),
);

// ----------------------------------------------------------------------------
// 4) Lambda environment
// ----------------------------------------------------------------------------

lambdaFn.addEnvironment(
  'APPSYNC_API_URL',
  backend.data.resources.cfnResources.cfnGraphqlApi.attrGraphQlUrl,
);
lambdaFn.addEnvironment(
  'SLIDES_BUCKET',
  backend.storage.resources.bucket.bucketName,
);

export default backend;
