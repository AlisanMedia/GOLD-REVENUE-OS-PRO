import { hasAdminCapability } from "@/lib/admin/permissions";
import { getAttentionItems, getDashboardMetrics, requireAdminCapability } from "@/lib/admin/server";
import Link from "next/link";

export default async function AdminDashboardPage() {
  const context = await requireAdminCapability("dashboard.read");
  const [metrics, attention] = await Promise.all([getDashboardMetrics(), hasAdminCapability(context.role, "attention.read") ? getAttentionItems() : Promise.resolve([])]);
  const states = Object.entries(metrics.customers_by_state).sort((a, b) => b[1] - a[1]);
  return <main className="admin-main">
    <div className="page-heading"><div><p className="eyebrow">YÖNETİM MERKEZİ</p><h1>Operasyonun tamamı, tek merkezde.</h1><p className="lede">Müşteri, işlem ve denetim kayıtlarına dayalı güncel marka görünümü.</p></div></div>
    <section className="metric-grid dashboard-metrics" aria-label="Operasyon göstergeleri">
      <article className="metric"><span>Toplam müşteri</span><strong>{metrics.total_customers}</strong></article><article className="metric"><span>İçe aktarma incelemesi</span><strong>{metrics.open_import_reviews}</strong></article>
      <article className="metric"><span>Olası / belirsiz eşleştirme</span><strong>{metrics.probable_identities + metrics.ambiguous_identities}</strong><small>{metrics.probable_identities} olası · {metrics.ambiguous_identities} belirsiz</small></article>
      <article className="metric"><span>Müdahale bekleyen işlemler</span><strong>{metrics.failed_events}</strong></article><article className="metric"><span>Son işlemler · 24 saat</span><strong>{metrics.recent_events}</strong></article>
      <article className="metric"><span>Sıradaki görevler</span><strong>{metrics.scheduled_backlog}</strong></article><article className="metric"><span>Yetkili işlemler · 24 saat</span><strong>{metrics.recent_audit}</strong></article>
      <article className="metric metric-muted"><span>Gelir analizi</span><strong>Henüz kullanılamıyor</strong><small>Ödeme ve abonelik kayıtları sandbox kapsamındadır; canlı gelir raporu yoktur.</small></article>
    </section>
    <section className="dashboard-columns">
      <article className="detail-card"><div className="card-heading"><h2>Müşteri yaşam döngüsü</h2><Link href="/admin/customers">Müşterileri Aç</Link></div>{states.length ? <ul>{states.map(([state, count]) => <li key={state}><strong>{state}</strong><span>{count}</span></li>)}</ul> : <p className="muted">Henüz müşteri durum kaydı yok.</p>}</article>
      <article className="detail-card"><div className="card-heading"><h2>Son müşteriler</h2><Link href="/admin/customers">Müşteri Merkezini Aç</Link></div>{metrics.recent_customers.length ? <ul>{metrics.recent_customers.map((customer) => <li key={customer.id}><Link className="table-link" href={`/admin/customers/${customer.id}`}>{customer.display_name || "Adı belirtilmemiş müşteri"}</Link><span>{customer.state} · {new Date(customer.created_at).toLocaleString("tr-TR", { timeZone: "UTC" })}</span></li>)}</ul> : <p className="muted">Henüz müşteri yok.</p>}</article>
    </section>
    {hasAdminCapability(context.role, "attention.read") ? <section className="detail-card full-width-card"><div className="card-heading"><h2>İnceleme gerekiyor</h2><Link href="/admin/attention">İnceleme Merkezini Aç</Link></div>{attention.length ? <ul>{attention.slice(0, 6).map((item) => <li key={`${item.category}:${item.entity_id}`}><strong>{item.category.replaceAll("_", " ")}</strong><span>{item.summary || "İnceleme gerekiyor"} · {item.severity}</span></li>)}</ul> : <p className="muted">Müdahale veya inceleme bekleyen işlem yok.</p>}</section> : null}
  </main>;
}
