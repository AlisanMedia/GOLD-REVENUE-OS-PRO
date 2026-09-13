# Phase 1 secret handling

Phase 1 accepts only public Supabase connection values in the web application. Despite their name, publishable keys depend on RLS and explicit grants for security.

- Keep production, preview, CI and local projects separate.
- Store service-role and database credentials only in operator or deployment secret stores. They are not application environment variables in Phase 1.
- Rotate a credential immediately if it appears in logs, source control or a client bundle.
- Use `LOG_LEVEL`; loggers redact authorization, cookie, password, token and secret fields.
- Do not add Telegram, payment or OpenAI keys before their approved implementation phases.
