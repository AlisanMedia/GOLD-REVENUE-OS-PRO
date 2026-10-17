"use client";
import { T } from "@/components/admin-i18n";
export default function SurveyError({reset}:{reset:()=>void}){return <main className="admin-main"><h1><T k="Survey service is unavailable. Try again later."/></h1><button className="secondary-button" onClick={reset}><T k="Try again"/></button></main>;}
