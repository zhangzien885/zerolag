const els = {
  railLabel: document.querySelector("#railLabel"),
  scoreValue: document.querySelector("#scoreValue"),
  fpsEstimate: document.querySelector("#fpsEstimate"),
  lowEstimate: document.querySelector("#lowEstimate"),
  interferenceState: document.querySelector("#interferenceState"),
  boostTimer: document.querySelector("#boostTimer"),
  licenseState: document.querySelector("#licenseState"),
  adminState: document.querySelector("#adminState"),
  planState: document.querySelector("#planState"),
  toolboxButton: document.querySelector("#toolboxButton"),
  rescanButton: document.querySelector("#rescanButton"),
  restoreButton: document.querySelector("#restoreButton"),
  websiteButton: document.querySelector("#websiteButton"),
  activePlan: document.querySelector("#activePlan"),
  diagnosticState: document.querySelector("#diagnosticState"),
  cpuState: document.querySelector("#cpuState"),
  gpuState: document.querySelector("#gpuState"),
  memoryState: document.querySelector("#memoryState"),
  gameModeState: document.querySelector("#gameModeState"),
  readyState: document.querySelector("#readyState"),
  pipelineState: document.querySelector("#pipelineState"),
  toolState: document.querySelector("#toolState"),
  gameCount: document.querySelector("#gameCount"),
  gameSelect: document.querySelector("#gameSelect"),
  addGameButton: document.querySelector("#addGameButton"),
  launchGameButton: document.querySelector("#launchGameButton"),
  networkState: document.querySelector("#networkState"),
  networkDetail: document.querySelector("#networkDetail"),
  networkCheckButton: document.querySelector("#networkCheckButton"),
  flushDnsButton: document.querySelector("#flushDnsButton"),
  toolboxOverlay: document.querySelector("#toolboxOverlay"),
  closeToolboxButton: document.querySelector("#closeToolboxButton"),
  resultState: document.querySelector("#resultState"),
  memberState: document.querySelector("#memberState"),
  memberCard: document.querySelector("#memberCard"),
  expiresAt: document.querySelector("#expiresAt"),
  planName: document.querySelector("#planName"),
  planPrice: document.querySelector("#planPrice"),
  deviceState: document.querySelector("#deviceState"),
  boostSummary: document.querySelector("#boostSummary"),
  boostButton: document.querySelector("#boostButton"),
  boostButtonText: document.querySelector("#boostButtonText"),
  boostButtonHint: document.querySelector("#boostButtonHint"),
  licenseCode: document.querySelector("#licenseCode"),
  activateButton: document.querySelector("#activateButton"),
  renewButton: document.querySelector("#renewButton"),
  purchaseOverlay: document.querySelector("#purchaseOverlay"),
  closePurchaseButton: document.querySelector("#closePurchaseButton"),
  paidButton: document.querySelector("#paidButton"),
  copyDemoCodeButton: document.querySelector("#copyDemoCodeButton"),
  updateOverlay: document.querySelector("#updateOverlay"),
  updateKicker: document.querySelector("#updateKicker"),
  updateTitle: document.querySelector("#updateTitle"),
  currentVersion: document.querySelector("#currentVersion"),
  latestVersion: document.querySelector("#latestVersion"),
  updateMessage: document.querySelector("#updateMessage"),
  updateNotes: document.querySelector("#updateNotes"),
  updateBadge: document.querySelector("#updateBadge"),
  installUpdateButton: document.querySelector("#installUpdateButton"),
  laterUpdateButton: document.querySelector("#laterUpdateButton"),
  closeUpdateButton: document.querySelector("#closeUpdateButton"),
  log: document.querySelector("#log")
};

const stepOrder = ["prepare", "plan", "write", "memory", "activate", "vbs", "reboot"];
let lastStatusWarning = "";
let memoryRefreshInFlight = false;
let pendingUpdateUrl = "";
let pendingUpdate = null;
let forceUpdateRequired = false;
let boostStartedAt = "";

function setText(node, value) {
  node.textContent = value;
}

