// js/forgot-password.js
(() => {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const emailValid = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  function showError(input, msg) {
    const field = input.closest(".field") || input.parentElement;
    if (!field) return;
    field.classList.add("is-error");
    const old = field.querySelector(".field-msg");
    if (old) old.remove();
    const p = document.createElement("div");
    p.className = "field-msg";
    p.textContent = msg;
    field.appendChild(p);
  }

  function clearErrors(form) {
    $$(".is-error", form).forEach((el) => el.classList.remove("is-error"));
    $$(".field-msg", form).forEach((el) => el.remove());
  }

  function setLoading(btn, on) {
    if (!btn) return;
    btn.disabled = !!on;
    btn.classList.toggle("is-loading", on);
  }

  document.addEventListener("DOMContentLoaded", () => {
    const form = $("#forgotForm");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearErrors(form);

      const email = form.elements["email"];
      const pw1 = form.elements["new_password"];
      const pw2 = form.elements["new_password_confirm"];

      let firstInvalid = null;

      if (!email.value.trim()) {
        showError(email, "E-posta zorunludur.");
        firstInvalid ||= email;
      } else if (!emailValid(email.value.trim())) {
        showError(email, "Geçerli bir e-posta girin.");
        firstInvalid ||= email;
      }

      if (!pw1.value) {
        showError(pw1, "Yeni şifre zorunludur.");
        firstInvalid ||= pw1;
      } else if (pw1.value.length < 8) {
        showError(pw1, "Şifre en az 8 karakter olmalı.");
        firstInvalid ||= pw1;
      }

      if (!pw2.value) {
        showError(pw2, "Şifre tekrar zorunludur.");
        firstInvalid ||= pw2;
      } else if (pw1.value && pw1.value !== pw2.value) {
        showError(pw2, "Şifreler uyuşmuyor.");
        firstInvalid ||= pw2;
      }

      if (firstInvalid) {
        firstInvalid.focus({ preventScroll: true });
        firstInvalid.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }

      const submitBtn = form.querySelector('button[type="submit"]');
      setLoading(submitBtn, true);

      try {
        const res = await fetch("/auth/forgot-password", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            email: email.value.trim(),
            new_password: pw1.value,
            new_password_confirm: pw2.value,
          }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          // Alan bazlı hatalar geldiyse göster
          if (data.fieldErrors) {
            Object.entries(data.fieldErrors).forEach(([name, msg]) => {
              const input =
                form.elements[name] ||
                (name === "email" ? email : name === "new_password" ? pw1 : pw2);
              if (input) showError(input, msg);
            });
          } else if (data.error) {
            alert(data.error);
          } else {
            alert("İşlem gerçekleştirilemedi.");
          }
          return;
        }

        alert(data.message || "Şifreniz güncellendi. Giriş yapabilirsiniz.");
        window.location.href = data.redirect || "login.html";
      } catch (err) {
        console.error("forgot password error:", err);
        alert("Sunucuya bağlanılamadı.");
      } finally {
        setLoading(submitBtn, false);
      }
    });

    // Canlı hata temizleme
    document.addEventListener("input", (e) => {
      const field = e.target.closest(".field");
      if (!field) return;
      field.classList.remove("is-error");
      const msg = field.querySelector(".field-msg");
      if (msg) msg.remove();
    });
  });
})();
