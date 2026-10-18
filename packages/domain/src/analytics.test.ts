import {describe,it,expect} from "vitest";
import {analyticsFilterSchema,analyticsDefaultPeriod,METRIC_DICTIONARY,ANALYTICS_SECTIONS} from "./analytics";
describe("analytical contracts",()=>{
 it("uses UTC complete date boundaries independently from operator locale",()=>{expect(analyticsDefaultPeriod(new Date("2026-10-17T23:59:00-03:00"),7)).toEqual({mode:"LIVE",start:"2026-10-12",end:"2026-10-19"});});
 it.each([{start:"2026-10-01",end:"2026-10-01"},{start:"2026-10-02",end:"2026-10-01"},{start:"2025-01-01",end:"2026-10-01"},{start:"2026-02-30",end:"2026-03-02"}])("rejects invalid/empty/unbounded intervals %o",v=>{expect(analyticsFilterSchema.safeParse({...v,mode:"LIVE"}).success).toBe(false);});
 it("rejects tenant/role injection into filters",()=>{expect(analyticsFilterSchema.safeParse({start:"2026-10-01",end:"2026-10-17",mode:"LIVE",tenant:"other"}).success).toBe(false);});
 it.each(Object.entries(METRIC_DICTIONARY))("defines reproducible source and unknown behavior for %s",(_,definition)=>{
  expect(ANALYTICS_SECTIONS).toContain(definition.section);expect(definition.sources.length).toBeGreaterThan(0);
  for(const key of ["meaning","formula","verification","numerator","denominator","time","currency","classification","incomplete","permission","duplicates","caveats"] as const)expect(definition[key].length).toBeGreaterThan(5);
 });
 it("never treats existing receipt identity as received money",()=>{expect(METRIC_DICTIONARY.collected.verification).toContain("no amount");expect(METRIC_DICTIONARY.collected.classification).toContain("never live cash");});
 it("retains calendar and fixed-day distinction",()=>expect(METRIC_DICTIONARY.mrr.caveats).toContain("Fixed-day"));
 it("excludes anonymous identity enrichment and telemetry double counting",()=>{expect(METRIC_DICTIONARY.survey_topics.verification).toContain("no anonymous response IDs");expect(METRIC_DICTIONARY.billing_coverage.verification).toContain("no agent_runs billing");});
});
