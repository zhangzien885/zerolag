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
  recoveryCard: document.querySelector("#recoveryCard"),
  restoreState: document.querySelector("#restoreState"),
  restoreDetail: document.querySelector("#restoreDetail"),
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
  versionState: document.querySelector("#versionState"),
  versionDetail: document.querySelector("#versionDetail"),
  versionCheckButton: document.querySelector("#versionCheckButton"),
  versionInstallButton: document.querySelector("#versionInstallButton"),
  serviceState: document.querySelector("#serviceState"),
  serviceDetail: document.querySelector("#serviceDetail"),
  serviceWebsiteState: document.querySelector("#serviceWebsiteState"),
  servicePurchaseState: document.querySelector("#servicePurchaseState"),
  serviceAccountState: document.querySelector("#serviceAccountState"),
  serviceUpdateState: document.querySelector("#serviceUpdateState"),
  serviceSupportState: document.querySelector("#serviceSupportState"),
  serviceRefreshButton: document.querySelector("#serviceRefreshButton"),
  serviceWebsiteButton: document.querySelector("#serviceWebsiteButton"),
  supportState: document.querySelector("#supportState"),
  supportDetail: document.querySelector("#supportDetail"),
  supportPrepareButton: document.querySelector("#supportPrepareButton"),
  supportBundleButton: document.querySelector("#supportBundleButton"),
  supportCopyButton: document.querySelector("#supportCopyButton"),
  supportContactButton: document.querySelector("#supportContactButton"),
  supportRevealButton: document.querySelector("#supportRevealButton"),
  supportCaseId: document.querySelector("#supportCaseId"),
  supportMemberStatus: document.querySelector("#supportMemberStatus"),
  supportVersionStatus: document.querySelector("#supportVersionStatus"),
  supportRuntimeStatus: document.querySelector("#supportRuntimeStatus"),
  toolboxOverlay: document.querySelector("#toolboxOverlay"),
  closeToolboxButton: document.querySelector("#closeToolboxButton"),
  resultState: document.querySelector("#resultState"),
  memberState: document.querySelector("#memberState"),
  memberCard: document.querySelector("#memberCard"),
  expiresAt: document.querySelector("#expiresAt"),
  planName: document.querySelector("#planName"),
  planPrice: document.querySelector("#planPrice"),
  renewHint: document.querySelector("#renewHint"),
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
  copyActivationCodeButton: document.querySelector("#copyActivationCodeButton"),
  paymentCheckoutButton: document.querySelector("#paymentCheckoutButton"),
  paymentState: document.querySelector("#paymentState"),
  paymentTitle: document.querySelector("#paymentTitle"),
  paymentMessage: document.querySelector("#paymentMessage"),
  orderState: document.querySelector("#orderState"),
  orderCode: document.querySelector("#orderCode"),
  paymentOrderId: document.querySelector("#paymentOrderId"),
  paymentProvider: document.querySelector("#paymentProvider"),
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
let pendingPurchaseOrderId = "";
let pendingPurchaseActivationCode = "";
let pendingPaymentUrl = "";
let pendingCheckoutMode = "payment";
let purchaseAppConfig = {};
let latestSupportHandoff = null;
let latestSupportBundleReady = false;

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
  if (window.zeroLag && typeof window.zeroLag.recordSupportLog === "function") {
    window.zeroLag.recordSupportLog(message, type || "info").catch(() => {});
  }
}

function setPill(node, text, className = "") {
  node.className = `status-pill ${className}`.trim();
  setText(node, text);
}

