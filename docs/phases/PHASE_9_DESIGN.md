# Phase 9 design and gap

Phase 8 is closed at e924f5f6710b28e09d77b9c01e95d291926e68ed (CI38233998965). Existing outbox, tenant/RBAC, task leases, Conversation renderer/QA/evidence handles, Customer OS and admin shell are reused.

Missing capabilities are structured commercial versions, owner publication, bounded approved retrieval and deterministic offer proposals. Add tenant-scoped commercial items/immutable versions and offers, narrowly authorized RPCs and ordinary server-action forms. Product/plan/Knowledge Base payloads are typed; prices are decimal strings backed by PostgreSQL numeric. Publication serializes per item, ends the previous validity interval and audits atomically. Review and publication are separate actions. Restore copies an approved historical payload into a new draft.

Source-bounded retrieval includes only published, effective, unexpired records in the source tenant/locale and explicit test-conversation scope. Catalog amounts outrank descriptive knowledge; pricing conflicts fail closed. Knowledge is data, never instructions; unsafe instruction/secret/performance claims are rejected on publication and retrieval. Runtime evidence handles are issued by the backend for exact approved statements.

Conversion is a deterministic specialist task after Lead Intelligence and before the single Conversation task, with no model, sends, payment or lifecycle effects. Offers reference immutable commercial versions, exact amount/currency/duration/terms, eligibility and allowed discount. Human approval remains separate. Follow-ups are recommendation-only, deduplicated and unscheduled. No entitlement or payment receipts are created.

Admin adds Products & Pricing, Knowledge Base and Offers, with bounded listings, typed create/edit forms, preview/review/publish/archive/restore/history. Existing roles and authenticated tenant context remain authoritative.

An unsupported optional inference may use the existing single rewrite only when there is no action/identity/financial/escalation violation; original blocked evidence remains immutable, and the rewritten response must pass unchanged QA. Otherwise preserve the hold.

No new provider, queue, vector database, service, import, cold outreach, financial processing or access grant. Phase 10/11 remain prohibited. Test-only records are explicitly isolated to the owner's staging conversation and archived after acceptance.

Main Git deployments are disabled in Vercel configuration: they lacked required build-time public environment values and replaced the working alias before controlled validation. The existing CI-gated staging workflow remains the publication path; previews and all security checks remain available.
