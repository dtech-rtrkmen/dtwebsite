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
    const exists = window.PRODUCTS.find((x) => String(x.id) === String(p.id));
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
      const mainImgUrl = p.imageurl || "assets/placeholder.png";

      const product = {
        id: String(p.id),
        name: p.name,
        price: Number(p.price),
        cat: p.category || "",
        img: mainImgUrl,
        desc: p.description || "",
        images: [mainImgUrl], // galeri buradan genişleyecek
        techImages: [],       // teknik görseller buraya gelecek
      };

      // 🔹 Üst galeri: productimages tablosu
      await attachProductImages(product);

      // 🔹 Teknik özellik görselleri: productdetailimages tablosu
      await attachTechImages(product);

      renderProduct(product);
      ensureProductRegistered(product);
    } catch (err) {
      console.error("loadProduct error:", err);
      wrap.innerHTML = "<p>Ürün yüklenirken bir hata oluştu.</p>";
    }
  }

  // ---------- ÜST GALERİ: productimages ----------
  async function attachProductImages(p) {
    try {
      const res = await fetch(`/api/products/${p.id}/images`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) return;

      // PostgreSQL'den gelen kolon isimleri: id, imageurl, createdat
      const extra = (data.images || [])
        .map((img) => img.imageurl)   // !!! küçük harf
        .filter(Boolean);

      if (!extra.length) {
        p.images = [p.img];
        return;
      }

      // Eğer ana resim placeholder ise, ilk gerçek görseli ana resim yap
      if (!p.img || p.img === "assets/placeholder.png") {
        p.img = extra[0];
      }

      const all = [p.img, ...extra];
      // Tekrar edenleri kaldır
      p.images = [...new Set(all)];
    } catch (e) {
      console.error("attachProductImages error:", e);
    }
  }

  // ---------- TEKNİK GÖRSELLER: productdetailimages ----------
  async function attachTechImages(p) {
    try {
      const res = await fetch(`/api/products/${p.id}/detail-images`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) return;

      // Kolonlar: id, productid, imageurl, caption, sortorder, createdat
      p.techImages = (data.images || [])
        .map((img) => ({
          url: img.imageurl,
          caption: img.caption || "",
        }))
        .filter((x) => x.url);
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

    if (specsEl) specsEl.innerHTML = ""; // şimdilik teknik özellik yok
    if (longEl) longEl.textContent = p.desc || "";

    if (mainImg) {
      mainImg.src = p.img;
      mainImg.alt = p.name;
    }

    // ---------- Teknik özellik görselleri ----------
    if (techGalleryEl) {
      const techImgs = p.techImages || [];
      if (!techImgs.length) {
        techGalleryEl.innerHTML = "";
      } else {
        techGalleryEl.innerHTML = techImgs
          .map(
            (t) => `
          <figure class="pd-tech-image">
            <img src="${t.url}" alt="${p.name} teknik görsel" loading="lazy">
            ${t.caption ? `<figcaption>${t.caption}</figcaption>` : ""}
          </figure>
        `
          )
          .join("");
      }
    }

    // ---------- Üst thumbnail galeri + oklar ----------
    const prevBtn = document.getElementById("pdPrev");
    const nextBtn = document.getElementById("pdNext");

    if (thumbs) {
      const imgs = p.images && p.images.length ? p.images : [p.img];
      let currentIndex = 0;

      function setImageByIndex(idx) {
        if (!imgs.length || !mainImg) return;
        // 0–(n-1) aralığına mod alarak sar
        const len = imgs.length;
        currentIndex = ((idx % len) + len) % len;
        const src = imgs[currentIndex] || p.img;

        mainImg.src = src;

        // aktif thumb sınıfı
        thumbs
          .querySelectorAll(".pd-thumb")
          .forEach((x) => x.classList.remove("is-active"));
        const activeBtn = thumbs.querySelector(
          `.pd-thumb[data-index="${currentIndex}"]`
        );
        if (activeBtn) activeBtn.classList.add("is-active");
      }

      // thumb’ları bas
      thumbs.innerHTML = imgs
        .map(
          (src, idx) => `
        <button type="button" class="pd-thumb${idx === 0 ? " is-active" : ""
            }" data-index="${idx}">
          <img src="${src}" alt="${p.name}">
        </button>
      `
        )
        .join("");

      // thumb tıklama
      thumbs.addEventListener("click", (e) => {
        const btn = e.target.closest(".pd-thumb");
        if (!btn) return;
        const index = Number(btn.dataset.index) || 0;
        setImageByIndex(index);
      });

      // sol/sağ oklar
      if (prevBtn) {
        prevBtn.addEventListener("click", () => {
          if (imgs.length <= 1) return;
          setImageByIndex(currentIndex - 1);
        });
      }
      if (nextBtn) {
        nextBtn.addEventListener("click", () => {
          if (imgs.length <= 1) return;
          setImageByIndex(currentIndex + 1);
        });
      }

      // ilk resmi garantiye al
      setImageByIndex(0);
    }

    // ---------- Zoom ----------
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

     // ---------- Adet ve sepete ekleme ----------
    const qtyInput = document.getElementById("pdQtyInput");
    const qtyBtns = document.querySelectorAll(".qty-btn");
    const addBtn = document.getElementById("pdAddBtn");

    qtyBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!qtyInput) return;
        const delta = parseInt(btn.dataset.delta || "0", 10);
        const val = Math.max(
          1,
          (parseInt(qtyInput.value || "1", 10) || 1) + delta
        );
        qtyInput.value = String(val);
      });
    });

    addBtn &&
      addBtn.addEventListener("click", () => {
        const qty = qtyInput
          ? Math.max(1, parseInt(qtyInput.value || "1", 10) || 1)
          : 1;

        // 1) Eğer shop.js içindeki addToCart varsa onu kullan
        if (typeof window.addToCart === "function") {
          window.addToCart(String(p.id), qty);
        } else {
          // 2) Yoksa slider'da yaptığımız gibi localStorage fallback
          try {
            const CART_KEY = "cart_v1";
            const cart = JSON.parse(localStorage.getItem(CART_KEY) || "[]");

            const ex = cart.find((i) => String(i.id) === String(p.id));
            if (ex) {
              ex.qty += qty;
            } else {
              cart.push({
                id: String(p.id),
                name: p.name,
                price: p.price || 0,
                qty,
                img: p.img,
              });
            }

            localStorage.setItem(CART_KEY, JSON.stringify(cart));

            // rozet güncelle
            const badge = document.getElementById("cartBadge");
            if (badge) {
              const totalQty = cart.reduce(
                (t, i) => t + (i.qty || 0),
                0
              );
              badge.textContent = totalQty;
            }
          } catch (err) {
            console.warn("product page cart fallback error:", err);
          }
        }

        alert("Ürün sepetinize eklendi.");
      });
  }

  document.addEventListener("DOMContentLoaded", loadProduct);
})();
