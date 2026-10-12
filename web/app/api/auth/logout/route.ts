import { NextResponse, type NextRequest } from "next/server";
import { ID_TOKEN_COOKIE, requestOrigin } from "@/lib/auth";

/** Clear the session cookie and go back to the login page. */
export async function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/login", requestOrigin(req)));
  res.cookies.set(ID_TOKEN_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
