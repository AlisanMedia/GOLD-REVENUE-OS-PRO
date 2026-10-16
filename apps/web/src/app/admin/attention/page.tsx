import { T, OperatorText, AdminDate } from "../../../components/admin-i18n";
import { getAttentionItems } from "@/lib/admin/server";
import Link from "next/link";
import { escalationList } from "@/lib/escalations/admin";
import { EscalationQueue, CasePriority } from "@/components/escalation-views";

const operatingLabels: Record<string, string> = { dead_letter_event: "İşlem müdahale bekliyor", failed_processing: "İşlem tamamlanamadı", import_review: "İçe aktarma incelemesi", import_error: "İçe aktarma sorunu" };
export default async function NeedsAttentionPage() {
  const [items, escalations] = await Promise.all([getAttentionItems(), escalationList()]);
  return <main className="admin-main case-workspace"><p className="eyebrow"><T k="OPERASYON MERKEZİ"/></p><h1><T k="İnceleme Merkezi"/></h1>
    <p className="lede"><T k="Müşteri sorunlarını önceliğine göre inceleyin, görüşmeyi üstlenin ve çözümü kaydedin."/></p>
    <EscalationQueue cases={escalations.cases} userId={escalations.context.userId}/>
    <section className="case-section" aria-labelledby="operating-items-heading"><h2 id="operating-items-heading"><T k="Diğer operasyon kayıtları"/></h2>
      <div className="case-list">{items.map(item => <article className="case-card" key={`${item.category}:${item.entity_id}`}><CasePriority value={item.severity}/>
        <h3><OperatorText value={operatingLabels[item.category] ?? "Operasyon incelemesi"}/></h3><p className="muted">{<AdminDate value={item.created_at}/>}</p>
        {item.customer_id ? <Link className="table-link" href={`/admin/customers/${item.customer_id}`}><T k="Müşteri Kaydını Aç"/></Link> : null}
        <details className="case-technical"><summary><T k="Teknik kayıt"/></summary><p>{item.summary ?? <T k="Ek ayrıntı yok"/>}</p><code>{item.entity_id}</code></details>
      </article>)}</div>{!items.length ? <p className="muted"><T k="İnceleme bekleyen başka operasyon kaydı yok."/></p> : null}
    </section></main>;
}
