// js/odeme-basarili.js

(() => {
  const CART_KEY = "cart_v1";   // 🔹 sepet key'i
  const TRY = new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
  });

  document.addEventListener("DOMContentLoaded", () => {
    // 1) ÖDEME BAŞARILI OLDUĞUNDA SEPETİ TEMİZLE
    try {
      // localStorage'dan sepeti sil
      localStorage.removeItem(CART_KEY);

      // header’daki sepet rozeti varsa 0 yap
      const badge = document.getElementById("cartBadge");
      if (badge) badge.textContent = "0";
    } catch (e) {
      console.warn("Sepet temizlenemedi:", e);
    }

    // 2) URL parametrelerinden bilgiler
    const params = new URLSearchParams(window.location.search);

    const orderId  = params.get("orderId") || "-";
    const tracking = params.get("tracking") || "-";
    const totalRaw = params.get("total");

    const orderIdCell  = document.getElementById("orderIdCell");
    const trackingCell = document.getElementById("trackingCell");
    const totalCell    = document.getElementById("totalCell");
    const btnYkTrack   = document.getElementById("btnYurticiTrack");

    // Sipariş no
    if (orderIdCell) {
      orderIdCell.textContent = orderId !== "-" ? `#${orderId}` : "-";
    }

    // Kargo takip
    if (trackingCell) {
      trackingCell.textContent = tracking || "-";
    }

    // Toplam tutar
    if (totalCell) {
      if (totalRaw) {
        totalCell.textContent = TRY.format(Number(totalRaw));
      } else {
        totalCell.textContent = "-";
      }
    }

    // Yurtiçi kargo sayfası butonu
    if (btnYkTrack && tracking && tracking !== "-") {
      btnYkTrack.addEventListener("click", () => {
        const base =
          "https://www.yurticikargo.com/tr/online-servisler/gonderi-sorgula";
        const url = `${base}?code=${encodeURIComponent(tracking)}`;
        window.open(url, "_blank");
      });
    }

    // 3) DB'den sipariş detaylarını çek (varsa)
    if (orderId && orderId !== "-") {
      loadOrderDetails(orderId, totalCell);
    }
  });

  async function loadOrderDetails(orderId, totalCell) {
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`);
      if (!res.ok) return;

      const data = await res.json();
      if (!data.ok || !data.order) return;

      const { order, items } = data;

      if (totalCell && order.PaidPrice != null) {
        totalCell.textContent = TRY.format(Number(order.PaidPrice));
      }

      const block = document.getElementById("orderItemsBlock");
      const listEl = document.getElementById("orderItemsList");
      if (!block || !listEl || !Array.isArray(items) || !items.length) return;

      listEl.innerHTML = items
        .map((it) => {
          const qty = it.Quantity || 1;
          const name = it.ProductName || "Ürün";
          const lineTotal = Number(it.TotalPrice || 0);
          return `
            <div class="order-item-row">
              <div>
                <span class="order-item-name">${name}</span>
                <span class="order-item-qty">× ${qty}</span>
              </div>
              <div class="order-item-total">
                ${TRY.format(lineTotal)}
              </div>
            </div>
          `;
        })
        .join("");

      block.hidden = false;
    } catch (err) {
      console.error("Order details load error:", err);
    }
  }
})();
