import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as agentcore from '@aws-cdk/aws-bedrock-agentcore-alpha';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface SlidevAgentRuntimeStackProps extends cdk.StackProps {
  /** Amplify Storage bucket name. Optional — granted PutObject on jobs/* if set. */
  readonly slidesBucketName?: string;
  /** Secrets Manager secret name holding the Tavily API key. */
  readonly tavilySecretName: string;
  /** Bedrock model id used by the agent (Claude Opus 4.6 etc.). */
  readonly bedrockModelId: string;
}

/**
 * Deploys the Slidev Agent as a Bedrock AgentCore Runtime.
 *
 * Resources created:
 *  - ECR container image (built from ../Dockerfile)
 *  - AgentCore Runtime (IAM auth, public network)
 *  - Execution role baseline + Bedrock InvokeModel + Secrets Manager + S3 PutObject
 *  - SSM Parameter exposing the runtime ARN to Amplify
 *  - CFN output for the runtime ARN
 */
export class SlidevAgentRuntimeStack extends cdk.Stack {
  public readonly runtime: agentcore.Runtime;
  public readonly runtimeArnParameter: ssm.StringParameter;

  constructor(scope: Construct, id: string, props: SlidevAgentRuntimeStackProps) {
    super(scope, id, props);

    const projectRoot = path.resolve(__dirname, '..', '..');

    // ECR image asset built from the project root Dockerfile.
    // The asset publisher pushes to a CDK-managed repository.
    const artifact = agentcore.AgentRuntimeArtifact.fromAsset(projectRoot);

    this.runtime = new agentcore.Runtime(this, 'SlidevAgentRuntime', {
      runtimeName: 'slidev_agent',
      description: 'Slidev presentation generator (Strands Graph multi-agent)',
      agentRuntimeArtifact: artifact,
      // IAM auth is the default — Lambda invokes via SigV4.
      networkConfiguration: agentcore.RuntimeNetworkConfiguration.usingPublicNetwork(),
      environmentVariables: {
        BEDROCK_MODEL_ID: props.bedrockModelId,
        AWS_REGION: this.region,
        MODEL_PROVIDER: 'bedrock',
        // Tavily key is fetched via boto3 inside the agent (Secrets Manager).
        TAVILY_SECRET_NAME: props.tavilySecretName,
        ...(props.slidesBucketName ? { SLIDES_BUCKET: props.slidesBucketName } : {}),
      },
      lifecycleConfiguration: {
        idleRuntimeSessionTimeout: cdk.Duration.minutes(30),
        maxLifetime: cdk.Duration.hours(2),
      },
    });

    // ---- Bedrock InvokeModel (Claude Opus 4.6 + cross-region inference profile) ----
    this.runtime.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'bedrock:InvokeModel',
          'bedrock:InvokeModelWithResponseStream',
        ],
        resources: ['*'],
      }),
    );

    // ---- Secrets Manager: Tavily API key ----
    this.runtime.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:${this.partition}:secretsmanager:${this.region}:${this.account}:secret:${props.tavilySecretName}*`,
        ],
      }),
    );

    // ---- S3: PutObject/GetObject on Amplify Storage bucket (if provided) ----
    if (props.slidesBucketName) {
      const bucket = s3.Bucket.fromBucketName(
        this,
        'SlidesBucketRef',
        props.slidesBucketName,
      );
      bucket.grantReadWrite(this.runtime.role!, 'jobs/*');
    }

    // ---- CloudWatch Logs (auto-created by service; keep retention reasonable) ----
    new logs.LogRetention(this, 'AgentRuntimeLogRetention', {
      logGroupName: `/aws/bedrock-agentcore/runtimes/${this.runtime.agentRuntimeId}`,
      retention: logs.RetentionDays.ONE_MONTH,
    });

    // ---- SSM Parameter for Amplify to consume ----
    this.runtimeArnParameter = new ssm.StringParameter(this, 'RuntimeArnParameter', {
      parameterName: '/slidev-agent/agent-runtime-arn',
      stringValue: this.runtime.agentRuntimeArn,
      description: 'Bedrock AgentCore Runtime ARN for the slidev-agent',
    });

    // ---- CFN outputs ----
    new cdk.CfnOutput(this, 'AgentRuntimeArn', {
      value: this.runtime.agentRuntimeArn,
      exportName: 'SlidevAgentRuntimeArn',
      description: 'Bedrock AgentCore Runtime ARN',
    });
    new cdk.CfnOutput(this, 'AgentRuntimeId', {
      value: this.runtime.agentRuntimeId,
      description: 'Bedrock AgentCore Runtime ID',
    });
    new cdk.CfnOutput(this, 'AgentRuntimeRoleArn', {
      value: this.runtime.role!.roleArn,
      description: 'Execution role for the AgentCore runtime',
    });
  }
}
