
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
const productMessage = document.getElementById("product-message");
const productsTableWrapper = document.getElementById("products-table-wrapper");
const productIdInput = document.getElementById("product-id");
const productNameInput = document.getElementById("product-name");
const productSlugInput = document.getElementById("product-slug");
const productPriceInput = document.getElementById("product-price");
const productStockInput = document.getElementById("product-stock");
const productCategoryInput = document.getElementById("product-category");
const productImageInput = document.getElementById("product-image");
const productActiveSelect = document.getElementById("product-active");
const productDescInput = document.getElementById("product-desc");
const productSubmitBtn = document.getElementById("product-submit-btn");
const productResetBtn = document.getElementById("product-reset-btn");
const productFormMode = document.getElementById("product-form-mode");
const productForm = document.getElementById("product-form");

function resetProductForm() {
    productIdInput.value = "";
    productNameInput.value = "";
    productSlugInput.value = "";
    productPriceInput.value = "";
    productStockInput.value = "";
    productCategoryInput.value = "";
    productImageInput.value = "";
    productActiveSelect.value = "1";
    productDescInput.value = "";
    productFormMode.textContent = "Mod: Yeni ürün";
    productSubmitBtn.textContent = "Kaydet";
    if (productImagesCard) {
        productImagesCard.style.display = "none";
        if (productImagesList) productImagesList.innerHTML = "";
    }
    if (techImagesSection) {
        techImagesSection.style.display = "none";
        if (techImageList) techImageList.innerHTML = "";
    }
}

function fillProductForm(p) {
    productIdInput.value = p.Id;
    productNameInput.value = p.Name || "";
    productSlugInput.value = p.Slug || "";
    productPriceInput.value = p.Price || "";
    productStockInput.value = p.Stock || "";
    productCategoryInput.value = p.Category || "";
    productImageInput.value = p.ImageUrl || "";
    productActiveSelect.value = p.IsActive ? "1" : "0";
    productDescInput.value = p.Description || "";
    productFormMode.textContent = "Mod: Düzenleme (" + p.Id + ")";
    productSubmitBtn.textContent = "Güncelle";
    if (productImagesCard) {
        productImagesCard.style.display = "block";
        if (p.Id) {
            loadProductImages(p.Id);
        }
    }
    if (techImagesSection) {
        techImagesSection.style.display = "block";
        if (p.Id) {
            loadTechImages(p.Id);
        }
    }

}

productResetBtn.addEventListener("click", resetProductForm);

productForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    showMessage(productMessage, "", "");
    const payload = {
        name: productNameInput.value.trim(),
        slug: productSlugInput.value.trim(),
        price: productPriceInput.value,
        stock: productStockInput.value,
        category: productCategoryInput.value.trim(),
        imageUrl: productImageInput.value.trim(),
        description: productDescInput.value.trim(),
        isActive: productActiveSelect.value === "1",
    };
    if (!payload.name || !payload.slug) {
        showMessage(productMessage, "Ad ve slug zorunludur.", "error");
        return;
    }
    const id = productIdInput.value;
    const isEdit = !!id;
    productSubmitBtn.disabled = true;
    productSubmitBtn.textContent = isEdit ? "Güncelleniyor..." : "Kaydediliyor...";

    try {
        const res = await fetch(isEdit ? `/api/admin/products/${id}` : "/api/admin/products", {
            method: isEdit ? "PUT" : "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
            showMessage(
                productMessage,
                data.error || "Ürün kaydedilirken hata oluştu.",
                "error"
            );
        } else {
            showMessage(
                productMessage,
                isEdit ? "Ürün güncellendi." : "Ürün eklendi.",
                "success"
            );
            resetProductForm();
            loadProducts();
            refreshDashboard();
        }
    } catch (e) {
        console.error(e);
        showMessage(productMessage, "Sunucu hatası.", "error");
    } finally {
        productSubmitBtn.disabled = false;
        productSubmitBtn.textContent = isEdit ? "Güncelle" : "Kaydet";
    }
});

