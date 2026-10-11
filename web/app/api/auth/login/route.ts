import { createHash, randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getAuthConfig, isSecure, PKCE_COOKIE, requestOrigin } from "@/lib/auth";

/** Start the Cognito authorization code flow (PKCE, public client). */
export async function GET(req: NextRequest) {
  const { clientId, domainUrl } = await getAuthConfig();
  const state = randomBytes(16).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  const url = new URL("/oauth2/authorize", domainUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", `${requestOrigin(req)}/api/auth/callback`);
  url.searchParams.set("scope", "openid email");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");

  const res = NextResponse.redirect(url);
  res.cookies.set(PKCE_COOKIE, JSON.stringify({ state, verifier }), {
    httpOnly: true,
    secure: isSecure(req),
    sameSite: "lax",
    path: "/api/auth",
    maxAge: 600,
  });
  return res;
}
