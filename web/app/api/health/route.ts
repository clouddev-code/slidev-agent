/** Lambda Web Adapter readiness check (excluded from auth in proxy.ts). */
export function GET() {
  return Response.json({ ok: true });
}
