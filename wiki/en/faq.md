# FAQ

[Wiki index](../README.md) · [简体中文](../zh-CN/faq.md) · [Technical documentation](../../docs/en/README.md)

## Why did the request succeed without an SMS arriving?

The page gives the same response for matching and nonmatching details to avoid exposing personnel information. Check your employee number and registered 11-digit mobile number. Ask an administrator to check your active status, whether SMS is enabled, and delivery status. Requests are rate limited separately by source address, employee number, and mobile number. If an unexpired link already exists, another request does not send a new link. A member with a password, TOTP, or FIDO2 factor cannot use SMS as a recovery or downgrade path.

## What should I do with an expired or used link?

A link can be redeemed once. Its default lifetime and server-side cap are 10 minutes, subject to the active security policy. A browser that is already signed in can continue using its valid session. If you have no valid session, return to the identity page and request another link.

## What are the three authentication targets?

Enhanced authentication requires password, TOTP, and FIDO2 for administrators and members. Combined authentication requires password and TOTP for both. Convenience authentication, the recommended target, uses password and TOTP for administrators and a one-time SMS link for members. The target name describes identity configuration; it does not mean that every ASVS or Level 3 requirement has passed. See [Security and authentication](security.md).

## What should an administrator do after forgetting a password?

Ask an authorized administrator to start a recovery task from account management. The target administrator must open `/admin/password-reset` and set a new password within 30 minutes. A verified TOTP also requires the current code; without a verified TOTP, complete the task in a browser where the target account is still signed in. Completing the task invalidates the account's other sessions. The current flow does not send a recovery link by email or SMS.

## Can I submit if AI did not recognize the dates?

You can enter and check the fields manually. You can submit once evidence is uploaded and the fields satisfy the rules. Follow any confirmation prompt. AI does not approve submissions automatically; an administrator still checks the evidence.

## Why can I not enter any expiry date?

The qualification may use a fixed-month rule calculated from the issue or training date. Long-term qualifications do not allow an expiry date. If the configuration does not match your organization's requirements, ask an administrator to check the qualification rule.

## Why did the qualification date stay the same after submission?

Successful submission means the system received the update request. The active record changes after an administrator approves it. Open the receipt to check its status. If it was returned, follow the reason, supply the requested evidence or corrections, and submit again.

## Can I upload a PDF or an iPhone HEIC image?

The credential upload accepts images, not PDFs. Supported formats include JPEG, PNG, WebP, AVIF, and GIF. HEIC/HEIF depends on browser decoding support and must be converted before use in Chrome. Convert it to JPEG or PNG if Safari cannot read it either.

## Why can an administrator not see a member or an action button?

Roles and assigned units limit access. Administrators other than super administrators require a unit. Reviewers can make review decisions; viewers cannot write business data. Ask a super administrator to check the account's role, unit, and active status.

## Why are some qualification names still Chinese in English mode?

Interface language and organization-entered business data are separate. Check whether the position, qualification, or template has an English name. Changing the interface language does not automatically translate arbitrary names or notes.

## Where are installation, upgrade, and recovery instructions?

Read the [technical documentation](../../docs/en/README.md). When reporting a problem, include the deployed version, time, relevant page, receipt or request ID, and error details with personal information removed. Do not include access links, passwords, or verification codes.

## Implementation references

[Access link handling](../../src/app/api/pilot/access-link/route.ts), [permissions](../../src/server/admin-permissions.ts), [validity checks](../../src/lib/qualification-rules.ts), [image support](../../src/lib/image-processing.ts), and [business name localization](../../src/lib/i18n.ts).
