const memoryTicker = document.querySelector("#memoryTicker");
const revealTargets = document.querySelectorAll(
  ".problem-section, .section-block, .audience-section, .split-section, .pricing-section, .download-section, .faq-section"
);
const downloadKicker = document.querySelector("#downloadKicker");
const downloadIntro = document.querySelector("#downloadIntro");
const releaseStatus = document.querySelector("#releaseStatus");
const releaseDescription = document.querySelector("#releaseDescription");
const releaseChecksum = document.querySelector("#releaseChecksum");
const downloadPrimary = document.querySelector("#downloadPrimary");
const downloadSecondary = document.querySelector("#downloadSecondary");

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

function shortHash(value) {
  return value ? `${value.slice(0, 12)}...${value.slice(-8)}` : "";
}

function setExternalLink(anchor, url) {
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener";
}

function renderRelease(release) {
  if (!release || !release.version) return;

  if (!release.downloadReady) {
    releaseStatus.textContent = `ZeroLag ${release.version} 准备中`;
    releaseDescription.textContent = "安装包发布信息已接入官网。开放下载后，这里会自动显示下载入口和校验码。";
    return;
  }

  const checksum = release.installer && release.installer.sha256 ? release.installer.sha256 : "";
  downloadKicker.textContent = "PUBLIC BUILD";
  downloadIntro.textContent = "ZeroLag 安装包已经准备好。下载后可以用页面中的 SHA256 校验码确认文件完整性。";
  releaseStatus.textContent = `ZeroLag ${release.version} 已开放下载`;
  releaseDescription.textContent = release.installer && release.installer.file
    ? `Windows 安装包：${release.installer.file}`
    : "Windows 安装包已准备好。";

  if (checksum) {
    releaseChecksum.hidden = false;
    releaseChecksum.textContent = `SHA256 ${shortHash(checksum)}`;
    releaseChecksum.title = checksum;
  }

  if (release.downloadUrl) {
    downloadPrimary.textContent = "下载 Windows 安装包";
    setExternalLink(downloadPrimary, release.downloadUrl);
  }

  downloadSecondary.textContent = "查看校验信息";
  downloadSecondary.href = "./release.json";
}

fetch("./release.json", { cache: "no-store" })
  .then((response) => (response.ok ? response.json() : null))
  .then(renderRelease)
  .catch(() => {});
