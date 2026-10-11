import { NextResponse, type NextRequest } from "next/server";
import { getAuthConfig, ID_TOKEN_COOKIE, requestOrigin } from "@/lib/auth";

/** Clear the session cookie and end the Cognito managed-login session. */
export async function GET(req: NextRequest) {
  const { clientId, domainUrl } = await getAuthConfig();
  const url = new URL("/logout", domainUrl);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("logout_uri", `${requestOrigin(req)}/`);

  const res = NextResponse.redirect(url);
  res.cookies.set(ID_TOKEN_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
