
document.addEventListener("DOMContentLoaded", () => {
  // SLIDER
  const slides = document.querySelectorAll(".ti-slide");
  const dots = document.querySelectorAll(".ti-slider-dots .dot");
  const prevBtn = document.querySelector(".ti-prev");
  const nextBtn = document.querySelector(".ti-next");

  let current = 0;
  let timer;

  function showSlide(index) {
    slides.forEach((s, i) => {
      s.classList.toggle("active", i === index);
    });
    dots.forEach((d, i) => {
      d.classList.toggle("active", i === index);
    });
    current = index;
  }

  function nextSlide() {
    const next = (current + 1) % slides.length;
    showSlide(next);
  }

  function prevSlide() {
    const prev = (current - 1 + slides.length) % slides.length;
    showSlide(prev);
  }

  function startAuto() {
    timer = setInterval(nextSlide, 6000);
  }

  function stopAuto() {
    clearInterval(timer);
  }

  if (nextBtn && prevBtn) {
    nextBtn.addEventListener("click", () => {
      stopAuto();
      nextSlide();
      startAuto();
    });

    prevBtn.addEventListener("click", () => {
      stopAuto();
      prevSlide();
      startAuto();
    });
  }

  dots.forEach(dot => {
    dot.addEventListener("click", () => {
      stopAuto();
      const index = Number(dot.dataset.slide);
      showSlide(index);
      startAuto();
    });
  });

  showSlide(0);
  startAuto();


  const scrollBtn = document.getElementById("scrollTopBtn");

  if (scrollBtn) {
    window.addEventListener("scroll", () => {
      if (window.scrollY > 300) {
        scrollBtn.classList.add("show");
      } else {
        scrollBtn.classList.remove("show");
      }
    });

    scrollBtn.addEventListener("click", () => {
      window.scrollTo({
        top: 0,
        behavior: "smooth"
      });
    });
  }

  // NAV TOGGLE (MOBİL MENÜ)
  const nav = document.querySelector(".ti-nav");
  const navToggle = document.querySelector(".ti-nav-toggle");

  if (nav && navToggle) {
    navToggle.addEventListener("click", e => {
      e.stopPropagation();
      nav.classList.toggle("open");
      navToggle.classList.toggle("open");
    });
  }

  // MOBİL DROPDOWN: İLETİŞİM'e tıklayınca aç/kapa
  const dropdownLinks = document.querySelectorAll(".ti-has-dropdown > a");

  function isMobile() {
    return window.matchMedia("(max-width: 768px)").matches;
  }

  dropdownLinks.forEach(link => {
    link.addEventListener("click", function (e) {
      if (isMobile()) {
        e.preventDefault();

        const parentLi = this.parentElement;
        const alreadyOpen = parentLi.classList.contains("is-open");

        // önce tüm dropdownları kapat
        document
          .querySelectorAll(".ti-has-dropdown.is-open")
          .forEach(li => li.classList.remove("is-open"));

        // eğer bu zaten açıksa, kapalı bırak (toggle)
        if (!alreadyOpen) {
          parentLi.classList.add("is-open");
        }
      }
    });
  });
});