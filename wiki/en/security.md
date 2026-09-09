# Security and authentication

[Wiki index](../README.md) · [简体中文](../zh-CN/security.md) · [Technical documentation](../../docs/en/README.md)

This page describes authentication and security behavior in the current implementation. The Authentication target in setup and System settings configures identity factors; it does not mean that CrewQual has passed every ASVS or Level 3 requirement. The [security improvement plan](../../docs/security/2026-09-07-security-improvement-plan.md) and [security gap audit](../../docs/security/2026-09-07-product-security-gap-audit.md) list work that is still pending or needs validation.

## Authentication targets

Setup and System settings provide three targets. Changing a target requires reauthentication under the current policy. High-risk reauthentication is enabled by default.

| Target                    | Administrators          | Members                             | Prerequisite                                                                                                      |
| ------------------------- | ----------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Enhanced authentication   | Password + TOTP + FIDO2 | Password + TOTP + FIDO2             | Purchase a security key and bind it in an HTTPS secure context                                                    |
| Combined authentication   | Password + TOTP         | Password + TOTP                     | Every account must bind a password and TOTP                                                                       |
| Convenience (recommended) | Password + TOTP         | Employee number + one-time SMS link | Members use single-factor sign-in, which does not meet the ASVS L2 or Level 3 combined-authentication requirement |

The enhanced target requires a user-verified WebAuthn credential. The implementation checks the challenge, origin, RP ID, expiry, and user verification. It accepts a non-synchronizable single-device credential and uses `attestationType: none`, so a successful registration or a product name alone does not prove that the hardware source has been attested. System settings use Yubico Security Key C NFC as an example of a security key. A normal six-digit code from Microsoft Authenticator is TOTP, not FIDO2 hardware authentication.

The target name is a configuration label. Overall compliance still depends on the other applicable controls and item-by-item verification. Disabling a combined factor or high-risk reauthentication shows a downgrade warning and requires confirmation under the current policy.

## Member access and factor enrollment

Under the convenience target, a member enters an employee number and registered mobile number at `/member/identity` and requests a one-time SMS link. Matching and nonmatching requests return the same accepted response, so the page does not reveal whether a person exists.

Access links are valid for 10 minutes by default, and the server caps their lifetime at 10 minutes. Each link can be redeemed once. Requests are rate limited separately by source address, employee number, and mobile number. If an unexpired link exists, another request does not invalidate it or send a replacement. Links, enrollment sessions, and password recovery tasks carry the security policy version; after a policy change, an old link or pending task cannot establish or retain access under the old policy.

Under the combined or enhanced target, an SMS link only opens a restricted enrollment session for an account without existing authentication factors. Under Combined, the member must complete password and TOTP enrollment; under Enhanced, the member must complete password, TOTP, and FIDO2 enrollment. This happens at `/member/security` or the compatibility `/pilot/security` page before the session can view qualifications. An account with existing factors cannot use SMS to recover its password, bind TOTP again, or downgrade to SMS sign-in.

The member security page is currently focused on first-time enrollment. An already authenticated member is redirected to qualifications; the page is not a complete device-management center. Authenticated members can use the member security APIs to list or revoke their other sessions, but the current interface does not promise a full device list or recovery workflow.

## Administrator sign-in, sessions, and password recovery

The administrator sign-in page requests the password, TOTP, and FIDO2 factors required by the active policy. Administrator sessions have an 8-hour absolute lifetime by default and end after 15 minutes of inactivity. Member sessions have a 60-minute absolute lifetime by default and end after 30 minutes of inactivity. Administrator and member password logins are rate limited separately by source address and account or employee number. The default administrator policy locks an account after five failed attempts for 15 minutes; these values can be changed in the security policy. A policy version change invalidates older sessions; background polling does not renew a session forever.

Administrators can view active sessions in the security area of System settings; non-super administrators see their own sessions. The list shows the browser and a masked IP address. A super administrator with `settings.security.write` can end another administrator's session; the current session cannot be ended from that list. Session revocation and policy changes are recorded in the audit history.

