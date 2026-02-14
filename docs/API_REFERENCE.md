# API Reference

<div align="center">

## NexusAuth API Documentation

*Complete reference for all API endpoints*

**Base URL**: `https://your-domain.com`

</div>

---

## Table of Contents

1. [Authentication](#authentication)
2. [OAuth 2.0 / OIDC](#oauth-20--oidc)
3. [SDK API](#sdk-api)
4. [WebAuthn/Passkeys](#webauthnpasskeys)
5. [Magic Links](#magic-links)
6. [Developer Portal API](#developer-portal-api)
7. [Webhooks](#webhooks)
8. [Error Codes](#error-codes)

---

## Authentication

### API Key Authentication

For SDK API endpoints, include your API key in the request header:

```http
X-API-Key: your_api_key_here
```

Or use Bearer token:

```http
Authorization: Bearer your_api_key_here
```

### OAuth Access Token

For OAuth-protected resources, include the access token:

```http
Authorization: Bearer your_access_token_here
```

---

## OAuth 2.0 / OIDC

### Discovery Endpoint

```http
GET /.well-known/openid-configuration
```

Returns the OpenID Connect Discovery document.

**Response:**
```json
{
  "issuer": "https://your-domain.com",
  "authorization_endpoint": "https://your-domain.com/oauth/authorize",
  "token_endpoint": "https://your-domain.com/oauth/token",
  "userinfo_endpoint": "https://your-domain.com/oauth/userinfo",
  "jwks_uri": "https://your-domain.com/.well-known/jwks.json",
  "introspection_endpoint": "https://your-domain.com/oauth/introspect",
  "revocation_endpoint": "https://your-domain.com/oauth/revoke",
  "end_session_endpoint": "https://your-domain.com/oauth/logout",
  "response_types_supported": ["code", "token", "id_token"],
  "grant_types_supported": ["authorization_code", "refresh_token", "client_credentials"],
  "scopes_supported": ["openid", "profile", "email", "offline_access"],
  "token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post"],
  "code_challenge_methods_supported": ["S256"]
}
```

---

### JWKS Endpoint

```http
GET /.well-known/jwks.json
```

Returns the JSON Web Key Set for token verification.

---

### Authorization Endpoint

```http
GET /oauth/authorize
```

Initiates the OAuth authorization flow.

**Query Parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `response_type` | Yes | `code` for authorization code flow |
| `client_id` | Yes | Your application's client ID |
| `redirect_uri` | Yes | Registered redirect URI |
| `scope` | No | Space-separated scopes (default: `openid`) |
| `state` | Recommended | Random state for CSRF protection |
| `code_challenge` | For PKCE | Base64URL encoded challenge |
| `code_challenge_method` | For PKCE | `S256` |
| `nonce` | For OIDC | Random nonce for ID token |
| `prompt` | No | `login`, `consent`, or `none` |

**Example:**
```
GET /oauth/authorize?
  response_type=code&
  client_id=app_abc123&
  redirect_uri=https://yourapp.com/callback&
  scope=openid%20profile%20email&
  state=random_state&
  code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&
  code_challenge_method=S256
```

---

### Token Endpoint

```http
POST /oauth/token
Content-Type: application/x-www-form-urlencoded
```

Exchange authorization code for tokens.

**Authorization Code Grant:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `grant_type` | Yes | `authorization_code` |
| `code` | Yes | Authorization code |
| `redirect_uri` | Yes | Same as authorization request |
| `client_id` | Yes | Application client ID |
| `client_secret` | Depends | Required for confidential clients |
| `code_verifier` | For PKCE | Original code verifier |

**Refresh Token Grant:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `grant_type` | Yes | `refresh_token` |
| `refresh_token` | Yes | The refresh token |
| `client_id` | Yes | Application client ID |
| `client_secret` | Depends | Required for confidential clients |

**Client Credentials Grant:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `grant_type` | Yes | `client_credentials` |
| `client_id` | Yes | Application client ID |
| `client_secret` | Yes | Application client secret |
| `scope` | No | Requested scopes |

**Response:**
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "dGhpcyBpcyBhIHJlZnJlc2ggdG9rZW4...",
  "id_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "scope": "openid profile email"
}
```

---

### UserInfo Endpoint

```http
GET /oauth/userinfo
Authorization: Bearer {access_token}
```

Returns claims about the authenticated user.

**Response:**
```json
{
  "sub": "user_123",
  "email": "user@example.com",
  "email_verified": true,
  "name": "John Doe",
  "given_name": "John",
  "family_name": "Doe",
  "picture": "https://example.com/avatar.jpg",
  "updated_at": 1234567890
}
```

---

### Token Introspection

```http
POST /oauth/introspect
Content-Type: application/x-www-form-urlencoded
```

Validate and get information about a token.

**Parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `token` | Yes | Token to introspect |
| `token_type_hint` | No | `access_token` or `refresh_token` |
| `client_id` | Yes | Application client ID |
| `client_secret` | Yes | Application client secret |

**Response (active token):**
```json
{
  "active": true,
  "scope": "openid profile email",
  "client_id": "app_abc123",
  "username": "user@example.com",
  "token_type": "Bearer",
  "exp": 1234567890,
  "iat": 1234564290,
  "sub": "user_123",
  "aud": "app_abc123",
  "iss": "https://your-domain.com"
}
```

---

### Token Revocation

```http
POST /oauth/revoke
Content-Type: application/x-www-form-urlencoded
```

Revoke an access or refresh token.

**Parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `token` | Yes | Token to revoke |
| `token_type_hint` | No | `access_token` or `refresh_token` |
| `client_id` | Yes | Application client ID |
| `client_secret` | Yes | Application client secret |

**Response:** `200 OK` (always, even if token was invalid)

---

## SDK API

All SDK API endpoints require API key authentication.

### List Users

```http
GET /api/sdk/users
X-API-Key: {api_key}
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `page` | integer | Page number (default: 1) |
| `limit` | integer | Results per page (default: 20, max: 100) |
| `search` | string | Search by email or username |
| `sort` | string | Sort field (default: `createdAt`) |
| `order` | string | `asc` or `desc` (default: `desc`) |

**Response:**
```json
{
  "success": true,
  "users": [
    {
      "id": "user_123",
      "email": "user@example.com",
      "username": "johndoe",
      "profile": {
        "firstName": "John",
        "lastName": "Doe"
      },
      "isVerified": true,
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "pages": 5
  }
}
```

---

### Create User

```http
POST /api/sdk/users
X-API-Key: {api_key}
Content-Type: application/json
```

**Request Body:**
```json
{
  "email": "newuser@example.com",
  "password": "securePassword123",
  "username": "newuser",
  "profile": {
    "firstName": "Jane",
    "lastName": "Doe"
  },
  "metadata": {
    "plan": "pro",
    "referrer": "google"
  },
  "sendVerificationEmail": true
}
```

**Response:**
```json
{
  "success": true,
  "user": {
    "id": "user_456",
    "email": "newuser@example.com",
    "username": "newuser",
    "isVerified": false,
    "createdAt": "2024-01-15T00:00:00.000Z"
  }
}
```

---

### Get User

```http
GET /api/sdk/users/{userId}
X-API-Key: {api_key}
```

**Response:**
```json
{
  "success": true,
  "user": {
    "id": "user_123",
    "email": "user@example.com",
    "username": "johndoe",
    "profile": {
      "firstName": "John",
      "lastName": "Doe",
      "avatar": "https://example.com/avatar.jpg"
    },
    "isVerified": true,
    "twoFactorEnabled": true,
    "lastLogin": "2024-01-14T12:00:00.000Z",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "metadata": {}
  }
}
```

---

### Update User

```http
PATCH /api/sdk/users/{userId}
X-API-Key: {api_key}
Content-Type: application/json
```

**Request Body:**
```json
{
  "username": "newusername",
  "profile": {
    "firstName": "Jonathan"
  },
  "metadata": {
    "plan": "enterprise"
  }
}
```

---

### Delete User

```http
DELETE /api/sdk/users/{userId}
X-API-Key: {api_key}
```

**Response:**
```json
{
  "success": true,
  "message": "User deleted successfully"
}
```

---

### Verify Password

```http
POST /api/sdk/auth/verify-password
X-API-Key: {api_key}
Content-Type: application/json
```

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "userPassword123"
}
```

**Response:**
```json
{
  "success": true,
  "valid": true,
  "user": {
    "id": "user_123",
    "email": "user@example.com"
  }
}
```

---

### Generate Tokens

```http
POST /api/sdk/auth/tokens
X-API-Key: {api_key}
Content-Type: application/json
```

**Request Body:**
```json
{
  "userId": "user_123",
  "scopes": ["openid", "profile", "email"]
}
```

**Response:**
```json
{
  "success": true,
  "accessToken": "eyJhbGciOiJSUzI1NiIs...",
  "refreshToken": "dGhpcyBpcyBhIHJlZnJlc2g...",
  "idToken": "eyJhbGciOiJSUzI1NiIs...",
  "expiresIn": 3600
}
```

---

### Send Magic Link

```http
POST /api/sdk/auth/magic-link
X-API-Key: {api_key}
Content-Type: application/json
```

**Request Body:**
```json
{
  "email": "user@example.com",
  "redirectUrl": "https://yourapp.com/auth/callback",
  "expiresIn": 900
}
```

**Response:**
```json
{
  "success": true,
  "message": "Magic link sent",
  "expiresAt": "2024-01-15T00:15:00.000Z"
}
```

---

## WebAuthn/Passkeys

### Registration Options

```http
POST /webauthn/register/options
Content-Type: application/json
Cookie: sessionId=...
```

**Request Body:**
```json
{
  "authenticatorType": "platform"
}
```

**Response:**
```json
{
  "success": true,
  "options": {
    "challenge": "random-base64url-challenge",
    "rp": {
      "name": "NexusAuth",
      "id": "your-domain.com"
    },
    "user": {
      "id": "base64url-user-id",
      "name": "user@example.com",
      "displayName": "John"
    },
    "pubKeyCredParams": [
      { "alg": -7, "type": "public-key" },
      { "alg": -257, "type": "public-key" }
    ],
    "timeout": 60000,
    "attestation": "none",
    "authenticatorSelection": {
      "residentKey": "preferred",
      "userVerification": "preferred"
    }
  }
}
```

---

### Verify Registration

```http
POST /webauthn/register/verify
Content-Type: application/json
Cookie: sessionId=...
```

**Request Body:**
```json
{
  "credential": {
    "id": "credential-id",
    "rawId": "base64url-raw-id",
    "type": "public-key",
    "response": {
      "attestationObject": "base64url-attestation",
      "clientDataJSON": "base64url-clientdata"
    }
  },
  "name": "MacBook Pro"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Passkey registered successfully",
  "passkey": {
    "id": "passkey_123",
    "name": "MacBook Pro",
    "createdAt": "2024-01-15T00:00:00.000Z",
    "authenticatorType": "platform"
  }
}
```

---

### Authentication Options

```http
POST /webauthn/login/options
Content-Type: application/json
```

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

**Response:**
```json
{
  "success": true,
  "options": {
    "challenge": "random-base64url-challenge",
    "timeout": 60000,
    "rpId": "your-domain.com",
    "userVerification": "preferred",
    "allowCredentials": [
      {
        "id": "base64url-credential-id",
        "type": "public-key",
        "transports": ["internal"]
      }
    ]
  }
}
```

---

### Verify Authentication

```http
POST /webauthn/login/verify
Content-Type: application/json
```

**Request Body:**
```json
{
  "credential": {
    "id": "credential-id",
    "rawId": "base64url-raw-id",
    "type": "public-key",
    "response": {
      "authenticatorData": "base64url-authdata",
      "clientDataJSON": "base64url-clientdata",
      "signature": "base64url-signature",
      "userHandle": "base64url-user-handle"
    }
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Authentication successful",
  "user": {
    "id": "user_123",
    "email": "user@example.com"
  },
  "redirect": "/dashboard"
}
```

---

### List Passkeys

```http
GET /webauthn/credentials
Cookie: sessionId=...
```

**Response:**
```json
{
  "success": true,
  "passkeys": [
    {
      "id": "passkey_123",
      "name": "MacBook Pro",
      "authenticatorType": "platform",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "lastUsedAt": "2024-01-15T12:00:00.000Z",
      "useCount": 42,
      "backupEligible": true
    }
  ]
}
```

---

### Delete Passkey

```http
DELETE /webauthn/credentials/{passkeyId}
Cookie: sessionId=...
```

**Response:**
```json
{
  "success": true,
  "message": "Passkey removed"
}
```

---

## Magic Links

### Request Magic Link

```http
POST /magic/request
Content-Type: application/x-www-form-urlencoded
```

**Parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `email` | Yes | User's email address |
| `redirect` | No | URL to redirect after auth |

---

### Verify Magic Link

```http
GET /magic/{token}
```

Validates the magic link token and shows confirmation page.

---

### Confirm Magic Link

```http
POST /magic/{token}/confirm
```

Completes authentication and creates session.

---

## Webhooks

### Webhook Events

| Event | Description |
|-------|-------------|
| `user.created` | A new user registered |
| `user.updated` | User profile was updated |
| `user.deleted` | User account was deleted |
| `user.verified` | User email was verified |
| `session.created` | New login session created |
| `session.revoked` | Session was terminated |
| `auth.failed` | Login attempt failed |
| `auth.mfa_enabled` | User enabled MFA |
| `auth.mfa_disabled` | User disabled MFA |
| `passkey.created` | User registered a passkey |
| `passkey.deleted` | User removed a passkey |

### Webhook Payload

```json
{
  "id": "evt_123456789",
  "type": "user.created",
  "timestamp": "2024-01-15T12:00:00.000Z",
  "data": {
    "user": {
      "id": "user_123",
      "email": "user@example.com"
    }
  },
  "organization": {
    "id": "org_456",
    "slug": "my-org"
  }
}
```

### Webhook Signature

Verify webhook authenticity using the `X-Webhook-Signature` header:

```javascript
const crypto = require('crypto');

function verifyWebhook(payload, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}
```

---

## Error Codes

### HTTP Status Codes

| Code | Description |
|------|-------------|
| `200` | Success |
| `201` | Created |
| `400` | Bad Request - Invalid parameters |
| `401` | Unauthorized - Missing or invalid auth |
| `403` | Forbidden - Insufficient permissions |
| `404` | Not Found - Resource doesn't exist |
| `409` | Conflict - Resource already exists |
| `422` | Unprocessable - Validation failed |
| `429` | Too Many Requests - Rate limited |
| `500` | Internal Server Error |

### Error Response Format

```json
{
  "success": false,
  "error": {
    "code": "invalid_request",
    "message": "The email field is required",
    "details": {
      "field": "email",
      "reason": "required"
    }
  }
}
```

### OAuth Error Codes

| Code | Description |
|------|-------------|
| `invalid_request` | Missing required parameter |
| `invalid_client` | Client authentication failed |
| `invalid_grant` | Invalid authorization code or refresh token |
| `unauthorized_client` | Client not authorized for this grant type |
| `unsupported_grant_type` | Grant type not supported |
| `invalid_scope` | Requested scope is invalid |
| `access_denied` | User denied authorization |

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| `/api/*` | 100 requests per minute |
| `/auth/*` | 10 requests per minute |
| `/oauth/token` | 30 requests per minute |
| `/webauthn/*` | 20 requests per minute |

Rate limit headers are included in responses:

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1705320000
```

---

<div align="center">

*For more information, see the [Integration Guide](./COMPETITIVE_ANALYSIS.md#-integration-guide)*

</div>