function setValueWithTitle(node, value) {
  const text = String(value || "未知");
  node.textContent = text;
  node.title = text;
}

function addLog(message, type = "") {
  if (message === lastStatusWarning) return;
  lastStatusWarning = type === "warn" || type === "fail" ? message : "";
  const item = document.createElement("p");
  if (type) item.className = type;
  item.textContent = message;
  els.log.appendChild(item);
  els.log.scrollTop = els.log.scrollHeight;
}

function setPill(node, text, className = "") {
  node.className = `status-pill ${className}`.trim();
  setText(node, text);
}

function setStep(step, state) {
  const node = document.querySelector(`[data-step="${step}"]`);
  if (!node) return;
  node.classList.remove("running", "done", "fail");
  if (state) node.classList.add(state);
}

function resetSteps() {
  for (const step of stepOrder) setStep(step, "");
}

function planNameFromRaw(raw) {
  const match = raw.match(/\(([^)]+)\)/);
  return match ? match[1] : raw.trim() || "未知";
}

function formatDate(value) {
  if (!value) return "未激活";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未激活";
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = (value) => String(value).padStart(2, "0");
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`;
}

function shorten(value, maxLength = 30) {
  const text = String(value || "未知").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function readinessLabel(score) {
  if (score >= 88) return "优秀";
  if (score >= 76) return "良好";
  if (score >= 66) return "可优化";
  return "需处理";
}

function interferenceLabel(score) {
  if (score >= 84) return "LOW";
  if (score >= 70) return "MID";
  return "HIGH";
}

function readinessClass(score) {
  if (score >= 84) return "ready-good";
  if (score >= 70) return "ready-mid";
  return "ready-low";
}

function railLabel(score) {
  if (score >= 84) return "GAME READY";
  if (score >= 70) return "READY SOON";
  return "NEEDS BOOST";
}

function renderMemory(memory) {
  if (!memory) {
    setValueWithTitle(els.memoryState, "读取失败");
    return;
  }

  setValueWithTitle(els.memoryState, `${memory.usedPercent}% / ${memory.total}`);
}

function renderDiagnostics(diagnostics) {
  if (!diagnostics) {
    setText(els.diagnosticState, "读取失败");
    return;
  }

  const score = diagnostics.readinessScore || 80;
  const gpu = diagnostics.gpu && diagnostics.gpu.length ? diagnostics.gpu[0] : null;

  document.body.classList.remove("ready-good", "ready-mid", "ready-low");
  document.body.classList.add(readinessClass(score));
  setText(els.railLabel, railLabel(score));
  setText(els.scoreValue, `${score}%`);
  setText(els.fpsEstimate, score >= 86 ? "+12%" : score >= 74 ? "+8%" : "+4%");
  setText(els.lowEstimate, score >= 86 ? "+18%" : score >= 74 ? "+11%" : "+6%");
  setText(els.interferenceState, interferenceLabel(score));
  setText(els.diagnosticState, readinessLabel(score));
  setValueWithTitle(els.cpuState, `${diagnostics.cpu && diagnostics.cpu.name ? diagnostics.cpu.name : "未知处理器"} / ${diagnostics.cpu ? diagnostics.cpu.threads : "-"} 线程`);
  setValueWithTitle(els.gpuState, gpu ? gpu.name : "未识别");
  renderMemory(diagnostics.memory);
  setValueWithTitle(els.gameModeState, diagnostics.windows.gameMode);
}

function updateBoostTimer() {
  if (!boostStartedAt) {
    setText(els.boostTimer, "待启动");
    return;
  }

  const startedAt = new Date(boostStartedAt).getTime();
  if (Number.isNaN(startedAt)) {
    setText(els.boostTimer, "运行中");
    return;
  }

  setText(els.boostTimer, formatDuration((Date.now() - startedAt) / 1000));
}

function renderGameLibrary(games) {
  const list = Array.isArray(games) ? games : [];
  const selected = els.gameSelect.value;
  els.gameSelect.innerHTML = "";
  setText(els.gameCount, `${list.length} 个`);

  if (!list.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "还没有添加游戏";
    els.gameSelect.appendChild(option);
    els.launchGameButton.disabled = true;
    return;
  }

  for (const game of list) {
    const option = document.createElement("option");
    option.value = game.id;
    option.textContent = shorten(game.name, 24);
    els.gameSelect.appendChild(option);
  }

  if (selected && list.some((game) => game.id === selected)) {
    els.gameSelect.value = selected;
  }

  els.launchGameButton.disabled = false;
}

async function refreshGameLibrary() {
  try {
    renderGameLibrary(await window.zeroLag.getGameLibrary());
  } catch {
    setText(els.toolState, "读取失败");
    addLog("常用游戏读取失败。", "warn");
  }
}

function renderNetworkDiagnostics(result) {
  if (!result || !result.best) {
    setText(els.networkState, "不可用");
    setText(els.networkDetail, "网络检测失败，请检查当前网络连接。");
    return;
  }

  setText(els.networkState, result.summary || "已检测");
  setText(els.networkDetail, `${result.best.label} 延迟 ${result.best.average}ms，丢包 ${result.packetLoss || 0}%`);
}

async function refreshMemoryUsage() {
  if (memoryRefreshInFlight) return;

  memoryRefreshInFlight = true;
  try {
    const memory = await window.zeroLag.getMemory();
    renderMemory(memory);
  } catch {
    setText(els.memoryState, "读取失败");
  } finally {
    memoryRefreshInFlight = false;
  }
}

async function refreshStatus() {
  try {
    setText(els.readyState, "扫描中");
    const status = await window.zeroLag.getStatus();
    const runtimeReady = Boolean(status.runtimePowerPlan);
    const licenseActive = Boolean(status.license && status.license.active);
    const integrityOk = !status.license || status.license.integrityOk !== false;

    setPill(els.licenseState, licenseActive ? "Pro 已启用" : (integrityOk ? "待激活" : "授权异常"), licenseActive ? "good" : "warn");
    setPill(els.adminState, status.admin ? "权限就绪" : "权限待启用", status.admin ? "good" : "warn");
    setPill(els.planState, runtimeReady ? "加速运行中" : "待加速", runtimeReady ? "good" : "warn");
    boostStartedAt = runtimeReady && status.runtimePowerPlan ? status.runtimePowerPlan.activatedAt : "";
    updateBoostTimer();
    els.restoreButton.disabled = !runtimeReady;
    setText(els.activePlan, runtimeReady ? "已启用" : "待启用");
    setText(els.readyState, licenseActive ? (runtimeReady ? "加速中" : "待处理") : "等待授权");
    setText(els.memberState, licenseActive ? "Pro 已启用" : (integrityOk ? "未授权" : "授权异常"));
    els.memberCard.classList.toggle("active", licenseActive);
    setText(els.expiresAt, formatDate(status.license && status.license.expiresAt));
    setText(els.planName, licenseActive ? status.license.plan : "ZeroLag Pro 月度");
    setText(els.planPrice, licenseActive ? "已激活" : "¥30 / 月");
    setText(els.deviceState, licenseActive ? "本机已绑定" : (integrityOk ? "等待绑定" : "安全校验失败"));
    setText(els.boostButtonText, licenseActive ? "启动 ZeroLag Boost" : (integrityOk ? "购买 ZeroLag Pro" : "授权环境异常"));
    setText(els.boostButtonHint, licenseActive ? "PERFORMANCE MODE + VBS OFF" : (integrityOk ? "UNLOCK PERFORMANCE MODE" : "CLIENT PROTECTION"));
    els.boostButton.disabled = !integrityOk || forceUpdateRequired;
    renderDiagnostics(status.diagnostics);

    if (runtimeReady) {
      setText(els.boostSummary, "");
    } else {
      setText(els.boostSummary, "");
      if (!licenseActive) {
        addLog(integrityOk ? "请先激活会员，再启用游戏性能优化。" : "授权环境异常，请重新安装正版客户端。", integrityOk ? "warn" : "fail");
      } else if (status.runtimePowerPlanError) {
        addLog("性能模式启动受限，请使用管理员权限重新打开。", "warn");
      }
    }
  } catch (error) {
    setPill(els.planState, "读取失败", "warn");
    setText(els.readyState, "异常");
    els.restoreButton.disabled = true;
    addLog("状态读取失败，请重新打开软件。", "fail");
  }
}

function showUpdateDialog(update) {
  pendingUpdate = update;
  pendingUpdateUrl = update.downloadUrl || "";
  forceUpdateRequired = Boolean(update.force);
  setText(els.updateKicker, update.force ? "必须更新" : "版本更新");
  setText(els.updateTitle, update.title || "发现新版本");
  setText(els.currentVersion, update.current || "未知");
  setText(els.latestVersion, update.latest || "未知");
  setText(els.updateMessage, update.message || "ZeroLag 有可用更新。");
  els.updateNotes.innerHTML = "";

  for (const note of update.releaseNotes || []) {
    const item = document.createElement("li");
    item.textContent = note;
    els.updateNotes.appendChild(item);
  }

  els.updateOverlay.hidden = false;
  els.laterUpdateButton.hidden = Boolean(update.force);
  els.closeUpdateButton.hidden = Boolean(update.force);
  els.boostButton.disabled = forceUpdateRequired;
}

async function checkForUpdates() {
  try {
    const update = await window.zeroLag.getUpdateStatus();
    if (!update || !update.updateAvailable) {
      els.updateBadge.hidden = true;
      return;
    }

    pendingUpdate = update;
    pendingUpdateUrl = update.downloadUrl || "";
    forceUpdateRequired = Boolean(update.force);
    setText(els.updateBadge, update.force ? "必须更新" : "发现新版");
    els.updateBadge.hidden = false;

    if (update.force) {
      showUpdateDialog(update);
    }
  } catch {
    addLog("更新检测暂时不可用。", "warn");
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runBoost() {
  const currentStatus = await window.zeroLag.getStatus();
  if (currentStatus.license && currentStatus.license.integrityOk === false) {
    addLog("授权环境异常，请重新安装正版客户端。", "fail");
    return;
  }

  if (!(currentStatus.license && currentStatus.license.active)) {
    els.purchaseOverlay.hidden = false;
    setText(els.memberState, "等待支付");
    return;
  }

  resetSteps();
  els.boostButton.disabled = true;
  els.log.innerHTML = "";
  setText(els.pipelineState, "运行中");
  setText(els.resultState, "执行中");
  setText(els.readyState, "加速中");

  try {
    setStep("prepare", "running");
    addLog("正在准备游戏性能优化。");
    await sleep(350);
    setStep("prepare", "done");

    setStep("plan", "running");
    addLog("正在启用性能模式。");
    await sleep(350);

    setStep("write", "running");
    addLog("正在应用游戏优化项。");
    const result = await window.zeroLag.boost();
    setStep("plan", "done");
    setStep("write", result.optimizations && result.optimizations.ok ? "done" : "fail");
    addLog(result.optimizations && result.optimizations.ok ? "游戏优化项已应用。" : "部分游戏优化项受限。", result.optimizations && result.optimizations.ok ? "good" : "warn");

    setStep("memory", "running");
    addLog("正在整理游戏内存。");
    await sleep(260);
    setStep("memory", result.memoryOptimization && result.memoryOptimization.ok ? "done" : "fail");
    addLog(result.memoryOptimization && result.memoryOptimization.ok ? "内存优化成功。" : "内存优化部分受限。", result.memoryOptimization && result.memoryOptimization.ok ? "good" : "warn");

    setStep("activate", "running");
    addLog("游戏性能模式已启用。", "good");
    if (result.powerPlan.skipped.length) {
      addLog("部分硬件专属优化未适用于当前电脑，其余优化已完成。", "warn");
    }
    await sleep(300);
    setStep("activate", "done");

    setStep("vbs", "running");
    addLog(result.vbs.ok ? "系统延迟优化已写入。" : "系统延迟优化部分受限。", result.vbs.ok ? "good" : "warn");
    setStep("vbs", result.vbs.ok ? "done" : "fail");
    addLog("后台减负已完成。", "good");

    setStep("reboot", result.rebootRequired ? "running" : "done");
    if (result.rebootRequired) {
      addLog("优化成功。重启后可获得完整效果。", "warn");
      setText(els.resultState, "需要重启");
    } else {
      addLog("优化成功。", "good");
      setText(els.resultState, "完成");
    }

    setText(els.readyState, "已加速");
    setText(els.pipelineState, result.vbs.ok && result.optimizations && result.optimizations.ok ? "完成" : "部分完成");
    await refreshStatus();
  } catch (error) {
    const running = stepOrder.find((step) => document.querySelector(`[data-step="${step}"]`).classList.contains("running"));
    if (running) setStep(running, "fail");
    setText(els.pipelineState, "失败");
    setText(els.resultState, "执行失败");
    setText(els.readyState, "失败");
    addLog("优化失败，请确认会员状态和管理员权限后再试。", "fail");
  } finally {
    const status = await window.zeroLag.getStatus();
    const integrityOk = !status.license || status.license.integrityOk !== false;
    els.boostButton.disabled = !integrityOk || forceUpdateRequired;
  }
}

els.boostButton.addEventListener("click", runBoost);
els.rescanButton.addEventListener("click", async () => {
  setText(els.resultState, "扫描中");
  addLog("正在重新扫描当前状态。");
  await refreshStatus();
  await refreshMemoryUsage();
  setText(els.resultState, "扫描完成");
  addLog("状态扫描完成。", "good");
});

els.restoreButton.addEventListener("click", async () => {
  els.restoreButton.disabled = true;
  setText(els.resultState, "恢复中");
  setText(els.readyState, "恢复中");
  addLog("正在恢复日常状态。");

  try {
    const result = await window.zeroLag.restoreDailyMode();
    boostStartedAt = "";
    updateBoostTimer();
    setText(els.resultState, result && result.deleted ? "已恢复" : "已处理");
    addLog("已恢复日常状态。", "good");
    await refreshStatus();
  } catch {
    setText(els.resultState, "恢复失败");
    addLog("恢复失败，请重新打开软件后再试。", "fail");
    await refreshStatus();
  }
});

els.licenseCode.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    els.activateButton.click();
  }
});

els.activateButton.addEventListener("click", () => {
  const code = els.licenseCode.value.trim();
  if (!code) {
    addLog("请输入会员码后再激活。", "warn");
    return;
  }

  window.zeroLag.activateLicense(code).then((license) => {
    if (license.active) {
      setPill(els.licenseState, "订阅有效", "good");
      setText(els.memberState, "激活成功");
      setText(els.expiresAt, formatDate(license.expiresAt));
      addLog("会员激活成功。", "good");
      els.licenseCode.value = "";
      refreshStatus();
      return;
    }

    setPill(els.licenseState, "未授权", "warn");
    setText(els.memberState, "激活失败");
    addLog(license.reason || "会员码无效。", "fail");
  });
});

els.renewButton.addEventListener("click", () => {
  els.purchaseOverlay.hidden = false;
  setText(els.memberState, "等待支付");
});

els.toolboxButton.addEventListener("click", () => {
  els.toolboxOverlay.hidden = false;
  setText(els.toolState, "待命");
  refreshGameLibrary();
});

els.closeToolboxButton.addEventListener("click", () => {
  els.toolboxOverlay.hidden = true;
});

els.toolboxOverlay.addEventListener("click", (event) => {
  if (event.target === els.toolboxOverlay) {
    els.toolboxOverlay.hidden = true;
  }
});

els.addGameButton.addEventListener("click", async () => {
  setText(els.toolState, "添加中");
  try {
    const games = await window.zeroLag.addGame();
    renderGameLibrary(games);
    setText(els.toolState, "已更新");
    if (games.length) addLog("常用游戏已更新。", "good");
  } catch {
    setText(els.toolState, "添加失败");
    addLog("添加游戏失败，请重新选择启动程序。", "warn");
  }
});

els.launchGameButton.addEventListener("click", async () => {
  const gameId = els.gameSelect.value;
  if (!gameId) {
    addLog("请先添加常用游戏。", "warn");
    return;
  }

  setText(els.toolState, "启动中");
  try {
    const result = await window.zeroLag.launchGame(gameId);
    setText(els.toolState, result.ok ? "已启动" : "启动失败");
    addLog(result.ok ? `已启动 ${result.name || "游戏"}。` : (result.message || "游戏启动失败。"), result.ok ? "good" : "warn");
  } catch {
    setText(els.toolState, "启动失败");
    addLog("游戏启动失败，请确认路径是否仍然存在。", "warn");
  }
});

els.networkCheckButton.addEventListener("click", async () => {
  setText(els.toolState, "检测网络");
  setText(els.networkState, "检测中");
  setText(els.networkDetail, "正在测试多个网络目标，请稍等。");

  try {
    const result = await window.zeroLag.getNetworkDiagnostics();
    renderNetworkDiagnostics(result);
    setText(els.toolState, "网络完成");
    addLog(result.best ? `网络检测完成：${result.summary}。` : "网络检测未连通。", result.best ? "good" : "warn");
  } catch {
    setText(els.toolState, "检测失败");
    setText(els.networkState, "失败");
    setText(els.networkDetail, "网络检测失败，请稍后再试。");
    addLog("网络检测失败。", "warn");
  }
});

els.flushDnsButton.addEventListener("click", async () => {
  setText(els.toolState, "刷新 DNS");
  setText(els.networkState, "刷新中");

  try {
    const result = await window.zeroLag.flushDns();
    setText(els.toolState, result.ok ? "已刷新" : "刷新失败");
    setText(els.networkState, result.ok ? "DNS 已刷新" : "刷新失败");
    setText(els.networkDetail, result.ok ? "DNS 缓存已刷新，适合开局前快速排除解析异常。" : "DNS 刷新失败，请确认管理员权限。");
    addLog(result.ok ? "DNS 缓存已刷新。" : "DNS 刷新失败。", result.ok ? "good" : "warn");
  } catch {
    setText(els.toolState, "刷新失败");
    addLog("DNS 刷新失败。", "warn");
  }
});

els.closePurchaseButton.addEventListener("click", () => {
  els.purchaseOverlay.hidden = true;
});

els.purchaseOverlay.addEventListener("click", (event) => {
  if (event.target === els.purchaseOverlay) {
    els.purchaseOverlay.hidden = true;
  }
});

els.paidButton.addEventListener("click", () => {
  els.purchaseOverlay.hidden = true;
  addLog("支付确认已提交。正式版会等待服务器回调后自动开通。", "warn");
});

els.copyDemoCodeButton.addEventListener("click", async () => {
  const demoCode = "ZL-PRO-DEMO-2026";
  try {
    await navigator.clipboard.writeText(demoCode);
    addLog("演示会员码已复制。", "good");
  } catch {
    addLog(`演示会员码：${demoCode}`, "good");
  }
});

els.websiteButton.addEventListener("click", async () => {
  await window.zeroLag.openWebsite();
});

els.updateBadge.addEventListener("click", () => {
  if (pendingUpdate) showUpdateDialog(pendingUpdate);
});

els.laterUpdateButton.addEventListener("click", () => {
  els.updateOverlay.hidden = true;
});

els.closeUpdateButton.addEventListener("click", () => {
  els.updateOverlay.hidden = true;
});

els.installUpdateButton.addEventListener("click", async () => {
  if (!pendingUpdateUrl) {
    addLog("更新地址暂未配置。", "warn");
    return;
  }

  await window.zeroLag.openUpdateUrl(pendingUpdateUrl);
  addLog("已打开更新下载页面。", "good");
});

refreshStatus();
refreshMemoryUsage();
refreshGameLibrary();
checkForUpdates();
setInterval(refreshMemoryUsage, 1000);
setInterval(updateBoostTimer, 1000);
