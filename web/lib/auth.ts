import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import type { NextRequest } from "next/server";

export const ID_TOKEN_COOKIE = "slidev_id_token";
export const PKCE_COOKIE = "slidev_pkce";

/** Local development only: skip Cognito entirely. */
export const authDisabled = process.env.AUTH_DISABLED === "true";

interface AuthConfig {
  userPoolId: string;
  clientId: string;
  /** Cognito domain base URL, e.g. https://xxx.auth.us-east-1.amazoncognito.com */
  domainUrl: string;
}

let configPromise: Promise<AuthConfig> | undefined;
let verifier: ReturnType<typeof CognitoJwtVerifier.create<{ userPoolId: string; clientId: string; tokenUse: "id" }>> | undefined;

export function getAuthConfig(): Promise<AuthConfig> {
  configPromise ??= loadAuthConfig().catch((err) => {
    configPromise = undefined;
    throw err;
  });
  return configPromise;
}

async function loadAuthConfig(): Promise<AuthConfig> {
  // On Lambda the client ID is read from SSM: the app client's callback URL
  // references the Function URL, so passing the client ID as an env var would
  // make a CloudFormation dependency cycle.
  const clientId =
    process.env.COGNITO_CLIENT_ID ?? (await readParameter(requiredEnv("COGNITO_CLIENT_ID_PARAM")));
  return {
    userPoolId: requiredEnv("COGNITO_USER_POOL_ID"),
    clientId,
    domainUrl: requiredEnv("COGNITO_DOMAIN_URL"),
  };
}

async function readParameter(name: string): Promise<string> {
  const res = await new SSMClient({}).send(new GetParameterCommand({ Name: name }));
  const value = res.Parameter?.Value;
  if (!value) throw new Error(`SSM parameter ${name} is empty`);
  return value;
}

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`環境変数 ${key} が設定されていません`);
  return value;
}

export async function isValidIdToken(token: string): Promise<boolean> {
  const { userPoolId, clientId } = await getAuthConfig();
  verifier ??= CognitoJwtVerifier.create({ userPoolId, clientId, tokenUse: "id" });
  try {
    await verifier.verify(token);
    return true;
  } catch {
    return false;
  }
}

/**
 * Public origin of the request. Behind a Lambda Function URL the server sees
 * the Function URL host in `Host` and `https` in `X-Forwarded-Proto`.
 */
export function requestOrigin(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  return `${proto}://${req.headers.get("host")}`;
}

export function isSecure(req: NextRequest): boolean {
  return requestOrigin(req).startsWith("https://");
}
