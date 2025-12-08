// js/product.js — ürün detayını /api/products/:id den çeker
(() => {
  const TRY =
    window.TRY ||
    new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" });

  function getQueryParam(name) {
    const url = new URL(window.location.href);
    return url.searchParams.get(name);
  }

  function ensureProductRegistered(p) {
    // shop.js'teki addToCart'in çalışması için PRODUCTS içinde olmalı
    window.PRODUCTS = window.PRODUCTS || [];
    const exists = window.PRODUCTS.find((x) => x.id === p.id);
    if (!exists) {
      window.PRODUCTS.push({
        id: p.id,
        name: p.name,
        price: p.price,
        img: p.img,
        cat: p.cat,
      });
    }
  }

  async function loadProduct() {
    const id = getQueryParam("id");
    const wrap = document.getElementById("pd");
    if (!wrap) return;

    if (!id) {
      wrap.innerHTML = "<p>Ürün bulunamadı.</p>";
      return;
    }

    try {
      const res = await fetch(`/api/products/${id}`);
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        wrap.innerHTML = "<p>Ürün bulunamadı veya silinmiş olabilir.</p>";
        return;
      }

      const p = data.product;
      const product = {
        id: String(p.Id),
        name: p.Name,
        price: Number(p.Price),
        cat: p.Category || "",
        img: p.ImageUrl || "assets/placeholder.png",
        desc: p.Description || "",
        images: [p.ImageUrl || "assets/placeholder.png"],
      };

      await attachProductImages(product);   // Üstteki thumbnail galeri
      await attachTechImages(product);      // Alttaki teknik görseller
      renderProduct(product);
      ensureProductRegistered(product);
    } catch (err) {
      console.error("loadProduct error:", err);
      wrap.innerHTML = "<p>Ürün yüklenirken bir hata oluştu.</p>";
    }
  }
  async function attachProductImages(p) {
    try {
      const res = await fetch(`/api/products/${p.id}/images`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) return;

      const extra = (data.images || [])
        .map((img) => img.ImageUrl)
        .filter(Boolean);

      if (!extra.length) return;

      const base = p.img;
      const all = [base, ...extra];
      // Tekrar edenleri kaldır
      p.images = [...new Set(all)];
    } catch (e) {
      console.error("attachProductImages error:", e);
    }
  }

  async function attachTechImages(p) {
    try {
      const res = await fetch(`/api/products/${p.id}/detail-images`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) return;

      p.techImages = (data.images || [])
        .map((img) => img.ImageUrl)
        .filter(Boolean);
    } catch (e) {
      console.error("attachTechImages error:", e);
    }
  }


  function renderProduct(p) {
    const titleEl = document.getElementById("pdTitle");
    const catEl = document.getElementById("pdCat");
    const descEl = document.getElementById("pdDesc");
    const priceEl = document.getElementById("pdPrice");
    const specsEl = document.getElementById("pdSpecs");
    const longEl = document.getElementById("pdLong");
    const mainImg = document.getElementById("pdMain");
    const thumbs = document.getElementById("pdThumbs");
    const techGalleryEl = document.getElementById("pdTechGallery");

    if (titleEl) titleEl.textContent = p.name;
    if (catEl) catEl.textContent = p.cat || "";
    if (descEl) descEl.textContent = p.desc || "";
    if (priceEl)
      priceEl.textContent =
        p.price != null ? TRY.format(p.price) : "Fiyat için iletişime geçin";

    if (specsEl) specsEl.innerHTML = ""; // şimdilik teknik özellik yok (DB'ye ekleyince doldururuz)
    if (longEl) longEl.textContent = p.desc || "";

    if (mainImg) {
      mainImg.src = p.img;
      mainImg.alt = p.name;
    }

    // Teknik özellik görselleri (alt alta)
    if (techGalleryEl) {
      const imgs = p.techImages || []; // sadece ProductDetailImages
      if (!imgs.length) {
        techGalleryEl.innerHTML = "";
      } else {
        techGalleryEl.innerHTML = imgs
          .map(
            (url) => `
      <div class="pd-tech-image">
        <img src="${url}" alt="${p.name} teknik görsel" loading="lazy">
      </div>
    `
          )
          .join("");
      }
    }
    
    if (thumbs) {
      thumbs.innerHTML = p.images
        .map(
          (src, idx) => `
        <button type="button" class="pd-thumb${idx === 0 ? " is-active" : ""
            }" data-index="${idx}">
          <img src="${src}" alt="${p.name}">
        </button>
      `
        )
        .join("");

      thumbs.addEventListener("click", (e) => {
        const btn = e.target.closest(".pd-thumb");
        if (!btn) return;
        const index = Number(btn.dataset.index) || 0;
        const imgSrc = p.images[index] || p.img;
        if (mainImg) {
          mainImg.src = imgSrc;
        }
        thumbs
          .querySelectorAll(".pd-thumb")
          .forEach((x) => x.classList.remove("is-active"));
        btn.classList.add("is-active");
      });
    }

    // Zoom
    const zoomBtn = document.getElementById("pdZoomBtn");
    const lightbox = document.getElementById("pdLightbox");
    const lightboxImg = document.getElementById("pdLightboxImg");
    const lightboxClose = document.getElementById("pdLightboxClose");

    zoomBtn &&
      zoomBtn.addEventListener("click", () => {
        if (!lightbox || !lightboxImg) return;
        lightboxImg.src = mainImg?.src || p.img;
        lightbox.style.display = "flex";
        lightbox.setAttribute("aria-hidden", "false");
      });

    lightboxClose &&
      lightboxClose.addEventListener("click", () => {
        if (!lightbox) return;
        lightbox.style.display = "none";
        lightbox.setAttribute("aria-hidden", "true");
      });

    lightbox &&
      lightbox.addEventListener("click", (e) => {
        if (e.target === lightbox) {
          lightbox.style.display = "none";
          lightbox.setAttribute("aria-hidden", "true");
        }
      });

    // Adet ve sepete ekleme
    const qtyInput = document.getElementById("pdQtyInput");
    const qtyBtns = document.querySelectorAll(".qty-btn");
    const addBtn = document.getElementById("pdAddBtn");

    qtyBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!qtyInput) return;
        const delta = parseInt(btn.dataset.delta || "0", 10);
        const val = Math.max(1, (parseInt(qtyInput.value || "1", 10) || 1) + delta);
        qtyInput.value = String(val);
      });
    });

    addBtn &&
      addBtn.addEventListener("click", () => {
        const qty = qtyInput
          ? Math.max(1, parseInt(qtyInput.value || "1", 10) || 1)
          : 1;

        if (typeof window.addToCart === "function") {
          window.addToCart(p.id, qty);
          alert("Ürün sepetinize eklendi.");
        } else {
          console.warn("addToCart fonksiyonu bulunamadı.");
        }
      });
  }

  document.addEventListener("DOMContentLoaded", loadProduct);
})();
