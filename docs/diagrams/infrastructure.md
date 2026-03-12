# Infrastructure (SST v4)

## Resource Graph

```mermaid
graph TB
    subgraph "sst.config.ts"
        direction TB

        subgraph "Native SST v4 Components"
            BUCKET["sst.aws.Bucket<br/><b>EmailBucket</b><br/>lifecycle: 8 days"]
            DYNAMO["sst.aws.Dynamo<br/><b>EmailsTable</b><br/>PK: string, SK: string<br/>ttl: 'ttl'"]
            API["sst.aws.ApiGatewayV2<br/><b>EmailApi</b>"]
            INGEST["sst.aws.Function<br/><b>IngestFn</b><br/>timeout: 30s"]
            APIFN["sst.aws.Function<br/><b>ApiFn</b><br/>timeout: 30s"]
            SECRET["sst.Secret<br/><b>HmacSecret</b>"]
        end

        subgraph "Raw Pulumi Resources (SES Inbound)"
            SES_RULESET["aws.ses.ReceiptRuleSet<br/><b>InboundRuleSet</b>"]
            SES_RULE["aws.ses.ReceiptRule<br/><b>CatchAllRule</b><br/>action: S3"]
            SES_ACTIVE["aws.ses.ActiveReceiptRuleSet"]
            MX["aws.route53.Record<br/><b>MX Record</b><br/>10 inbound-smtp.region.amazonaws.com"]
            DOMAIN_ID["aws.ses.DomainIdentity<br/><b>receive.domain.com</b>"]
            DOMAIN_VERIF["aws.route53.Record<br/><b>TXT verification</b>"]
        end
    end

    BUCKET -.->|"notify: ObjectCreated"| INGEST
    SECRET -.->|"link"| APIFN
    DYNAMO -.->|"link"| INGEST
    DYNAMO -.->|"link"| APIFN
    BUCKET -.->|"link"| APIFN
    API -.->|"route: GET /emails"| APIFN
    API -.->|"route: GET /emails/id/raw"| APIFN
    API -.->|"route: GET /health"| APIFN
    SES_RULE -.->|"s3Action"| BUCKET
    MX -.->|"routes to"| SES_RULESET
    DOMAIN_ID -.->|"verified by"| DOMAIN_VERIF
    SES_ACTIVE -.->|"activates"| SES_RULESET
```

## Resource Configuration

| Resource | SST/Pulumi Type | Key Config |
| --- | --- | --- |
| EmailBucket | `sst.aws.Bucket` | Lifecycle expiration: 8 days, notify on `ObjectCreated`, filter prefix: `incoming/` |
| EmailsTable | `sst.aws.Dynamo` | Fields: PK (string), SK (string). Primary index: hashKey=PK, rangeKey=SK. TTL field: `ttl` |
| EmailApi | `sst.aws.ApiGatewayV2` | Routes: `GET /emails`, `GET /emails/{messageId}/raw`, `GET /health` |
| IngestFn | `sst.aws.Function` | Timeout: 30s. Links: EmailsTable |
| ApiFn | `sst.aws.Function` | Timeout: 30s. Links: EmailsTable, EmailBucket, HmacSecret |
| HmacSecret | `sst.Secret` | HMAC signing key, set via `sst secret set` |
| DomainIdentity | `aws.ses.DomainIdentity` | Domain: `receive.yourdomain.com` |
| DomainVerification | `aws.route53.Record` | TXT record: `_amazonses.{domain}` with verification token |
| MxRecord | `aws.route53.Record` | MX record: `10 inbound-smtp.{region}.amazonaws.com`, TTL 300 |
| InboundRuleSet | `aws.ses.ReceiptRuleSet` | Rule set name: `ses-inbox-inbound` |
| ActiveRuleSet | `aws.ses.ActiveReceiptRuleSet` | Activates InboundRuleSet |
| CatchAllRule | `aws.ses.ReceiptRule` | Catch-all, scan enabled, S3 action to EmailBucket with prefix `incoming/` |

## IAM Permissions (auto-wired by SST `link`)

| Function | Resource | Permissions |
| --- | --- | --- |
| IngestFn | EmailsTable | `dynamodb:PutItem` |
| ApiFn | EmailsTable | `dynamodb:Query`, `dynamodb:GetItem` |
| ApiFn | EmailBucket | `s3:GetObject` (for pre-signed URLs) |
| ApiFn | HmacSecret | Read (auto via SST Secret link) |

## SDK IAM Requirements

The SDK generates tokens client-side by reading the HMAC secret directly from SSM. The caller's IAM role needs:

| Permission | Resource | Purpose |
| --- | --- | --- |
| `ssm:GetParameter` | HMAC secret parameter ARN | Read signing key to generate tokens |

## SES Inbound — Why Raw Pulumi?

SST v4's `sst.aws.Email` component only supports **outbound** email (domain identity + DKIM + configuration sets). There is no built-in support for:

- SES receipt rule sets
- SES receipt rules (inbound catch-all → S3)
- Active receipt rule set activation
- MX record creation

These are created using raw `aws.ses.*` and `aws.route53.*` Pulumi resources directly in `sst.config.ts`. This is a supported pattern in SST v4 — any Pulumi resource can coexist with SST components.

## Outputs

| Output | Description |
| --- | --- |
| `apiUrl` | API Gateway endpoint URL |
| `bucketName` | S3 bucket name for raw emails |
| `tableName` | DynamoDB table name |
