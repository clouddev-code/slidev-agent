import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import type { NextRequest } from "next/server";

export const ID_TOKEN_COOKIE = "slidev_id_token";

/** Local development only: skip Cognito entirely. */
export const authDisabled = process.env.AUTH_DISABLED === "true";

interface AuthConfig {
  userPoolId: string;
  clientId: string;
}

let verifier: ReturnType<typeof CognitoJwtVerifier.create<{ userPoolId: string; clientId: string; tokenUse: "id" }>> | undefined;
let cognito: CognitoIdentityProviderClient | undefined;

export function getAuthConfig(): AuthConfig {
  return {
    userPoolId: requiredEnv("COGNITO_USER_POOL_ID"),
    clientId: requiredEnv("COGNITO_CLIENT_ID"),
  };
}

export function cognitoClient(): CognitoIdentityProviderClient {
  cognito ??= new CognitoIdentityProviderClient({});
  return cognito;
}

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`環境変数 ${key} が設定されていません`);
  return value;
}

export async function isValidIdToken(token: string): Promise<boolean> {
  const { userPoolId, clientId } = getAuthConfig();
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
