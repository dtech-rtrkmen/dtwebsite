document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("jobApplicationForm");
  if (!form) return;

  const messageBox = document.getElementById("jobFormMessage");
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
    form
      .querySelectorAll(".field-error")
      .forEach((el) => el.remove());
    form
      .querySelectorAll(".has-error")
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
        const span = document.createElement("div");
        span.className = "field-error";
        span.textContent = msg;
        wrapper.appendChild(span);
      }
    });
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors();
    setMessage("");

    const formData = new FormData(form);

    // Onay kutusu işaretli mi kontrolü (extra güvenlik)
    if (!form.approval.checked) {
      setMessage(
        "Başvuruyu tamamlamak için bilgilerin doğruluğunu onaylamalısınız.",
        "error"
      );
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Gönderiliyor...";
    }

    try {
      const res = await fetch(form.action || "/api/job-application", {
        method: "POST",
        body: formData,
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        if (data.fieldErrors) {
          showFieldErrors(data.fieldErrors);
        }
        setMessage(
          data.message || "Form gönderilirken bir hata oluştu.",
          "error"
        );
      } else {
        setMessage(data.message || "Başvurunuz başarıyla alındı.", "success");
        form.reset();
      }
    } catch (err) {
      console.error("Job application error:", err);
      setMessage(
        "Sunucuya ulaşılamadı. Lütfen daha sonra tekrar deneyin.",
        "error"
      );
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Başvuruyu Gönder";
      }
    }
  });
});
