# Security Policy & Vulnerability Reporting

## 🛡️ Supported Versions

We actively provide security patches and dependency updates for the following versions:

| Version | Supported |
|---------|-----------|
| 2.x     | Yes       |
| < 2.0   | No        |

---

## 🔒 Security Invariants & Threat Model

WealthOS is designed for active financial traders and quantitative systems. The following security invariants must be maintained at all times:

1. **Zero Plaintext Secrets in Repositories:** Never commit `.env`, private keys, API secrets, or session cookies.
2. **Local-First Key Management:** User broker tokens, TOTP secrets, and API credentials must be encrypted using AES-256 with user PBKDF2 salt before persistence.
3. **No Unauthenticated Broker Execution:** Order execution APIs must never be exposed directly to the public web without reverse-proxy authentication, WAF rate limiting, and origin IP validation.

---

## 🚨 Reporting a Vulnerability

If you discover a security vulnerability or credential exposure risk in WealthOS:

1. **Do NOT open a public GitHub issue.**
2. Send a confidential report directly to the security maintainer:
   - **Lead Architect:** Sudhanshu Gaddam ([@0codedev](https://github.com/0codedev))
   - **GitHub Security Advisory:** Use GitHub's private vulnerability reporting feature on the [WealthOS repository](https://github.com/0codedev/wealthos/security/advisories/new).
3. Include:
   - Description of the vulnerability and attack vector
   - Steps to reproduce or proof-of-concept payload
   - Potential impact on client data or trading sessions

We appreciate responsible disclosure and aim to acknowledge reports within 48 hours and release validated patches swiftly.
