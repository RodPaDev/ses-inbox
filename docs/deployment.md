# Deployment Guide

## Overview

ses-inbox deploys to AWS using [SST v4](https://sst.dev) (built on Pulumi). The deployment creates:

| Resource | Purpose |
|----------|---------|
| **S3 Bucket** | Stores raw `.eml` files (8-day lifecycle) |
| **DynamoDB Tables** | Email metadata index (7-day TTL) + API keys |
| **API Lambda** | Hono HTTP handler for the REST API |
| **Ingest Lambda** | S3 event handler that parses emails into DynamoDB |
| **SES Domain Identity** | Verifies your domain for inbound email |
| **SES Receipt Rules** | Catch-all rule that routes emails to S3 |
| **DNS Records** (optional) | MX + TXT verification records in Route 53 |

## Stages

SST uses **stages** to isolate environments. Each stage creates its own set of resources.

```bash
bun run deploy:dev       # Deploy to dev stage
bun run deploy:prod      # Deploy to production stage
```

**Removal behavior:**

- `dev` — all resources are deleted on `bun run remove:dev`
- `prod` — resources are **retained** on removal (safety measure to prevent data loss)

## DNS Setup

This is the most important part of the deployment. SES needs two DNS records to receive emails on your domain:

1. **MX record** — tells mail servers to route emails to AWS SES
2. **TXT record** — proves you own the domain (SES verification)

There are two ways to set this up:

---

### Option A: Automatic (Route 53 Hosted Zone)

If your domain's DNS is managed by **AWS Route 53**, you can let the deployment create the records automatically.

#### 1. Find your Hosted Zone ID

Go to [Route 53 → Hosted Zones](https://console.aws.amazon.com/route53/v2/hostedzones) in the AWS Console and copy the **Hosted Zone ID** for your domain.

> **Using a subdomain?** If you're using `receive.yourdomain.com`, you need the hosted zone for `yourdomain.com` (or a dedicated hosted zone for the subdomain if you have one).

#### 2. Set it in `.env`

```bash
SES_DOMAIN=receive.yourdomain.com
HOSTED_ZONE_ID=Z1234567890ABC
```

#### 3. Deploy

```bash
bun run deploy:dev
```

The deployment will automatically create:
- `TXT _amazonses.receive.yourdomain.com` → SES verification token
- `MX receive.yourdomain.com` → `10 inbound-smtp.{region}.amazonaws.com`

---

### Option B: Manual (External DNS Provider)

If your DNS is managed outside Route 53 (Cloudflare, Namecheap, GoDaddy, etc.), **omit** `HOSTED_ZONE_ID` from your `.env`:

```bash
SES_DOMAIN=receive.yourdomain.com
# HOSTED_ZONE_ID=     ← leave this commented out
```

#### 1. Deploy

```bash
bun run deploy:dev
```

The deploy output will print the DNS records you need to add:

```
dnsVerificationRecord: TXT _amazonses.receive.yourdomain.com <verification-token>
dnsMxRecord: MX receive.yourdomain.com 10 inbound-smtp.us-east-1.amazonaws.com
```

#### 2. Add the TXT record

In your DNS provider, create a **TXT** record:

| Field | Value |
|-------|-------|
| **Type** | TXT |
| **Name/Host** | `_amazonses.receive.yourdomain.com` |
| **Value** | The verification token from the deploy output |
| **TTL** | 300 (or default) |

This proves to AWS that you own the domain. SES will periodically check this record — **do not remove it**.

#### 3. Add the MX record

Create an **MX** record:

| Field | Value |
|-------|-------|
| **Type** | MX |
| **Name/Host** | `receive.yourdomain.com` |
| **Priority** | `10` |
| **Value** | `inbound-smtp.{region}.amazonaws.com` |
| **TTL** | 300 (or default) |

Replace `{region}` with your AWS region (`us-east-1`, `us-west-2`, or `eu-west-1`).

> **Note:** Some DNS providers require you to put the priority in a separate field, others expect it inline (e.g., `10 inbound-smtp.us-east-1.amazonaws.com`). Check your provider's docs.

#### 4. Wait for DNS propagation

DNS changes can take a few minutes to a few hours to propagate. You can verify the records:

```bash
# Check MX record
dig MX receive.yourdomain.com

# Check TXT verification record
dig TXT _amazonses.receive.yourdomain.com
```

#### 5. Verify in SES Console

Go to [SES → Verified Identities](https://console.aws.amazon.com/ses/home#/verified-identities) to confirm your domain shows as **Verified**.

---

## Custom Domain (API)

By default, the API is served at an auto-generated Lambda Function URL. You can optionally serve it at a custom domain like `api.inbox.yourdomain.com` by setting the `API_DOMAIN` environment variable.

### Option A: Automatic DNS (Route 53)

If you already have `HOSTED_ZONE_ID` set for SES DNS, the same hosted zone is used to create the API domain records and ACM certificate automatically.

```bash
SES_DOMAIN=receive.yourdomain.com
HOSTED_ZONE_ID=Z1234567890ABC
API_DOMAIN=api.inbox.yourdomain.com
```

Deploy as usual — SST provisions an ACM certificate, validates it via Route 53, and creates a CloudFront distribution.

### Option B: External DNS

If your DNS is managed outside Route 53, omit `HOSTED_ZONE_ID`:

```bash
SES_DOMAIN=receive.yourdomain.com
API_DOMAIN=api.inbox.yourdomain.com
```

#### 1. Start the deployment

```bash
bun run deploy:dev
```

The deployment will provision an ACM certificate and **pause** while it waits for DNS validation. SST does not print the validation records — you need to retrieve them from AWS.

#### 2. Retrieve the ACM validation record

While the deploy is paused, open a separate terminal and run:

```bash
aws acm list-certificates --query "CertificateSummaryList[?DomainName=='api.inbox.yourdomain.com'].CertificateArn" --output text
```

Then describe the certificate to get the validation CNAME:

```bash
aws acm describe-certificate \
  --certificate-arn <arn-from-above> \
  --query "Certificate.DomainValidationOptions[0].ResourceRecord"
```

This returns the CNAME name and value needed for validation.

#### 3. Add the validation CNAME

In your DNS provider, create a **CNAME** record with the name and value from the previous step.

#### 4. Wait for validation

Once DNS propagates, ACM validates the certificate and the paused deployment resumes automatically. This can take a few minutes.

#### 5. Add the API domain CNAME

After the deployment completes, the output includes an `apiDomainCname` record. Add that **CNAME** in your DNS provider to point your custom domain to the CloudFront distribution.

### Behavior

- All existing endpoints (`/health`, `/docs`, `/v1/emails`, etc.) respond at the custom domain
- The `apiUrl` SST output reflects the custom domain when configured
- Omitting `API_DOMAIN` keeps the default Lambda Function URL — no changes needed

---

## Domain Recommendations

- **Use a subdomain** (e.g., `receive.yourdomain.com`, `inbox.yourdomain.com`) rather than your root domain. This avoids conflicts with existing MX records for your primary email.
- **One domain per deployment** — each ses-inbox deployment manages one receiving domain. If you need multiple domains, deploy separate stages or instances.

## Data Retention

- **DynamoDB entries** expire after **7 days** (automatic TTL)
- **S3 raw emails** expire after **8 days** (lifecycle rule)
- The 1-day buffer ensures S3 objects are cleaned up after their DynamoDB index entries expire.

## Teardown

```bash
bun run remove:dev       # Remove dev stage (deletes all resources)
```

> Production stage resources are retained on removal. To fully delete prod resources, you'll need to manually delete them in the AWS Console or change the removal policy in `sst.config.ts`.

## Troubleshooting

### Emails not arriving

1. **Check DNS records** — verify MX and TXT records are correctly set using `dig`
2. **Check SES verification** — ensure the domain is verified in the SES Console
3. **Check the region** — SES inbound only works in `us-east-1`, `us-west-2`, `eu-west-1`
4. **Check the S3 bucket** — look for `.eml` files under the `incoming/` prefix
5. **Check the Ingest Lambda logs** — CloudWatch logs will show parsing errors

### API returns empty results

1. **Check the inbox name** — it's the local part of the email address (before `@`), case-insensitive
2. **Wait for processing** — there's a small delay between email arrival and API availability
3. **Use long-poll** — add `?wait=true` to wait for emails to arrive

### Deploy fails

1. **Check your AWS region** — must be `us-east-1`, `us-west-2`, or `eu-west-1`
2. **Check AWS credentials** — ensure your `AWS_PROFILE` has the necessary permissions
3. **SES receipt rule conflict** — only one active receipt rule set is allowed per AWS account per region. If you have an existing rule set, you may need to deactivate it first
