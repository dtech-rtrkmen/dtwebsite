// yıl
document.getElementById('yil') && (document.getElementById('yil').textContent = new Date().getFullYear());

// mobil menü (beyaz header)
function toggleMenu() {
  const nav = document.getElementById('topNav');
  const btn = document.querySelector('.nav-toggle');
  if (!nav || !btn) return;
  nav.classList.toggle('open');
  const open = nav.classList.contains('open');
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

// ==== Mobilde dropdown tıkla aç ====
document.querySelectorAll('.has-dropdown .nav-link').forEach(btn => {
  btn.addEventListener('click', (e) => {
    if (window.matchMedia('(max-width: 900px)').matches) {
      e.preventDefault();
      const dd = btn.parentElement.querySelector('.dropdown');
      if (!dd) return;
      const open = dd.style.display === 'block';
      document.querySelectorAll('.has-dropdown .dropdown').forEach(x => x.style.display = 'none');
      dd.style.display = open ? 'none' : 'block';
    }
  });
});

// ==== Sepet sayacı (localStorage'daki cart_v1 verisi) ====
// Tek fonksiyon, her çağrıldığında badge'i günceller
function updateCartBadgeFromStorage() {
  try {
    const cart = JSON.parse(localStorage.getItem('cart_v1') || '[]');
    const qty = cart.reduce((t, i) => t + (i.qty || 0), 0);
    const badge = document.getElementById('cartBadge');
    if (badge) badge.textContent = qty;
  } catch (e) {
    console.error('Cart read error', e);
  }
}

// İlk yüklemede
document.addEventListener('DOMContentLoaded', updateCartBadgeFromStorage);

// Geri/ileri tuşuyla sayfa geri geldiğinde (bfcache vs.)
window.addEventListener('pageshow', () => {
  updateCartBadgeFromStorage();
});

// ==== Ürünler linki: hover'da açılır, click'te urunler.html ====
const urunlerLink = document.getElementById('urunlerLink');
let hoverTimer = null;

if (urunlerLink && urunlerLink.parentElement) {
  const wrapper = urunlerLink.parentElement;

  wrapper.addEventListener('mouseenter', () => {
    clearTimeout(hoverTimer);
    const dd = wrapper.querySelector('.dropdown');
    if (dd) dd.style.display = 'block';
  });

  wrapper.addEventListener('mouseleave', () => {
    hoverTimer = setTimeout(() => {
      const dd = wrapper.querySelector('.dropdown');
      if (dd) dd.style.display = 'none';
    }, 250);
  });

  urunlerLink.addEventListener('click', (e) => {
    const isMobile = window.matchMedia('(max-width: 900px)').matches;
    const dd = wrapper.querySelector('.dropdown');

    if (isMobile && dd) {
      e.preventDefault(); // mobilde sayfaya gitme, dropdown aç/kapat
      const open = dd.style.display === 'block';

      // diğer açık dropdownları kapat
      document.querySelectorAll('.has-dropdown .dropdown').forEach(x => {
        x.style.display = 'none';
      });

      dd.style.display = open ? 'none' : 'block';
    } else {
      // desktop: urunler.html'e git
      window.location.href = 'urunler.html';
    }
  });
}

function toggleMenuDark() {
  const nav = document.querySelector('.main-nav');
  const btn = document.querySelector('.main-header .nav-toggle');
  if (!nav || !btn) return;

  nav.classList.toggle('open');
  btn.setAttribute('aria-expanded', nav.classList.contains('open') ? 'true' : 'false');
}

document.addEventListener('DOMContentLoaded', () => {
  const urunler = document.querySelector('.main-nav #urunlerLink');
  if (!urunler) return;

  const wrapper = urunler.closest('.has-dropdown');
  const dd = wrapper?.querySelector('.dropdown');
  if (!dd) return;

  urunler.addEventListener('click', (e) => {
    const isMobile = window.matchMedia('(max-width: 900px)').matches;
    if (!isMobile) return; // desktop'ta normal kalsın

    e.preventDefault();
    dd.style.display = (dd.style.display === 'block') ? 'none' : 'block';
  });
});

document.addEventListener('DOMContentLoaded', () => {
  // Hamburger aç/kapat
  const btn = document.querySelector('.main-header .nav-toggle');
  const nav = document.querySelector('.main-header .main-nav');

  if (btn && nav) {
    btn.addEventListener('click', () => {
      nav.classList.toggle('open');
      btn.setAttribute('aria-expanded', nav.classList.contains('open') ? 'true' : 'false');
    });
  }

  // Mobilde Ürünler: tıkla aç/kapat (anasayfa gibi)
  const urunler = document.querySelector('.main-header .main-nav #urunlerLink');
  const wrapper = urunler?.closest('.has-dropdown');
  const dd = wrapper?.querySelector('.dropdown');

  if (urunler && dd) {
    // capture ile en baştan yakala (navigasyonu garanti engeller)
    urunler.addEventListener('click', (e) => {
      const isMobile = window.matchMedia('(max-width: 900px)').matches;
      if (!isMobile) return;

      e.preventDefault();
      e.stopPropagation();

      wrapper.classList.toggle('dd-open');
    }, true);
  }

  // Dışarı tıklayınca kapat (opsiyonel ama iyi)
  document.addEventListener('click', (e) => {
    const isMobile = window.matchMedia('(max-width: 900px)').matches;
    if (!isMobile) return;

    const anyOpen = document.querySelector('.main-header .has-dropdown.dd-open');
    if (!anyOpen) return;

    if (!anyOpen.contains(e.target)) {
      anyOpen.classList.remove('dd-open');
    }
  });
});

/* ===== Product Slider (Veritabanından) ===== */
(async function initProductSlider() {
  const track = document.getElementById('psTrack');
  const dotsBox = document.getElementById('psDots');
  if (!track || !dotsBox) return;      // bu sayfada slider yoksa

  // TRY formatter
  const TRY = new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  let PS_PRODUCTS = [];

  // ---------- 1) Ürünleri API'den çek ----------
  try {
    const res = await fetch("/api/products");
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      console.error("Slider products error:", data.error || res.status);
      return;
    }

    let list = data.products || [];
    if (!list.length) return;

    // Ürün detay sayfasındaysak, o ürünü slider'dan çıkar (isteğe bağlı)
    const url = new URL(window.location.href);
    const currentId = url.searchParams.get("id");
    if (currentId) {
      list = list.filter(p => String(p.id) !== String(currentId));
    }

    // Biraz karışık / random olsun
    list = list.sort(() => Math.random() - 0.5).slice(0, 10); // en fazla 10 ürün

    // Slider'ın kullanacağı formata çevir
    PS_PRODUCTS = list.map(p => ({
      id: String(p.id),
      title: p.name,
      price: p.price != null ? Number(p.price) : null,
      img: p.imageurl || "assets/placeholder.png",
      url: `/product.html?id=${p.id}`,
      cat: p.category || "",
    }));
  } catch (err) {
    console.error("initProductSlider fetch error:", err);
    return;
  }

  if (!PS_PRODUCTS.length) return;

  // ---------- 2) Kartları bas ----------
  track.innerHTML = PS_PRODUCTS.map(p => `
  <li class="ps-card">
    <div class="ps-thumb-wrap">
      <img class="ps-thumb"
           src="${p.img}"
           alt="${p.title}"
           loading="lazy"
           onerror="this.src='assets/placeholder.png'">
    </div>
    <div class="ps-title">${p.title}</div>
    <div class="ps-meta">${p.cat || ''}</div>
    <div class="ps-price">
      ${p.price != null ? TRY.format(p.price) : '—'}
    </div>
    <div class="ps-actions">
      <a class="ps-btn ps-btn--alt" href="${p.url}">İncele</a>
      <button class="ps-btn" data-add="${p.id}">Sepete Ekle</button>
    </div>
  </li>
`).join('');

  const slides = Array.from(track.children);

  // ---------- 3) Slider layout / navigation ----------
  function perView() {
    const w = window.innerWidth;
    if (w <= 600) return 1;
    if (w <= 860) return 2;
    if (w <= 1100) return 3;
    return 4;
  }

  let pv = perView();
  function pages() {
    return Math.max(1, Math.ceil(slides.length / pv));
  }

  let index = 0;  // sayfa indexi

  function setWidths() {
    pv = perView();
    const gap = 22; // CSS gap
    const viewport = track.parentElement.getBoundingClientRect().width;
    const cardWidth = (viewport - gap * (pv - 1)) / pv;
    slides.forEach(li => li.style.minWidth = cardWidth + "px");
    goto(index);
  }

  function drawDots() {
    dotsBox.innerHTML = "";
    for (let i = 0; i < pages(); i++) {
      const b = document.createElement("button");
      b.className = "ps-dot";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-label", `Sayfa ${i + 1}`);
      b.addEventListener("click", () => goto(i));
      dotsBox.appendChild(b);
    }
  }

  function goto(i) {
    index = (i + pages()) % pages();
    const firstVisible = index * pv;
    const x = slides[firstVisible]?.offsetLeft || 0;
    track.style.transform = `translateX(${-x}px)`;
    Array.from(dotsBox.children).forEach((d, k) =>
      d.setAttribute("aria-selected", k === index ? "true" : "false")
    );
  }

  const prev = document.querySelector(".ps-prev");
  const next = document.querySelector(".ps-next");
  prev?.addEventListener("click", () => goto(index - 1));
  next?.addEventListener("click", () => goto(index + 1));

  let timer = null, paused = false;
  function start() { stop(); timer = setInterval(() => !paused && goto(index + 1), 5000); }
  function stop() { if (timer) clearInterval(timer); }

  track.parentElement.addEventListener("mouseenter", () => (paused = true));
  track.parentElement.addEventListener("mouseleave", () => (paused = false));

  // ---------- 4) Sepete ekle ----------
  track.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-add]");
    if (!btn) return;
    const id = btn.dataset.add;
    const item = PS_PRODUCTS.find(p => p.id === id);
    if (!item) return;

    try {
      // Eğer global addToCart fonksiyonun varsa onu kullan
      if (typeof window.addToCart === "function") {
        window.addToCart(id, 1);
      } else {
        // Yoksa mevcut cart_v1 localStorage mantığını kullan
        const cart = JSON.parse(localStorage.getItem("cart_v1") || "[]");
        const ex = cart.find(c => c.id === item.id);
        if (ex) ex.qty += 1;
        else cart.push({
          id: item.id,
          name: item.title,
          price: item.price || 0,
          qty: 1,
          img: item.img,
        });
        localStorage.setItem("cart_v1", JSON.stringify(cart));

        const badge = document.getElementById("cartBadge");
        if (badge) badge.textContent = cart.reduce((t, i) => t + (i.qty || 0), 0);
      }

      alert("Ürün sepetinize eklendi.");
    } catch (err) {
      console.warn("slider addToCart error:", err);
    }
  });

  // ---------- 5) Başlat ----------
  setWidths();
  drawDots();
  goto(0);
  start();

  window.addEventListener("resize", () => {
    setWidths();
    drawDots();
  });
})();

