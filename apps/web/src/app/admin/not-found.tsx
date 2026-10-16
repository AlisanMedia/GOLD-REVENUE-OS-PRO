import Link from "next/link";
import { T } from "../../components/admin-i18n";
export default function AdminNotFound(){return <main className="admin-main"><section className="case-panel"><h1><T k="Record not found"/></h1><p><T k="This record is unavailable in your authorized workspace."/></p><Link className="secondary-button" href="/admin"><T k="Overview"/></Link></section></main>;}
