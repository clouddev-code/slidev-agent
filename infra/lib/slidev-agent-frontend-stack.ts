import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface SlidevAgentFrontendStackProps extends cdk.StackProps {
  /** AgentCore Runtime the frontend relays chat runs to. */
  readonly runtime: agentcore.IBedrockAgentRuntime;
  /** Bucket holding generated decks; the preview site is read from jobs/{id}/site/. */
  readonly slidesBucket: s3.IBucket;
}

const CLIENT_ID_PARAMETER_NAME = '/slidev-agent/frontend/cognito-client-id';

/**
 * Deploys the Next.js frontend (web/) on Lambda with Lambda Web Adapter.
 *
 * Resources created:
 *  - Lambda (container image from ../web/Dockerfile) + Function URL (response streaming)
 *  - Cognito User Pool (admin-created users only) + managed login domain + app client
 *  - SSM Parameter holding the app client ID
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
    const domain = userPool.addDomain('Domain', {
      // Prefix must be globally unique per region.
      cognitoDomain: { domainPrefix: `slidev-agent-${this.account}` },
    });

    // ---- Lambda (Next.js standalone + Lambda Web Adapter) ----
    const fn = new lambda.DockerImageFunction(this, 'WebFunction', {
      code: lambda.DockerImageCode.fromImageAsset(path.resolve(__dirname, '..', '..', 'web')),
      architecture: lambda.Architecture.ARM_64,
      memorySize: 1024,
      // One slide generation streams through a single invocation.
      timeout: cdk.Duration.minutes(15),
      environment: {
        AGENT_RUNTIME_ARN: props.runtime.agentRuntimeArn,
        SLIDES_BUCKET: props.slidesBucket.bucketName,
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        COGNITO_DOMAIN_URL: domain.baseUrl(),
        // The client ID can't be an env var: the client's callback URL depends
        // on the Function URL, which depends on this function.
        COGNITO_CLIENT_ID_PARAM: CLIENT_ID_PARAMETER_NAME,
      },
    });
    props.runtime.grantInvokeRuntime(fn);
    props.slidesBucket.grantRead(fn, 'jobs/*');
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        // Built from the name (not the construct) to avoid the same cycle.
        resources: [
          `arn:${this.partition}:ssm:${this.region}:${this.account}:parameter${CLIENT_ID_PARAMETER_NAME}`,
        ],
      }),
    );

    // Auth is enforced in the app (web/proxy.ts). CloudFront OAC can't front
    // this URL because browser POSTs don't carry x-amz-content-sha256.
    const fnUrl = fn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
    });

    const client = userPool.addClient('WebClient', {
      generateSecret: false,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL],
        // fnUrl.url ends with '/'. localhost is for `npm run dev` against this pool.
        callbackUrls: [`${fnUrl.url}api/auth/callback`, 'http://localhost:3000/api/auth/callback'],
        logoutUrls: [fnUrl.url, 'http://localhost:3000/'],
      },
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
    });

    new ssm.StringParameter(this, 'ClientIdParameter', {
      parameterName: CLIENT_ID_PARAMETER_NAME,
      stringValue: client.userPoolClientId,
      description: 'Cognito app client ID for the slidev-agent frontend',
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
