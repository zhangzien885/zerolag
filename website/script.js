const memoryTicker = document.querySelector("#memoryTicker");
const revealTargets = document.querySelectorAll(
  ".problem-section, .section-block, .audience-section, .split-section, .pricing-section, .download-section, .faq-section"
);
const downloadKicker = document.querySelector("#downloadKicker");
const downloadIntro = document.querySelector("#downloadIntro");
const releaseStatus = document.querySelector("#releaseStatus");
const releaseDescription = document.querySelector("#releaseDescription");
const releaseChecksum = document.querySelector("#releaseChecksum");
const copyChecksumButton = document.querySelector("#copyChecksumButton");
const releaseNotes = document.querySelector("#releaseNotes");
const pricingPurchase = document.querySelector("#pricingPurchase");
const downloadPrimary = document.querySelector("#downloadPrimary");
const downloadPurchase = document.querySelector("#downloadPurchase");
const downloadSecondary = document.querySelector("#downloadSecondary");
const downloadSupport = document.querySelector("#downloadSupport");
let fullReleaseChecksum = "";

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

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "";

  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function setExternalLink(anchor, url) {
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener";
}

function wirePurchaseLink(url) {
  if (!url) return;

  if (pricingPurchase) {
    pricingPurchase.textContent = "开通 ZeroLag Pro";
    setExternalLink(pricingPurchase, url);
  }

  if (downloadPurchase) {
    downloadPurchase.hidden = false;
    downloadPurchase.textContent = "开通会员";
    setExternalLink(downloadPurchase, url);
  }
}

async function copyReleaseChecksum() {
  if (!fullReleaseChecksum || !copyChecksumButton) return;

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(fullReleaseChecksum);
    } else {
      const textArea = document.createElement("textarea");
      textArea.value = fullReleaseChecksum;
      textArea.setAttribute("readonly", "");
      textArea.style.position = "fixed";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
    }

    const previousText = copyChecksumButton.textContent;
    copyChecksumButton.textContent = "已复制";
    window.setTimeout(() => {
      copyChecksumButton.textContent = previousText || "复制校验码";
    }, 1400);
  } catch (_error) {
    copyChecksumButton.textContent = "复制失败";
  }
}

function renderReleaseNotes(notes) {
  if (!releaseNotes || !Array.isArray(notes) || notes.length === 0) return;

  releaseNotes.innerHTML = "";
  for (const note of notes.slice(0, 6)) {
    const item = document.createElement("li");
    item.textContent = String(note);
    releaseNotes.appendChild(item);
  }
  releaseNotes.hidden = false;
}

function renderRelease(release) {
  if (!release || !release.version) return;

  wirePurchaseLink(release.purchaseUrl);

  if (release.supportUrl && downloadSupport) {
    downloadSupport.hidden = false;
    downloadSupport.textContent = "遇到问题？联系支持";
    setExternalLink(downloadSupport, release.supportUrl);
  }

  if (!release.downloadReady) {
    releaseStatus.textContent = `ZeroLag ${release.version} 准备中`;
    releaseDescription.textContent = "安装包发布信息已接入官网。开放下载后，这里会自动显示下载入口和校验码。";
    return;
  }

  const checksum = release.installer && release.installer.sha256 ? release.installer.sha256 : "";
  downloadKicker.textContent = "PUBLIC BUILD";
  downloadIntro.textContent = "ZeroLag 安装包已经准备好。下载后可以用页面中的 SHA256 校验码确认文件完整性。";
  releaseStatus.textContent = `ZeroLag ${release.version} 已开放下载`;
  const installerSize = formatBytes(release.installer && release.installer.size);
  releaseDescription.textContent = release.installer && release.installer.file
    ? `Windows 安装包：${release.installer.file}${installerSize ? ` · ${installerSize}` : ""}`
    : "Windows 安装包已准备好。";

  if (checksum) {
    fullReleaseChecksum = checksum;
    releaseChecksum.hidden = false;
    releaseChecksum.textContent = `SHA256 ${shortHash(checksum)}`;
    releaseChecksum.title = checksum;
    copyChecksumButton.hidden = false;
  }

  if (release.downloadUrl) {
    downloadPrimary.textContent = "下载 Windows 安装包";
    setExternalLink(downloadPrimary, release.downloadUrl);
  }

  renderReleaseNotes(release.releaseNotes);

  downloadSecondary.textContent = "查看校验信息";
  downloadSecondary.href = "./release.json";
}

fetch("./release.json", { cache: "no-store" })
  .then((response) => (response.ok ? response.json() : null))
  .then(renderRelease)
  .catch(() => {});

if (copyChecksumButton) {
  copyChecksumButton.addEventListener("click", copyReleaseChecksum);
}
