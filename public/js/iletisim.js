// public/js/iletisim.js
document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("contactForm");
  if (!form) return;

  const messageBox = document.getElementById("contactFormMessage");
  const submitBtn = form.querySelector('button[type="submit"]');

  const setMessage = (text, type = "info") => {
    if (!messageBox) return;
    messageBox.textContent = text || "";
    messageBox.classList.remove(
      "form-message--error",
      "form-message--success"
    );
    if (type === "error") messageBox.classList.add("form-message--error");
    if (type === "success") messageBox.classList.add("form-message--success");
  };

  const clearFieldErrors = () => {
    form.querySelectorAll(".field-error").forEach((el) => el.remove());
    form
      .querySelectorAll(".form-field.has-error")
      .forEach((el) => el.classList.remove("has-error"));
  };

  const showFieldErrors = (fieldErrors) => {
    Object.entries(fieldErrors).forEach(([name, msg]) => {
      const input =
        form.querySelector(`[name="${name}"]`) ||
        form.querySelector(`#${name}`);
      if (!input) return;

      const wrapper = input.closest(".form-field") || input.parentElement;
      if (wrapper) {
        wrapper.classList.add("has-error");
        const div = document.createElement("div");
        div.className = "field-error";
        div.textContent = msg;
        wrapper.appendChild(div);
      }
    });
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors();
    setMessage("");

    const payload = {
      firstName: form.firstName.value.trim(),
      lastName: form.lastName.value.trim(),
      email: form.email.value.trim(),
      subject: form.subject.value.trim(),
      message: form.message.value.trim(),
    };

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Gönderiliyor...";
    }

    try {
      const res = await fetch(form.action || "/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        if (data.fieldErrors) {
          showFieldErrors(data.fieldErrors);
        }
        setMessage(
          data.message || "Mesaj gönderilirken bir hata oluştu.",
          "error"
        );
      } else {
        setMessage(
          data.message || "Mesajınız başarıyla gönderildi.",
          "success"
        );
        form.reset();
      }
    } catch (err) {
      console.error("Contact form error:", err);
      setMessage(
        "Sunucuya ulaşılamadı. Lütfen daha sonra tekrar deneyin.",
        "error"
      );
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Gönder";
      }
    }
  });
});
