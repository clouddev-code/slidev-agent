import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface SlidevAgentRuntimeStackProps extends cdk.StackProps {
  /**
   * Existing bucket (e.g. Amplify Storage) for generated slides. If omitted,
   * the stack creates its own bucket. Either way the runtime gets read/write
   * on `jobs/*`.
   */
  readonly slidesBucketName?: string;
  /** AgentCore Identity API key credential provider holding the Tavily key. */
  readonly tavilyApiKey: TavilyApiKeyProps;
  /** Model backend. `anthropic` = Claude Platform via Workload Identity Federation. */
  readonly modelProvider: 'anthropic' | 'bedrock';
  /** Bedrock model id. Required when `modelProvider` is `bedrock`. */
  readonly bedrockModelId?: string;
  /** Claude Platform settings. Required when `modelProvider` is `anthropic`. */
  readonly anthropic?: AnthropicWifProps;
}

export interface TavilyApiKeyProps {
  /** Credential provider name (e.g. `tavily-api-key`). */
  readonly providerName: string;
  /**
   * ARN of the provider's backing secret (`apiKeySecretArn` from
   * `get-api-key-credential-provider`). Defaults to a prefix match on the
   * provider's secret name, which survives re-creating the provider (the
   * random suffix changes).
   */
  readonly secretArn?: string;
}

export interface AnthropicWifProps {
  /** Claude API model id (e.g. `claude-sonnet-5-5`). */
  readonly modelId: string;
  /**
   * Fixed execution role name, so the role ARN can be registered as the
   * federation rule subject in Claude Console before the first deploy.
   */
  readonly executionRoleName: string;
  readonly federationRuleId: string;
  readonly organizationId: string;
  readonly serviceAccountId: string;
  readonly workspaceId: string;
}

/**
 * Deploys the Slidev Agent as a Bedrock AgentCore Runtime.
 *
 * Resources created:
 *  - ECR container image (built from ../Dockerfile)
 *  - AgentCore Runtime (IAM auth, public network)
 *  - Execution role baseline + model access (STS GetWebIdentityToken for the
 *    Claude Platform, or Bedrock InvokeModel) + AgentCore Identity API key + S3 PutObject
 *  - S3 bucket for generated slides (unless `slidesBucketName` is given)
 *  - SSM Parameter exposing the runtime ARN to Amplify
 *  - CFN output for the runtime ARN
 */
export class SlidevAgentRuntimeStack extends cdk.Stack {
  public readonly runtime: agentcore.Runtime;
  public readonly runtimeArnParameter: ssm.StringParameter;
  public readonly slidesBucket: s3.IBucket;

