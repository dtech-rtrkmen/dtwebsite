
// ---- Yardımcılar ----
function formatPrice(value) {
    const n = Number(value || 0);
    return n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDate(value) {
    if (!value) return "";
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;
    return d.toLocaleString("tr-TR");
}
function showMessage(el, text, type) {
    el.textContent = text || "";
    el.className = "message " + (type || "");
    if (text) {
        setTimeout(() => {
            if (el.textContent === text) {
                el.textContent = "";
                el.className = "message";
            }
        }, 5000);
    }
}

// ---- SİPARİŞLER ----
let currentProductId = null;
var ordersTableWrapper = document.getElementById("orders-table-wrapper");
var orderDetailCard = document.getElementById("order-detail-card");
var orderDetailContent = document.getElementById("order-detail-content");
var usersTableWrapper = document.getElementById("users-table-wrapper");

// ---- Login / Admin görünümü ----
const loginView = document.getElementById("login-view");
const adminApp = document.getElementById("admin-app");
const loginForm = document.getElementById("login-form");
const loginMsg = document.getElementById("login-message");
const loginBtn = document.getElementById("login-btn");
const loginIdentifier = document.getElementById("login-identifier");
const loginPassword = document.getElementById("login-password");
const adminInfo = document.getElementById("admin-info");
const logoutBtn = document.getElementById("logout-btn");

async function checkAdmin() {
    try {
        const res = await fetch("/api/admin/me", { credentials: "include" });
        if (!res.ok) {
            showLogin();
            return;
        }
        const data = await res.json();
        if (!data.ok) {
            showLogin();
            return;
        }
        showAdmin(data.user);
    } catch (e) {
        console.error(e);
        showLogin();
    }
}

function showLogin() {
    loginView.style.display = "flex";
    adminApp.style.display = "none";
}

function showAdmin(user) {
    loginView.style.display = "none";
    adminApp.style.display = "block";
    adminInfo.textContent = user.fullName + " (" + user.email + ")";
    // Dashboard istatistikleri
    refreshDashboard();
    loadProducts();
    loadOrders();
    loadUsers();
}

loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    showMessage(loginMsg, "", "");
    const identifier = loginIdentifier.value.trim();
    const password = loginPassword.value.trim();
    if (!identifier || !password) {
        showMessage(loginMsg, "E-posta ve şifre zorunludur.", "error");
        return;
    }
    loginBtn.disabled = true;
    loginBtn.textContent = "Giriş yapılıyor...";

    try {
        // Var olan /auth/login endpoint'ini kullanıyoruz
        const res = await fetch("/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            credentials: "include",
            body: JSON.stringify({ identifier, password }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            const msg =
                (data.fieldErrors && (data.fieldErrors.identifier || data.fieldErrors.password)) ||
                data.message ||
                "Giriş başarısız.";
            showMessage(loginMsg, msg, "error");
        } else {
            // Giriş başarılı, admin mi kontrol et
            const meRes = await fetch("/api/admin/me", { credentials: "include" });
            const meData = await meRes.json().catch(() => ({}));
            if (!meRes.ok || !meData.ok) {
                showMessage(loginMsg, "Bu kullanıcı admin değil.", "error");
            } else {
                showAdmin(meData.user);
            }
        }
    } catch (e) {
        console.error(e);
        showMessage(loginMsg, "Sunucu hatası.", "error");
    } finally {
        loginBtn.disabled = false;
        loginBtn.textContent = "Giriş Yap";
    }
});

logoutBtn.addEventListener("click", async () => {
    try {
        await fetch("/auth/logout", {
            method: "POST",
            credentials: "include",
        }).catch(() => { });
    } catch { }
    showLogin();
});

