import { NextResponse, type NextRequest } from "next/server";
import { getAuthConfig, ID_TOKEN_COOKIE, isSecure, PKCE_COOKIE, requestOrigin } from "@/lib/auth";

/** Exchange the authorization code for tokens and store the ID token. */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const saved = parsePkceCookie(req.cookies.get(PKCE_COOKIE)?.value);
  if (!code || !state || !saved || saved.state !== state) {
    return NextResponse.json({ error: "invalid_state" }, { status: 400 });
  }

  const { clientId, domainUrl } = await getAuthConfig();
  const origin = requestOrigin(req);
  const tokenRes = await fetch(new URL("/oauth2/token", domainUrl), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: `${origin}/api/auth/callback`,
      code_verifier: saved.verifier,
    }),
  });
  if (!tokenRes.ok) {
    return NextResponse.json({ error: "token_exchange_failed" }, { status: 502 });
  }
  const { id_token, expires_in } = (await tokenRes.json()) as {
    id_token: string;
    expires_in: number;
  };

  const res = NextResponse.redirect(new URL("/", origin));
  res.cookies.set(ID_TOKEN_COOKIE, id_token, {
    httpOnly: true,
    secure: isSecure(req),
    sameSite: "lax",
    path: "/",
    maxAge: expires_in,
  });
  res.cookies.set(PKCE_COOKIE, "", { path: "/api/auth", maxAge: 0 });
  return res;
}

function parsePkceCookie(value: string | undefined): { state: string; verifier: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed?.state === "string" && typeof parsed?.verifier === "string"
      ? parsed
      : null;
  } catch {
    return null;
  }
}