async function loadProducts() {
    productsTableWrapper.textContent = "Yükleniyor...";
    try {
        const res = await fetch("/api/admin/products", { credentials: "include" });
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
            return;
        }
        const rows = products.map(p => `
        <tr>
          <td>${p.Id}</td>
          <td>${p.Name}</td>
          <td>${p.Slug}</td>
          <td>${formatPrice(p.Price)} TL</td>
          <td>${p.Stock}</td>
          <td>${p.Category || ""}</td>
          <td>${p.IsActive ? '<span class="badge">Aktif</span>' : '<span class="badge gray">Pasif</span>'}</td>
          <td>
            <button type="button" class="btn secondary btn-edit" data-id="${p.Id}">Düzenle</button>
            <button type="button" class="btn danger btn-delete" data-id="${p.Id}">Sil</button>
          </td>
        </tr>
      `).join("");

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
              <th>Durum</th>
              <th>İşlemler</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `;

        productsTableWrapper.querySelectorAll(".btn-edit").forEach(btn => {
            btn.addEventListener("click", () => {
                const p = products.find(x => String(x.Id) === btn.dataset.id);
                if (p) fillProductForm(p);
            });
        });

        productsTableWrapper.querySelectorAll(".btn-delete").forEach(btn => {
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
                    loadProducts();
                    refreshDashboard();
                } catch (e) {
                    console.error(e);
                    alert("Sunucu hatası.");
                }
            });
        });

        // dashboard için küçük stat
        document.getElementById("stat-products").textContent = products.length;
    } catch (e) {
        console.error(e);
        productsTableWrapper.innerHTML =
            '<div class="message error">Ürünler alınırken hata oluştu.</div>';
    }
}
const productImagesCard = document.getElementById("product-images-card");
const productImageExtraFileInput = document.getElementById(
    "product-image-extra-file"
);
const productImageExtraStatus = document.getElementById(
    "product-image-extra-status"
);
const productImagesList = document.getElementById("product-images-list");

async function loadProductImages(productId) {
    if (!productImagesList) return;
    productImagesList.textContent = "Yükleniyor...";

    try {
        const res = await fetch(`/api/admin/products/${productId}/images`, {
            credentials: "include",
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok || !data.ok) {
            productImagesList.innerHTML =
                '<div class="message error">' +
                (data.error || "Görseller alınamadı.") +
                "</div>";
            return;
        }

        const images = data.images || [];
        if (!images.length) {
            productImagesList.innerHTML =
                '<div class="small">Bu ürüne ait teknik görsel yok.</div>';
            return;
        }

        productImagesList.innerHTML = images
            .map(
                (img) => `
        <div style="display:flex; flex-direction:column; align-items:center; gap:4px;">
          <img src="${img.ImageUrl}" 
               style="width:120px; height:80px; object-fit:cover; border-radius:8px; border:1px solid #e5e7eb;"
               alt="Tech image ${img.Id}">
          <button type="button" class="btn secondary btn-tech-del" data-id="${img.Id}" data-pid="${productId}">
            Sil
          </button>
        </div>
      `
            )
            .join("");

        productImagesList.querySelectorAll(".btn-tech-del").forEach((btn) => {
            btn.addEventListener("click", async () => {
                if (!confirm("Bu görseli silmek istediğine emin misin?")) return;
                try {
                    const res = await fetch(
                        `/api/admin/products/${btn.dataset.pid}/images/${btn.dataset.id}`,
                        {
                            method: "DELETE",
                            credentials: "include",
                        }
                    );
                    const d = await res.json().catch(() => ({}));
                    if (!res.ok || !d.ok) {
                        alert(d.error || "Görsel silinemedi.");
                        return;
                    }
                    loadProductImages(btn.dataset.pid);
                } catch (e) {
                    console.error(e);
                    alert("Sunucu hatası.");
                }
            });
        });
    } catch (e) {
        console.error(e);
        productImagesList.innerHTML =
            '<div class="message error">Görseller alınırken hata oluştu.</div>';
    }
}
if (productImageExtraFileInput) {
    productImageExtraFileInput.addEventListener("change", async () => {
        const file = productImageExtraFileInput.files?.[0];
        if (!file) return;

        const productId = productIdInput.value;
        if (!productId) {
            productImageExtraStatus.textContent =
                "Önce ürünü kaydet ve listeden 'Düzenle' ile aç.";
            productImageExtraStatus.className = "small error";
            productImageExtraFileInput.value = "";
            return;
        }

        productImageExtraStatus.textContent = "Yükleniyor...";
        productImageExtraStatus.className = "small";

        const fd = new FormData();
        fd.append("image", file);

        try {
            const res = await fetch(`/api/admin/products/${productId}/images`, {
                method: "POST",
                body: fd,
                credentials: "include",
            });
            const data = await res.json().catch(() => ({}));

            if (!res.ok || !data.ok || !data.url) {
                productImageExtraStatus.textContent =
                    data.error || "Yükleme başarısız.";
                productImageExtraStatus.className = "small error";
                return;
            }

            productImageExtraStatus.textContent = "Yüklendi ✔";
            productImageExtraStatus.className = "small success";
            productImageExtraFileInput.value = "";
            loadProductImages(productId);
        } catch (e) {
            console.error(e);
            productImageExtraStatus.textContent = "Sunucu hatası.";
            productImageExtraStatus.className = "small error";
        }
    });
}

const techImagesSection = document.getElementById("techImagesAdmin");
const techImageForm = document.getElementById("techImageForm");
const techImageList = document.getElementById("techImageList");
const productId = currentProductId; // senin zaten kullandığın id

async function loadTechImages(productId) {
    if (!techImageList) return;
    techImageList.textContent = "Yükleniyor...";

    try {
        const res = await fetch(`/api/admin/products/${productId}/detail-images`, {
            credentials: "include",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
            techImageList.innerHTML =
                '<div class="message error">' +
                (data.error || "Teknik görseller alınamadı.") +
                "</div>";
            return;
        }

        const images = data.images || [];
        if (!images.length) {
            techImageList.innerHTML =
                '<div class="small">Bu ürüne ait teknik görsel yok.</div>';
            return;
        }

        techImageList.innerHTML = images
            .map(
                (img) => `
            <div class="tech-thumb">
                <img src="${img.ImageUrl}" alt="${img.Caption || ""}">
                <div class="caption">${img.Caption || ""}</div>
                <button type="button" data-del="${img.Id}">Sil</button>
            </div>
        `
            )
            .join("");
    } catch (err) {
        console.error(err);
        techImageList.innerHTML =
            '<div class="message error">Teknik görseller alınırken hata oluştu.</div>';
    }
}

if (techImageForm) {
    techImageForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const productId = productIdInput.value;
        if (!productId) {
            alert("Önce ürünü kaydet ve listeden 'Düzenle' ile aç.");
            return;
        }

        const fileInput = techImageForm.querySelector('input[type="file"][name="image"]');
        const captionInput = techImageForm.querySelector('input[name="caption"]');
        const file = fileInput.files[0];

        if (!file) {
            alert("Lütfen bir görsel seç.");
            return;
        }

        const fd = new FormData();
        fd.append("image", file);
        if (captionInput && captionInput.value) {
            fd.append("caption", captionInput.value);
        }

        try {
            const res = await fetch(`/api/admin/products/${productId}/detail-images`, {
                method: "POST",
                body: fd,
                credentials: "include",
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.ok) {
                alert(data.error || "Teknik görsel eklenemedi.");
                return;
            }

            techImageForm.reset();
            loadTechImages(productId);
        } catch (err) {
            console.error(err);
            alert("Sunucu hatası.");
        }
    });
}

if (techImageList) {
    techImageList.addEventListener("click", async (e) => {
        const btn = e.target.closest("button[data-del]");
        if (!btn) return;

        const productId = productIdInput.value;
        if (!productId) return;

        const imgId = btn.dataset.del;
        if (!confirm("Bu görsel silinsin mi?")) return;

        try {
            const res = await fetch(
                `/api/admin/products/${productId}/detail-images/${imgId}`,
                {
                    method: "DELETE",
                    credentials: "include",
                }
            );
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.ok) {
                alert(data.error || "Görsel silinemedi.");
                return;
            }
            loadTechImages(productId);
        } catch (err) {
            console.error(err);
            alert("Sunucu hatası.");
        }
    });
}


techImageForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(techImageForm);

    const res = await fetch(`/api/admin/products/${productId}/detail-images`, {
        method: "POST",
        body: fd,
    });
    const data = await res.json();
    if (!data.ok) {
        alert(data.error || "Teknik görsel eklenemedi");
        return;
    }
    techImageForm.reset();
    loadTechImages();
});

techImageList?.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-del]");
    if (!btn) return;
    const imgId = btn.dataset.del;
    if (!confirm("Bu görsel silinsin mi?")) return;

    const res = await fetch(
        `/api/admin/products/${productId}/detail-images/${imgId}`,
        { method: "DELETE" }
    );
    const data = await res.json();
    if (!data.ok) {
        alert(data.error || "Silme hatası");
        return;
    }
    loadTechImages();
});

// sayfa açılınca
loadTechImages();


// ---- SİPARİŞLER ----
const ordersTableWrapper = document.getElementById("orders-table-wrapper");
const orderDetailCard = document.getElementById("order-detail-card");
const orderDetailContent = document.getElementById("order-detail-content");

async function loadOrders() {
    ordersTableWrapper.textContent = "Yükleniyor...";
    orderDetailCard.style.display = "none";
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
            ordersTableWrapper.innerHTML = '<div class="small">Henüz sipariş yok.</div>';
            document.getElementById("stat-orders").textContent = "0";
            return;
        }
        document.getElementById("stat-orders").textContent = orders.length;

        const rows = orders.map(o => `
        <tr class="clickable" data-id="${o.Id}">
          <td>${o.Id}</td>
          <td>${formatDate(o.CreatedAt)}</td>
          <td>${formatPrice(o.TotalPrice)} TL</td>
          <td>${o.ItemCount || 0}</td>
          <td>${o.TrackingNumber || "-"}</td>
          <td>${o.PaymentStatus === "paid"
                ? '<span class="badge">Ödendi</span>'
                : o.PaymentStatus === "failed"
                    ? '<span class="badge red">Hata</span>'
                    : '<span class="badge gray">' + (o.PaymentStatus || "Bilinmiyor") + "</span>"
            }</td>
        </tr>
      `).join("");

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

        ordersTableWrapper.querySelectorAll("tr[data-id]").forEach(row => {
            row.addEventListener("click", () => loadOrderDetail(row.dataset.id));
        });
    } catch (e) {
        console.error(e);
        ordersTableWrapper.innerHTML =
            '<div class="message error">Siparişler alınırken hata oluştu.</div>';
    }
}

async function loadOrderDetail(id) {
    orderDetailCard.style.display = "block";
    orderDetailContent.textContent = "Yükleniyor...";
    try {
        const res = await fetch(`/api/admin/orders/${id}`, { credentials: "include" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
            orderDetailContent.innerHTML =
                '<div class="message error">' +
                (data.error || "Sipariş detayı alınamadı.") +
                "</div>";
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
                  <td>${it.ProductName || it.ProductId}</td>
                  <td>${it.Quantity}</td>
                  <td>${formatPrice(it.UnitPrice)} TL</td>
                  <td>${formatPrice(it.TotalPrice)} TL</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        `;
        orderDetailContent.innerHTML = `
        <p><strong>Sipariş ID:</strong> ${o.Id}</p>
        <p><strong>Kullanıcı ID:</strong> ${o.UserId}</p>
        <p><strong>Tarih:</strong> ${formatDate(o.CreatedAt)}</p>
        <p><strong>Toplam:</strong> ${formatPrice(o.TotalPrice)} TL</p>
        <p><strong>Ödenen:</strong> ${formatPrice(o.PaidPrice)} TL</p>
        <p><strong>Durum:</strong> ${o.PaymentStatus || "-"}</p>
        <p><strong>Kargo Takip:</strong> ${o.TrackingNumber || "-"}</p>
        <hr />
        <h3>Ürünler</h3>
        ${itemsHtml}
      `;
    } catch (e) {
        console.error(e);
        orderDetailContent.innerHTML =
            '<div class="message error">Sipariş detayı alınırken hata oluştu.</div>';
    }
}

// ---- ÜYELER ----
const usersTableWrapper = document.getElementById("users-table-wrapper");

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
          <td>${u.Id}</td>
          <td>${u.FullName}</td>
          <td>${u.Email}</td>
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
