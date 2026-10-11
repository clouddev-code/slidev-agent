import { GetObjectCommand, NoSuchKey, S3Client } from "@aws-sdk/client-s3";

const s3 = new S3Client({});
// Run IDs are UUIDs; the route is public, so the ID is the only capability.
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Serve the static Slidev site built by the runtime
 * (s3://$SLIDES_BUCKET/jobs/{jobId}/site/).
 *
 * The deck is LLM-generated from web research, so it is untrusted: it is
 * served without login (no cookies needed) under a CSP sandbox, which gives it
 * an opaque origin that cannot call the app's APIs as the user. The sandboxed
 * document fetches its assets with `Origin: null`, hence the CORS header.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ jobId: string; path?: string[] }> },
) {
  const { jobId, path = [] } = await params;
  const bucket = process.env.SLIDES_BUCKET;
  if (!bucket || !JOB_ID.test(jobId) || path.some((p) => p === ".." || p === ".")) {
    return new Response("Not found", { status: 404 });
  }

  const relative = path.join("/");
  const object =
    (await getObject(bucket, `jobs/${jobId}/site/${relative || "index.html"}`)) ??
    // SPA fallback: Slidev routes such as /3 have no file of their own.
    (relative.includes(".") ? undefined : await getObject(bucket, `jobs/${jobId}/site/index.html`));
  if (!object?.Body) return new Response("Not found", { status: 404 });

  return new Response(object.Body.transformToWebStream(), {
    headers: {
      "content-type": object.ContentType ?? "application/octet-stream",
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox allow-scripts",
      "access-control-allow-origin": "*",
    },
  });
}

async function getObject(bucket: string, key: string) {
  try {
    return await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  } catch (err) {
    if (err instanceof NoSuchKey) return undefined;
    throw err;
  }
}
