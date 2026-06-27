const memoryTicker = document.querySelector("#memoryTicker");
const revealTargets = document.querySelectorAll(
  ".problem-section, .section-block, .audience-section, .split-section, .pricing-section, .download-section, .faq-section"
);

if (memoryTicker) {
  let tick = 0;
  window.setInterval(() => {
    tick += 1;
    const value = 67.8 + Math.sin(tick / 2) * 1.8 + Math.cos(tick / 5) * 0.7;
    memoryTicker.textContent = `${value.toFixed(1)}% / 32 GB`;
  }, 1200);
}

for (const target of revealTargets) {
  target.classList.add("reveal");
}

const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting) {
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    }
  }
}, { threshold: 0.18 });

for (const target of revealTargets) {
  observer.observe(target);
}
