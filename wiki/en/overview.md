# Product overview

[Wiki index](../README.md) · [简体中文](../zh-CN/overview.md) · [Technical documentation](../../docs/en/README.md)

CrewQual manages member qualifications, credential expiry dates, update submissions, and human review. It also includes a calendar, notifications, and progression plans. Members view their qualifications and submit evidence through the portal. Administrators maintain personnel and rules, review updates, and follow up on upcoming expirations.

## Basic concepts

| Term                      | Meaning                                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Member                    | A personnel record with an employee number, contact details, unit, and position assignments.                               |
| Position and assignment   | A position defines required qualifications. A member record tracks primary and secondary assignments.                      |
| Qualification requirement | A qualification required for a position, with validity and field rules.                                                    |
| Active record             | The qualification data currently in effect, used to display expiry dates and qualification status.                         |
| Update submission         | Evidence and fields submitted by a member for review. A successful submission does not mean the active record has changed. |
| Human review              | An authorized administrator checks evidence, corrects fields, and approves or returns the submission.                      |
| Progression plan          | A staged plan for personnel progression or training, with plan and stage progress.                                         |

Member management provides entry points by position. The repository also retains the `/pilot` portal and related pages for pilots. The general member portal is at `/member`.

## How a qualification update works

1. A member opens a qualification, uploads a credential image, and checks the fields.
2. When an AI service is configured, the system provides recognition or comparison results. Manual entry remains available.
3. The member submits the update and receives a receipt.
4. An administrator compares the evidence, submitted fields, assisted results, and active record in the review workspace.
5. Approval activates the new qualification record. If the submission is returned, the member follows the feedback and submits again.

AI assists data entry and review. An AI result never approves a submission automatically.

## Validity and submission status

Validity rules support a manually entered expiry date, a fixed number of months calculated from the issue or training date, and long-term validity. Long-term qualifications have no expiry date. Dates for fixed-cycle qualifications must satisfy the configured rule.

The member page groups qualifications into expired, due within 30 days, due within 90 days, and valid. Submission receipts separately show received, processing, approved, or returned for additional evidence. To check whether a qualification has changed, check both the submission result and the active record.

## Where to start

- For the member portal, read the [member guide](member-guide.md).
- For personnel management and reviews, read the [administrator guide](admin-guide.md).
- For installation, SMS, or storage setup, read the [technical documentation](../../docs/en/README.md).

## Implementation references

[Member detail](../../src/components/admin/member-detail-view.tsx), [validity rules](../../src/lib/qualification-rules.ts), [submission status](../../src/server/submission-status.ts), and [review workspace](../../src/components/admin/review-detail-view.tsx).
