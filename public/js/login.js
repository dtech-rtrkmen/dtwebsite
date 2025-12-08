/* login.js — Login/Register sekmeleri, şifre gösterme ve form doğrulama + AJAX */
(() => {
  "use strict";

  // Kısayollar
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  // ----- Redirect helper'ları -----
  function getRedirectTarget() {
    const params = new URLSearchParams(window.location.search);
    // ?redirect=odeme.html varsa onu al, yoksa account.html'e git
    return params.get("redirect") || "account.html";
  }

  function handleLoginSuccess() {
    const target = getRedirectTarget();
    window.location.href = target;
  }

  // ----- Sekmeler -----
  function initTabs() {
    const loginTab = $("#loginTab");
    const registerTab = $("#registerTab");
    const loginPanel = $("#loginPanel");
    const registerPanel = $("#registerPanel");
    if (!loginTab || !registerTab || !loginPanel || !registerPanel) return;

    const showLogin = () => {
      loginTab.classList.add("is-active");
      registerTab.classList.remove("is-active");
      loginPanel.classList.remove("is-hidden");
      loginPanel.removeAttribute("hidden");
      registerPanel.classList.add("is-hidden");
      registerPanel.setAttribute("hidden", "");
      loginTab.setAttribute("aria-selected", "true");
      registerTab.setAttribute("aria-selected", "false");
    };

    const showRegister = () => {
      registerTab.classList.add("is-active");
      loginTab.classList.remove("is-active");
      registerPanel.classList.remove("is-hidden");
      registerPanel.removeAttribute("hidden");
      loginPanel.classList.add("is-hidden");
      loginPanel.setAttribute("hidden", "");
      registerTab.setAttribute("aria-selected", "true");
      loginTab.setAttribute("aria-selected", "false");
    };

    loginTab.addEventListener("click", showLogin);
    registerTab.addEventListener("click", showRegister);
  }

  // ----- Şifreyi göster/gizle -----
  function initReveal() {
    $$(".reveal").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sel = btn.dataset.target;
        if (!sel) return;
        const input = document.querySelector(sel);
        if (!input) return;
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        btn.textContent = show ? "🙈" : "👁️";
      });
    });
  }

  // ----- Doğrulama yardımcıları -----
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
  const emailValid = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  function setLoading(btn, on) { if (btn) { btn.classList.toggle("is-loading", on); btn.disabled = !!on; } }

  // ----- LOGIN -----
  function initLoginValidation() {
    const form = $("#loginPanel form.auth-form");
    if (!form) return;

    form.addEventListener("submit", (e) => {
      e.preventDefault();                 // <— önce varsayılanı durdur
      clearErrors(form);
      let firstInvalid = null;

      const id = form.elements["identifier"];
      const pw = form.elements["password"];

      if (!id.value.trim()) { showError(id, "Kullanıcı adı veya e-posta zorunludur."); firstInvalid ||= id; }
      if (!pw.value) { showError(pw, "Şifre zorunludur."); firstInvalid ||= pw; }
      else if (pw.value.length < 6) { showError(pw, "Şifre en az 6 karakter olmalı."); firstInvalid ||= pw; }

      if (firstInvalid) {
        firstInvalid.focus({ preventScroll: true });
        firstInvalid.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }

      setLoading(form.querySelector('button[type="submit"]'), true);

      fetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ identifier: id.value.trim(), password: pw.value })
      })
        .then(r => r.json())
        .then(data => {
          if (data.redirect) {
            // Backend "giriş OK" dedi → nereye gideceğimize biz karar veriyoruz
            handleLoginSuccess();
            return;
          }
          alert("Giriş başarısız.");
        })
        .catch(() => alert("Sunucuya bağlanılamadı."))
        .finally(() => setLoading(form.querySelector('button[type="submit"]'), false));
    });
  }

  // ----- REGISTER -----
  function initRegisterValidation() {
    const form = $("#registerPanel form.auth-form");
    if (!form) return;

    form.addEventListener("submit", (e) => {
      e.preventDefault();                 // <— önce varsayılanı durdur
      clearErrors(form);
      let firstInvalid = null;

      const name = form.elements["full_name"];
      const mail = form.elements["email"];
      const pw1 = form.elements["reg_password"];
      const pw2 = form.elements["reg_password_confirm"];
      const terms = form.elements["terms"];

      if (!name.value.trim()) { showError(name, "Ad Soyad zorunludur."); firstInvalid ||= name; }
      if (!mail.value.trim()) { showError(mail, "E-posta zorunludur."); firstInvalid ||= mail; }
      else if (!emailValid(mail.value.trim())) { showError(mail, "Geçerli bir e-posta girin."); firstInvalid ||= mail; }
      if (!pw1.value) { showError(pw1, "Şifre zorunludur."); firstInvalid ||= pw1; }
      else if (pw1.value.length < 8) { showError(pw1, "Şifre en az 8 karakter olmalı."); firstInvalid ||= pw1; }
      if (!pw2.value) { showError(pw2, "Şifre tekrar zorunludur."); firstInvalid ||= pw2; }
      else if (pw1.value && pw1.value !== pw2.value) { showError(pw2, "Şifreler uyuşmuyor."); firstInvalid ||= pw2; }
      if (!terms.checked) {
        const label = terms.closest(".checkbox") || terms.parentElement;
        if (label) {
          const m = document.createElement("div");
          m.className = "field-msg";
          m.textContent = "Kullanım şartlarını kabul etmelisiniz.";
          label.appendChild(m);
        }
        firstInvalid ||= terms;
      }

      if (firstInvalid) {
        firstInvalid.focus({ preventScroll: true });
        firstInvalid.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }

      setLoading(form.querySelector('button[type="submit"]'), true);

      fetch("/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({
          full_name: name.value.trim(),
          email: mail.value.trim(),
          reg_password: pw1.value,
          reg_password_confirm: pw2.value
        })
      })
        .then(r => r.json())
        .then(data => {
          if (data.redirect) { window.location.href = data.redirect; return; }
          alert("Kayıt tamamlanamadı.");
        })
        .catch(() => alert("Sunucuya bağlanılamadı."))
        .finally(() => setLoading(form.querySelector('button[type="submit"]'), false));
    });
  }

  // ----- Hata temizleme -----
  function initLiveCleanup() {
    document.addEventListener("input", (e) => {
      const field = e.target.closest(".field");
      if (!field) return;
      field.classList.remove("is-error");
      const msg = field.querySelector(".field-msg");
      if (msg) msg.remove();
    });
  }

  // ----- Başlat -----
  document.addEventListener("DOMContentLoaded", () => {
    initTabs();
    initReveal();
    initLoginValidation();
    initRegisterValidation();
    initLiveCleanup();
  });
})();
