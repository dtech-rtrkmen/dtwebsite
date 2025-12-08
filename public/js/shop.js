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
      // ürün listesi olmayan sayfa (ör: product.html) → sadece sepet için js gerekiyor
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

      PRODUCTS = (data.products || []).map((p) => ({
        id: String(p.Id),
        name: p.Name,
        price: Number(p.Price),
        cat: p.Category || "",
        img: p.ImageUrl || "assets/placeholder.png",
        description: p.Description || "",
      }));

      window.PRODUCTS = PRODUCTS; // güncel referansı paylaş
      applyFilters(); // filtre + liste
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
          ${
            p.price != null
              ? TRY.format(p.price)
              : "Fiyat için iletişime geçin"
          }
        </div>
        <button class="btn-add" data-add="${p.id}" ${
          p.price == null ? "disabled" : ""
        }>
          Sepete Ekle
        </button>
      </article>
    `
      )
      .join("");
  }

  // ---------- SEPET AKSİYONLARI ----------
  function addToCart(id, qty = 1) {
    const p = PRODUCTS.find((x) => x.id === id);
    if (!p) {
      console.warn("addToCart: ürün bulunamadı", id);
      return;
    }

    const ex = cart.find((x) => x.id === id);
    if (ex) ex.qty += qty;
    else cart.push({ ...p, qty });

    writeCart();
    updateCartUI();
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

  function updateCartUI() {
    const cartNow = readCart();
    cart = cartNow;

    const subtotal = cart.reduce((t, i) => t + i.price * i.qty, 0);
    let shipping = cart.length > 0 ? 99 : 0;
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
        addToCart(addId, 1);
        return;
      }
      const card = e.target.closest(".product-card");
      if (card && !e.target.classList.contains("btn-add")) {
        const productId = card.dataset.id;
        window.location.href = `product.html?id=${productId}`;
      }
    });
  }

  // Sepet satırları için tıklama (x, +, -)
  if (cartItemsEl) {
    cartItemsEl.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;

      const removeId = btn.dataset.remove;
      if (removeId) {
        removeFromCart(removeId);
        return;
      }

      const qtyId = btn.dataset.qty;
      if (qtyId) {
        const delta = parseInt(btn.dataset.delta, 10) || 0;
        changeQty(qtyId, delta);
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