An administrator starts a password recovery task from administrator account management. The system creates a one-time handoff, and the target administrator completes it at `/admin/password-reset`. The task expires after 30 minutes. If the target account has verified TOTP, the current code is required; otherwise the target must complete the task in a browser where that account is already signed in. Completing recovery revokes all administrator sessions for that account. The current flow does not send an email or SMS and cannot provide self-service recovery after every factor and session has been lost.

## Audit, browser, and API protection

System settings includes a Security and audit area. Authorized roles can filter recent audit records, view administrator sessions, and inspect read-only 24-hour, 7-day, or 30-day statistics for public scans, credential stuffing, and distributed login attempts. The view shows batches, related requests, sources, category trends, and collection completeness; delayed or failed collection is never presented as a clean zero. After each administrator sign-in, it shows a summary since the previous successful sign-in, capped at 30 days, or the latest 24 hours for a first sign-in. A browser session shows that summary once without creating server-side read state. `audit.read` is a separate read permission; it does not grant account, system, or security-policy management. The feature has no acknowledgement, response, automatic blocking, or external security notifications and is not a complete incident-response platform.

Before private evidence is read, the server checks that the current member owns the evidence and issues a temporary URL valid for five minutes. The access event records the actor, object, and expiry metadata without recording image contents or the complete signed URL.

Browser responses use a per-response nonce CSP, `base-uri 'none'`, same-origin window policy, `nosniff`, frame denial, and a permissions policy. Production scripts do not rely on `unsafe-inline`. Authenticated state-changing requests check the request origin and a CSRF token; login and recovery entry points use same-origin and their own credential checks. Access-link pages use `no-store`, `no-referrer`, and `noindex`. Session cookies are HttpOnly and SameSite=Lax; Secure is set only for an HTTPS origin. Cookie names remain `crewqual_*`; the `__Host-` prefix is not implemented.

## Upload limits

Member credential uploads reserve quota in a serializable database transaction. Active reservations count toward the limits, so concurrent uploads cannot bypass them. Current per-account limits are three concurrent uploads, ten uploads per 15 minutes, 30 uploads and 200 MiB per day, 1 GiB of total held files, and ten orphaned files awaiting association. A reservation lease lasts five minutes and is released after failure or cleanup.

These limits are not malware scanning. The current code does not yet isolate a file from viewing, signed URL issuance, or model recognition whenever a scanning service is unavailable, fails, or times out. A successful upload therefore does not mean that a virus or malicious-file scan has completed.

## Current boundary

Implemented behavior and security targets must remain separate. Physical security-key validation, malicious-file scanning and quarantine, device-risk decisions, proactive security notifications, anti-phishing codes, root-key rotation, a complete high-risk operation reauthentication matrix, complete security-event handling, and external PostgreSQL concurrency and recovery validation remain pending or unverified. ARM64 isolation deployment has been recorded, but it does not make every deployment environment automatically pass security acceptance.

The recorded ARM64 isolation acceptance covered native image builds, migrations and bootstrap, PostgreSQL, MinIO, Caddy, and Worker health, readiness probes, administrator login and sessions, rejection of invalid same-origin and CSRF requests, database role restrictions, host-side PostgreSQL isolation, and restart recovery. Temporary containers, volumes, images, keys, and override files were removed after the acceptance run. These results apply to that isolated environment and do not replace hardware, scanning-service, external-database concurrency, or complete control verification.

## Implementation references

[Security policy](../../src/server/runtime-settings.ts), [authentication and sessions](../../src/server/auth.ts), [WebAuthn](../../src/server/webauthn.ts), [upload quotas](../../src/server/upload-quotas.ts), [security signals and detection](../../src/server/security-detection.ts), [security settings](../../src/components/admin/settings/security-settings-section.tsx), [browser policy](../../src/middleware.ts), and [evidence access audit](../../src/app/api/evidence-images/[id]/url/route.ts).
