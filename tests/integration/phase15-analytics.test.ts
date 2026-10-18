import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {hasAdminCapability} from "../../apps/web/src/lib/admin/permissions";
import {translator,formatDecimal} from "../../apps/web/src/lib/i18n/core";
import {metricLabels} from "../../apps/web/src/lib/analytics/labels";
import {METRIC_DICTIONARY} from "../../packages/domain/src/analytics";
describe("Phase 15 trusted UI and access contracts",()=>{
 it.each(["manager","super_admin","analyst"] as const)("permits %s analytical reads",role=>expect(hasAdminCapability(role,"analytics.read")).toBe(true));
 it.each(["support","readonly"] as const)("denies %s analytical reads",role=>expect(hasAdminCapability(role,"analytics.read")).toBe(false));
 it("analyst cannot review costs",()=>expect(hasAdminCapability("analyst","analytics.manage")).toBe(false));
 it.each(Object.keys(METRIC_DICTIONARY) as (keyof typeof METRIC_DICTIONARY)[])("localizes %s in both locales",key=>{expect(metricLabels[key][0]).toBeTruthy();expect(metricLabels[key][1]).toBeTruthy();});
 it("has localized primary analytics controls and exact large decimals",()=>{expect(translator("tr-TR")("Analytics")).toBe("Analitik");expect(translator("en-US")("Apply analytics filters")).toBe("Apply filters");expect(formatDecimal("tr-TR","12345678901234567.890123")).toBe("12.345.678.901.234.567,890123");});
 it("does not add a model, sender, campaign or payment command to analytics",()=>{const sql=readFileSync("supabase/migrations/20261017232925_phase15_analytics_read_layer.sql","utf8");expect(sql).not.toMatch(/insert into (?:public\.)?(?:messages|subscriptions|channel_access|payment_invoices|domain_events)/iu);expect(sql).not.toContain("insert into private.verified_payment_receipts");expect(sql).toContain("from public,anon,authenticated,service_role");});
});
