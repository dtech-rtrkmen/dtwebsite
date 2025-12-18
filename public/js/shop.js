// js/shop.js — API'den ürün çeken + sepet yöneten versiyon
(() => {
  // ---------- DATA KAYNAĞI ----------
  // Ortak para formatı
  window.TRY =
    window.TRY ||
    new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" });

  let PRODUCTS = [];
  window.PRODUCTS = PRODUCTS; // referans olarak paylaş

  const TRY = window.TRY;
  const $ = (s) => document.querySelector(s);

  // ---------- DOM ----------
  const grid = $("#productGrid");
  const cartBadge = $("#cartBadge");
  const cartItemsEl = $("#cartItems");
  const cartTotalEl = $("#cartTotal");
  const checkoutBtn = $("#checkoutBtn");
  const continueBtn = document.querySelector("#continueBtn");

  let ALL_PRODUCTS = [];
  // grid varsa, en yakın main'den data-category oku
  const pageRoot = grid ? grid.closest("main") : null;
  const PAGE_CATEGORY = pageRoot ? (pageRoot.dataset.category || null) : null;
  console.log("PAGE_CATEGORY =", PAGE_CATEGORY);

  const POSTA_HIZMET_ORAN = 0.0235; // %2.35
  const KDV_ORAN = 0.20;           // %20

  function addFeesAndVat(netPrice) {
    const n = Number(netPrice || 0);
    if (n <= 0) return 0;

    const withService = n * (1 + POSTA_HIZMET_ORAN);
    const gross = withService * (1 + KDV_ORAN);

    // istersen 2 hane yuvarla:
    return Math.round(gross * 100) / 100;
  }

  const SHIPPING_RULES = [
    { min: 0, max: 1, type: "fixed", price: 111.86 },
    { min: 1, max: 4, type: "fixed", price: 134.20 },
    { min: 4, max: 6, type: "fixed", price: 163.53 },
    { min: 6, max: 10, type: "fixed", price: 177.25 },
    { min: 10, max: 15, type: "fixed", price: 200.48 },
    { min: 15, max: 20, type: "fixed", price: 249.10 },
    { min: 20, max: 25, type: "fixed", price: 309.55 },
    { min: 25, max: 30, type: "fixed", price: 374.23 },

    // 31 kg ve üzeri
    {
      min: 30,
      max: Infinity,
      type: "incremental",
      basePrice: 374.23,
      perKg: 12.324
    }
  ];

  function calcShippingByKg(totalKg) {
    const kg = Number(totalKg || 0);
    if (kg <= 0) return 0;

    const rule = SHIPPING_RULES.find(r => kg > r.min && kg <= r.max);
    if (!rule) return 0;

    let net = 0;

    if (rule.type === "fixed") {
      net = rule.price;
    } else if (rule.type === "incremental") {
      const extraKg = kg - rule.min;
      net = rule.basePrice + extraKg * rule.perKg;
    }

    // ✅ burada hizmet bedeli + KDV ekle
    return addFeesAndVat(net);
  }

  function cartTotalKg() {
    return cart.reduce((t, it) => {
      const w = Number(it.weightKg ?? it.weight_kg ?? 0);
      const q = Number(it.qty || 0);
      return t + (w * q);
    }, 0);
  }

  // ---------- SEPET (LS) ----------
  const CART_KEY = "cart_v1";
  let cart = readCart();

  function readCart() {
    try {
      return JSON.parse(localStorage.getItem(CART_KEY) || "[]");
    } catch {
      return [];
    }
  }
  function writeCart() {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  }

  function cartTotal() {
    return cart.reduce((t, i) => t + i.price * i.qty, 0);
  }
  function cartQty() {
    return cart.reduce((t, i) => t + i.qty, 0);
  }

  // ---------- API'DEN ÜRÜN ÇEKME ----------
  async function loadProductsFromApi() {
    if (!grid) {
      // ürün listesi olmayan sayfa (ör: product.html)
      return;
    }

    grid.innerHTML = "Yükleniyor...";

    try {
      const res = await fetch("/api/products");
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        grid.innerHTML =
          '<p style="color:#b91c1c;">Ürünler alınamadı. Daha sonra tekrar deneyin.</p>';
        console.error("loadProductsFromApi error:", data.error || res.status);
        return;
      }

      // 1) Tüm ürünleri normalize et
      ALL_PRODUCTS = (data.products || []).map((p) => ({
        id: String(p.id),
        name: p.name,
        price: Number(p.price),
        cat: p.category || "",                 // <-- slug burada
        img: p.imageurl || "assets/placeholder.png",
        description: p.description || "",
        weightKg: Number(p.weight_kg || 0), // ✅ ekle
      }));

      // 2) Sayfanın kategorisine göre filtrele
      let list = ALL_PRODUCTS;
      if (PAGE_CATEGORY) {
        list = list.filter(p => p.cat === PAGE_CATEGORY);
      }

      // 3) Filtrelenmiş listeyi PRODUCTS olarak kullan
      PRODUCTS = list;
      window.PRODUCTS = PRODUCTS;

      // 4) Var olan arama/sıralama filtreleri ne yapıyorsa yapsın
      applyFilters();
    } catch (err) {
      console.error("loadProductsFromApi error:", err);
      grid.innerHTML =
        '<p style="color:#b91c1c;">Ürünler alınırken bir hata oluştu.</p>';
    }
  }
  // ---------- ÜRÜN LİSTESİ ----------
  function renderProducts(list = PRODUCTS) {
    if (!grid) return;

    if (!list.length) {
      grid.innerHTML =
        '<p class="small">Şu anda listelenecek ürün bulunamadı.</p>';
      return;
    }

    grid.innerHTML = list
      .map(
        (p) => `
      <article class="product-card" data-id="${p.id}">
        <img src="${p.img}" alt="${p.name}" class="product-thumb"
             onerror="this.src='assets/placeholder.png'">
        <div class="product-title">${p.name}</div>
        <div class="product-meta">${p.cat?.toUpperCase() || ""}</div>
        <div class="product-price">
          ${p.price != null
            ? TRY.format(p.price)
            : "Fiyat için iletişime geçin"
          }
        </div>
        <button class="btn-add" data-add="${p.id}" ${p.price == null ? "disabled" : ""
          }>
          Sepete Ekle
        </button>
      </article>
    `
      )
      .join("");
  }

  // ---------- SEPET AKSİYONLARI ----------
  // BUNU ESKİ addToCart YERİNE KOY
  function addToCart(id, qty = 1) {
    // Ürünü önce ALL_PRODUCTS'ta, yoksa PRODUCTS'ta ara
    const p =
      (ALL_PRODUCTS && ALL_PRODUCTS.find((x) => x.id === id)) ||
      PRODUCTS.find((x) => x.id === id);

    if (!p) {
      console.warn("addToCart: ürün bulunamadı", id);
      return;
    }

    const ex = cart.find((x) => x.id === id);
    if (ex) {
      ex.qty += qty;
    } else {
      cart.push({
        id: p.id,
        name: p.name,
        price: p.price || 0,
        qty,
        img: p.img,
        cat: p.cat,
        description: p.description || "",
        weightKg: Number(p.weightKg || 0),   // ✅ BUNU EKLE
      });
    }

    writeCart();
    updateCartUI();
    alert("Ürün sepetinize eklendi.");
  }

  function removeFromCart(id) {
    cart = cart.filter((x) => x.id !== id);
    writeCart();
    updateCartUI();
  }

  function changeQty(id, delta) {
    const it = cart.find((x) => x.id === id);
    if (!it) return;
    it.qty = Math.max(1, it.qty + delta);
    writeCart();
    updateCartUI();
  }
  // Sepet içi butonlar (silme + adet değiştirme)
  if (cartItemsEl) {
    cartItemsEl.addEventListener("click", (e) => {
      const target = e.target;

      // Adet değiştirme (+ / -)
      const qtyBtn = target.closest(".qty-btn");
      if (qtyBtn) {
        const id = qtyBtn.dataset.qty;
        const delta = parseInt(qtyBtn.dataset.delta, 10) || 0;
        changeQty(id, delta);
        return;
      }

      // Ürün silme (x butonu)
      const rmBtn = target.closest(".cart-remove");
      if (rmBtn) {
        const id = rmBtn.dataset.remove;
        removeFromCart(id);
        return;
      }
    });
  }

  function updateCartUI() {
    const cartNow = readCart();
    cart = cartNow;

    const subtotal = cart.reduce((t, i) => t + i.price * i.qty, 0);
    const totalKg = cartTotalKg();
    let shipping = calcShippingByKg(totalKg);
    const total = subtotal + shipping;

    if (cartBadge) cartBadge.textContent = cartQty();

    if (cartTotalEl) cartTotalEl.textContent = TRY.format(subtotal);
    const cartTotalCloneEl = document.querySelector("#cartTotalClone");
    if (cartTotalCloneEl)
      cartTotalCloneEl.textContent = TRY.format(subtotal);

    const cartShippingEl = document.querySelector("#cartShipping");
    if (cartShippingEl) cartShippingEl.textContent = TRY.format(shipping);

    const cartGrandTotalEl = document.querySelector("#cartGrandTotal");
    if (cartGrandTotalEl) cartGrandTotalEl.textContent = TRY.format(total);

    if (!cartItemsEl) return;

    if (!cart.length) {
      cartItemsEl.innerHTML = "<p>Sepetiniz boş.</p>";
      return;
    }

    cartItemsEl.innerHTML = cart
      .map(
        (i) => `
        <div class="cart-item-row">

          <button type="button" class="cart-remove"
                  data-remove="${i.id}" aria-label="Ürünü sil">×</button>

          <div class="cart-col cart-product">
            <img src="${i.img}" class="cart-thumb">
            <span class="cart-product-name">${i.name}</span>
          </div>

          <div class="cart-col cart-price">${TRY.format(i.price)}</div>

          <div class="cart-col cart-qty">
            <button type="button" class="qty-btn"
                    data-qty="${i.id}" data-delta="-1">−</button>

            <input type="text" value="${i.qty}" readonly class="qty-input">

            <button type="button" class="qty-btn"
                    data-qty="${i.id}" data-delta="1">+</button>
          </div>

          <div class="cart-col cart-subtotal">
            ${TRY.format(i.price * i.qty)}
          </div>
        </div>
      `
      )
      .join("");
  }

  // ---------- EVENTLER ----------
  // Ürün grid'i (liste sayfaları)
  if (grid) {
    grid.addEventListener("click", (e) => {
      const addId = e.target?.dataset?.add;
      if (addId) {
        addToCart(addId, 1);   // <-- artık yukarıdaki fonksiyon çalışıyor
        return;
      }
      const card = e.target.closest(".product-card");
      if (card && !e.target.classList.contains("btn-add")) {
        const productId = card.dataset.id;
        window.location.href = `product.html?id=${productId}`;
      }
    });
  }

  // Filtre / sıralama
  const q = $("#q"),
    cat = $("#cat"),
    sort = $("#sort");

  function applyFilters() {
    if (!grid) return;
    let list = PRODUCTS.slice();

    if (q?.value) {
      const val = q.value.toLowerCase();
      list = list.filter((p) =>
        p.name.toLowerCase().includes(val)
      );
    }

    if (cat?.value) {
      list = list.filter((p) => p.cat === cat.value);
    }

    if (sort?.value === "price_asc") list.sort((a, b) => a.price - b.price);
    if (sort?.value === "price_desc") list.sort((a, b) => b.price - a.price);
    if (sort?.value === "name_asc")
      list.sort((a, b) => a.name.localeCompare(b.name, "tr"));

    renderProducts(list);
  }

  [q, cat, sort].forEach((inp) =>
    inp && inp.addEventListener("input", applyFilters)
  );

  // Checkout - login kontrolü ile
  checkoutBtn &&
    checkoutBtn.addEventListener("click", async () => {
      if (!cart.length) {
        alert("Sepetiniz boş.");
        return;
      }

      const user = await getCurrentUser?.();
      if (user) {
        window.location.href = "odeme.html";
      } else {
        window.location.href = "login.html?redirect=odeme.html";
      }
    });

  continueBtn &&
    continueBtn.addEventListener("click", () => {
      window.location.href = "urunler.html";
    });

  // ---------- BAŞLANGIÇ ----------
  updateCartUI();
  loadProductsFromApi(); // varsa ürün listesi sayfasında ürünleri çek

  // ---------- GLOBAL EXPORT ----------
  window.addToCart = addToCart;
  window.changeQty = changeQty;
  window.removeFromCart = removeFromCart;
  window.updateCartUI = updateCartUI;
})();
