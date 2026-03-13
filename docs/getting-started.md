# Getting Started

## What is ses-inbox?

ses-inbox is a serverless inbound email API. It receives emails via AWS SES, stores the raw `.eml` files in S3, indexes metadata in DynamoDB, and exposes a REST API to query and retrieve them.

It's designed for **E2E testing workflows** and **email ingestion pipelines** — any scenario where your application sends emails and you need to programmatically verify they arrived with the right content.

## Philosophy

ses-inbox is meant to be a **standalone, self-contained repo** that you deploy once and use across all your projects. The recommended approach:

- **Separate repo in your org** — fork or clone this into its own repository, deploy it to your AWS account, and consume the API from any project that needs email verification.
- **Monorepo-friendly** — if you prefer, you can merge this into an existing monorepo. Updates from upstream are supported as long as you **don't change the internal directory structure** (`packages/api/`, `packages/infra/`, `sst.config.ts`).

### Why a separate repo?

- **Single deployment** — one SES domain, one API, shared across all projects.
- **Independent lifecycle** — deploy and manage email infrastructure without coupling it to your main app's CI/CD.
- **Clean ownership** — the email testing API has its own permissions, keys, and monitoring.

## Prerequisites

- [Bun](https://bun.sh) (package manager and runtime)
- [SST v4](https://sst.dev) (`npm i -g sst`)
- AWS account with credentials configured
- A domain (or subdomain) you control for receiving emails

> **Region constraint:** SES inbound email is only available in `us-east-1`, `us-west-2`, and `eu-west-1`. Your deployment must target one of these regions.

## Setup

### 1. Clone the repo

```bash
git clone <your-repo-url> ses-inbox
cd ses-inbox
```

### 2. Install dependencies

```bash
bun install
```

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```bash
# AWS credentials profile
AWS_PROFILE=default

# Must be one of: us-east-1, us-west-2, eu-west-1
AWS_REGION=us-east-1

# The domain (or subdomain) that will receive emails
# e.g., receive.yourdomain.com, inbox.yourdomain.com
SES_DOMAIN=receive.yourdomain.com

# Optional: If your domain is managed by Route 53, set this to auto-create DNS records.
# Omit to manage DNS manually (the deploy will output the records you need to add).
# HOSTED_ZONE_ID=Z1234567890ABC
```

### 4. Deploy

```bash
bun run deploy:dev
```

See the [Deployment Guide](./deployment.md) for details on DNS setup, hosted zones, and production deployments.

### 5. Create an API key

After deploying, generate an API key to authenticate requests:

```bash
bun run provision --create --name my-key
```

The token is displayed **once** and cannot be retrieved again. Store it securely.

### 6. Test it

Send an email to `anything@receive.yourdomain.com`, then query the API:

```bash
curl -H "Authorization: Bearer <your-token>" \
  "<api-url>/emails?inbox=anything"
```

The `<api-url>` is printed in the deploy output.

## Managing API Keys

```bash
# List all keys
bun run provision --list

# Revoke a key
bun run provision --revoke <keyId>
```

## Development

Start SST in dev mode for live Lambda reloading:

```bash
bun run dev
```

## Running Tests

```bash
bun run test
```

## Project Structure

```
├── sst.config.ts                  # SST app configuration
├── scripts/provision.ts           # API key management CLI
├── packages/
│   ├── api/src/
│   │   ├── index.ts               # Hono API (GET /emails, /raw, /health)
│   │   ├── ingest.ts              # S3 event → parse email → DynamoDB
│   │   ├── lib/dynamo.ts          # DynamoDB read/write operations
│   │   ├── lib/email-parser.ts    # Email header extraction
│   │   └── middleware/auth.ts     # Bearer token authentication
│   └── infra/src/
│       ├── index.ts               # S3, DynamoDB, Lambda definitions
│       └── ses-inbound.ts         # SES receipt rules (raw Pulumi)
```

## Next Steps

- [Deployment Guide](./deployment.md) — DNS setup, hosted zones, MX verification, and production deployment
- [API Reference](./api-reference.md) — full endpoint documentation and usage examples
