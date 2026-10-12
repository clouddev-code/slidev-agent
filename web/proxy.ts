import { NextResponse, type NextRequest } from "next/server";
import { authDisabled, ID_TOKEN_COOKIE, isValidIdToken, requestOrigin } from "@/lib/auth";

export async function proxy(req: NextRequest) {
  if (authDisabled) return NextResponse.next();

  const token = req.cookies.get(ID_TOKEN_COOKIE)?.value;
  if (token && (await isValidIdToken(token))) return NextResponse.next();

  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", requestOrigin(req)));
}

export const config = {
  // api/slides is public by unguessable run ID and sandboxed (see its route).
  matcher: ["/((?!login|api/auth/|api/health|api/slides/|_next/static|_next/image|favicon.ico).*)"],
};
