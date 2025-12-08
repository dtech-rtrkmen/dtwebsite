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

// ==== Arama paneli aç/kapat ====
const searchToggle = document.getElementById('searchToggle');
const searchPop = document.getElementById('searchPop');

if (searchToggle && searchPop) {
  document.addEventListener('click', (e) => {
    const within = searchPop.contains(e.target) || searchToggle.contains(e.target);
    if (!within) {
      searchPop.style.display = 'none';
    } else {
      searchPop.style.display = searchPop.style.display === 'block' ? 'none' : 'block';
    }
  });
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
try {
  const cart = JSON.parse(localStorage.getItem('cart_v1') || '[]');
  const qty = cart.reduce((t, i) => t + (i.qty || 0), 0);
  const badge = document.getElementById('cartBadge');
  if (badge) badge.textContent = qty;
} catch (e) {
  console.error('Cart read error', e);
}

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
    // desktop'ta doğrudan sayfaya git
    window.location.href = 'urunler.html';
  });
}

/* ===== Product Slider (Vanilla JS) ===== */
const PS_PRODUCTS = [
  { id: 'g1', title: 'WLF-PLANE 3-Axis Micro Prime Lens EO/IR AI Tracking Gimbal Camera', price: '$5.580,00', img: 'assets/WLF-Plane.jpg', url: 'product-g1.html', cat: 'Gimbal' },
  { id: 'g2', title: 'WLF-VTOL 40x EO + IR+ LRF AI Object Tracking Gimbal Camera', price: '—', img: 'assets/WLF-VTOL-40x.png', url: 'product-g2.html', cat: 'Gimbal' },
  { id: 'g3', title: 'WLF-VTOL 30x Drone Zoom Camera With Thermal Imager And Object Tracking', price: '$6.490,00', img: 'assets/WLF-VTOL-30x.jpg', url: 'product-g3.html', cat: 'Gimbal' },
  { id: 'm1', title: 'XRotor X13-13825', price: '—', img: 'assets/XRotor.jpg', url: 'product-m1.html', cat: 'Motor' },
  { id: 'v1', title: 'WFL GROUND STATION', price: '—', img: 'assets/WFL-Grand.jpg', url: 'product-v1.html', cat: 'Datalink' },
  { id: 'b1', title: 'T-MOTOR G24 X 7.8 CARBON', price: '$250,00', img: 'assets/T-Motor-G24.jpg', url: 'product-b1.html', cat: 'Battery' },
  { id: 'f1', title: 'T-MOTOR 17 X 5.8 CARBON', price: '$76,00', img: 'assets/T-Motor-17.jpg', url: 'product-f1.html', cat: 'Flight Ctrl' },
  { id: 'f1', title: 'RDX2 1000 AC/DC Dual Port Charger', price: '—', img: 'assets/RDX2.jpg', url: 'product-f1.html', cat: 'Flight Ctrl' },
  { id: 'f1', title: 'WLF – 30F Auto identify & tracking, 30x optical zoom, 1500m laser rangefinder', price: '—', img: 'assets/WFL-30F.png', url: 'product-f1.html', cat: 'Camera' },
  { id: 'f1', title: 'WLF -1000E Electric Heavy Lift Long Endurance VTOL Drone', price: '—', img: 'assets/WFL-1000E.jpeg', url: 'product-f1.html', cat: 'Drone' },
];

(function initProductSlider() {
  const track = document.getElementById('psTrack');
  const dotsBox = document.getElementById('psDots');
  if (!track || !dotsBox) return;

  // Kartları bas
  track.innerHTML = PS_PRODUCTS.map(p => `
    <li class="ps-card">
      <img class="ps-thumb" src="${p.img}" alt="${p.title}" onerror="this.src='assets/placeholder.png'">
      <div class="ps-title">${p.title}</div>
      <div class="ps-meta">${p.cat || ''}</div>
      <div class="ps-price">${p.price}</div>
      <div class="ps-actions">
        <a class="ps-btn ps-btn--alt" href="${p.url}">İncele</a>
        <button class="ps-btn" data-add="${p.id}">Sepete Ekle</button>
      </div>
    </li>
  `).join('');

  const slides = Array.from(track.children);

  // Görünür kart sayısı: genişliğe göre
  function perView() {
    const w = window.innerWidth;
    if (w <= 600) return 1;
    if (w <= 860) return 2;
    if (w <= 1100) return 3;
    return 4;
  }

  let pv = perView();
  function setWidths() {
    pv = perView();
    const gap = 22; // CSS gap
    const viewport = track.parentElement.getBoundingClientRect().width;
    const cardWidth = (viewport - gap * (pv - 1)) / pv;
    slides.forEach(li => li.style.minWidth = cardWidth + 'px');
    goto(index); // mevcut sayfayı koru
  }

  // Sayfa sayısı
  function pages() { return Math.max(1, Math.ceil(slides.length / pv)); }

  // Noktaları oluştur
  function drawDots() {
    dotsBox.innerHTML = '';
    for (let i = 0; i < pages(); i++) {
      const b = document.createElement('button');
      b.className = 'ps-dot';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-label', `Sayfa ${i + 1}`);
      b.addEventListener('click', () => goto(i));
      dotsBox.appendChild(b);
    }
  }

  // Kaydırma
  let index = 0;              // sayfa indexi (0…pages-1)
  function goto(i) {
    index = (i + pages()) % pages();
    const firstVisible = index * pv;
    const x = slides[firstVisible]?.offsetLeft || 0;
    track.style.transform = `translateX(${-x}px)`;
    // dots
    Array.from(dotsBox.children).forEach((d, k) => d.setAttribute('aria-selected', k === index ? 'true' : 'false'));
  }

  // Oklar
  const prev = document.querySelector('.ps-prev');
  const next = document.querySelector('.ps-next');
  prev?.addEventListener('click', () => goto(index - 1));
  next?.addEventListener('click', () => goto(index + 1));

  // Autoplay
  let timer = null, paused = false;
  function start() { stop(); timer = setInterval(() => !paused && goto(index + 1), 5000); }
  function stop() { if (timer) clearInterval(timer); }
  track.parentElement.addEventListener('mouseenter', () => paused = true);
  track.parentElement.addEventListener('mouseleave', () => paused = false);

  // Sepete ekle (senin mevcut shop.js / cart_v1 yapın varsa oraya entegre olur)
  track.addEventListener('click', (e) => {
    const id = e.target?.dataset?.add;
    if (!id) return;
    try {
      const item = PS_PRODUCTS.find(p => p.id === id);
      const cart = JSON.parse(localStorage.getItem('cart_v1') || '[]');
      const ex = cart.find(c => c.id === item.id);
      if (ex) ex.qty += 1; else cart.push({ id: item.id, name: item.title, price: 1, qty: 1, img: item.img }); // price=1 demo
      localStorage.setItem('cart_v1', JSON.stringify(cart));
      const badge = document.getElementById('cartBadge');
      if (badge) badge.textContent = cart.reduce((t, i) => t + i.qty, 0);
      alert('Sepete eklendi');
    } catch (err) { console.warn(err); }
  });

  // Başlat
  setWidths();
  drawDots();
  goto(0);
  start();

  window.addEventListener('resize', () => { setWidths(); drawDots(); });
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
  