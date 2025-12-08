// js/odeme.js

// 🔹 Sepet bilgisi için kullanılan localStorage anahtarı
const CART_KEY = "cart_v1";

// 🔹 TL formatlayıcı
const TRY_FORMAT = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
});

// 🔹 İyzico’ya göndereceğimiz toplamlar
let checkoutTotals = { subtotal: 0, shipping: 0, total: 0 };

// localStorage'dan sepeti oku
function readCheckoutCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY) || "[]");
  } catch (e) {
    console.error("Sepet okunamadı:", e);
    return [];
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadUserInfo();      // /api/me -> ad, soyad, email
  initCityDistrict();  // İl / ilçe comboları
  initStepFlow();      // 1-2-3 adım geçişleri
  initForms();         // Teslimat & Ödeme form submit'leri
  initCartSummary();   // ✅ Sepet tutarlarını ve ürünleri doldur
});

/* --------------------------------------------------
 * 1. GİRİŞ YAPMIŞ KULLANICIDAN AD / SOYAD / EMAIL ÇEK
 * -------------------------------------------------- */
async function loadUserInfo() {
  try {
    const res = await fetch("/api/me");
    if (!res.ok) return;
    const data = await res.json();
    if (!data.user) return;

    const [firstName, ...lastNameParts] = data.user.full_name.split(" ");
    const lastName = lastNameParts.join(" ");

    const firstNameEl = document.querySelector("[name='firstName']");
    const lastNameEl = document.querySelector("[name='lastName']");
    const emailEl = document.querySelector("[name='email']");

    if (firstNameEl) firstNameEl.value = firstName;
    if (lastNameEl) lastNameEl.value = lastName;
    if (emailEl) emailEl.value = data.user.email;
  } catch (e) {
    console.error("Kullanıcı bilgisi alınamadı:", e);
  }
}

/* --------------------------------------------------
 * 2. TÜRKİYE İL – İLÇE COMBOBOX
 * -------------------------------------------------- */
let TR_CITIES = {};

async function initCityDistrict() {
  const citySelect = document.getElementById("citySelect");
  const districtSelect = document.getElementById("districtSelect");
  if (!citySelect || !districtSelect) return;

  try {
    const res = await fetch("/data/tr-cities.json");
    if (!res.ok) {
      console.warn("Şehir datası bulunamadı /data/tr-cities.json");
      return;
    }

    TR_CITIES = await res.json();

    // Şehirleri doldur
    Object.keys(TR_CITIES)
      .sort((a, b) => a.localeCompare(b, "tr"))
      .forEach((city) => {
        const opt = document.createElement("option");
        opt.value = city;
        opt.textContent = city;
        citySelect.appendChild(opt);
      });

    citySelect.addEventListener("change", () => {
      const city = citySelect.value;
      const districts = TR_CITIES[city] || [];

      districtSelect.innerHTML = "";
      const first = document.createElement("option");
      first.value = "";
      first.textContent = districts.length ? "İlçe seçin" : "Önce şehir seçin";
      districtSelect.appendChild(first);

      districts.forEach((d) => {
        const opt = document.createElement("option");
        opt.value = d;
        opt.textContent = d;
        districtSelect.appendChild(opt);
      });

      districtSelect.disabled = !districts.length;
    });
  } catch (err) {
    console.error("İl/ilçe datası yüklenemedi:", err);
  }
}

/* --------------------------------------------------
 * 3. ADIM GEÇİŞLERİ (STEP 1-2-3)
 * -------------------------------------------------- */
function showStep(stepNumber) {
  document.querySelectorAll(".step-panel").forEach((panel) => {
    panel.classList.toggle("is-active", panel.id === `step-${stepNumber}`);
  });

  document.querySelectorAll(".checkout-step").forEach((st) => {
    const s = Number(st.dataset.step);
    st.classList.toggle("active", s === stepNumber);
    st.classList.toggle("completed", s < stepNumber);
  });
}

function initStepFlow() {
  const btnStep2Back = document.getElementById("btnStep2Back");
  const btnStep2Next = document.getElementById("btnStep2Next");
  const btnStep3Back = document.getElementById("btnStep3Back");

  if (btnStep2Back) btnStep2Back.addEventListener("click", () => showStep(1));
  if (btnStep2Next) btnStep2Next.addEventListener("click", () => showStep(3));
  if (btnStep3Back) btnStep3Back.addEventListener("click", () => showStep(2));
}

/* --------------------------------------------------
 * 4. FORMLAR: TESLİMAT & ÖDEME
 * -------------------------------------------------- */

let deliveryData = null; // Step-1'de girilen adres bilgilerini burada tutacağız

