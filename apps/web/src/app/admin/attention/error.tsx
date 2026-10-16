"use client";
import { T } from "../../../components/admin-i18n";
export default function AttentionError({ reset }: { reset: () => void }) {
  return <main className="admin-main" lang="tr"><h1><T k="Vaka görüntülenemedi"/></h1><p><T k="Bağlantı veya işlem sırasında bir sorun oluştu. Verilerin değiştiğini varsaymayın; son durumu yeniden kontrol edin."/></p><button className="secondary-button" onClick={reset}><T k="Yeniden Dene"/></button></main>;
}
