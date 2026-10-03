# Gmail reconnect service

Status: implemented and tested locally. NOT deployed or enabled in production. The current production deployment is 6ac05191e4bf163de7470af3; this branch is based on 7ebc010 and must not replace the newer production source wholesale.

## Deployment prerequisites

1. Apply these focused changes to the verified current source, preserving its worker recovery, Gmail diagnostics and payment-handoff changes. The worker change only loads a refreshed token before its existing exchange; keep the current diagnostics.
2. In Google Cloud, add this exact authorized redirect URI to the existing Gmail Web application OAuth client: `https://www.daronroyal.com/api/gmail-reconnect`. This has NOT been registered or verified. Google Cloud is unavailable in the agent browser.
3. Production needs its existing matching GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_ACCOUNT, APPOINTMENT_ACTION_SECRET (at least 32 characters), NETLIFY_ACCESS_TOKEN with access to this site's Blobs, plus GMAIL_OAUTH_SITE_ID=1e40c2ba-a615-4fd1-a149-6ee4e78c5ebc. Keep Gmail credentials separate from Calendar credentials.
4. Deploy the focused service and dependency updates on the exact current source. Leave GMAIL_RECONNECT_ENABLED unset until its storage access and the registered Google callback are verified; then set it to true and redeploy the current bundles.
5. Owner signs into the practitioner dashboard, opens `/api/gmail-reconnect`, and completes Google consent. This grants the existing gmail.readonly scope. Credentials and tokens are neither pasted in chat nor displayed by the callback.
6. Verify the next payment-email-reconcile run succeeds. Consent success alone does not establish successful payment reconciliation. No historical payment records should be invented or marked paid manually.

## Security and operation

Owner-only start and callback revalidation; same-origin POST; random state and separate HttpOnly/Secure/SameSite=Lax cookie; 10-minute expiry; PKCE; one-time authorization-request consumption; exact configured Gmail account check; Google callback errors sanitized. Authorization request and refresh token data are encrypted with AES-256-GCM using a purpose-derived key from APPOINTMENT_ACTION_SECRET. Only backend functions use the site-scoped Netlify Blobs store. The refreshed token is bound to the configured client ID and account.

The existing Netlify token's permission to access Blobs must be verified before enabling. Do not broaden access silently. Rotating APPOINTMENT_ACTION_SECRET makes stored records unreadable and requires reconnecting Gmail. Setting GMAIL_RECONNECT_ENABLED away from true restores use of the existing environment token; it does not repair a revoked environment token.

Tests: node qa/gmail-reconnect-security-test.cjs; node --experimental-strip-types qa/gmail-reconnect-flow-test.cjs (Node 24 used locally). The latter mocks auth, storage and Google; it does not establish real Google registration or deployed storage access.
