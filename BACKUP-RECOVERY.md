# TMS PDC Warehouse — Backup & Recovery Checklist

This file is intentionally operational rather than provider-specific.

1. Verify the current Supabase plan and its backup retention in the project dashboard.
2. Enable/verify database backups and point-in-time recovery where available on the plan.
3. Keep periodic CSV exports of `observations`, `master_elements`, `operators`, and `rating_factors` in a controlled company location.
4. Store at least one backup copy separately from the application deployment.
5. Perform a recovery drill on a non-production copy before the application is used for official company records.
6. Record the recovery owner and the date of the last successful restore test.
