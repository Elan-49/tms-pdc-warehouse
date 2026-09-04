# TMS PDC Warehouse — Security Operations Guide

## Production rule

The deployed application must use Supabase Auth. Local passcode mode is allowed only on `localhost` for development and is disabled automatically on public production hosts.

## User lifecycle

1. New account signs up.
2. Supabase creates the account and a `user_profiles` row with `status = pending` and `role = viewer`.
3. An administrator approves the account and assigns `viewer`, `analyst`, or `admin`.
4. Suspended users keep their account but cannot access study data.
5. Role changes are audited.

## First admin bootstrap

After creating the first account, find its UUID in Supabase Authentication > Users, then run:

```sql
update public.user_profiles
set role = 'admin',
    status = 'approved',
    approved_at = now(),
    approved_by = id,
    updated_at = now()
where id = 'PASTE_FIRST_ADMIN_USER_UUID_HERE';
```

After the first admin exists, all further approvals can be done from the app's User Management screen.

## Key rules

- Never put a `service_role` key in frontend code.
- The Supabase publishable/anon key may be present in frontend code; RLS is the database boundary.
- Keep production backups independent of browser localStorage.
- Review audit logs after any suspicious or unexpected data change.
- Prefer suspension instead of deleting a user account immediately when investigating an incident.
