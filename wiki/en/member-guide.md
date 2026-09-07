# Member guide

[Wiki index](../README.md) · [简体中文](../zh-CN/member-guide.md) · [Technical documentation](../../docs/en/README.md)

## Open the member portal

1. Open your organization's CrewQual address and go to `/member/identity`.
2. Enter your employee number and registered mobile number. The current form requires an 11-digit mobile number.
3. Request an access link, then open the link sent to your registered phone by SMS.

The accepted message does not reveal whether your details matched. If the SMS does not arrive, ask an administrator to check your employee number, mobile number, active status, and the SMS service.

An access link can be redeemed once. Links expire after 15 minutes by default, and the resulting session lasts 60 minutes by default. Administrators can change the security policy. Request another link after expiry. A browser with a valid session can continue using that session without redeeming the same link again.

## View qualifications

My qualifications lists your current qualifications and expiry information. Start with expired and upcoming items, then open the qualification you need to update. Long-term qualifications have no expiry date.

Ask an administrator to correct errors in your name, contact details, position, or qualification requirements.

## Submit an update

1. Open the qualification update page and capture or select a credential image.
2. Crop the image as prompted, retaining the credential number, dates, issuing authority, level, and other details needed for review.
3. Check the credential number, issue date, issuing authority, and level/parameter. Enter the training date when the form requests it.
4. Check the expiry date. Fixed-month rules calculate it from the issue or training date. Leave it empty for long-term qualifications.
5. Check recognized dates and candidate values, correcting errors. You can also enter the fields manually. Follow any confirmation prompt before submitting.
6. Keep the receipt ID and check the receipt or notifications for the decision.

The submit button becomes available once evidence has uploaded and the required fields satisfy the rules. Wait for any upload still in progress. If AI is temporarily unavailable, you can still enter the fields manually; the application still requires human review.

You can close the page after submission. The active record changes only after approval. A returned submission requires you to read the reason, provide the requested evidence or corrections, and submit again.

![Member credential upload page](../../docs/images/readme/member-credential-upload-mobile.png)

Example member upload. The screenshot contains no real personnel information.

## Images and notifications

Credential upload accepts JPEG, PNG, WebP, AVIF, and GIF images. HEIC/HEIF depends on browser decoding support. Chrome users must convert these files to JPEG or PNG; do the same if Safari cannot read them. PDF is not a supported format for this image upload.

The notifications page shows review results and qualification reminders. You can mark notifications as read. Delivery through external channels such as SMS depends on your organization's configuration.

## Implementation references

[Identity form](../../src/components/pilot/identity-form.tsx), [access links](../../src/app/api/pilot/access-link/route.ts), [sessions](../../src/server/auth.ts), [update form](../../src/components/pilot/qualification-update-flow.tsx), and [image handling](../../src/lib/image-processing.ts).
