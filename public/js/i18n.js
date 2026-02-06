// public/js/i18n.js

// Dil değiştirme fonksiyonu (Global erişim için window'a atıyoruz)
window.changeLanguage = function(lng) {
    i18next.changeLanguage(lng, () => {
        updateContent();
        localStorage.setItem('i18nextLng', lng);
        // Dil değiştiğinde bayrakları veya aktif sınıfı güncellemek için event tetikleyebiliriz
        document.dispatchEvent(new CustomEvent('languageChanged', { detail: lng }));
    });
};

// Sayfadaki tüm data-i18n etiketlerini bulup içeriğini günceller
function updateContent() {
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.getAttribute('data-i18n');
        const translation = i18next.t(key);
        
        // Input ise placeholder'ı, değilse html içeriğini değiştir
        if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
            element.setAttribute('placeholder', translation);
        } else {
            element.innerHTML = translation;
        }
    });
    
    // HTML lang attribute'unu güncelle (SEO için)
    document.documentElement.lang = i18next.language;
}

// Sayfa yüklendiğinde i18next'i başlat
document.addEventListener('DOMContentLoaded', () => {
    // Kütüphanelerin yüklendiğinden emin olalım
    if (typeof i18next === 'undefined') {
        console.error('i18next kütüphanesi yüklenemedi.');
        return;
    }

    i18next
        .use(i18nextHttpBackend) // JSON dosyalarını sunucudan çekmek için
        .use(i18nextBrowserLanguageDetector) // Tarayıcı dilini algılamak için
        .init({
            fallbackLng: 'tr',
            debug: false, // Geliştirme aşamasında true yapabilirsiniz
            backend: {
                loadPath: '/locales/{{lng}}/translation.json', // JSON dosya yolu
            },
            detection: {
                order: ['localStorage', 'navigator'],
                caches: ['localStorage'] // Seçilen dili hatırla
            }
        }, function(err, t) {
            if (err) return console.error('i18n init error:', err);
            updateContent();
        });
});
