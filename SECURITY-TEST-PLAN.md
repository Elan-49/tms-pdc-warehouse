# TMS PDC Warehouse — Security Acceptance Test

Use this checklist after running `supabase/schema.sql` and redeploying the app.

## A. Authentication

- [ ] Open the production URL in Incognito: the app must show Login.
- [ ] Refresh without logging in: dashboard/data must not appear.
- [ ] Login with a valid but `pending` account: access must be blocked with an approval message.
- [ ] Login with an `approved` account: app opens normally.
- [ ] Logout, then press browser Back: protected screens must not become usable.
- [ ] Test a wrong password: login must fail without revealing backend details.

## B. Role-based authorization

Create at least three approved users:

- admin
- analyst
- viewer

Expected permissions:

| Action | Admin | Analyst | Viewer |
|---|---:|---:|---:|
| View dashboard/data/analysis | Yes | Yes | Yes |
| Add/edit observation | Yes | Yes | No |
| Import CSV | Yes | Yes | No |
| Export CSV | Yes | Yes | No |
| Add/edit master element | Yes | Yes | No |
| Delete master element | Yes | No | No |
| Add/edit PIC/rating | Yes | Yes | No |
| Delete PIC | Yes | No | No |
| Change allowance/N minimum | Yes | No | No |
| Approve/suspend/change roles | Yes | No | No |
| Read audit log | Yes | No | No |
| Delete observation | Yes | No | No |

The UI restriction is not the security boundary. The real test is that Supabase returns a denied operation when a lower-role user attempts a restricted write.

## C. Direct database/RLS tests

Use the browser DevTools Network tab while logged in as each role.

- [ ] Viewer SELECT works.
- [ ] Viewer INSERT/UPDATE/DELETE returns an authorization error.
- [ ] Analyst INSERT/UPDATE works where allowed.
- [ ] Analyst DELETE on observations/master/operators is denied.
- [ ] Admin DELETE works.
- [ ] A pending/suspended account receives no study data.
- [ ] No request exposes a Supabase `service_role` key.

## D. Audit log tests

Perform an INSERT, UPDATE, and DELETE using an admin/allowed account.

- [ ] A corresponding row appears in `audit_logs`.
- [ ] `actor_id`, action, table, record ID, timestamp are populated.
- [ ] UPDATE contains old and new data.
- [ ] Browser users cannot modify or delete audit rows.

## E. Data-loss / recovery tests

- [ ] Run a small export of production data.
- [ ] Confirm Supabase backup/recovery is enabled for the project plan.
- [ ] Test restoring a non-production copy or export.
- [ ] Do not rely on browser localStorage as the only backup.

## F. Basic web security checks

- [ ] Production URL is HTTPS.
- [ ] Browser console does not show leaked secrets.
- [ ] Response headers include security headers configured in `vercel.json`.
- [ ] Try large repeated login attempts and review Vercel/Supabase logs for abnormal traffic.
- [ ] Test common input fields with harmless strings such as `<script>alert(1)</script>` and SQL-like text; the UI must display them as text and not execute them.

## Pass criteria

The application should not be considered production-ready until all authentication, RLS, role, audit, and backup checks pass.