// scroll-to-top (IIFE dışına koyuyoruz ki emin olalım DOM yüklendikten sonra çalışsın)
document.addEventListener('DOMContentLoaded', function () {
  const btn = document.getElementById('scrollTopBtn');
  if (!btn) return;

  const toggle = () => btn.classList.toggle('show', window.scrollY > 300);
  window.addEventListener('scroll', toggle, { passive: true });
  toggle(); // sayfa zaten aşağıdaysa ilk anda göster

  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
});

async function getCurrentUser() {
  try {
    const res = await fetch('/api/me', {   // 🔴 /api/auth/me DEĞİL
      credentials: 'include'              // cookie taşı
    });

    if (!res.ok) return null;             // 401 → login yok demek

    const data = await res.json();
    return data?.user || null;           // { user: {...} } bekliyoruz
  } catch (err) {
    console.error('getCurrentUser error:', err);
    return null;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const authLink = document.querySelector('#authLink');

  // sayfada authLink yoksa (bazı sayfalarda olabilir) çık
  if (!authLink) return;

  const user = await getCurrentUser();

  if (user) {
    // giriş var → Hesabım
    authLink.textContent = 'Hesabım';
    authLink.href = 'account.html';
  } else {
    // giriş yok → Register/Login
    authLink.textContent = 'Register/Login';
    authLink.href = 'login.html';
  }
});
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.querySelector('.nav-toggle');
  if (!btn) return;

  btn.addEventListener('click', toggleMenu);
});