const productImageFileInput = document.getElementById("product-image-file");
const productImageUploadStatus = document.getElementById(
    "product-image-upload-status"
);
if (productImageFileInput) {
    productImageFileInput.addEventListener("change", async () => {
        const file = productImageFileInput.files?.[0];
        if (!file) return;

        productImageUploadStatus.textContent = "Yükleniyor...";
        productImageUploadStatus.className = "small";

        const fd = new FormData();
        fd.append("image", file);

        try {
            const res = await fetch("/api/admin/upload-product-image", {
                method: "POST",
                body: fd,
                credentials: "include",
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.ok || !data.url) {
                productImageUploadStatus.textContent =
                    data.error || "Yükleme başarısız.";
                productImageUploadStatus.className = "small error";
                return;
            }

            productImageInput.value = data.url; // ← formdaki Görsel URL alanını doldur
            productImageUploadStatus.textContent = "Yüklendi ✔";
            productImageUploadStatus.className = "small success";
        } catch (err) {
            console.error(err);
            productImageUploadStatus.textContent = "Sunucu hatası.";
            productImageUploadStatus.className = "small error";
        }
    });
}

function statusLabel(s) {
    if (s === "preparing") return "Hazırlanıyor";
    if (s === "shipped") return "Kargoya Verildi";
    if (s === "delivered") return "Teslim Edildi";
    if (s === "cancelled") return "İptal";
    return "Hazırlanıyor";
}

function statusSlug(s) {
    if (s === "shipped") return "blue";
    if (s === "delivered") return "green";
    if (s === "cancelled") return "red";
    return "gray";
}

async function loadOrders() {
    if (!ordersTableWrapper) return;

    ordersTableWrapper.textContent = "Yükleniyor...";
    if (orderDetailCard) orderDetailCard.style.display = "none";

    try {
        const res = await fetch("/api/admin/orders", { credentials: "include" });
        const data = await res.json().catch(() => ({}));

        if (!res.ok || !data.ok) {
            ordersTableWrapper.innerHTML =
                '<div class="message error">' +
                (data.error || "Siparişler alınamadı.") +
                "</div>";
            return;
        }

        const orders = data.orders || [];
        if (!orders.length) {
            ordersTableWrapper.innerHTML =
                '<div class="small">Henüz sipariş yok.</div>';
            const stat = document.getElementById("stat-orders");
            if (stat) stat.textContent = "0";
            return;
        }

        const stat = document.getElementById("stat-orders");
        if (stat) stat.textContent = orders.length;

        const rows = orders
            .map(
                (o) => `
        <tr class="clickable" data-id="${o.id}">
          <td>${o.id}</td>
          <td>${formatDate(o.createdat)}</td>
          <td>${formatPrice(o.totalprice)} TL</td>
          <td>${o.itemcount || 0}</td>
          <td>${o.trackingnumber || "-"}</td>
        <td>
        <span class="badge ${statusSlug(o.status)}">
            ${statusLabel(o.status)}
        </span>
        </td>
        </tr>
      `
            )
            .join("");

        ordersTableWrapper.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Tarih</th>
            <th>Tutar</th>
            <th>Ürün Adedi</th>
            <th>Kargo Takip</th>
            <th>Durum</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;

        ordersTableWrapper.querySelectorAll("tr[data-id]").forEach((row) => {
            row.addEventListener("click", () =>
                loadOrderDetail(row.dataset.id)
            );
        });
    } catch (e) {
        console.error(e);
        ordersTableWrapper.innerHTML =
            '<div class="message error">Siparişler alınırken hata oluştu.</div>';
    }
}

async function loadOrderDetail(id) {
    if (!orderDetailCard || !orderDetailContent) return;

    orderDetailCard.style.display = "block";
    orderDetailContent.textContent = "Yükleniyor...";

    try {
        const res = await fetch(`/api/admin/orders/${id}`, { credentials: "include" });
        const data = await res.json().catch(() => ({}));

        if (!res.ok || !data.ok) {
            orderDetailContent.innerHTML =
                '<div class="message error">' + (data.error || "Sipariş detayı alınamadı.") + "</div>";
            return;
        }

        const o = data.order;
        const items = data.items || [];

        const itemsHtml = !items.length
            ? "<div class='small'>Bu siparişte ürün yok.</div>"
            : `
        <table>
          <thead>
            <tr>
              <th>Ürün</th>
              <th>Adet</th>
              <th>Birim Fiyat</th>
              <th>Toplam</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(it => `
              <tr>
                <td>${it.productname || it.productid}</td>
                <td>${it.quantity}</td>
                <td>${formatPrice(it.unitprice)} TL</td>
                <td>${formatPrice(it.totalprice)} TL</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `;

        orderDetailContent.innerHTML = `
      <p><strong>Sipariş ID:</strong> ${o.id}</p>
      <p><strong>Kullanıcı ID:</strong> ${o.userid}</p>
      <p><strong>Tarih:</strong> ${formatDate(o.createdat)}</p>
      <p><strong>Toplam:</strong> ${formatPrice(o.totalprice)} TL</p>
      <p><strong>Ödenen:</strong> ${formatPrice(o.paidprice)} TL</p>
      <p><strong>Durum:</strong> ${o.status || "-"}</p>
      <p><strong>Kargo Takip:</strong> <span id="trkNo">${o.trackingnumber || "-"}</span></p>

      <div style="margin:10px 0;">
        ${o.trackingnumber
                ? `<button class="btn btn-sm btn-secondary" disabled>Kargoya Verildi</button>`
                : `<button class="btn btn-primary" id="btnShipOrder">Kargoya Ver</button>`
            }
      </div>

      <hr />
      <h3>Ürünler</h3>
      ${itemsHtml}
    `;

        // ✅ CSP’ye takılmayan doğru yöntem: event listener
        const btn = document.getElementById("btnShipOrder");
        if (btn) {
            btn.addEventListener("click", () => shipOrder(o.id));
        }

    } catch (e) {
        console.error(e);
        orderDetailContent.innerHTML =
            '<div class="message error">Sipariş detayı alınırken hata oluştu.</div>';
    }
}


async function shipOrder(orderId) {
    if (!confirm(`#${orderId} siparişi kargoya vermek istiyor musunuz?`)) return;

    let msg = ""; // ✅ her durumda tanımlı olsun

    try {
        const res = await fetch(`/api/admin/orders/${orderId}/ship`, {
            method: "POST",
            credentials: "include",
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            msg = data?.error || data?.message || `Kargoya verme başarısız (HTTP ${res.status})`;
            alert(msg);
            console.error("Ship error response:", data);
            return;
        }

        alert(`Kargoya verildi ✅ Takip No: ${data.trackingNumber || "-"}`);

        loadOrderDetail(orderId);
    } catch (err) {
        console.error("Ship request failed:", err);
        alert("Sunucuya istek atılamadı (network/timeout).");
    }
}

// ---- Navigation ----
const navItems = document.querySelectorAll(".nav-item");
const viewTitle = document.getElementById("view-title");
const headerSub = document.getElementById("header-sub");

const viewMap = {
    "dashboard": {
        el: document.getElementById("view-dashboard"),
        title: "Dashboard",
        sub: "Genel bakış",
    },
    "products": {
        el: document.getElementById("view-products"),
        title: "Ürünler",
        sub: "Ürün ekle / düzenle",
    },
    "orders": {
        el: document.getElementById("view-orders"),
        title: "Siparişler",
        sub: "Gelen siparişler",
    },
    "users": {
        el: document.getElementById("view-users"),
        title: "Üyeler",
        sub: "Kayıtlı kullanıcılar",
    },
};

navItems.forEach((item) => {
    item.addEventListener("click", () => {
        navItems.forEach((i) => i.classList.remove("active"));
        item.classList.add("active");
        const v = item.dataset.view;
        Object.keys(viewMap).forEach((k) => {
            viewMap[k].el.style.display = k === v ? "block" : "none";
        });
        viewTitle.textContent = viewMap[v].title;
        headerSub.textContent = viewMap[v].sub;

        if (v === "products") loadProducts();
        if (v === "orders") loadOrders();
        if (v === "users") loadUsers();
        if (v === "dashboard") refreshDashboard();
    });
});
// ---- ÜRÜNLER ----

// FORM ALANLARI
const productMessage = document.getElementById("product-message");
const productsTableWrapper = document.getElementById("products-table-wrapper");
const productForm = document.getElementById("product-form");
const productIdInput = document.getElementById("product-id");
const productNameInput = document.getElementById("product-name");
const productSlugInput = document.getElementById("product-slug");
const productPriceInput = document.getElementById("product-price");
const productStockInput = document.getElementById("product-stock");
const productCategoryInput = document.getElementById("product-category");
const productWeightInput = document.getElementById("weightKg"); // 🔹 yeni
const productActiveSelect = document.getElementById("product-active");
const productDescInput = document.getElementById("product-desc");
const productSubmitBtn = document.getElementById("product-submit-btn");
const productResetBtn = document.getElementById("product-reset-btn");
const productFormMode = document.getElementById("product-form-mode");

// ANA GÖRSEL + GALERİ
const productMainFile = document.getElementById("productMainFile");
const productImageUrlInput = document.getElementById("productImageUrl");
const productGalleryInput = document.getElementById("productGalleryInput");
const productGalleryPreview = document.getElementById("productGalleryPreview");

// TEKNİK GÖRSELLER
const techImageFile = document.getElementById("techImageFile");
const techImageCaption = document.getElementById("techImageCaption");
const techImageAddBtn = document.getElementById("techImageAddBtn");
const techImageStatus = document.getElementById("techImageStatus");
const techImageList = document.getElementById("techImageList");

// DURUM
let pendingTechImages = [];           // Yeni ürün için sıraya alınan teknik görseller

/* ---------------- GALERİ ÖNİZLEME ---------------- */

if (productGalleryInput && productGalleryPreview) {
    productGalleryInput.addEventListener("change", () => {
        const files = Array.from(productGalleryInput.files || []);
        if (!files.length) {
            productGalleryPreview.textContent = "Henüz galeri görseli seçmediniz.";
            return;
        }

        const limited = files.slice(0, 4);
        productGalleryPreview.innerHTML =
            limited
                .map(
                    (f) =>
                        `<div>- ${f.name} (${(f.size / 1024).toFixed(1)} KB)</div>`
                )
                .join("") +
            `<div class="small">* En fazla 4 görsel kullanılacaktır.</div>`;
    });
}

/* ---------------- TEKNİK GÖRSEL KUYRUĞU ---------------- */

function renderPendingTechImages() {
    if (!techImageList || !techImageStatus) return;

    if (!pendingTechImages.length && !currentProductId) {
        techImageList.innerHTML =
            "<div>Henüz teknik görsel eklenmedi.</div>";
        techImageStatus.textContent =
            'Henüz teknik görsel eklenmedi. Dosya seçip "Ekle" diyerek sıraya alabilirsiniz.';
        return;
    }

    if (currentProductId && !pendingTechImages.length) {
        // Düzenleme modunda, mevcut görseller loadTechImages ile listeleniyor
        techImageStatus.textContent =
            "Bu ürün için teknik görselleri görüntüleyip yeni görsel ekleyebilirsiniz.";
        return;
    }

    // Yeni ürün modunda sıraya alınanlar
    techImageList.innerHTML = pendingTechImages
        .map(
            (it, i) =>
                `<div>${i + 1}. ${it.file.name} ${it.caption ? "(" + it.caption + ")" : ""
                }</div>`
        )
        .join("");

    techImageStatus.textContent =
        `${pendingTechImages.length} teknik görsel sıraya alındı. Ürün kaydedilince yüklenecek.`;
}

/* ---------------- TEK TEKNİK GÖRSEL UPLOAD (MEVCUT ÜRÜN) ---------------- */

async function uploadSingleTechImage(productId, file, caption) {
    const fd = new FormData();
    fd.append("image", file);
    if (caption) fd.append("caption", caption);

    const res = await fetch(`/api/admin/products/${productId}/detail-images`, {
        method: "POST",
        credentials: "include",
        body: fd,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
        console.error("Teknik görsel yüklenemedi:", data.error || res.status);
    }
}

/* ---------------- TEKNİK GÖRSEL EKLE BUTONU ---------------- */

// Teknik görsel kuyruğu (yeni + düzenleme için ortak
function renderPendingTechImages() {
    if (!techImageList) return;

    if (!pendingTechImages.length) {
        techImageList.textContent = "Henüz teknik görsel eklenmedi.";
        techImageStatus.textContent =
            "Bu ürün için teknik görsel görüntüleyip yeni görsel ekleyebilirsiniz.";
        return;
    }

    techImageStatus.textContent =
        pendingTechImages.length +
        " teknik görsel sıraya alındı. Ürün kaydedilince yüklenecek.";

    techImageList.innerHTML = pendingTechImages
        .map(
            (img, idx) => `${idx + 1}. ${img.file.name} ${img.caption ? `- ${img.caption}` : ""
                }`
        )
        .join("<br>");
}

function renderPendingTechImages() {
    if (!techImageList) return;

    if (!pendingTechImages.length) {
        techImageList.textContent = "Henüz teknik görsel eklenmedi.";
        if (techImageStatus) {
            techImageStatus.textContent =
                "Bu ürün için teknik görsel eklemedi. Dosya seçip \"Ekle\" diyerek sıraya alabilirsiniz.";
        }
        return;
    }

    if (techImageStatus) {
        techImageStatus.textContent =
            pendingTechImages.length +
            " teknik görsel sıraya alındı. Ürün kaydedilince yüklenecek.";
    }

    techImageList.innerHTML = pendingTechImages
        .map(
            (img, idx) =>
                `${idx + 1}. ${img.file.name}${img.caption ? " - " + img.caption : ""
                }`
        )
        .join("<br>");
}

if (techImageAddBtn) {
    techImageAddBtn.addEventListener("click", () => {
        if (!techImageFile || !techImageFile.files.length) {
            alert("Lütfen bir teknik görsel seçin.");
            return;
        }

        const file = techImageFile.files[0];
        const caption = techImageCaption.value.trim() || null;

        // Her zaman sadece sıraya al
        pendingTechImages.push({ file, caption });
        renderPendingTechImages();

        techImageFile.value = "";
        techImageCaption.value = "";
    });
}

/* ---------------- GALERİ GÖRSELLERİNİ YÜKLE (MAX 4) ---------------- */

async function uploadGalleryImages(productId) {
    if (!productGalleryInput) return;

    const files = Array.from(productGalleryInput.files || []).slice(0, 4);
    for (const file of files) {
        const fd = new FormData();
        fd.append("image", file);

        try {
            const res = await fetch(`/api/admin/products/${productId}/images`, {
                method: "POST",
                credentials: "include",
                body: fd,
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.ok) {
                console.error("Galeri görseli yüklenemedi:", data.error || res.status);
            }
        } catch (err) {
            console.error("uploadGalleryImages error:", err);
        }
    }
}

/* ---------------- FORM RESET ---------------- */

function resetProductForm() {
    currentProductId = null;
    productIdInput.value = "";
    productNameInput.value = "";
    productSlugInput.value = "";
    productPriceInput.value = "";
    productStockInput.value = "";
    if (productWeightInput) productWeightInput.value = "";   // 🔹 yeni
    productCategoryInput.value = "";
    productActiveSelect.value = "1";
    productDescInput.value = "";
    if (productImageUrlInput) productImageUrlInput.value = "";
    if (productMainFile) productMainFile.value = "";
    if (productGalleryInput) productGalleryInput.value = "";
    if (productGalleryPreview)
        productGalleryPreview.textContent = "Henüz galeri görseli seçmediniz.";

    pendingTechImages = [];
    renderPendingTechImages();

    productFormMode.textContent = "Mod: Yeni ürün";
    productSubmitBtn.textContent = "Kaydet";
    showMessage(productMessage, "", "");
}

if (productResetBtn) {
    productResetBtn.addEventListener("click", resetProductForm);
}

/* ---------------- FORM SUBMIT (YENİ ÜRÜN + DÜZENLEME) ---------------- */

if (productForm) {
    productForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const payload = {
            name: productNameInput.value.trim(),
            slug: productSlugInput.value.trim(),
            price: Number(productPriceInput.value),
            weight_kg: productWeightInput
                ? parseFloat(productWeightInput.value) || 0
                : 0,
            stock: Number(productStockInput.value),
            category: productCategoryInput.value.trim() || null,
            imageUrl: productImageUrlInput ? productImageUrlInput.value.trim() : null,
            description: productDescInput.value.trim() || null,
            isActive: productActiveSelect.value === "1",
        };

        if (!payload.name || !payload.slug) {
            showMessage(productMessage, "Ad ve kod (slug) zorunludur.", "error");
            return;
        }

        const id = productIdInput.value;
        const isEdit = !!id;

        productSubmitBtn.disabled = true;
        productSubmitBtn.textContent = isEdit
            ? "Güncelleniyor..."
            : "Kaydediliyor...";
        showMessage(productMessage, "", "");

        try {
            const res = await fetch(
                isEdit ? `/api/admin/products/${id}` : "/api/admin/products",
                {
                    method: isEdit ? "PUT" : "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify(payload),
                }
            );

            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.ok) {
                showMessage(
                    productMessage,
                    data.error || "Ürün kaydedilemedi.",
                    "error"
                );
                return;
            }

            const saved = data.product || {};
            const productId = isEdit ? Number(id) : Number(saved.id || saved.Id);

            // 1) ANA GÖRSEL
            if (productMainFile && productMainFile.files.length && productId) {
                const fd = new FormData();
                fd.append("image", productMainFile.files[0]);
                await fetch(`/api/admin/products/${productId}/images`, {
                    method: "POST",
                    credentials: "include",
                    body: fd,
                });
            }

            // 2) TANITIM GALERİSİ
            if (productId) {
                await uploadGalleryImages(productId);
            }

            // 3) YENİ ÜRÜN MODUNDA SIRADAKİ TEKNİK GÖRSELLER
            if (productId && pendingTechImages.length) {
                for (const item of pendingTechImages) {
                    await uploadSingleTechImage(productId, item.file, item.caption);
                }
                pendingTechImages = [];
            }

            renderPendingTechImages();
            showMessage(productMessage, "Ürün kaydedildi.", "success");

            resetProductForm();
            await loadProducts();
            if (typeof refreshDashboard === "function") {
                refreshDashboard();
            }
        } catch (err) {
            console.error(err);
            showMessage(productMessage, "Sunucu hatası.", "error");
        } finally {
            productSubmitBtn.disabled = false;
            productSubmitBtn.textContent = isEdit ? "Güncelle" : "Kaydet";
        }
    });
}

/* ---------------- ÜRÜN FORMUNU DOLDUR (DÜZENLEME) ---------------- */

function fillProductForm(p) {
    currentProductId = p.id;

    productIdInput.value = p.id;
    productNameInput.value = p.name || "";
    productSlugInput.value = p.slug || "";
    productPriceInput.value = p.price || "";
    productStockInput.value = p.stock || "";
    if (productWeightInput) {
        productWeightInput.value =
            p.weight_kg ?? p.weightkg ?? "";   // 🔹 API’de hangi isim geliyorsa onu yakalar
    }
    productCategoryInput.value = p.category || "";
    productActiveSelect.value = p.isactive ? "1" : "0";
    productDescInput.value = p.description || "";
    if (productImageUrlInput) productImageUrlInput.value = p.imageurl || "";

    productFormMode.textContent = "Mod: Düzenleme (" + p.id + ")";
    productSubmitBtn.textContent = "Güncelle";

    // Yeni ürün kuyruğunu temizle
    pendingTechImages = [];
    renderPendingTechImages();

    // Eğer loadTechImages tanımlıysa, mevcut teknik görselleri de çek
    if (typeof loadTechImages === "function") {
        loadTechImages(p.id);
    }
}

/* ---------------- ÜRÜN LİSTESİ ---------------- */

async function loadProducts() {
    productsTableWrapper.textContent = "Yükleniyor...";
    try {
        const res = await fetch("/api/admin/products", {
            credentials: "include",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
            productsTableWrapper.innerHTML =
                '<div class="message error">' +
                (data.error || "Ürünler alınamadı.") +
                "</div>";
            return;
        }

        const products = data.products || [];
        if (!products.length) {
            productsTableWrapper.innerHTML =
                '<div class="small">Henüz ürün yok.</div>';
            document.getElementById("stat-products").textContent = "0";
            return;
        }

        const rows = products
            .map(
                (p) => `
        <tr>
          <td>${p.id}</td>
          <td>${p.name}</td>
          <td>${p.slug}</td>
          <td>${formatPrice(p.price)} TL</td>
          <td>${p.stock}</td>
          <td>${p.category || ""}</td>
          <td>${Number(p.weight_kg || 0).toFixed(2)}</td>
          <td>${p.isactive
                        ? '<span class="badge">Aktif</span>'
                        : '<span class="badge gray">Pasif</span>'
                    }</td>
          <td>
            <button type="button" class="btn secondary btn-edit" data-id="${p.id}">Düzenle</button>
            <button type="button" class="btn danger btn-delete" data-id="${p.id}">Sil</button>
          </td>
        </tr>
      `
            )
            .join("");

        productsTableWrapper.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Ad</th>
            <th>Slug</th>
            <th>Fiyat</th>
            <th>Stok</th>
            <th>Kategori</th>
            <th>Ağırlık (kg)</th>
            <th>Durum</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;

        // Düzenle
        productsTableWrapper.querySelectorAll(".btn-edit").forEach((btn) => {
            btn.addEventListener("click", () => {
                const id = btn.dataset.id;
                const p = products.find((x) => String(x.id) === String(id));
                if (p) fillProductForm(p);
            });
        });

        // Sil
        productsTableWrapper.querySelectorAll(".btn-delete").forEach((btn) => {
            btn.addEventListener("click", async () => {
                if (!confirm("Bu ürünü silmek istediğine emin misin?")) return;
                try {
                    const res = await fetch(`/api/admin/products/${btn.dataset.id}`, {
                        method: "DELETE",
                        credentials: "include",
                    });
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok || !data.ok) {
                        alert(data.error || "Ürün silinemedi.");
                        return;
                    }
                    await loadProducts();
                    if (typeof refreshDashboard === "function") {
                        refreshDashboard();
                    }
                } catch (e) {
                    console.error(e);
                    alert("Sunucu hatası.");
                }
            });
        });

        // dashboard için stat
        document.getElementById("stat-products").textContent = products.length;
    } catch (e) {
        console.error(e);
        productsTableWrapper.innerHTML =
            '<div class="message error">Ürünler alınırken hata oluştu.</div>';
    }
}


// ---- ÜYELER ----

async function loadUsers() {
    usersTableWrapper.textContent = "Yükleniyor...";
    try {
        const res = await fetch("/api/admin/users", { credentials: "include" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
            usersTableWrapper.innerHTML =
                '<div class="message error">' +
                (data.error || "Üyeler alınamadı.") +
                "</div>";
            return;
        }
        const users = data.users || [];
        document.getElementById("stat-users").textContent = users.length;
        if (!users.length) {
            usersTableWrapper.innerHTML =
                '<div class="small">Henüz üye yok.</div>';
            return;
        }
        const rows = users.map(u => `
        <tr>
            <td>${u.id}</td>
            <td>${u.fullName || u.fullname}</td>
            <td>${u.email}</td>
        </tr>
        `).join("");
        usersTableWrapper.innerHTML = `
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Ad Soyad</th>
              <th>E-posta</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    } catch (e) {
        console.error(e);
        usersTableWrapper.innerHTML =
            '<div class="message error">Üyeler alınırken hata oluştu.</div>';
    }
}

// ---- Dashboard refresh ----
async function refreshDashboard() {
    // Şimdilik sadece statler diğer load fonksiyonlarından geliyor:
    // - stat-products: loadProducts
    // - stat-orders: loadOrders
    // - stat-users: loadUsers
    // Eğer o an güncel değilse, buradan da tetikleyebilirsin.
}

// Sayfa ilk açılışında admin kontrolü
checkAdmin();
