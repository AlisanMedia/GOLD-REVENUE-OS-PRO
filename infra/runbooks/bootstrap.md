# First tenant bootstrap

This is an operator-only database procedure. Public signup does not create tenants or privileged memberships.

1. Create the first operator in Supabase Auth using the dashboard or an approved administrative process.
2. Copy the Auth user UUID. Never put the password, service-role key or session token in a command history or repository file.
3. Run the following transaction through an authenticated administrative database channel, replacing the UUID and tenant values:

```sql
begin;
insert into public.tenants (name, slug) values ('GoldResellerSystem', 'gold-reseller-system') returning id;
insert into public.tenant_members (tenant_id, user_id, role)
values ('<returned-tenant-id>', '<auth-user-id>', 'super_admin');
commit;
```

4. Verify one tenant, one active membership and audit rows for both inserts.
5. Sign in through `/login` and confirm the shell shows the expected tenant and role.

If any step fails, roll back. Do not grant direct authenticated write permissions to repair bootstrap.