function setSupportBundleRevealReady(ready) {
  latestSupportBundleReady = Boolean(ready);
  els.supportRevealButton.hidden = !latestSupportBundleReady;
  els.supportRevealButton.disabled = !latestSupportBundleReady;
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

function membershipExpiryInfo(value) {
  if (!value) return null;
  const expiresAt = new Date(value).getTime();
  if (Number.isNaN(expiresAt)) return null;

  const msLeft = expiresAt - Date.now();
  const daysLeft = Math.ceil(msLeft / 86400000);
  if (daysLeft <= 0) {
    return {
      state: "expired",
      priceLabel: "已到期",
      hint: "会员已到期，续费后即可继续使用一键加速。"
    };
  }

  if (daysLeft <= 3) {
    return {
      state: "expiring",
      priceLabel: `剩余 ${daysLeft} 天`,
      hint: `会员还剩 ${daysLeft} 天，提前续费可保持 Pro 权益不中断。`
    };
  }

  if (daysLeft <= 7) {
    return {
      state: "notice",
      priceLabel: `剩余 ${daysLeft} 天`,
      hint: `会员还剩 ${daysLeft} 天，建议提前续费避免影响开局加速。`
    };
  }

  return {
    state: "active",
    priceLabel: "权益正常",
    hint: "Pro 权益正常，可随时续费延长有效期。"
  };
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

function renderRestoreAssurance(runtimeReady, status = {}) {
  els.recoveryCard.classList.toggle("active", runtimeReady);
  els.recoveryCard.classList.toggle("warn", !runtimeReady && Boolean(status.runtimePowerPlanError));

  if (runtimeReady) {
    setText(els.restoreState, "可恢复");
    setText(els.restoreDetail, "当前处于 Boost 状态，点击右上角恢复即可回到日常模式。");
    setText(els.restoreButton.querySelector("span"), "Safe");
    setText(els.restoreButton.querySelector("b"), "恢复");
    return;
  }

  if (status.runtimePowerPlanError) {
    setText(els.restoreState, "需重试");
    setText(els.restoreDetail, "性能模式启动受限，建议使用管理员权限重新打开后再恢复。");
    setText(els.restoreButton.querySelector("span"), "Reset");
    setText(els.restoreButton.querySelector("b"), "恢复");
    return;
  }

  setText(els.restoreState, "已待命");
  setText(els.restoreDetail, "当前没有正在运行的 Boost，会保持日常状态。");
  setText(els.restoreButton.querySelector("span"), "Safe");
  setText(els.restoreButton.querySelector("b"), "待命");
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

function supportUpdateLabel(update) {
  if (!update) return "待读取";
  if (update.state === "force-update") return "必须更新";
  if (update.state === "update-available") return "有新版本";
  if (update.state === "check-limited") return "检查受限";
  return update.current ? `当前 ${update.current}` : "已就绪";
}

function supportHandoffShareText(handoff) {
  const membership = handoff && handoff.membership ? handoff.membership : {};
  const runtime = handoff && handoff.runtime ? handoff.runtime : {};
  const update = handoff && handoff.update ? handoff.update : {};
  const caseId = handoff && handoff.caseId ? handoff.caseId : "未生成";
  const memberText = membership.active ? "Pro 有效" : (membership.integrityOk ? "未激活" : "授权异常");
  const runtimeText = runtime.boostActive ? "Boost 运行中" : (runtime.errorCode ? "需重试" : "日常待命");

  return [
    "ZeroLag 售后摘要",
    `售后编号：${caseId}`,
    `会员状态：${memberText}`,
    `版本状态：${supportUpdateLabel(update)}`,
    `运行状态：${runtimeText}`,
    "我已准备好诊断信息，请协助排查。"
  ].join("\n");
}

async function copySupportHandoffText(handoff) {
  const text = supportHandoffShareText(handoff);
  await navigator.clipboard.writeText(text);
  return text;
}

function setServiceStatus(node, ready) {
  setText(node, ready ? "已准备" : "准备中");
  node.classList.toggle("ready", Boolean(ready));
  node.classList.toggle("pending", !ready);
}

function renderServiceStatus(config = {}) {
  const status = config.serviceStatus || {};
  const checks = [
    Boolean(status.websiteConfigured),
    Boolean(status.purchaseConfigured),
    Boolean(status.accountConfigured),
    Boolean(status.updateConfigured),
    Boolean(status.supportConfigured)
  ];
  const readyCount = checks.filter(Boolean).length;

  setText(els.serviceState, readyCount === checks.length ? "全部就绪" : (readyCount ? `${readyCount}/${checks.length} 就绪` : "准备中"));
  setText(
    els.serviceDetail,
    readyCount === checks.length
      ? "官网、购买、账号验证、版本更新和售后入口都已准备。"
      : (readyCount
        ? "部分官方服务已准备，其余通道会在正式上线前补齐。"
        : "官方服务正在准备中，当前仍可使用本地检测和工具箱功能。")
  );
  setServiceStatus(els.serviceWebsiteState, status.websiteConfigured);
  setServiceStatus(els.servicePurchaseState, status.purchaseConfigured);
  setServiceStatus(els.serviceAccountState, status.accountConfigured);
  setServiceStatus(els.serviceUpdateState, status.updateConfigured);
  setServiceStatus(els.serviceSupportState, status.supportConfigured);
  els.serviceWebsiteButton.disabled = !status.websiteConfigured;
}

async function refreshServiceStatus() {
  setText(els.serviceState, "读取中");
  setText(els.serviceDetail, "正在确认购买、账号、更新和售后通道是否准备就绪。");
  els.serviceRefreshButton.disabled = true;

  try {
    renderServiceStatus(await window.zeroLag.getAppConfig());
  } catch {
    setText(els.serviceState, "读取失败");
    setText(els.serviceDetail, "服务状态暂时不可用，请稍后重新打开工具箱。");
    els.serviceWebsiteButton.disabled = true;
  } finally {
    els.serviceRefreshButton.disabled = false;
  }
}

function websiteOpenSucceeded(result) {
  return result === true || Boolean(result && result.ok);
}

async function openOfficialWebsiteWithFeedback(source = "topbar") {
  try {
    const result = await window.zeroLag.openWebsite();
    if (websiteOpenSucceeded(result)) {
      if (source === "service") {
        setText(els.serviceState, "官网已打开");
        setText(els.serviceDetail, "已打开官方页面，可查看下载、购买和售后入口。");
      }
      addLog("已打开官方页面。", "good");
      return true;
    }

    if (source === "service") {
      setText(els.serviceState, result && result.configured ? "打开失败" : "官网未配置");
      setText(
        els.serviceDetail,
        result && result.configured
          ? "官方页面打开失败，请稍后再试。"
          : "官网入口暂未准备好，正式上线后这里会直接打开官方页面。"
      );
    }
    addLog(result && result.configured ? "官方页面打开失败。" : "官网入口暂未配置。", "warn");
  } catch {
    if (source === "service") {
      setText(els.serviceState, "打开失败");
      setText(els.serviceDetail, "官方页面打开失败，请稍后再试。");
    }
    addLog("官方页面打开失败。", "warn");
  }

  return false;
}

function renderSupportHandoff(handoff) {
  if (!handoff || !handoff.ok) {
    latestSupportHandoff = null;
    setText(els.supportCaseId, "准备失败");
    setText(els.supportMemberStatus, "未知");
    setText(els.supportVersionStatus, "未知");
    setText(els.supportRuntimeStatus, "未知");
    els.supportCopyButton.disabled = true;
    return;
  }

  latestSupportHandoff = handoff;
  const membership = handoff.membership || {};
  const runtime = handoff.runtime || {};
  setText(els.supportCaseId, handoff.caseId || "已准备");
  setText(els.supportMemberStatus, membership.active ? "Pro 有效" : (membership.integrityOk ? "未激活" : "授权异常"));
  setText(els.supportVersionStatus, supportUpdateLabel(handoff.update));
  setText(els.supportRuntimeStatus, runtime.boostActive ? "Boost 运行中" : (runtime.errorCode ? "需重试" : "日常待命"));
  els.supportCaseId.title = handoff.caseId || "";
  els.supportCopyButton.disabled = false;
}

async function refreshSupportHandoff(manual = false) {
  if (manual) {
    els.supportPrepareButton.disabled = true;
    setText(els.toolState, "准备售后信息");
    setText(els.supportState, "准备中");
    setText(els.supportDetail, "正在整理会员、版本、权限、运行状态和系统检测摘要。");
  }

  try {
    const handoff = await window.zeroLag.getSupportHandoff();
    renderSupportHandoff(handoff);
    setText(els.supportState, handoff.supportConfigured ? "可联系" : "待配置");
    setText(
      els.supportDetail,
      handoff.supportConfigured
        ? `售后信息已准备，编号 ${handoff.caseId}。建议先生成诊断包，再联系支持。`
        : `售后信息已准备，编号 ${handoff.caseId}。正式支持入口配置后可一键联系。`
    );
    if (manual) {
      setText(els.toolState, "售后信息已准备");
      addLog("售后信息已准备，可生成诊断包后联系支持。", "good");
    }
    return handoff;
  } catch {
    renderSupportHandoff(null);
    setText(els.supportState, "准备失败");
    setText(els.supportDetail, "售后信息准备失败，请重新扫描状态后再试。");
    if (manual) {
      setText(els.toolState, "准备失败");
      addLog("售后信息准备失败。", "warn");
    }
    return null;
  } finally {
    if (manual) els.supportPrepareButton.disabled = false;
  }
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
    const expiryInfo = membershipExpiryInfo(status.license && status.license.expiresAt);
    const expiredLicense = !licenseActive && expiryInfo && expiryInfo.state === "expired";
    const memberAlert = (licenseActive || expiredLicense) && expiryInfo && (expiryInfo.state === "expiring" || expiryInfo.state === "expired");

    setPill(els.licenseState, licenseActive ? "Pro 已启用" : (integrityOk ? "待激活" : "授权异常"), licenseActive ? "good" : "warn");
    setPill(els.adminState, status.admin ? "权限就绪" : "权限待启用", status.admin ? "good" : "warn");
    setPill(els.planState, runtimeReady ? "加速运行中" : "待加速", runtimeReady ? "good" : "warn");
    boostStartedAt = runtimeReady && status.runtimePowerPlan ? status.runtimePowerPlan.activatedAt : "";
    updateBoostTimer();
    els.restoreButton.disabled = !runtimeReady;
    renderRestoreAssurance(runtimeReady, status);
    setText(els.activePlan, runtimeReady ? "已启用" : "待启用");
    setText(els.readyState, licenseActive ? (runtimeReady ? "加速中" : "待处理") : "等待授权");
    setText(els.memberState, expiredLicense ? "已到期" : (licenseActive ? (memberAlert ? "即将到期" : "Pro 已启用") : (integrityOk ? "未授权" : "授权异常")));
    els.memberCard.classList.toggle("active", licenseActive);
    els.memberCard.classList.toggle("expiring", licenseActive && expiryInfo && expiryInfo.state === "expiring");
    els.memberCard.classList.toggle("expired", expiredLicense || (licenseActive && expiryInfo && expiryInfo.state === "expired"));
    setText(els.expiresAt, formatDate(status.license && status.license.expiresAt));
    setText(els.planName, licenseActive ? status.license.plan : "ZeroLag Pro 月度");
    setText(els.planPrice, expiredLicense ? "续费恢复" : (licenseActive ? (expiryInfo ? expiryInfo.priceLabel : "已激活") : "¥30 / 月"));
    setText(els.renewHint, expiredLicense ? expiryInfo.hint : (licenseActive ? (expiryInfo ? expiryInfo.hint : "Pro 权益正常，可随时续费延长有效期。") : "开通后即可解锁一键加速与会员工具。"));
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
    renderRestoreAssurance(false, { runtimePowerPlanError: true });
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

function renderVersionCenter(update, config = {}) {
  const current = update && update.current ? update.current : "未知";
  const channel = config.releaseChannel || "alpha";
  const base = `当前 ${current} / ${channel}`;

  if (!update) {
    setText(els.versionState, "待检查");
    setText(els.versionDetail, `${base}。点击检查更新获取最新状态。`);
    els.versionInstallButton.disabled = true;
    return;
  }

  if (update.error) {
    setText(els.versionState, "检查受限");
    setText(els.versionDetail, `${base}。更新服务暂时不可用，请稍后再试。`);
    els.versionInstallButton.disabled = true;
    return;
  }

  if (update.updateAvailable) {
    setText(els.versionState, update.force ? "必须更新" : "发现新版");
    setText(els.versionDetail, `${base}，最新 ${update.latest || "未知"}。${update.message || "建议更新到最新版本。"}`);
    els.versionInstallButton.disabled = !update.downloadUrl;
    return;
  }

  setText(els.versionState, "已是最新");
  setText(els.versionDetail, `${base}。当前已经是最新版本。`);
  els.versionInstallButton.disabled = true;
}

async function checkForUpdates(options = {}) {
  const manual = Boolean(options.manual);
  if (manual) {
    els.versionCheckButton.disabled = true;
    setText(els.toolState, "检查更新");
    setText(els.versionState, "检查中");
    setText(els.versionDetail, "正在连接 ZeroLag 更新通道，请稍等。");
  }

  try {
    const [update, config] = await Promise.all([
      window.zeroLag.getUpdateStatus(),
      window.zeroLag.getAppConfig()
    ]);
    renderVersionCenter(update, config);
    renderServiceStatus(config);

    if (!update || !update.updateAvailable) {
      pendingUpdate = null;
      pendingUpdateUrl = "";
      forceUpdateRequired = false;
      els.updateBadge.hidden = true;
      if (manual) {
        setText(els.toolState, "已是最新");
        addLog("当前已经是最新版本。", "good");
      }
      return;
    }

    pendingUpdate = update;
    pendingUpdateUrl = update.downloadUrl || "";
    forceUpdateRequired = Boolean(update.force);
    setText(els.updateBadge, update.force ? "必须更新" : "发现新版");
    els.updateBadge.hidden = false;

    if (update.force || manual) {
      showUpdateDialog(update);
    }

    if (manual) {
      setText(els.toolState, "发现新版");
      addLog(update.force ? "发现必须更新版本。" : "发现可用新版本。", update.force ? "warn" : "good");
    }
  } catch {
    renderVersionCenter(null, {});
    setText(els.versionState, "检查失败");
    setText(els.versionDetail, "更新服务暂时不可用，请稍后再试。");
    if (manual) setText(els.toolState, "检查失败");
    addLog("更新检测暂时不可用。", "warn");
  } finally {
    if (manual) els.versionCheckButton.disabled = false;
  }
}

function renderPurchaseFallback(config = purchaseAppConfig) {
  pendingPurchaseOrderId = "";
  pendingPurchaseActivationCode = "";
  pendingPaymentUrl = "";
  setText(els.paymentState, "支付通道准备中");
  setText(els.paymentTitle, "ZeroLag Pro 月度");
  setText(els.paymentMessage, "当前客户端还没有连接正式支付服务，请稍后重试或前往官网购买。");
  setText(els.orderState, "待接入");
  setText(els.paymentOrderId, "暂无订单");
  setText(els.paymentProvider, "未连接");
  setText(els.orderCode, "支付后生成");
  setText(els.paidButton, "刷新开通状态");
  setText(els.copyActivationCodeButton, "复制激活码");
  renderCheckoutFallback(config);
  els.copyActivationCodeButton.disabled = true;
}

function paymentProviderLabel(provider) {
  const value = String(provider || "").toLowerCase();
  if (value === "wechat_pay") return "微信支付";
  if (value === "alipay") return "支付宝";
  if (value === "manual") return "人工确认";
  return provider ? provider : "待连接";
}

function isHttpPaymentUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

function isConfiguredPublicUrl(value) {
  return isHttpPaymentUrl(value) && !/example\.com|localhost|127\.0\.0\.1/i.test(String(value || ""));
}

function purchaseFallbackAvailable(config = {}) {
  return isConfiguredPublicUrl(config.purchaseUrl) || isConfiguredPublicUrl(config.websiteUrl);
}

function renderCheckoutFallback(config = {}) {
  const available = purchaseFallbackAvailable(config);
  pendingCheckoutMode = available ? "purchase" : "disabled";
  setText(els.paymentCheckoutButton, available ? "前往官网购买" : "支付通道准备中");
  els.paymentCheckoutButton.disabled = !available;
}

function renderPaymentCheckout(status, config = {}) {
  const hasPaymentUrl = isHttpPaymentUrl(pendingPaymentUrl);
  if (!hasPaymentUrl && status !== "paid") {
    renderCheckoutFallback(config);
    return;
  }

  pendingCheckoutMode = "payment";
  setText(els.paymentCheckoutButton, "打开支付页");
  els.paymentCheckoutButton.disabled = !hasPaymentUrl || status === "paid";
}

function renderPurchaseOrder(order, payment = null, config = purchaseAppConfig) {
  const status = order && order.status ? order.status : "pending";
  const code = order && order.activationCode ? order.activationCode : "";
  pendingPurchaseOrderId = order && order.orderId ? order.orderId : pendingPurchaseOrderId;
  pendingPurchaseActivationCode = code;
  if (payment && payment.paymentUrl) pendingPaymentUrl = payment.paymentUrl;
  setText(els.paymentState, status === "paid" ? "支付完成" : "等待支付");
  setText(els.paymentTitle, "ZeroLag Pro 月度");
  setText(els.paymentMessage, status === "paid"
    ? "会员开通信息已准备好，正在为你完成激活。"
    : ((payment && payment.message) || "订单已创建。打开官方支付页完成支付后，回到这里刷新开通状态。"));
  setText(els.orderState, status === "paid" ? "已开通" : "待支付");
  els.orderState.title = pendingPurchaseOrderId || "";
  setText(els.paymentOrderId, pendingPurchaseOrderId ? shorten(pendingPurchaseOrderId, 18) : "待创建");
  els.paymentOrderId.title = pendingPurchaseOrderId || "";
  setText(els.paymentProvider, paymentProviderLabel(payment && payment.provider || order && order.paymentProvider));
  setText(els.orderCode, code ? shorten(code, 18) : "支付后生成");
  els.orderCode.title = code || "";
  setText(els.paidButton, "刷新开通状态");
  setText(els.copyActivationCodeButton, code ? "复制激活码" : "等待激活码");
  renderPaymentCheckout(status, config);
  els.copyActivationCodeButton.disabled = !code;
}

async function activateFromPurchaseCode(code) {
  if (!code) return false;

  const license = await window.zeroLag.activateLicense(code);
  if (license.active) {
    setPill(els.licenseState, "订阅有效", "good");
    setText(els.memberState, "激活成功");
    setText(els.expiresAt, formatDate(license.expiresAt));
    els.licenseCode.value = "";
    els.purchaseOverlay.hidden = true;
    addLog("会员已开通成功。", "good");
    await refreshStatus();
    return true;
  }

  els.licenseCode.value = code;
  addLog(license.reason || "会员激活暂未完成，请稍后刷新。", "warn");
  return false;
}

async function refreshPurchaseOrder() {
  if (!pendingPurchaseOrderId) {
    renderPurchaseFallback();
    return;
  }

  setText(els.paymentState, "正在刷新");
  setText(els.orderState, "查询中");
  const result = await window.zeroLag.getOrderStatus(pendingPurchaseOrderId);
  if (!result || !result.ok || !result.order) {
    setText(els.paymentState, "等待支付");
    setText(els.orderState, "待支付");
    addLog("暂未检测到会员开通结果。", "warn");
    return;
  }

  renderPurchaseOrder(result.order);
  if (result.order.activationCode) {
    await activateFromPurchaseCode(result.order.activationCode);
  }
}

async function openPurchaseOverlay() {
  els.purchaseOverlay.hidden = false;
  pendingPaymentUrl = "";
  pendingCheckoutMode = "payment";
  purchaseAppConfig = {};
  setText(els.memberState, "等待支付");
  setText(els.paymentState, "准备中");
  setText(els.paymentTitle, "ZeroLag Pro 月度");
  setText(els.paymentMessage, "正在准备会员开通信息，请稍等。");
  setText(els.orderState, "创建中");
  setText(els.paymentOrderId, "创建中");
  setText(els.paymentProvider, "连接中");
  setText(els.orderCode, "等待开通");
  setText(els.paymentCheckoutButton, "准备支付页");
  setText(els.paidButton, "刷新开通状态");
  setText(els.copyActivationCodeButton, "复制激活码");
  els.paymentCheckoutButton.disabled = true;
  els.copyActivationCodeButton.disabled = true;

  const configPromise = window.zeroLag.getAppConfig().catch(() => ({}));

  try {
    const result = await window.zeroLag.createOrder();
    const config = await configPromise;
    purchaseAppConfig = config || {};
    if (!result || !result.ok || !result.order) {
      renderPurchaseFallback(purchaseAppConfig);
      return;
    }

    renderPurchaseOrder(result.order, result.payment, purchaseAppConfig);
  } catch {
    purchaseAppConfig = await configPromise;
    renderPurchaseFallback(purchaseAppConfig);
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
    await openPurchaseOverlay();
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
    setText(els.resultState, result && result.ok !== false ? "已恢复" : "需重试");
    setText(els.restoreState, result && result.ok !== false ? "已恢复" : "需重试");
    setText(els.restoreDetail, result && result.ok !== false ? "已回到日常状态，Boost 临时状态已收尾。" : "恢复已执行，但仍建议重新扫描确认状态。");
    addLog(result && result.ok !== false ? "已恢复日常状态。" : "恢复已执行，但仍建议重新扫描确认状态。", result && result.ok !== false ? "good" : "warn");
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
  openPurchaseOverlay();
});

els.toolboxButton.addEventListener("click", () => {
  els.toolboxOverlay.hidden = false;
  setText(els.toolState, "待命");
  refreshGameLibrary();
  refreshServiceStatus();
  refreshSupportHandoff();
});

els.closeToolboxButton.addEventListener("click", () => {
  els.toolboxOverlay.hidden = true;
});

els.toolboxOverlay.addEventListener("click", (event) => {
  if (event.target === els.toolboxOverlay) {
    els.toolboxOverlay.hidden = true;
  }
});

els.serviceRefreshButton.addEventListener("click", async () => {
  await refreshServiceStatus();
});

els.serviceWebsiteButton.addEventListener("click", async () => {
  els.serviceWebsiteButton.disabled = true;
  await openOfficialWebsiteWithFeedback("service");
  els.serviceWebsiteButton.disabled = false;
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

els.versionCheckButton.addEventListener("click", async () => {
  await checkForUpdates({ manual: true });
});

els.versionInstallButton.addEventListener("click", async () => {
  if (!pendingUpdateUrl) {
    addLog("更新地址暂未配置。", "warn");
    return;
  }

  await window.zeroLag.openUpdateUrl(pendingUpdateUrl);
  addLog("已打开更新下载页面。", "good");
});

els.supportPrepareButton.addEventListener("click", async () => {
  await refreshSupportHandoff(true);
});

els.supportCopyButton.addEventListener("click", async () => {
  els.supportCopyButton.disabled = true;
  setText(els.toolState, "复制售后摘要");

  try {
    const handoff = latestSupportHandoff || await refreshSupportHandoff(true);
    if (!handoff || !handoff.ok) {
      setText(els.toolState, "复制失败");
      setText(els.supportState, "准备失败");
      setText(els.supportDetail, "售后摘要暂时无法生成，请重新扫描状态后再试。");
      addLog("售后摘要复制失败。", "warn");
      return;
    }

    await copySupportHandoffText(handoff);
    setText(els.toolState, "摘要已复制");
    setText(els.supportState, "已复制");
    setText(els.supportDetail, `售后摘要已复制，编号 ${handoff.caseId}。可直接粘贴给客服。`);
    addLog("售后摘要已复制。", "good");
  } catch {
    setText(els.toolState, "复制失败");
    setText(els.supportState, "复制失败");
    setText(els.supportDetail, "系统剪贴板暂时不可用，请稍后重试或手动发送售后编号。");
    addLog("售后摘要复制失败。", "warn");
  } finally {
    els.supportCopyButton.disabled = !latestSupportHandoff;
  }
});

els.supportBundleButton.addEventListener("click", async () => {
  els.supportBundleButton.disabled = true;
  setSupportBundleRevealReady(false);
  setText(els.toolState, "生成诊断");
  setText(els.supportState, "生成中");
  setText(els.supportDetail, "正在整理版本、会员、权限、系统检测、更新状态和最近操作记录。");

  try {
    const result = await window.zeroLag.createSupportBundle();
    if (!result || result.canceled) {
      setText(els.toolState, "待命");
      setText(els.supportState, "已取消");
      setText(els.supportDetail, "没有生成文件。需要客服排查时可以重新点击生成。");
      return;
    }

    if (!result.ok) {
      throw new Error("Support bundle failed");
    }

    setText(els.toolState, "诊断完成");
    setText(els.supportState, "已生成");
    if (result.summary && result.summary.caseId) setText(els.supportCaseId, result.summary.caseId);
    setSupportBundleRevealReady(result.canReveal);
    setText(els.supportDetail, `诊断文件已保存：${result.fileName || "ZeroLag-support.json"}。售后编号：${result.summary && result.summary.caseId ? result.summary.caseId : "已生成"}，可打开位置后发送给客服。`);
    addLog("支持诊断包已生成，可发送给客服排查。", "good");
  } catch {
    setText(els.toolState, "诊断失败");
    setText(els.supportState, "生成失败");
    setText(els.supportDetail, "诊断文件生成失败，请稍后重试。");
    addLog("支持诊断包生成失败。", "warn");
  } finally {
    els.supportBundleButton.disabled = false;
  }
});

els.supportRevealButton.addEventListener("click", async () => {
  els.supportRevealButton.disabled = true;
  setText(els.toolState, "打开诊断位置");

  try {
    const result = await window.zeroLag.revealSupportBundle();
    if (result && result.ok) {
      setText(els.toolState, "位置已打开");
      setText(els.supportState, "位置已打开");
      setText(els.supportDetail, "已打开诊断文件所在位置，请把诊断包发送给客服排查。");
      addLog("已打开诊断包所在位置。", "good");
      return;
    }

    setSupportBundleRevealReady(false);
    setText(els.toolState, "文件不可用");
    setText(els.supportState, "需重新生成");
    setText(els.supportDetail, "诊断文件可能已被移动或删除，请重新生成诊断包。");
    addLog("诊断包位置不可用，请重新生成。", "warn");
  } catch {
    setText(els.toolState, "打开失败");
    setText(els.supportState, "打开失败");
    setText(els.supportDetail, "诊断包位置打开失败，请稍后再试或重新生成诊断包。");
    addLog("诊断包位置打开失败。", "warn");
  } finally {
    els.supportRevealButton.disabled = !latestSupportBundleReady;
  }
});

els.supportContactButton.addEventListener("click", async () => {
  els.supportContactButton.disabled = true;
  setText(els.toolState, "打开支持");
  setText(els.supportState, "连接中");

  try {
    const result = await window.zeroLag.openSupportUrl();
    if (result && result.ok) {
      setText(els.toolState, "支持已打开");
      setText(els.supportState, "已打开");
      setText(els.supportDetail, "已打开官方支持页面，可把诊断包发送给客服排查。");
      addLog("已打开官方支持入口。", "good");
      return;
    }

    const configured = Boolean(result && result.configured);
    setText(els.toolState, configured ? "打开失败" : "待配置");
    setText(els.supportState, configured ? "打开失败" : "未配置");
    setText(
      els.supportDetail,
      configured
        ? "官方支持页面打开失败，请稍后再试。"
        : "客服入口暂未配置，正式官网上线后这里会直接打开支持页面。"
    );
    addLog(configured ? "官方支持入口打开失败。" : "客服入口暂未配置。", "warn");
  } catch {
    setText(els.toolState, "打开失败");
    setText(els.supportState, "打开失败");
    setText(els.supportDetail, "官方支持页面打开失败，请稍后再试。");
    addLog("官方支持入口打开失败。", "warn");
  } finally {
    els.supportContactButton.disabled = false;
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

els.paidButton.addEventListener("click", async () => {
  await refreshPurchaseOrder();
});

els.paymentCheckoutButton.addEventListener("click", async () => {
  if (pendingCheckoutMode === "purchase") {
    try {
      const result = await window.zeroLag.openPurchaseUrl();
      if (result && result.ok) {
        setText(els.paymentState, "官网购买");
        setText(els.paymentMessage, "已打开官方购买页。完成购买后回到 ZeroLag，刷新开通状态或输入获得的激活码。");
        addLog("已打开官方购买页。", "good");
        return;
      }
    } catch {
      // Keep purchase fallbacks user-safe; configuration details stay out of the UI.
    }

    addLog("官方购买页暂未配置，请稍后再试。", "warn");
    return;
  }

  if (!isHttpPaymentUrl(pendingPaymentUrl)) {
    addLog("支付页暂未准备好，请重新创建订单或稍后再试。", "warn");
    return;
  }

  try {
    const result = await window.zeroLag.openPaymentUrl(pendingPaymentUrl);
    if (result && result.ok) {
      setText(els.paymentState, "等待支付");
      setText(els.paymentMessage, "支付页已打开。完成支付后回到 ZeroLag，点击刷新开通状态。");
      addLog("已打开官方支付页。", "good");
      return;
    }
  } catch {
    // Keep payment failures user-safe; detailed provider errors stay server-side.
  }

  addLog("支付页暂未准备好，请稍后再试。", "warn");
});

els.copyActivationCodeButton.addEventListener("click", async () => {
  if (!pendingPurchaseActivationCode) {
    addLog("支付完成后才会生成激活码。", "warn");
    return;
  }

  const demoCode = pendingPurchaseActivationCode;
  try {
    await navigator.clipboard.writeText(demoCode);
    addLog("激活码已复制。", "good");
  } catch {
    addLog(`会员码：${demoCode}`, "good");
  }
});

els.websiteButton.addEventListener("click", async () => {
  els.websiteButton.disabled = true;
  await openOfficialWebsiteWithFeedback("topbar");
  els.websiteButton.disabled = false;
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
