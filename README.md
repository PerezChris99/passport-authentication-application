<div align="center">

# 🔐 Auth-as-a-Service Platform

<img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js" />
<img src="https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white" alt="Express.js" />
<img src="https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white" alt="MongoDB" />
<img src="https://img.shields.io/badge/OAuth_2.0-3C873A?style=for-the-badge&logo=oauth&logoColor=white" alt="OAuth 2.0" />
<img src="https://img.shields.io/badge/OpenID_Connect-F78C40?style=for-the-badge&logo=openid&logoColor=white" alt="OpenID Connect" />
<img src="https://img.shields.io/badge/JWT-000000?style=for-the-badge&logo=jsonwebtokens&logoColor=white" alt="JWT" />
<img src="https://img.shields.io/badge/Bootstrap-7952B3?style=for-the-badge&logo=bootstrap&logoColor=white" alt="Bootstrap" />

<br />

**Complete Authentication Infrastructure for Your Applications**

*OAuth 2.0 Provider • OpenID Connect • Magic Links • Developer Portal • SDK API*

<br />

[🚀 Quick Start](#-quick-start) •
[📖 Documentation](#-documentation) •
[🔑 OAuth/OIDC](#-oauth-20--openid-connect) •
[👨‍💻 Developer Portal](#-developer-portal) •
[🔗 SDK API](#-sdk-api)

---

</div>

## ✨ Platform Overview

This is a **complete Auth-as-a-Service platform** that enables you to add authentication to any application. It provides:

- **OAuth 2.0 / OpenID Connect Provider** - Be your own identity provider
- **Developer Portal** - Manage organizations, applications, API keys, and webhooks
- **SDK API** - RESTful API for user management, authentication, and sessions
- **Magic Link Authentication** - Passwordless login via email
- **Multi-factor Authentication** - TOTP, Email-based 2FA, and backup codes
- **Social Authentication** - Google, Facebook, GitHub OAuth integration

---

## ✨ Feature Highlights

<table>
<tr>
<td width="50%">

### 🔑 OAuth 2.0 / OIDC Provider
- ✅ Authorization Code Flow
- ✅ Authorization Code + PKCE
- ✅ Client Credentials Flow
- ✅ Refresh Token Flow
- ✅ OpenID Connect Discovery
- ✅ JWKS Endpoint
- ✅ Token Introspection
- ✅ Token Revocation
- ✅ UserInfo Endpoint

</td>
<td width="50%">

### 👨‍💻 Developer Portal
- ✅ Organization Management
- ✅ Application Registration
- ✅ Client ID/Secret Generation
- ✅ API Key Management
- ✅ Webhook Configuration
- ✅ Redirect URI Management
- ✅ Scope Configuration
- ✅ Usage Statistics

</td>
</tr>
<tr>
<td width="50%">

### 🔗 SDK API
- ✅ User CRUD Operations
- ✅ Password Verification
- ✅ Token Generation
- ✅ Magic Link API
- ✅ Session Management
- ✅ Organization Stats
- ✅ API Key Authentication
- ✅ Rate Limiting

</td>
<td width="50%">

### ✉️ Magic Link Authentication
- ✅ Passwordless Login
- ✅ Email Verification
- ✅ Secure Token Generation
- ✅ Configurable Expiration
- ✅ Device Fingerprinting
- ✅ Existing User Detection
- ✅ New User Registration
- ✅ API Integration

</td>
</tr>
<tr>
<td width="50%">

### 🛡️ Security Features
- ✅ Two-Factor Auth (TOTP)
- ✅ Email-based 2FA
- ✅ Backup Codes
- ✅ CSRF Protection
- ✅ Rate Limiting
- ✅ Account Lockout
- ✅ Helmet.js Headers
- ✅ Secure Sessions

</td>
<td width="50%">

### 👤 User Management
- ✅ Email Verification
- ✅ Password Reset
- ✅ Profile Management
- ✅ Session Control
- ✅ Activity Logging
- ✅ Audit Trail
- ✅ Admin Panel
- ✅ Role Management

</td>
</tr>
</table>

---

## 🚀 Quick Start

```bash
# Clone the repository
git clone https://github.com/PerezChris99/passport-authentication-application.git

# Navigate to directory
cd passport-authentication-application

# Install dependencies
npm install

# Configure environment
cp .env.example .env

# Start development server
npm start
```

<details>
<summary>📋 <strong>Environment Variables</strong></summary>

```env
# Server
NODE_ENV=development
PORT=3000
BASE_URL=http://localhost:3000

# Database
MONGO_URI=mongodb://localhost:27017/auth-service

# Session & Security
SESSION_SECRET=your-super-secret-key-here
JWT_SECRET=your-jwt-secret-key-here
COOKIE_SECRET=your-cookie-secret

# OAuth Provider Keys (for signing tokens)
OAUTH_PRIVATE_KEY=your-rsa-private-key
OAUTH_PUBLIC_KEY=your-rsa-public-key

# Social OAuth (Login with)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
FACEBOOK_APP_ID=your-facebook-app-id
FACEBOOK_APP_SECRET=your-facebook-app-secret
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret

# Email (SMTP)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-email@example.com
SMTP_PASS=your-email-password
EMAIL_FROM="Auth Service <noreply@example.com>"
```

</details>

---

## 🔑 OAuth 2.0 / OpenID Connect

This platform functions as a full **OAuth 2.0 Authorization Server** and **OpenID Connect Provider**.

### Supported Flows

| Flow | Use Case | Grant Type |
|------|----------|------------|
| **Authorization Code** | Server-side web apps | `authorization_code` |
| **Authorization Code + PKCE** | Mobile & SPA apps | `authorization_code` |
| **Client Credentials** | Machine-to-machine | `client_credentials` |
| **Refresh Token** | Token renewal | `refresh_token` |

### OAuth Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/.well-known/openid-configuration` | GET | OIDC Discovery document |
| `/.well-known/jwks.json` | GET | JSON Web Key Set |
| `/oauth/authorize` | GET/POST | Authorization endpoint |
| `/oauth/token` | POST | Token endpoint |
| `/oauth/userinfo` | GET/POST | UserInfo endpoint |
| `/oauth/introspect` | POST | Token introspection |
| `/oauth/revoke` | POST | Token revocation |
| `/oauth/logout` | GET | End session |

### Authorization Request Example

```
GET /oauth/authorize?
  response_type=code
  &client_id=your_client_id
  &redirect_uri=https://yourapp.com/callback
  &scope=openid profile email
  &state=random_state_string
  &code_challenge=base64url_challenge
  &code_challenge_method=S256
```

### Token Request Example

```bash
curl -X POST https://your-auth-server/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code" \
  -d "code=authorization_code_here" \
  -d "redirect_uri=https://yourapp.com/callback" \
  -d "client_id=your_client_id" \
  -d "client_secret=your_client_secret" \
  -d "code_verifier=original_code_verifier"
```

### Supported Scopes

| Scope | Description |
|-------|-------------|
| `openid` | Required for OIDC |
| `profile` | User profile information |
| `email` | User email address |
| `offline_access` | Refresh token |

---

## 👨‍💻 Developer Portal

The Developer Portal allows you to manage your authentication infrastructure.

### Portal Routes

| Route | Description |
|-------|-------------|
| `/developer` | Developer dashboard |
| `/developer/organizations` | List organizations |
| `/developer/organizations/new` | Create organization |
| `/developer/:orgSlug` | Organization dashboard |
| `/developer/:orgSlug/applications` | Manage applications |
| `/developer/:orgSlug/applications/new` | Register new application |
| `/developer/:orgSlug/api-keys` | Manage API keys |
| `/developer/:orgSlug/webhooks` | Configure webhooks |
| `/developer/:orgSlug/settings` | Organization settings |

### Application Types

| Type | Description | Use Case |
|------|-------------|----------|
| **Web Application** | Server-side apps | Traditional web apps with backend |
| **Single Page App** | Client-side apps | React, Vue, Angular apps |
| **Native/Mobile** | Mobile applications | iOS, Android apps |
| **Machine-to-Machine** | Backend services | API integrations, microservices |

### Webhook Events

Configure webhooks to receive real-time notifications:

| Event | Description |
|-------|-------------|
| `user.created` | New user registration |
| `user.updated` | User profile update |
| `user.deleted` | User account deletion |
| `session.created` | New login session |
| `session.revoked` | Session termination |
| `auth.failed` | Failed authentication attempt |

---

## 🔗 SDK API

RESTful API for managing users, authentication, and sessions. All requests require API key authentication.

### Authentication

Include your API key in the request header:

```
X-API-Key: your_api_key_here
```

Or in the Authorization header:

```
Authorization: Bearer your_api_key_here
```

### API Endpoints

#### User Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/sdk/users` | List users (paginated) |
| `POST` | `/api/sdk/users` | Create user |
| `GET` | `/api/sdk/users/:userId` | Get user by ID |
| `PATCH` | `/api/sdk/users/:userId` | Update user |
| `DELETE` | `/api/sdk/users/:userId` | Delete user |

#### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/sdk/auth/verify-password` | Verify user password |
| `POST` | `/api/sdk/auth/tokens` | Generate auth tokens |
| `POST` | `/api/sdk/auth/magic-link` | Send magic link |
| `POST` | `/api/sdk/auth/revoke` | Revoke tokens |

#### Sessions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/sdk/users/:userId/sessions` | List user sessions |
| `DELETE` | `/api/sdk/users/:userId/sessions/:sessionId` | Revoke session |

#### Organization

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/sdk/organization` | Get organization info |
| `GET` | `/api/sdk/stats` | Get usage statistics |

### SDK API Examples

#### Create User

```bash
curl -X POST https://your-auth-server/api/sdk/users \
  -H "X-API-Key: your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "securePassword123",
    "name": "John Doe"
  }'
```

#### Verify Password

```bash
curl -X POST https://your-auth-server/api/sdk/auth/verify-password \
  -H "X-API-Key: your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "securePassword123"
  }'
```

#### Generate Tokens

```bash
curl -X POST https://your-auth-server/api/sdk/auth/tokens \
  -H "X-API-Key: your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_id_here"
  }'
```

---

## ✉️ Magic Link Authentication

Passwordless authentication via secure email links.

### Magic Link Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/magic/login` | GET | Magic link login page |
| `/magic/request` | POST | Request magic link |
| `/magic/:token` | GET | Validate magic link |
| `/magic/:token/confirm` | POST | Complete authentication |
| `/magic/api/generate` | POST | API: Generate magic link |
| `/magic/api/verify` | POST | API: Verify magic link |

### How It Works

1. **User requests magic link** - Enter email on login page
2. **Email sent** - Secure token link delivered to inbox
3. **User clicks link** - Token validated, device fingerprinted
4. **Authentication complete** - User logged in or registered

### Magic Link Features

- ✅ Configurable expiration (default: 15 minutes)
- ✅ Single-use tokens
- ✅ Device fingerprinting
- ✅ Automatic user creation (optional)
- ✅ Existing user detection
- ✅ Rate limiting protection

---

## 📖 Documentation

### 📁 Project Structure

```
├── 📂 config/                 # Configuration files
│   ├── auth.js                 # Authentication config
│   ├── database.js             # MongoDB connection
│   └── passport.js             # Passport.js strategies
│
├── 📂 middleware/             # Express middleware
│   ├── auditLogger.js          # Audit trail logging
│   └── rateLimiter.js          # Rate limiting
│
├── 📂 models/                 # Mongoose schemas
│   ├── ApiKey.js               # API key model
│   ├── Application.js          # OAuth application model
│   ├── AuditLog.js             # Audit log model
│   ├── MagicLink.js            # Magic link token model
│   ├── OAuthToken.js           # OAuth token model
│   ├── Organization.js         # Organization model
│   ├── User.js                 # User model
│   └── Webhook.js              # Webhook model
│
├── 📂 routes/                 # Express routes
│   ├── admin.js                # Admin panel routes
│   ├── auth.js                 # Authentication routes
│   ├── developer.js            # Developer portal routes
│   ├── index.js                # Main routes
│   ├── magic.js                # Magic link routes
│   ├── oauth.js                # OAuth/OIDC routes
│   ├── users.js                # User routes
│   └── 📂 api/
│       ├── auth.js             # Auth API routes
│       ├── index.js            # API index
│       └── sdk.js              # SDK API routes
│
├── 📂 utils/                  # Utility functions
│   ├── email.js                # Email templates
│   ├── emailSender.js          # Email sending
│   ├── logger.js               # Winston logger
│   ├── security.js             # Security utilities
│   └── twoFactorAuth.js        # 2FA helpers
│
├── 📂 views/                  # EJS templates
│   ├── 📂 admin/               # Admin panel views
│   ├── 📂 auth/                # Auth views (magic link)
│   ├── 📂 developer/           # Developer portal views
│   ├── 📂 oauth/               # OAuth consent views
│   └── 📂 partials/            # Shared partials
│
├── 📂 public/                 # Static assets
│   ├── 📂 css/
│   │   ├── styles.css          # Main stylesheet
│   │   ├── developer.css       # Developer portal styles
│   │   └── auth-pages.css      # OAuth/magic link styles
│   └── 📂 js/
│       ├── scripts.js          # Main scripts
│       └── auth.js             # Auth-related scripts
│
└── 📄 app.js                  # Application entry point
```

### 🛤️ All Routes Overview

<table>
<tr>
<td width="50%">

#### 🌐 Web Routes

| Route | Description |
|-------|-------------|
| `/` | Home page |
| `/auth/login` | Login page |
| `/auth/register` | Registration |
| `/dashboard` | User dashboard |
| `/profile` | User profile |
| `/settings` | Account settings |
| `/sessions` | Active sessions |
| `/activity` | Activity log |
| `/admin` | Admin panel |

</td>
<td width="50%">

#### 🔑 OAuth Routes

| Route | Description |
|-------|-------------|
| `/oauth/authorize` | Authorization |
| `/oauth/token` | Token endpoint |
| `/oauth/userinfo` | User info |
| `/oauth/introspect` | Introspection |
| `/oauth/revoke` | Revocation |
| `/oauth/logout` | End session |
| `/.well-known/openid-configuration` | Discovery |
| `/.well-known/jwks.json` | JWKS |

</td>
</tr>
<tr>
<td width="50%">

#### 👨‍💻 Developer Routes

| Route | Description |
|-------|-------------|
| `/developer` | Dashboard |
| `/developer/organizations` | Organizations |
| `/developer/:org` | Org dashboard |
| `/developer/:org/applications` | Apps |
| `/developer/:org/api-keys` | API keys |
| `/developer/:org/webhooks` | Webhooks |
| `/developer/:org/settings` | Settings |

</td>
<td width="50%">

#### 🔗 API Routes

| Route | Description |
|-------|-------------|
| `/api/sdk/users` | User management |
| `/api/sdk/auth/verify-password` | Password verify |
| `/api/sdk/auth/tokens` | Token generation |
| `/api/sdk/auth/magic-link` | Magic link API |
| `/api/sdk/organization` | Org info |
| `/api/sdk/stats` | Usage stats |
| `/api/health` | Health check |

</td>
</tr>
</table>

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                    CLIENT LAYER                                          │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│  🌐 Web Browser       📱 Mobile App       🔧 Third-Party Apps      🤖 Backend Services  │
│  (EJS + Bootstrap)    (SDK API)           (OAuth 2.0/OIDC)         (Client Credentials) │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                           │
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                    GATEWAY LAYER                                         │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│  🛡️ Helmet.js     🔒 CSRF Protection     ⏱️ Rate Limiting     🔐 API Key / JWT Auth    │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                           │
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                 APPLICATION SERVICES                                     │
├────────────────────────┬────────────────────────┬───────────────────────────────────────┤
│   🔑 OAuth/OIDC        │   👨‍💻 Developer Portal   │   ✉️ Magic Links                     │
│   Provider             │                        │                                       │
│   • Authorization      │   • Organizations      │   • Token Generation                  │
│   • Token Endpoint     │   • Applications       │   • Email Delivery                    │
│   • UserInfo           │   • API Keys           │   • Verification                      │
│   • Introspection      │   • Webhooks           │   • Session Creation                  │
│   • Revocation         │   • Statistics         │   • User Registration                 │
├────────────────────────┼────────────────────────┼───────────────────────────────────────┤
│   🔗 SDK API           │   👤 User Service      │   🔔 Webhook Service                  │
│                        │                        │                                       │
│   • User CRUD          │   • Authentication     │   • Event Dispatch                    │
│   • Password Verify    │   • Profile            │   • Retry Logic                       │
│   • Token Generation   │   • 2FA                │   • Signature Validation              │
│   • Session Mgmt       │   • Sessions           │   • Delivery Tracking                 │
└────────────────────────┴────────────────────────┴───────────────────────────────────────┘
                                           │
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                     DATA LAYER                                           │
├───────────────────────┬───────────────────────┬─────────────────────────────────────────┤
│   📊 MongoDB          │   🗄️ Collections        │   🔐 Security                          │
│                       │                       │                                         │
│   • Users             │   • Organizations     │   • Password Hashing (bcrypt)           │
│   • Sessions          │   • Applications      │   • JWT Signing (RS256)                 │
│   • Audit Logs        │   • API Keys          │   • Token Encryption                    │
│   • OAuth Tokens      │   • Webhooks          │   • PKCE Verification                   │
│   • Magic Links       │   • Audit Logs        │   • Scope Validation                    │
└───────────────────────┴───────────────────────┴─────────────────────────────────────────┘
```

### Data Flow

```
┌────────────┐     ┌─────────────────┐     ┌──────────────┐     ┌────────────────┐
│  Client    │────▶│  Auth Request   │────▶│  Validate    │────▶│  Issue Token   │
│  App       │     │  (OAuth/Magic)  │     │  Credentials │     │  (JWT/Session) │
└────────────┘     └─────────────────┘     └──────────────┘     └────────────────┘
                                                                        │
                   ┌─────────────────┐     ┌──────────────┐            │
                   │  Webhook        │◀────│  Log Audit   │◀───────────┘
                   │  Dispatch       │     │  Event       │
                   └─────────────────┘     └──────────────┘
```

---

## 🛣️ Roadmap

<div align="center">

### 🎯 Evolution Path: Current → Scale → Enterprise

</div>

<table>
<tr>
<th align="center" width="33%">

### ✅ Phase 1: Complete
**Current State**

</th>
<th align="center" width="33%">

### 🔄 Phase 2: Scale
**Next Steps**

</th>
<th align="center" width="33%">

### 📋 Phase 3: Enterprise
**Future**

</th>
</tr>
<tr>
<td valign="top">

**✅ Auth-as-a-Service**
- [x] OAuth 2.0 Provider
- [x] OpenID Connect
- [x] PKCE Support
- [x] Developer Portal
- [x] Organization Management
- [x] Application Registration
- [x] API Key Management
- [x] Webhook System
- [x] SDK API
- [x] Magic Link Auth
- [x] Multi-factor Auth
- [x] Social OAuth Login
- [x] Session Management
- [x] Audit Logging
- [x] Admin Panel

</td>
<td valign="top">

**🔄 Scaling Features**
- [ ] Redis Session Store
- [ ] Docker Containerization
- [ ] CI/CD Pipeline
- [ ] Unit & Integration Tests
- [ ] API Documentation (Swagger)
- [ ] WebSocket Support
- [ ] Push Notifications
- [ ] SMS 2FA (Twilio)
- [ ] Organization Invites
- [ ] Team Management
- [ ] Role-Based Access

</td>
<td valign="top">

**📋 Enterprise Features**
- [ ] Kubernetes Deployment
- [ ] Multi-tenancy Isolation
- [ ] SSO/SAML Integration
- [ ] Compliance (SOC2, GDPR)
- [ ] Geographic Redundancy
- [ ] Real-time Monitoring
- [ ] AI Threat Detection
- [ ] Custom Branding
- [ ] White-label Solution
- [ ] SLA Management

</td>
</tr>
</table>

---

## 🛠️ Tech Stack

<table>
<tr>
<td width="25%" align="center">

### Backend
<br />
<img src="https://skillicons.dev/icons?i=nodejs,express,mongodb" />
<br /><br />

- **Runtime**: Node.js 18+
- **Framework**: Express 4.18
- **Database**: MongoDB 6+
- **ODM**: Mongoose 7.5

</td>
<td width="25%" align="center">

### Security
<br />
<img src="https://skillicons.dev/icons?i=linux" />
🛡️ 🔐
<br /><br />

- **Auth**: Passport.js
- **Tokens**: JWT (RS256)
- **Hashing**: bcrypt
- **2FA**: Speakeasy

</td>
<td width="25%" align="center">

### Frontend
<br />
<img src="https://skillicons.dev/icons?i=bootstrap,html,css" />
<br /><br />

- **Templates**: EJS
- **CSS**: Bootstrap 5.3
- **Icons**: Bootstrap Icons
- **External CSS/JS**: Modular

</td>
<td width="25%" align="center">

### Protocols
<br />
🔑 🔗 🌐
<br /><br />

- **OAuth 2.0**: Full spec
- **OIDC**: Discovery + JWKS
- **PKCE**: S256 method
- **REST**: JSON API

</td>
</tr>
</table>

---

## 🎨 Code Quality

This project follows clean code principles:

- ✅ **Externalized CSS** - All styles in dedicated CSS files
- ✅ **Externalized JavaScript** - All scripts in dedicated JS files
- ✅ **No Inline Styles** - Clean HTML templates
- ✅ **Modular Architecture** - Separation of concerns
- ✅ **Reusable Components** - EJS partials for consistency
- ✅ **Organized File Structure** - Logical directory layout

### CSS Files

| File | Purpose |
|------|---------|
| `styles.css` | Main application styles |
| `developer.css` | Developer portal styles |
| `auth-pages.css` | OAuth consent & magic link styles |

### JS Files

| File | Purpose |
|------|---------|
| `scripts.js` | Main application scripts |
| `auth.js` | Authentication-related scripts (password toggle, strength meter) |

---

## 🚀 Integration Guide

### Integrating Your App with This Auth Service

#### 1. Register Your Application

1. Log in to the Developer Portal at `/developer`
2. Create or select an organization
3. Create a new application with your redirect URIs
4. Note your `client_id` and `client_secret`

#### 2. Implement OAuth Flow

```javascript
// Redirect user to authorization
const authUrl = `${AUTH_SERVER}/oauth/authorize?` +
  `response_type=code&` +
  `client_id=${CLIENT_ID}&` +
  `redirect_uri=${REDIRECT_URI}&` +
  `scope=openid profile email&` +
  `state=${generateState()}`;

window.location.href = authUrl;
```

#### 3. Handle Callback

```javascript
// Exchange code for tokens
const response = await fetch(`${AUTH_SERVER}/oauth/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code: authorizationCode,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET
  })
});

const { access_token, id_token, refresh_token } = await response.json();
```

#### 4. Get User Info

```javascript
const userInfo = await fetch(`${AUTH_SERVER}/oauth/userinfo`, {
  headers: { 'Authorization': `Bearer ${access_token}` }
}).then(r => r.json());
```

---

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

<table>
<tr>
<td width="50%">

### 🐛 Report Bugs
Found a bug? [Open an issue](https://github.com/PerezChris99/passport-authentication-application/issues/new?template=bug_report.md)

</td>
<td width="50%">

### 💡 Request Features  
Have an idea? [Suggest a feature](https://github.com/PerezChris99/passport-authentication-application/issues/new?template=feature_request.md)

</td>
</tr>
</table>

---

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

---

<div align="center">

### 🌟 Star this repo if you find it useful!

<br />

**Auth-as-a-Service Platform** - Complete authentication infrastructure for your applications

<br />

Made with ❤️ by [PerezChris99](https://github.com/PerezChris99)

<br />

**[⬆ Back to Top](#-auth-as-a-service-platform)**

</div>
