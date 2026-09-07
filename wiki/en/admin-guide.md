# Administrator guide

[Wiki index](../README.md) · [简体中文](../zh-CN/admin-guide.md) · [Technical documentation](../../docs/en/README.md)

## Sign in and permissions

Open `/admin/login` and enter your administrator email. Supply a password, a time-based one-time code (TOTP), or both as requested by the page. The security policy determines the login method.

| Role                              | Typical actions                                                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Super administrator `SUPER_ADMIN` | All administrative permissions, including administrator accounts, security policies, backup and restore, system updates, and audit access.                          |
| Administrator `ADMIN`             | Maintain personnel, review submissions, manage calendar entries and progression plans, retry notifications, and maintain unit, position, and notification settings. |
| Reviewer `REVIEWER`               | View personnel and business pages, and approve or return submissions.                                                                                               |
| Viewer `VIEWER`                   | View business pages without review decisions or business write access.                                                                                              |

Administrators other than super administrators require an assigned unit, which limits their access to personnel data. Access to the settings page does not grant permission to edit every setting. The system requires at least one active super administrator.

## Maintain members and requirements

1. Check organization, unit, and position settings. The member management home shows entry points for installed position templates.
2. Open member management, choose a position, then find or add a member. For bulk entry, use the CSV import and preview workflow and resolve reported errors before importing.
3. Check the employee number, registered mobile number, unit, and active status. These details affect access to the member portal.
4. Check primary and secondary positions, qualification requirements, and active records in member details.
5. Check qualification names, validity rules, and field restrictions in qualification configuration before asking members to submit updates.

## Review update submissions

Open `/admin/reviews` and select a pending submission.

1. Inspect the credential image and compare submitted fields, AI-assisted results, and the active record.
2. Correct inaccurate fields using manual correction. The review retains the original values and marks corrected fields as manually changed.
3. If the evidence meets the requirements, approve the submission and confirm that you checked the credential and information. A review note is optional.
4. If more evidence is needed, return the submission with a specific reason, such as “Please upload the lower half of the credential showing its expiry date.” The reason must contain at least five characters.
5. Check the decision and notification status. External notifications use the configured channels.

If the system reports that someone else changed the record, reload the submission and check its latest contents before deciding.

Some personnel qualification maintenance pages also let authorized administrators correct the active record directly. Saving immediately changes the qualification and writes an audit record, so verify the evidence and dates before saving.

![Qualification review workspace](../../docs/images/readme/qualification-review.png)

Example review workspace. The screenshot contains no real personnel information.

## Daily follow-up

Use the dashboard and member lists to find missing, expired, or upcoming qualifications. The calendar brings related events together. Use progression plans to maintain stage schedules and progress.

Notification logs show delivery status. Administrators with retry permission can retry eligible failed deliveries. When a member does not receive an SMS, check the personnel details, then the notification configuration and logs.

Permissions control access to AI, object storage, media optimization, security, backup, and update settings. See the [technical documentation](../../docs/en/README.md) for deployment, upgrades, backup, and recovery procedures.

## Implementation references

[Administrator permissions](../../src/server/admin-permissions.ts), [login form](../../src/app/admin/login/login-form.tsx), [personnel actions](../../src/components/admin/pilot-management-dialogs.tsx), [review dialogs](../../src/components/admin/review-dialogs.tsx), and [system settings](../../src/components/admin/admin-settings-view.tsx).
