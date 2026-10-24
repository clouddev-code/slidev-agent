import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface SlidevAgentFrontendStackProps extends cdk.StackProps {
  /** AgentCore Runtime the frontend relays chat runs to. */
  readonly runtime: agentcore.IBedrockAgentRuntime;
  /** Bucket holding generated decks; the preview site is read from jobs/{id}/site/. */
  readonly slidesBucket: s3.IBucket;
}

const WEB_FUNCTION_NAME = 'slidev-agent-web';

/**
 * Deploys the Next.js frontend (web/) on Lambda with Lambda Web Adapter.
 *
 * Resources created:
 *  - Lambda (container image from ../web/Dockerfile) + Function URL (response streaming)
 *  - Cognito User Pool (admin-created users only) + app client. The login page
 *    is the app's own (/login); it signs in via AdminInitiateAuth, so no
 *    Cognito domain / hosted UI is created.
 */
export class SlidevAgentFrontendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SlidevAgentFrontendStackProps) {
    super(scope, id, props);

    // ---- Cognito ----
    const userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      passwordPolicy: { minLength: 12 },
    });
    const client = userPool.addClient('WebClient', {
      generateSecret: false,
      authFlows: { adminUserPassword: true },
      // No hosted UI: the app has its own login page.
      disableOAuth: true,
    });

    // ---- Lambda (Next.js standalone + Lambda Web Adapter) ----
    const fn = new lambda.DockerImageFunction(this, 'WebFunction', {
      // Fixed so logs (/aws/lambda/slidev-agent-web) and CLI commands are predictable.
      functionName: WEB_FUNCTION_NAME,
      code: lambda.DockerImageCode.fromImageAsset(path.resolve(__dirname, '..', '..', 'web')),
      architecture: lambda.Architecture.ARM_64,
      memorySize: 1024,
      // One slide generation streams through a single invocation.
      timeout: cdk.Duration.minutes(15),
      environment: {
        AGENT_RUNTIME_ARN: props.runtime.agentRuntimeArn,
        SLIDES_BUCKET: props.slidesBucket.bucketName,
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        COGNITO_CLIENT_ID: client.userPoolClientId,
      },
    });
    props.runtime.grantInvokeRuntime(fn);
    // The relay passes runtimeUserId so the runtime gets a workload access
    // token (needed to read the Tavily key from AgentCore Identity).
    props.runtime.grantInvokeRuntimeForUser(fn);
    props.slidesBucket.grantRead(fn, 'jobs/*');
    userPool.grant(fn, 'cognito-idp:AdminInitiateAuth', 'cognito-idp:AdminRespondToAuthChallenge');

    // Auth is enforced in the app (web/proxy.ts). CloudFront OAC can't front
    // this URL because browser POSTs don't carry x-amz-content-sha256.
    const fnUrl = fn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
    });

    // ---- CFN outputs ----
    new cdk.CfnOutput(this, 'WebUrl', {
      value: fnUrl.url,
      description: 'Frontend URL (Lambda Function URL)',
    });
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
      description: 'Cognito User Pool ID (create users with admin-create-user)',
    });
  }
}