  constructor(scope: Construct, id: string, props: SlidevAgentRuntimeStackProps) {
    super(scope, id, props);

    const projectRoot = path.resolve(__dirname, '..', '..');

    // ECR image asset built from the project root Dockerfile.
    // The asset publisher pushes to a CDK-managed repository.
    const artifact = agentcore.AgentRuntimeArtifact.fromAsset(projectRoot);

    // ---- S3: generated slides (jobs/{job_id}/slides.md) ----
    // Retained on stack deletion so generated decks are not lost.
    this.slidesBucket = props.slidesBucketName
      ? s3.Bucket.fromBucketName(this, 'SlidesBucketRef', props.slidesBucketName)
      : new s3.Bucket(this, 'SlidesBucket', {
          // Account + region suffix keeps the name globally unique.
          bucketName: `slidev-agent-slides-${this.account}-${this.region}`,
          blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
          encryption: s3.BucketEncryption.S3_MANAGED,
          enforceSSL: true,
          removalPolicy: cdk.RemovalPolicy.RETAIN,
        });

    this.runtime = new agentcore.Runtime(this, 'SlidevAgentRuntime', {
      runtimeName: 'slidev_agent',
      description: 'Slidev presentation generator (Strands Graph multi-agent)',
      agentRuntimeArtifact: artifact,
      // IAM auth is the default — Lambda invokes via SigV4.
      networkConfiguration: agentcore.RuntimeNetworkConfiguration.usingPublicNetwork(),
      environmentVariables: {
        AWS_REGION: this.region,
        MODEL_PROVIDER: props.modelProvider,
        ...this.modelEnvironment(props),
        // Tavily key is fetched from AgentCore Identity inside the agent.
        TAVILY_API_KEY_PROVIDER: props.tavilyApiKey.providerName,
        SLIDES_BUCKET: this.slidesBucket.bucketName,
      },
      lifecycleConfiguration: {
        idleRuntimeSessionTimeout: cdk.Duration.minutes(30),
        maxLifetime: cdk.Duration.hours(2),
      },
    });

    if (props.modelProvider === 'anthropic') {
      // ---- Claude Platform via Workload Identity Federation ----
      // Fix the execution role name so its ARN (the STS token `sub`) can be
      // registered in the Claude Console federation rule before deploying.
      const cfnRole = this.runtime.role.node.defaultChild as iam.CfnRole;
      cfnRole.roleName = props.anthropic!.executionRoleName;

      // AWS-signed OIDC token exchanged for a Claude API access token.
      this.runtime.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['sts:GetWebIdentityToken'],
          resources: ['*'],
        }),
      );
    } else {
      // ---- Bedrock InvokeModel (cross-region inference profile) ----
      // Cross-region (system) inference profiles like `us.anthropic...` require both
      // the inference-profile ARN and the underlying foundation-model ARN across the
      // regions the profile spans. Strip the regional prefix when building the
      // foundation-model ARN, and use `*` only on the region segment.
      const bedrockModelId = props.bedrockModelId!;
      const foundationModelId = bedrockModelId.replace(/^(us|eu|apac)\./, '');
      this.runtime.addToRolePolicy(
        new iam.PolicyStatement({
          actions: [
            'bedrock:InvokeModel',
            'bedrock:InvokeModelWithResponseStream',
          ],
          resources: [
            `arn:${this.partition}:bedrock:*::foundation-model/${foundationModelId}`,
            `arn:${this.partition}:bedrock:${this.region}:${this.account}:inference-profile/${bedrockModelId}`,
          ],
        }),
      );
    }

    // ---- AgentCore Identity: Tavily API key ----
    // GetResourceApiKey + read on the provider's backing secret. The workload
    // access token it needs is only injected when the caller passes
    // runtimeUserId (see the frontend stack).
    const { providerName, secretArn } = props.tavilyApiKey;
    agentcore.ApiKeyCredentialProvider.fromApiKeyCredentialProviderAttributes(
      this,
      'TavilyApiKeyProvider',
      {
        credentialProviderArn: `arn:${this.partition}:bedrock-agentcore:${this.region}:${this.account}:token-vault/default/apikeycredentialprovider/${providerName}`,
        apiKeySecretArn: secretArn,
      },
    ).grantUse(this.runtime);
    if (!secretArn) {
      // grantUse widens a tokenized ARN to every Identity secret, so grant
      // the prefix match on this provider's secret here instead.
      this.runtime.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
          resources: [
            `arn:${this.partition}:secretsmanager:${this.region}:${this.account}:secret:bedrock-agentcore-identity!default/apikey/${providerName}-*`,
          ],
        }),
      );
    }

    this.slidesBucket.grantReadWrite(this.runtime.role, 'jobs/*');

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
    new cdk.CfnOutput(this, 'SlidesBucketName', {
      value: this.slidesBucket.bucketName,
      description: 'S3 bucket for generated slides (jobs/{job_id}/slides.md)',
    });
    new cdk.CfnOutput(this, 'AgentRuntimeRoleArn', {
      value: this.runtime.role.roleArn,
      description: 'Execution role for the AgentCore runtime',
    });
  }

  private modelEnvironment(props: SlidevAgentRuntimeStackProps): Record<string, string> {
    if (props.modelProvider === 'anthropic') {
      const a = props.anthropic;
      if (!a) {
        throw new Error("'anthropic' props are required when modelProvider is 'anthropic'");
      }
      return {
        ANTHROPIC_MODEL_ID: a.modelId,
        ANTHROPIC_FEDERATION_RULE_ID: a.federationRuleId,
        ANTHROPIC_ORGANIZATION_ID: a.organizationId,
        ANTHROPIC_SERVICE_ACCOUNT_ID: a.serviceAccountId,
        ANTHROPIC_WORKSPACE_ID: a.workspaceId,
      };
    }
    if (!props.bedrockModelId) {
      throw new Error("'bedrockModelId' is required when modelProvider is 'bedrock'");
    }
    return { BEDROCK_MODEL_ID: props.bedrockModelId };
  }
}
