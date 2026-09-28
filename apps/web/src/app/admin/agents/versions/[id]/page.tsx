import { getAgentVersionDetail } from "@/lib/admin/server";
import { notFound } from "next/navigation";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export default async function AgentVersionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getAgentVersionDetail(id);
  if (!detail) notFound();
  const version = object(detail.version);
  const knowledge = object(detail.knowledge_inputs);
  const capabilities = object(detail.capabilities);
  const model = object(detail.model);
  const quality = object(detail.quality);
  return <main className="admin-main">
    <div className="page-heading"><div><p className="eyebrow">AGENT VERSION</p><h1>{String(version.agent_name ?? "Agent")} · v{String(version.version ?? "—")}</h1><p className="lede">The effective knowledge, permissions, model and measured quality for this immutable version.</p></div><span className="environment-badge">{String(version.execution_mode ?? "SHADOW")}</span></div>
    <section className="detail-grid">
      <article className="info-card"><h2>Knowledge inputs</h2><pre>{JSON.stringify(knowledge, null, 2)}</pre></article>
      <article className="info-card"><h2>Capabilities</h2><pre>{JSON.stringify(capabilities, null, 2)}</pre></article>
      <article className="info-card"><h2>Model</h2><pre>{JSON.stringify(model, null, 2)}</pre></article>
      <article className="info-card"><h2>Quality evidence</h2><pre>{JSON.stringify(quality, null, 2)}</pre></article>
    </section>
    <section className="info-card"><h2>Version lineage</h2><dl>
      <div><dt>Prompt</dt><dd>{String(version.prompt_version ?? "—")}</dd></div>
      <div><dt>Director</dt><dd>{String(version.director_version ?? "—")}</dd></div>
      <div><dt>Renderer</dt><dd>{String(version.renderer_version ?? "—")}</dd></div>
      <div><dt>QA</dt><dd>{String(version.qa_version ?? "—")}</dd></div>
      <div><dt>Context</dt><dd>v{String(version.context_version ?? "—")}</dd></div>
      <div><dt>Evaluation set</dt><dd>{String(version.evaluation_set_version ?? "—")}</dd></div>
    </dl></section>
  </main>;
}
