# syntax=docker/dockerfile:1.7
# Next.js frontend on AWS Lambda via Lambda Web Adapter (linux/arm64).

FROM --platform=linux/arm64 public.ecr.aws/docker/library/node:22.23.4-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM --platform=linux/arm64 public.ecr.aws/docker/library/node:22.23.4-slim AS runtime
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:1.1.0 /lambda-adapter /opt/extensions/lambda-adapter
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    AWS_LWA_INVOKE_MODE=response_stream \
    AWS_LWA_READINESS_CHECK_PATH=/api/health

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Lambda's filesystem is read-only outside /tmp.
RUN ln -s /tmp/next-cache ./.next/cache

CMD ["node", "server.js"]
