"use client";
export default function AttentionError({ reset }: { reset: () => void }) {
  return <main className="admin-main" lang="tr"><h1>Vaka görüntülenemedi</h1><p>Bağlantı veya işlem sırasında bir sorun oluştu. Verilerin değiştiğini varsaymayın; son durumu yeniden kontrol edin.</p><button className="secondary-button" onClick={reset}>Yeniden Dene</button></main>;
}
