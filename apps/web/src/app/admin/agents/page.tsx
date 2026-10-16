import { T, AdminCount, AdminEnum, AdminDate, AdminNumber } from "../../../components/admin-i18n";
import { getAgentRuntimeHealth, getAgentTasks } from "@/lib/admin/server";
import Link from "next/link";

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function AgentRuntimePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const status = first(raw.status);
  const page = Math.max(Number.parseInt(first(raw.page) ?? "1", 10) || 1, 1);
  const [health, tasks] = await Promise.all([
    getAgentRuntimeHealth(),
    getAgentTasks({ ...(status ? { status } : {}), page, pageSize: 50 }),
  ]);
  const pageCount = Math.max(Math.ceil(tasks.total / tasks.page_size), 1);
  const hrefFor = (target: number) => `/admin/agents?${new URLSearchParams({ ...(status ? { status } : {}), page: String(target) })}`;
  return <main className="admin-main">
    <div className="page-heading"><div><p className="eyebrow"><T k="PHASE 6 · AGENT RUNTIME"/></p><h1><T k="Shadow execution control"/></h1><p className="lede"><T k="Model output is untrusted. Drafts wait for human review and cannot bypass messaging controls."/></p></div><span className="environment-badge">{<AdminEnum value={health.execution_mode}/>}</span></div>
    <section className="metric-grid">
      <article className="metric-card"><span><T k="Queued"/></span><strong>{health.queued_tasks}</strong></article>
      <article className="metric-card"><span><T k="Running"/></span><strong>{health.running_tasks}</strong></article>
      <article className="metric-card"><span><T k="Waiting approval"/></span><strong>{health.waiting_approval}</strong></article>
      <article className="metric-card"><span><T k="Dead letter"/></span><strong>{health.dead_letter_tasks}</strong></article>
    </section>
    <section className="info-card"><strong><T k="Worker evidence"/></strong><p><T k="Last completed:"/> {health.last_worker_at ? <AdminDate value={health.last_worker_at}/> : <T k="No execution yet"/>}</p><p><T k="Autonomous messaging: disabled"/></p></section>
    <form className="filter-panel" method="get"><label><T k="Status"/><select name="status" defaultValue={status ?? ""}><option value=""><T k="All"/></option>{["QUEUED","RUNNING","WAITING_FOR_APPROVAL","SUCCEEDED","FAILED","CANCELLED","TIMED_OUT","DEAD_LETTER"].map((value) => <option key={value}>{value}</option>)}</select></label><button className="secondary-button" type="submit"><T k="Apply"/></button><Link className="text-button" href="/admin/agents"><T k="Clear"/></Link></form>
    <section className="table-card table-scroll"><table><thead><tr><th><T k="Task"/></th><th><T k="Agent / model"/></th><th><T k="Status"/></th><th><T k="Scope"/></th><th><T k="Created"/></th></tr></thead><tbody>
      {tasks.items.map((task) => <tr key={task.id}>
        <td>{task.run_id ? <Link className="table-link" href={`/admin/agent-runs/${task.run_id}`}>{task.task_type}</Link> : <strong>{task.task_type}</strong>}<small>{<AdminEnum value={task.execution_mode}/>} <T k="· v"/>{task.version}</small></td>
        <td>{task.agent_name}<small>{task.model_provider}/{task.model_name}</small></td>
        <td><span className="state-pill">{<AdminEnum value={task.status}/>}</span><small>{<AdminNumber value={task.attempts}/>}/{<AdminNumber value={task.max_attempts}/>} <T k="attempts"/>{task.approval_status ? ` · ${task.approval_status}` : ""}</small></td>
        <td><small><T k="Customer"/> {task.customer_id?.slice(0,8) ?? "unmatched"}</small><small><T k="Conversation"/> {task.conversation_id?.slice(0,8) ?? "—"}</small></td>
        <td>{<AdminDate value={task.created_at}/>}</td>
      </tr>)}{tasks.items.length === 0 ? <tr><td colSpan={5} className="empty-state"><T k="No agent tasks match this filter."/></td></tr> : null}
    </tbody></table></section>
    <nav className="pagination"><Link href={hrefFor(Math.max(page-1,1))} aria-disabled={page<=1}><T k="Previous"/></Link><span><T k="Page"/> {<AdminNumber value={page}/>} <T k="of"/> {<AdminNumber value={pageCount}/>} · <AdminCount value={tasks.total} kind="tasks"/></span><Link href={hrefFor(Math.min(page+1,pageCount))} aria-disabled={page>=pageCount}><T k="Next"/></Link></nav>
  </main>;
}
