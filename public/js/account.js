// js/account.js
(() => {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const TRY_FMT = new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
  });

  // ---------------- PANEL GÖSTER / GİZLE ----------------
  function showPanel(name) {
    $$(".account-panel").forEach(panel => {
      panel.classList.toggle("is-active", panel.dataset.panel === name);
    });

    $$(".account-nav-link").forEach(link => {
      link.classList.toggle("is-active", link.dataset.accountLink === name);
    });

    if (name) {
      history.replaceState(null, "", `#${name}`);
    }
  }

  // ---------------- ÇIKIŞ ----------------
  function doLogout() {
    fetch("/auth/logout", { method: "POST", credentials: "include" })
      .then(r => r.json())
      .then(d => {
        window.location.href = d.redirect || "/login.html";
      })
      .catch(() => {
        window.location.href = "/login.html";
      });
  }

  // ---------------- ADRES FORM AÇ / KAPAT ----------------
  function toggleAddressForm(type, open) {
    const form = document.querySelector(`.address-form[data-address-form="${type}"]`);
    const view = document.querySelector(`.address-view[data-address-view="${type}"]`);
    if (!form || !view) return;

    if (open) {
      form.classList.add("is-open");
      view.style.display = "none";
    } else {
      form.classList.remove("is-open");
      view.style.display = "";
    }
  }

  // ---------------- ADRESLERİ LOAD ET ----------------
  async function loadAddresses() {
    try {
      const res = await fetch("/api/addresses", { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json(); // { addresses: [...] }

      (data.addresses || []).forEach(addr => {
        const type = addr.type; // 'billing' | 'shipping'
        const card = document.querySelector(`.address-card[data-address-type="${type}"]`);
        if (!card) return;

        const emptyEl = card.querySelector(".address-empty");
        const textEl = card.querySelector(".address-text");
        if (!textEl) return;

        const lines = [
          addr.full_name || `${addr.first_name || ""} ${addr.last_name || ""}`.trim(),
          addr.address_line,
          addr.city || "",
          addr.phone ? `Tel: ${addr.phone}` : ""
        ].filter(Boolean);

        textEl.textContent = lines.join("\n");
        textEl.hidden = false;
        if (emptyEl) emptyEl.style.display = "none";

        const form = card.querySelector(`.address-form[data-address-form="${type}"]`);
        if (form) {
          form.elements["first_name"].value = addr.first_name || "";
          form.elements["last_name"].value = addr.last_name || "";
          form.elements["phone"].value = addr.phone || "";
          form.elements["city"].value = addr.city || "";
          form.elements["address_line"].value = addr.address_line || "";
          form.elements["address_title"].value = addr.address_title || "";
        }
      });
    } catch (err) {
      console.error("loadAddresses error:", err);
    }
  }

  // ---------------- SİPARİŞLERİ LOAD ET ----------------
  async function loadMyOrders() {
    const listEl = document.getElementById("ordersList");
    const emptyEl = document.getElementById("ordersEmpty");
    if (!listEl) return;

    // "yükleniyor" mesajı
    if (emptyEl) {
      emptyEl.style.display = "block";
      emptyEl.textContent = "Siparişleriniz yükleniyor...";
    }

    try {
      const res = await fetch("/api/my/orders", {
        credentials: "include",
      });

      if (!res.ok) {
        throw new Error("HTTP " + res.status);
      }

      const data = await res.json();
      const orders = data.orders || [];

      if (!orders.length) {
        if (emptyEl) {
          emptyEl.style.display = "block";
          emptyEl.textContent = "Henüz siparişiniz yok.";
        }
        listEl.innerHTML = "";
        return;
      }

      if (emptyEl) emptyEl.style.display = "none";

      if (emptyEl) emptyEl.style.display = "none";

      listEl.innerHTML = orders
        .map(o => {
          const created = o.createdat
            ? new Date(o.createdat).toLocaleDateString("tr-TR")
            : "";

          const total = o.paidprice != null
            ? Number(o.paidprice)
            : Number(o.totalprice || 0);

          const statusText =
            o.status === "shipped" ? "Kargoya Verildi" :
              o.status === "delivered" ? "Teslim Edildi" :
                "Hazırlanıyor";
          const tracking = o.trackingnumber || "-";

          const detailUrl =
            "odeme-basarili.html?orderId=" +
            encodeURIComponent(o.id) +
            "&tracking=" +
            encodeURIComponent(tracking) +
            "&total=" +
            encodeURIComponent(total);

          const statusSlug =
            o.status === "shipped" ? "kargoya-verildi" :
              o.status === "delivered" ? "teslim-edildi" :
                "hazirlaniyor";

          return `
      <div class="order-row">
        <div class="order-col order-id" data-label="Sipariş No">#${o.id}</div>
        <div class="order-col order-date" data-label="Tarih">${created}</div>
        <div class="order-col order-status" data-label="Durum">
          <span class="status-badge status-${statusSlug}">
            ${statusText}
          </span>
        </div>
        <div class="order-col order-tracking" data-label="Kargo Takip No">${tracking}</div>
        <div class="order-col order-total text-right" data-label="Tutar">
          <strong>${TRY_FMT.format(total)}</strong>
        </div>
        <div class="order-col order-actions text-center">
          <a href="${detailUrl}" class="btn btn-sm btn-outline-primary">Detay</a>
        </div>
      </div>
    `;
        })
        .join("");
    } catch (err) {
      console.error("loadMyOrders error:", err);
      if (emptyEl) {
        emptyEl.style.display = "block";
        emptyEl.textContent = "Siparişler yüklenirken bir hata oluştu.";
      }
    }
  }

  // ---------------- DOM READY ----------------
  document.addEventListener("DOMContentLoaded", () => {
    // 1) Kullanıcı kontrolü + isim
    fetch("/api/me", { credentials: "include" })
      .then(r => {
        if (r.status === 401) {
          location.href = "/login.html";
          throw new Error("unauthorized");
        }
        return r.json();
      })
      .then(d => {
        const u = d?.user || {};
        const name = u.fullname || u.full_name || "Kullanıcı"; // <- burayı değiştirdik
        const email = u.email || "—";

        const nameEl = document.getElementById("welcomeName");
        const mailEl = document.getElementById("welcomeEmail");
        if (nameEl) nameEl.textContent = name;
        if (mailEl) mailEl.textContent = email;

        const accNameEl = document.getElementById("accountName");
        if (accNameEl) accNameEl.textContent = name;

        // Varsayılan adres alanlarını doldur
        const full = u.full_name || "";
        let firstFromFull = "";
        let lastFromFull = "";

        if (full) {
          const parts = full.split(" ");
          firstFromFull = parts[0] || "";
          lastFromFull = parts.slice(1).join(" ");
        }

        const defaultFirst = u.first_name || firstFromFull;
        const defaultLast = u.last_name || lastFromFull;
        const defaultPhone = u.phone || "";

        const billingForm = document.querySelector('.address-form[data-address-form="billing"]');
        if (billingForm) {
          if (!billingForm.elements["first_name"].value)
            billingForm.elements["first_name"].value = defaultFirst;
          if (!billingForm.elements["last_name"].value)
            billingForm.elements["last_name"].value = defaultLast;
          if (!billingForm.elements["phone"].value)
            billingForm.elements["phone"].value = defaultPhone;
        }

        const shippingForm = document.querySelector('.address-form[data-address-form="shipping"]');
        if (shippingForm) {
          if (!shippingForm.elements["first_name"].value)
            shippingForm.elements["first_name"].value = defaultFirst;
          if (!shippingForm.elements["last_name"].value)
            shippingForm.elements["last_name"].value = defaultLast;
          if (!shippingForm.elements["phone"].value)
            shippingForm.elements["phone"].value = defaultPhone;
        }
      })
      .catch(() => { });

    // ---------------- ŞİFRE GÜNCELLEME ----------------
    const passForm = document.querySelector(".account-form");
    if (passForm) {
      passForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const body = {
          current_password: passForm.elements["current_password"].value.trim(),
          new_password: passForm.elements["new_password"].value.trim(),
          new_password_confirm: passForm.elements["new_password_confirm"].value.trim(),
        };

        try {
          const res = await fetch("/api/account/password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(body),
          });

          const data = await res.json();

          if (!res.ok) {
            alert(data.error || "Şifre güncellenemedi.");
            return;
          }

          alert("Şifre başarıyla güncellendi.");
          passForm.reset();
        } catch (err) {
          console.error("password update error:", err);
          alert("Sunucu hatası oluştu.");
        }
      });
    }

    // 2) "Fatura adresim teslimat ile aynı" checkbox
    const sameChk = document.getElementById("sameAsShipping");
    if (sameChk) {
      sameChk.addEventListener("change", () => {
        const teslimatForm = document.querySelector('.address-form[data-address-form="billing"]');
        const faturaForm = document.querySelector('.address-form[data-address-form="shipping"]');
        if (!teslimatForm || !faturaForm) return;

        const fields = ["first_name", "last_name", "phone", "city", "address_line", "address_title"];

        if (sameChk.checked) {
          fields.forEach(name => {
            const from = teslimatForm.elements[name];
            const to = faturaForm.elements[name];
            if (!from || !to) return;
            to.value = from.value;
          });
        } else {
          fields.forEach(name => {
            const to = faturaForm.elements[name];
            if (!to) return;
            to.value = "";
          });
        }
      });
    }

    // 3) Logout butonu
    const logoutForm = document.getElementById("logoutForm");
    if (logoutForm) {
      logoutForm.addEventListener("submit", (e) => {
        e.preventDefault();
        doLogout();
      });
    }

    // 4) Sol menü tıklamaları
    $$(".account-nav-link").forEach(link => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const target = link.dataset.accountLink;
        if (!target) return;

        if (target === "logout") {
          doLogout();
          return;
        }
        showPanel(target);
      });
    });

    // 5) Adres panelindeki butonlar
    document.querySelectorAll(".address-edit-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const type = btn.dataset.edit;   // 'billing' | 'shipping'
        toggleAddressForm(type, true);
      });
    });

    document.querySelectorAll(".address-cancel-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const type = btn.dataset.cancel;
        toggleAddressForm(type, false);
      });
    });

    document.querySelectorAll(".address-form").forEach(form => {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const type = form.dataset.addressForm;
        const body = {
          type,
          first_name: form.elements["first_name"].value.trim(),
          last_name: form.elements["last_name"].value.trim(),
          phone: form.elements["phone"].value.trim(),
          city: form.elements["city"].value.trim(),
          address_line: form.elements["address_line"].value.trim(),
          address_title: form.elements["address_title"].value.trim(),
        };

        try {
          const res = await fetch("/api/addresses", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            alert("Adres kaydedilemedi.");
            return;
          }
          await loadAddresses();
          toggleAddressForm(type, false);
        } catch (err) {
          console.error("saveAddress error:", err);
          alert("Sunucu hatası.");
        }
      });
    });

    // 6) İlk açılış – hash'e göre panel & siparişleri çek
    const initial = window.location.hash.replace("#", "") || "dashboard";
    showPanel(initial);

    loadAddresses();
    loadMyOrders();
  });
})();
