import {
  AdminInitiateAuthCommand,
  AdminRespondToAuthChallengeCommand,
  type AdminInitiateAuthCommandOutput,
  InvalidPasswordException,
  NotAuthorizedException,
  UserNotFoundException,
} from "@aws-sdk/client-cognito-identity-provider";
import { NextResponse, type NextRequest } from "next/server";
import { cognitoClient, getAuthConfig, ID_TOKEN_COOKIE, isSecure } from "@/lib/auth";

interface LoginBody {
  email?: unknown;
  password?: unknown;
  /** Set when answering NEW_PASSWORD_REQUIRED. */
  newPassword?: unknown;
  session?: unknown;
  username?: unknown;
}

/**
 * Sign in with email + password (ADMIN_USER_PASSWORD_AUTH, called with the
 * Lambda's IAM role). Users made by admin-create-user get NEW_PASSWORD_REQUIRED
 * on first login; the page answers it with a second POST.
 */
export async function POST(req: NextRequest) {
  // A cross-site form can't send application/json without a CORS preflight.
  if (req.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return NextResponse.json({ error: "unsupported_media_type" }, { status: 415 });
  }
  const body = (await req.json().catch(() => null)) as LoginBody | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const { userPoolId, clientId } = getAuthConfig();
  let result: Pick<AdminInitiateAuthCommandOutput, "AuthenticationResult" | "ChallengeName" | "ChallengeParameters" | "Session">;
  try {
    if (isString(body.newPassword) && isString(body.session) && isString(body.username)) {
      result = await cognitoClient().send(
        new AdminRespondToAuthChallengeCommand({
          UserPoolId: userPoolId,
          ClientId: clientId,
          ChallengeName: "NEW_PASSWORD_REQUIRED",
          Session: body.session,
          ChallengeResponses: { USERNAME: body.username, NEW_PASSWORD: body.newPassword },
        }),
      );
    } else if (isString(body.email) && isString(body.password)) {
      result = await cognitoClient().send(
        new AdminInitiateAuthCommand({
          UserPoolId: userPoolId,
          ClientId: clientId,
          AuthFlow: "ADMIN_USER_PASSWORD_AUTH",
          AuthParameters: { USERNAME: body.email, PASSWORD: body.password },
        }),
      );
    } else {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }
  } catch (err) {
    // Same message for unknown user and wrong password.
    if (err instanceof NotAuthorizedException || err instanceof UserNotFoundException) {
      return NextResponse.json({ error: "メールアドレスまたはパスワードが違います" }, { status: 401 });
    }
    if (err instanceof InvalidPasswordException) {
      return NextResponse.json({ error: "パスワードがポリシーを満たしていません（12 文字以上、大文字・小文字・数字・記号を含む）" }, { status: 400 });
    }
    throw err;
  }

  if (result.ChallengeName === "NEW_PASSWORD_REQUIRED") {
    return NextResponse.json({
      challenge: "NEW_PASSWORD_REQUIRED",
      session: result.Session,
      // With email as the sign-in alias the challenge must name the internal user id.
      username: result.ChallengeParameters?.USER_ID_FOR_SRP ?? body.email,
    });
  }
  const auth = result.AuthenticationResult;
  if (!auth?.IdToken) {
    return NextResponse.json({ error: `unsupported_challenge: ${result.ChallengeName}` }, { status: 501 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ID_TOKEN_COOKIE, auth.IdToken, {
    httpOnly: true,
    secure: isSecure(req),
    sameSite: "lax",
    path: "/",
    maxAge: auth.ExpiresIn,
  });
  return res;
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}
