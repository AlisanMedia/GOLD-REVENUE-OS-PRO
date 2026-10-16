import { T } from "../../components/admin-i18n";
export default function AdminLoading() {return <main className="admin-main" aria-busy="true"><div className="loading-skeleton" aria-hidden="true"/><p role="status"><T k="Loading your workspace…"/></p></main>;}