function initForms() {
  const deliveryForm = document.getElementById("deliveryForm");
  const paymentForm = document.getElementById("paymentForm");

  // STEP 1: Teslimat formu
  if (deliveryForm) {
    deliveryForm.addEventListener("submit", (e) => {
      e.preventDefault();

      const fd = new FormData(deliveryForm);
      deliveryData = Object.fromEntries(fd.entries());

      // Step-2'de özet göster
      fillAddressReview(deliveryData);

      // 2. adıma geç
      showStep(2);
    });
  }

  // STEP 3: Ödeme formu → İyzico checkout
  if (paymentForm) {
    paymentForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const submitBtn = paymentForm.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "İyzico'ya yönlendiriliyor...";
      }

      try {
        const cart = readCheckoutCart();
        const res = await fetch("/api/payments/iyzico/init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subtotal: checkoutTotals.subtotal,
            shippingFee: checkoutTotals.shipping,
            totalPrice: checkoutTotals.total,
            cart,
            address: deliveryData,
          }),
        });

        const data = await res.json();
        console.log("Iyzico init response:", data);

        // 🔥 KRİTİK: data.paymentPageUrl'i kontrol et
        if (!res.ok || !data.ok || !data.paymentPageUrl) {
          console.error("İyzico init hata:", data);
          alert("Ödeme başlatılamadı.");
          return;
        }

        // 🚀 YÖNLENDİRME KRİTİK ADIM: Başarılıysa, İyzico sayfasına git.
        window.location.href = data.paymentPageUrl;

        // Bu noktadan sonraki tüm JS kodu yoksayılacaktır.

      } catch (err) {
        console.error("Ödeme isteği hatası:", err);
        alert("Ödeme sırasında bir hata oluştu.");
        // Hata olursa butonu tekrar aktif et
      } finally {
        if (submitBtn && !window.location.href.includes("https://sandbox-api.iyzipay.com")) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Ödemeyi Tamamla";
        }
      }
    });
  }
}

/* --------------------------------------------------
 * 5. SEPET ÖZETİ (SAĞ TARAF + ADIM 2)
 * -------------------------------------------------- */
function initCartSummary() {
  const cart = readCheckoutCart();

  const sideItemsEl = document.getElementById("sideSummaryItems");
  const sideSubtotalEl = document.getElementById("sideSubtotal");
  const sideShippingEl = document.getElementById("sideShipping");
  const sideTotalEl = document.getElementById("sideTotal");

  const reviewItemsEl = document.getElementById("orderReviewItems");
  const reviewSubtotalEl = document.getElementById("reviewSubtotal");
  const reviewShippingEl = document.getElementById("reviewShipping");
  const reviewTotalEl = document.getElementById("reviewTotal");

  // Sepet boşsa
  if (!cart || !cart.length) {
    if (sideItemsEl) sideItemsEl.innerHTML = "<p>Sepetiniz boş.</p>";
    if (sideSubtotalEl) sideSubtotalEl.textContent = TRY_FORMAT.format(0);
    if (sideShippingEl) sideShippingEl.textContent = TRY_FORMAT.format(0);
    if (sideTotalEl) sideTotalEl.textContent = TRY_FORMAT.format(0);

    if (reviewItemsEl) reviewItemsEl.innerHTML = "<p>Sepetiniz boş.</p>";
    if (reviewSubtotalEl) reviewSubtotalEl.textContent = TRY_FORMAT.format(0);
    if (reviewShippingEl) reviewShippingEl.textContent = TRY_FORMAT.format(0);
    if (reviewTotalEl) reviewTotalEl.textContent = TRY_FORMAT.format(0);

    checkoutTotals = { subtotal: 0, shipping: 0, total: 0 };
    window.checkoutTotals = checkoutTotals;
    return;
  }

  // Ara toplam
  const subtotal = cart.reduce((sum, item) => sum + item.price * (item.qty || 1), 0);

  // 🔥 Kargo ücreti: calculateShippingFee fonksiyonu ile hesaplanıyor
  const shipping = calculateShippingFee(subtotal);

  // Genel toplam
  const total = subtotal + shipping;

  // Sağ taraf (Sepet Özeti)
  if (sideItemsEl) {
    sideItemsEl.innerHTML = cart
      .map((item) => {
        const qty = item.qty || 1;
        const lineTotal = (item.price || 0) * qty;
        return `
          <div class="summary-item">
            <span>${item.name} x ${qty}</span>
            <span>${TRY_FORMAT.format(lineTotal)}</span>
          </div>
        `;
      })
      .join("");
  }

  if (sideSubtotalEl) sideSubtotalEl.textContent = TRY_FORMAT.format(subtotal);
  if (sideShippingEl) sideShippingEl.textContent = TRY_FORMAT.format(shipping);
  if (sideTotalEl) sideTotalEl.textContent = TRY_FORMAT.format(total);

  // Adım 2 sipariş özeti
  if (reviewItemsEl) {
    reviewItemsEl.innerHTML = cart
      .map((item) => {
        const qty = item.qty || 1;
        const lineTotal = (item.price || 0) * qty;
        return `
          <p>
            <strong>${item.name}</strong> x ${qty}
            — ${TRY_FORMAT.format(lineTotal)}
          </p>
        `;
      })
      .join("");
  }

  if (reviewSubtotalEl) reviewSubtotalEl.textContent = TRY_FORMAT.format(subtotal);
  if (reviewShippingEl) reviewShippingEl.textContent = TRY_FORMAT.format(shipping);
  if (reviewTotalEl) reviewTotalEl.textContent = TRY_FORMAT.format(total);

  // 🔥 Hem değişkeni hem window'u güncelle
  checkoutTotals = { subtotal, shipping, total };
  window.checkoutTotals = checkoutTotals;
}

function calculateShippingFee(subtotal) {
  // örnek politika:
  // 1500 TL ve üzeri: ücretsiz
  // altı: 99 TL
  if (subtotal >= 1500) return 0;
  return 99;
}

/* Teslimat özet bloğunu doldur (step-2) */
function fillAddressReview(addr) {
  const el = document.getElementById("addressReview");
  if (!el || !addr) return;

  el.innerHTML = `
    <p><strong>${addr.firstName} ${addr.lastName}</strong></p>
    <p>${addr.address}</p>
    <p>${addr.district} / ${addr.city}</p>
    <p>Tel: ${addr.phone}</p>
    <p>E-posta: ${addr.email}</p>
  `;
}
