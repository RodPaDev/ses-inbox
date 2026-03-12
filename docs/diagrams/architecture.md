# System Architecture

## High-Level Architecture

```mermaid
graph LR
    subgraph Internet
        sender["Email Sender"]
        client["API Client"]
    end

    subgraph AWS["AWS Account"]
        subgraph DNS
            route53["Route 53<br/>MX Record"]
        end

        subgraph Ingestion["Email Ingestion"]
            ses["SES Inbound<br/>Catch-All Receipt Rule"]
            s3["S3<br/>Email Bucket"]
        end

        subgraph Compute
            ingest_fn["Ingest Lambda"]
            api_fn["API Lambda"]
        end

        subgraph Data
            dynamo["DynamoDB<br/>Emails Table"]
        end

        subgraph API
            apigw["API Gateway v2"]
        end

        subgraph Secrets
            hmac_secret["HMAC Secret<br/>SSM Parameter Store"]
        end
    end

    sender -->|SMTP| route53
    route53 --> ses
    ses -->|raw .eml| s3
    s3 -->|ObjectCreated event| ingest_fn
    ingest_fn -->|PutItem| dynamo
    client -->|HTTP| apigw
    apigw --> api_fn
    api_fn -->|Query| dynamo
    api_fn -->|Pre-signed URL| s3
    api_fn -->|Verify token| hmac_secret
```

## Component Summary

| Component | Type | Purpose |
| --- | --- | --- |
| Route 53 | DNS | MX record for `receive.yourdomain.com` → SES |
| SES Inbound | Email | Catch-all receipt rule → S3 |
| Email Bucket (S3) | Storage | Raw `.eml` files, 8-day lifecycle |
| Emails Table (DynamoDB) | Index | Email metadata, 7-day TTL |
| Ingest Lambda | Compute | S3 event → extract headers → DynamoDB write |
| API Lambda | Compute | Query, long-poll, pre-signed URL generation |
| API Gateway v2 | API | HTTP routes for email queries |
| HMAC Secret | Secret | SST Secret (SSM) for token signing key |
