"use client";
import {AnalyticsUnavailable} from "@/components/analytics/dashboard";
export default function Error({reset}:{reset:()=>void}){return <AnalyticsUnavailable retry={reset}/>;}
