# API Reference

## Base URL

After deploying, your API URL is printed in the deploy output:

```
apiUrl: https://xxxxxxxxxx.lambda-url.us-east-1.on.aws
```

All endpoints are served from this base URL. For example:

```
https://xxxxxxxxxx.lambda-url.us-east-1.on.aws/emails?inbox=test
```

## Authentication

All `/emails` endpoints require a **Bearer token** in the `Authorization` header:

```
Authorization: Bearer <your-api-key>
```

API keys are created with the provisioning script:

```bash
bun run provision --create --name my-key
```

The `/health` endpoint does **not** require authentication.

### Authentication Errors

| Status | Error Code | Description |
|--------|-----------|-------------|
| 401 | `UNAUTHORIZED` | Missing or invalid `Authorization` header |
| 401 | `UNAUTHORIZED` | Token does not match any active API key |

---

## Endpoints

### `GET /health`

Health check endpoint. No authentication required.

**Response**

```json
{
  "status": "ok",
  "timestamp": 1710000000000
}
```

---

### `GET /emails`

Query emails for a specific inbox. Returns emails sorted by newest first.

**Query Parameters**

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `inbox` | yes | — | Inbox name (the local part of the email address, before `@`). Valid characters: `a-z 0-9 . _ -` (case-insensitive). |
| `limit` | no | `50` | Number of results per page. Must be between `1` and `100`. |
| `cursor` | no | — | Pagination cursor returned from a previous response. |
| `wait` | no | `false` | Set to `"true"` to enable long-poll mode. |
| `timeout` | no | `28` | Maximum wait time in seconds for long-poll mode (`1`–`28`). |

**Response** `200 OK`

```json
{
  "emails": [
    {
      "messageId": "abc123@mail.example.com",
      "inbox": "test",
      "sender": "sender@example.com",
      "recipient": "test@receive.yourdomain.com",
      "subject": "Verify your account",
      "body": "<p>Click the link to verify...</p>",
      "receivedAt": 1710000000000,
      "rawUrl": "/emails/abc123@mail.example.com/raw"
    }
  ],
  "nextCursor": "2024-03-10T00:00:00.000Z#abc123",
  "hasMore": true
}
```

**Response Fields**

| Field | Type | Description |
|-------|------|-------------|
| `emails` | array | List of email objects |
| `emails[].messageId` | string | Unique email identifier (from the `Message-ID` header) |
| `emails[].inbox` | string | Inbox name (local part, lowercase) |
| `emails[].sender` | string | Sender email address |
| `emails[].recipient` | string | Recipient email address |
| `emails[].subject` | string | Email subject line |
| `emails[].body` | string | Email body (HTML) |
| `emails[].receivedAt` | number | Unix timestamp in milliseconds |
| `emails[].rawUrl` | string | Relative URL to fetch the raw `.eml` file |
| `nextCursor` | string \| undefined | Cursor for the next page. `undefined` if no more results. |
| `hasMore` | boolean | `true` if there are more results beyond this page |

**Error Responses**

| Status | Error Code | Cause |
|--------|-----------|-------|
| 400 | `MISSING_INBOX` | `inbox` query parameter not provided |
| 400 | `INVALID_INBOX` | `inbox` contains invalid characters |
| 400 | `INVALID_LIMIT` | `limit` is not between 1 and 100 |
| 401 | `UNAUTHORIZED` | Missing or invalid bearer token |

**Pagination**

To paginate through results, pass the `nextCursor` value from the previous response as the `cursor` parameter:

```bash
# First page
curl -H "Authorization: Bearer $TOKEN" \
  "$API_URL/emails?inbox=test&limit=10"

# Next page (use nextCursor from previous response)
curl -H "Authorization: Bearer $TOKEN" \
  "$API_URL/emails?inbox=test&limit=10&cursor=2024-03-10T00:00:00.000Z%23abc123"
```

**Long-Poll Mode**

When `wait=true`, the endpoint polls DynamoDB every 2 seconds until an email arrives or the timeout is reached. This is useful in E2E tests where you need to wait for an email to be delivered:

```bash
# Wait up to 28 seconds for an email to arrive
curl -H "Authorization: Bearer $TOKEN" \
  "$API_URL/emails?inbox=test&wait=true"

# Wait up to 10 seconds
curl -H "Authorization: Bearer $TOKEN" \
  "$API_URL/emails?inbox=test&wait=true&timeout=10"
```

If no email arrives before the timeout, the response contains an empty `emails` array.

---

### `GET /emails/:messageId/raw`

Fetch the raw `.eml` file for a specific email. Returns a redirect to a pre-signed S3 URL.

**Path Parameters**

| Parameter | Description |
|-----------|-------------|
| `messageId` | The `messageId` from the email object |

**Response** `302 Found`

Redirects to a **pre-signed S3 URL** (valid for 15 minutes) that serves the raw `.eml` file.

Most HTTP clients follow redirects automatically:

```bash
# curl follows the redirect and downloads the raw email
curl -L -H "Authorization: Bearer $TOKEN" \
  "$API_URL/emails/abc123@mail.example.com/raw"
```

**Error Responses**

| Status | Error Code | Cause |
|--------|-----------|-------|
| 401 | `UNAUTHORIZED` | Missing or invalid bearer token |
| 404 | `NOT_FOUND` | No email found with that messageId |

---

## Usage Examples

### E2E Test: Wait for a verification email

```typescript
const response = await fetch(
  `${API_URL}/emails?inbox=testuser&wait=true&timeout=15`,
  { headers: { Authorization: `Bearer ${TOKEN}` } }
);

const { emails } = await response.json();
const verificationEmail = emails.find(e =>
  e.subject.includes("Verify")
);

// Extract verification link from email body
const match = verificationEmail.body.match(/href="([^"]+)"/);
const verificationUrl = match[1];
```

### Fetch and parse a raw email

```bash
curl -L -H "Authorization: Bearer $TOKEN" \
  "$API_URL/emails/abc123/raw" -o email.eml
```

### Poll a specific inbox

```bash
while true; do
  curl -s -H "Authorization: Bearer $TOKEN" \
    "$API_URL/emails?inbox=alerts&wait=true&timeout=28" | jq '.emails | length'
  echo " emails found"
done
```

---

## Data Retention

- Emails are automatically deleted after **7 days** (DynamoDB TTL)
- Raw `.eml` files in S3 are deleted after **8 days** (lifecycle rule)
- There is no way to extend the retention period without modifying the infrastructure code

## Rate Limits

The API runs on AWS Lambda with a function URL. There are no application-level rate limits, but AWS Lambda concurrency limits apply (default: 1000 concurrent executions per region).
