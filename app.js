const sampleTender = `项目名称：示例设备供货项目（虚构）
招标范围：三套工业设备与验收文件。
最高限价：人民币200万元。合同生效后90日内交货。
投标人必须提交合格证和出厂试验报告。关键设备不得分包。`;

const state = {
  file: null,
  documents: [],
  analysis: null,
  busy: false,
  deployment: null,
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  [
    "fileInput",
    "companyName",
    "documentList",
    "apiHint",
    "agentActions",
    "exportTask",
    "importReport",
    "reportFile",
    "comparisonReport",
    "fileName",
    "dropZone",
    "documentText",
    "analysisMode",
    "statusMessage",
    "analyzeBtn",
    "sampleBtn",
    "clearBtn",
    "copyJsonBtn",
    "printBtn",
    "modePill",
    "apiStatusPill",
    "confidenceBadge",
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });

  setupPdfWorker();
  setupEvents();
  renderAnalysis(createEmptyAnalysis());
  checkApiStatus();

  if (window.lucide) {
    window.lucide.createIcons();
  }
});

function setupEvents() {
  els.fileInput.addEventListener("change", () => loadBatch([...els.fileInput.files]));
  for (const input of [els.companyName, els.documentText, els.analysisMode]) {
    input.addEventListener("input", resetReport);
  }
  els.exportTask.addEventListener("click", exportAgentTask);
  els.importReport.addEventListener("click", () => els.reportFile.click());
  els.reportFile.addEventListener("change", importAgentReport);

  ["dragenter", "dragover"].forEach((name) => {
    els.dropZone.addEventListener(name, (event) => {
      event.preventDefault();
      els.dropZone.classList.add("dragging");
    });
  });

  ["dragleave", "drop"].forEach((name) => {
    els.dropZone.addEventListener(name, (event) => {
      event.preventDefault();
      els.dropZone.classList.remove("dragging");
    });
  });

  els.dropZone.addEventListener("drop", (event) => loadBatch([...event.dataTransfer.files]));

  els.sampleBtn.addEventListener("click", () => {
    loadBatch([new File([sampleTender], "fictional-tender.txt", { type: "text/plain" })]);
  });

  els.clearBtn.addEventListener("click", () => {
    state.file = null;
    state.documents = [];
    els.documentList.replaceChildren();
    els.fileInput.value = "";
    els.fileName.textContent = "选择文件";
    els.documentText.value = "";
    els.documentText.hidden = false;
    showStatus("等待上传");
    updateModeStatus();
    resetReport();
  });

  els.analyzeBtn.addEventListener("click", () => {
    runAnalysis();
  });

  els.copyJsonBtn.addEventListener("click", async () => {
    const payload = JSON.stringify(state.analysis || createEmptyAnalysis(), null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      flashButton(els.copyJsonBtn, "已复制");
    } catch {
      flashButton(els.copyJsonBtn, "复制失败");
    }
  });

  els.printBtn.addEventListener("click", () => window.print());

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => activateTab(tab.dataset.tab));
  });
}

async function checkApiStatus() {
  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    if (!response.ok) throw new Error("status unavailable");
    const data = await response.json();
    if (!["agent", "api"].includes(data.analysisProvider)) throw new Error("unknown mode");
    state.deployment = data;
  } catch {
    state.deployment = { analysisProvider: "unavailable" };
  }
  updateModeStatus();
}

function updateModeStatus() {
  const mode = state.deployment?.analysisProvider;
  const isAgent = mode === "agent";
  const isApi = mode === "api";
  const ready = isApi && state.deployment.configured;
  const label = isAgent ? "本地 Agent" : isApi ? "在线 API" : "服务不可用";
  els.analyzeBtn.hidden = !isApi;
  els.analyzeBtn.disabled = state.busy || !ready;
  els.agentActions.hidden = !isAgent;
  els.modePill.textContent = label;
  els.apiStatusPill.textContent = isApi && !ready ? "API 待配置" : label;
  els.apiStatusPill.classList.remove("ready", "warning", "muted");
  els.apiStatusPill.classList.add(isAgent || ready ? "ready" : "warning");
  if (isAgent) {
    els.apiHint.textContent = "导出任务交给本地 Agent，完成后导入 JSON 报告。";
  } else if (ready) {
    els.apiHint.textContent = "在线分析会将公司名称和标书正文发送给部署方配置的模型服务。";
  } else if (isApi) {
    els.apiHint.textContent = "在线 API 待配置。请由部署方设置 ZHIPU_API_KEY 并重启服务。";
  } else {
    els.apiHint.textContent = "无法读取分析模式，请检查部署服务后刷新页面。";
  }
}

async function loadBatch(files) {
  if (!files.length || state.busy) return;
  if (files.length > TenderWorkflow.maxFiles) {
    els.fileInput.value = "";
    showStatus("每批最多选择 5 份标书。", "warning");
    return;
  }
  state.documents = [];
  state.file = null;
  els.documentList.replaceChildren();
  els.documentText.value = "";
  els.documentText.hidden = false;
  resetReport();
  els.fileName.textContent = `正在读取 ${files.length} 份文件`;
  setAnalyzeButton(true);
  try {
    const documents = [];
    for (const file of files) {
      showStatus(`正在读取 ${file.name}`);
      try {
        if (file.size > 30 * 1024 * 1024) throw new Error("单份文件上限 30 MB。");
        const text = normalizeText(await extractTextFromFile(file));
        if (text.length < 20) throw new Error("可用文本不足，扫描件请先做 OCR。");
        documents.push({ id: `D${documents.length + 1}`, fileName: file.name, text });
      } catch (error) {
        throw new Error(`${file.name}：${error.message}`);
      }
    }
    state.documents = documents;
    state.file = files.length === 1 ? files[0] : null;
    els.fileName.textContent = `已载入 ${files.length} 份标书`;
    els.documentText.hidden = files.length > 1;
    els.documentText.value = files.length === 1 ? documents[0].text : "";
    for (const doc of documents) {
      const li = document.createElement("li");
      li.textContent = `${doc.id} · ${doc.fileName}（${formatNumber(doc.text.length)} 字符）`;
      els.documentList.append(li);
    }
    showStatus(files.length > 1 ? "标书已就绪，可以横向对比。" : "标书已就绪。");
  } catch (error) {
    els.fileName.textContent = "重新选择文件";
    showStatus(error.message, "error");
  } finally {
    els.fileInput.value = "";
    setAnalyzeButton(false);
  }
}

async function extractTextFromFile(file) {
  const extension = getExtension(file.name);

  if (isPlainText(file)) {
    return file.text();
  }

  if (extension === "pdf") {
    return extractPdfText(file);
  }

  if (extension === "docx") {
    return extractDocxText(file);
  }

  if (extension === "doc") {
    throw new Error("暂不支持 .doc 二进制格式，请另存为 .docx、PDF 或 TXT 后上传。");
  }

  throw new Error("暂不支持该文件类型，请上传 PDF、DOCX、TXT、MD 或 CSV。");
}

async function extractPdfText(file) {
  if (!window.pdfjsLib) {
    throw new Error("PDF 解析库未加载，请联网刷新页面，或先把标书文本粘贴进文本框。");
  }

  const data = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map((item) => item.str).join(" ");
    if (text.trim()) pages.push(`第 ${pageNumber} 页\n${text}`);
  }

  return pages.join("\n\n");
}

async function extractDocxText(file) {
  if (!window.mammoth) {
    throw new Error("Word 解析库未加载，请联网刷新页面，或先把标书文本粘贴进文本框。");
  }

  const arrayBuffer = await file.arrayBuffer();
  const result = await window.mammoth.extractRawText({ arrayBuffer });
  return result.value || "";
}

function currentTask() {
  const companyName = els.companyName.value.trim();
  if (!companyName) {
    throw new Error("请输入投标方公司全名。");
  }
  const documents = state.documents.length > 1 ? state.documents : [{
    id: "D1", fileName: state.file?.name || "manual-input.txt", text: normalizeText(els.documentText.value),
  }];
  return TenderWorkflow.validateTask({ version: 1, companyName, analysisMode: els.analysisMode.value, documents });
}

function resetReport() {
  state.analysis = null;
  els.comparisonReport.hidden = true;
  els.comparisonReport.replaceChildren();
  document.querySelector(".metric-grid").hidden = false;
  document.querySelector(".results[aria-label='分析结果']").hidden = false;
  renderAnalysis(createEmptyAnalysis());
  setPipelineState();
}

function applyReport(report, task, source) {
  if (task.documents.length > 1) {
    const result = TenderWorkflow.comparisonResult(report, task);
    state.analysis = { ...result, companyName: task.companyName, source };
    document.querySelector(".metric-grid").hidden = true;
    document.querySelector(".results[aria-label='分析结果']").hidden = true;
    renderComparison(result, task.companyName);
  } else {
    const doc = task.documents[0];
    TenderWorkflow.singleResult(report);
    state.analysis = normalizeAnalysis(report, { name: doc.fileName });
    state.analysis.meta = { companyName: task.companyName, source };
    renderAnalysis(state.analysis);
  }
  setPipelineState("done");
}

function renderComparison(result, companyName) {
  const panel = els.comparisonReport;
  panel.hidden = false;
  const heading = document.createElement("h2");
  heading.textContent = `横向对比 · ${companyName}`;
  const summary = document.createElement("p");
  summary.textContent = result.summary;
  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  const table = document.createElement("table");
  const header = table.createTHead().insertRow();
  const labels = ["标书", "总分 / 100", "资格", "商务 / 5（25%）", "技术 / 5（30%）", "交付 / 5（20%）", "合规 / 5（25%）"];
  for (const label of labels) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = label;
    header.append(th);
  }
  const body = table.createTBody();
  for (const row of result.entries) {
    const tr = body.insertRow();
    const eligibility = { clear: "未见明确限制", review: "待复核", blocked: "存在硬性限制" };
    const cells = [row.fileName, row.total === null ? "证据不足" : row.total,
      `${eligibility[row.eligibility]} · ${row.note}`,
      ...Object.values(row.scores).map(({ score, reason, evidence }) =>
        `${score ?? "待复核"} · ${reason}${evidence ? ` 「${evidence}」` : ""}`)];
    for (const value of cells) tr.insertCell().textContent = value;
  }
  wrap.append(table);
  panel.replaceChildren(heading, summary, wrap);
}

function exportAgentTask() {
  try {
    const task = currentTask();
    const payload = { task, messages: TenderWorkflow.messages(task) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "tender-agent-task.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showStatus("Agent 任务已导出，包含标书原文。");
  } catch (error) {
    showStatus(error.message, "warning");
    if (!els.companyName.value.trim()) els.companyName.focus();
  }
}

async function importAgentReport() {
  const [file] = els.reportFile.files;
  els.reportFile.value = "";
  if (!file || state.busy) return;
  setAnalyzeButton(true);
  try {
    const task = currentTask();
    const envelope = JSON.parse(await file.text());
    if (envelope?.companyName !== task.companyName ||
        JSON.stringify(envelope?.documentNames) !== JSON.stringify(task.documents.map((doc) => doc.fileName))) {
      throw new Error("报告的公司或文件顺序与当前任务不一致。请从原任务生成报告。");
    }
    resetReport();
    applyReport(envelope.analysis, task, "本地 Agent");
    showStatus("本地 Agent 报告已导入。");
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    setAnalyzeButton(false);
  }
}

async function runAnalysis() {
  if (state.busy || state.deployment?.analysisProvider !== "api" || !state.deployment.configured) return;
  try {
    const task = currentTask();
    setAnalyzeButton(true);
    resetReport();
    setPipelineState("extract");
    showStatus("正在等待 AI 分析…");
    const report = await runRemoteAnalysis(task);
    applyReport(report, task, state.deployment.model || "在线 API");
    showStatus("AI 分析完成，请复核原文证据。");
  } catch (error) {
    setPipelineState();
    showStatus(error.message, "warning");
  } finally {
    setAnalyzeButton(false);
    if (!els.companyName.value.trim()) els.companyName.focus();
  }
}

async function runRemoteAnalysis(task) {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(task),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
  return payload.analysis;
}

function createEmptyAnalysis() {
  return {
    project: {
      name: "待生成分析",
      fileName: "--",
      analyzedAt: "--",
      documentType: "--",
    },
    keyFacts: {
      quote: { label: "--", note: "待分析", amountWan: null, evidence: "" },
      delivery: { label: "--", note: "待分析", days: null, evidence: "" },
      deadline: { label: "--", note: "待分析", evidence: "" },
      riskLevel: { label: "--", note: "待分析", score: 0 },
      confidence: 0,
    },
    summary: ["上传或粘贴标书文本后生成摘要。"],
    departments: ["销售、技术、项目、采购会在这里看到各自关注点。"],
    pricing: [],
    timeline: [],
    technicalRequirements: [],
    risks: [],
    outsourcing: [],
    compliance: {
      mustRespondItems: [],
      deviationItems: [],
      missingItems: [],
      clarificationQuestions: [],
    },
    sourceReferences: [],
  };
}

function normalizeAnalysis(value, file) {
  const empty = createEmptyAnalysis();
  const input = value && typeof value === "object" ? value : {};
  const keyFacts = { ...empty.keyFacts, ...(input.keyFacts || {}) };

  const compliance = input.compliance || {};
  const normalized = {
    project: {
      ...empty.project,
      ...(input.project || {}),
      fileName: input.project?.fileName || input.project?.file_name || file?.name || empty.project.fileName,
      analyzedAt: input.project?.analyzedAt || input.project?.analyzed_at || new Date().toLocaleString("zh-CN", { hour12: false }),
      documentType: input.project?.documentType || input.project?.document_type || inferDocumentType(file),
    },
    keyFacts: {
      quote: { ...empty.keyFacts.quote, ...(keyFacts.quote || {}) },
      delivery: { ...empty.keyFacts.delivery, ...(keyFacts.delivery || {}) },
      deadline: { ...empty.keyFacts.deadline, ...(keyFacts.deadline || {}) },
      riskLevel: { ...empty.keyFacts.riskLevel, ...(keyFacts.riskLevel || {}) },
      confidence: clampConfidence(keyFacts.confidence),
    },
    summary: normalizeStringArray(input.summary, empty.summary),
    departments: normalizeStringArray(input.departments, empty.departments),
    pricing: normalizeArray(input.pricing),
    timeline: normalizeArray(input.timeline),
    technicalRequirements: normalizeArray(input.technicalRequirements || input.technical_requirements),
    risks: normalizeArray(input.risks),
    outsourcing: normalizeArray(input.outsourcing || input.outsourcing_candidates),
    compliance: {
      mustRespondItems: normalizeStringArray(compliance.mustRespondItems || compliance.must_respond_items),
      deviationItems: normalizeStringArray(compliance.deviationItems || compliance.deviation_items),
      missingItems: normalizeStringArray(compliance.missingItems || compliance.missing_items),
      clarificationQuestions: normalizeStringArray(compliance.clarificationQuestions || compliance.clarification_questions),
    },
    sourceReferences: normalizeArray(input.sourceReferences || input.source_references),
    meta: input.meta || {},
  };

  normalized.technicalRequirements = normalized.technicalRequirements.map((item) => ({
    category: item.category || "其他",
    requirement: item.requirement || item.text || "需人工复核",
    priority: item.priority || "中",
    owner: item.owner || item.owner_department || "项目部",
    evidence: item.evidence || "",
  }));

  normalized.risks = normalized.risks.map((item) => ({
    title: item.title || "风险项",
    level: item.level || "中",
    detail: item.detail || item.impact || item.evidence || "需人工复核",
    impact: item.impact || "",
    mitigation: item.mitigation || "",
    owner: item.owner || item.owner_department || "项目部",
    evidence: item.evidence || "",
  }));

  normalized.outsourcing = normalized.outsourcing.map((item) => ({
    package: item.package || item.package_name || "外包包件",
    scope: item.scope || "需人工复核",
    trigger: item.trigger || item.reason || item.evidence || "标书条款触发",
    deliverable: arrayToText(item.deliverable || item.deliverables),
    supplierType: item.supplierType || item.recommended_supplier_type || "",
    owner: item.owner || item.internal_owner || "采购部",
    riskNotes: item.riskNotes || item.risk_notes || "",
  }));

  return normalized;
}

function renderAnalysis(analysis) {
  setText("projectTitle", analysis.project.name);
  setText("analysisTime", analysis.project.analyzedAt);
  setText("metricQuote", analysis.keyFacts.quote.label);
  setText("metricQuoteNote", analysis.keyFacts.quote.note);
  setText("metricDelivery", analysis.keyFacts.delivery.label);
  setText("metricDeliveryNote", analysis.keyFacts.delivery.note);
  setText("metricDeadline", analysis.keyFacts.deadline.label);
  setText("metricDeadlineNote", analysis.keyFacts.deadline.note);
  setText("metricRisk", analysis.keyFacts.riskLevel.label);
  setText("metricRiskNote", analysis.keyFacts.riskLevel.note);
  setText("confidenceBadge", analysis.keyFacts.confidence ? `${analysis.keyFacts.confidence}% 置信度` : "--");
  setText("commercialScope", analysis.project.documentType);
  setText("requirementCount", `${analysis.technicalRequirements.length} 项`);
  setText("outsourcingCount", `${analysis.outsourcing.length} 个包件`);
  setText("sourceCount", `${analysis.sourceReferences.length} 条证据`);

  renderList("summaryList", analysis.summary);
  renderList("departmentList", analysis.departments);
  renderTable("pricingTable", analysis.pricing, ["item", "value", "owner", "evidence"]);
  renderTable("timelineTable", analysis.timeline, ["stage", "period", "output", "owner"]);
  renderTable("requirementsTable", analysis.technicalRequirements, [
    "category",
    "requirement",
    (row) => priorityTag(row.priority),
    "owner",
  ]);
  renderRiskList(analysis.risks);
  renderTable("outsourcingTable", analysis.outsourcing, ["package", "scope", "trigger", "deliverable"]);
  renderList("mustRespondList", analysis.compliance.mustRespondItems);
  renderList("deviationList", [...analysis.compliance.deviationItems, ...analysis.compliance.missingItems]);
  renderList("clarificationList", analysis.compliance.clarificationQuestions);
  renderTable("sourceTable", analysis.sourceReferences, ["section", (row) => row.page || "--", "text"]);
}

function renderList(id, items) {
  const list = document.getElementById(id);
  list.replaceChildren();
  const values = normalizeStringArray(items);

  if (!values.length) {
    const li = document.createElement("li");
    li.textContent = "暂无数据";
    list.append(li);
    return;
  }

  values.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    list.append(li);
  });
}

function renderTable(id, rows, columns) {
  const body = document.getElementById(id);
  body.replaceChildren();
  const values = normalizeArray(rows);

  if (!values.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = columns.length;
    td.textContent = "暂无数据";
    tr.append(td);
    body.append(tr);
    return;
  }

  values.forEach((row) => {
    const tr = document.createElement("tr");
    columns.forEach((column) => {
      const td = document.createElement("td");
      const value = typeof column === "function" ? column(row) : row[column];
      if (value instanceof Node) {
        td.append(value);
      } else {
        td.textContent = arrayToText(value) || "--";
      }
      tr.append(td);
    });
    body.append(tr);
  });
}

function renderRiskList(risks) {
  const list = document.getElementById("riskList");
  list.replaceChildren();

  if (!risks.length) {
    const item = document.createElement("div");
    item.className = "risk-item";
    item.innerHTML = "<strong>暂无高风险条款</strong><span>建议仍进行人工抽检与部门会签。</span>";
    list.append(item);
    return;
  }

  risks.forEach((risk) => {
    const item = document.createElement("div");
    item.className = "risk-item";
    const title = document.createElement("strong");
    title.textContent = `${risk.level}风险 · ${risk.title}`;
    const detail = document.createElement("span");
    detail.textContent = risk.detail || risk.impact || "需人工复核";
    item.append(title, detail);
    list.append(item);
  });
}

function priorityTag(priority) {
  const span = document.createElement("span");
  const levelMap = { 高: "high", 中: "medium", 低: "low" };
  span.className = `tag ${levelMap[priority] || ""}`.trim();
  span.textContent = priority || "中";
  return span;
}

function setPipelineState(activeStep) {
  document.querySelectorAll(".pipeline-step").forEach((step) => {
    step.classList.remove("active", "done");
    if (!activeStep) {
      return;
    }
    const order = ["parse", "extract", "check", "report"];
    const currentIndex = order.indexOf(step.dataset.step);
    const activeIndex = order.indexOf(activeStep);
    if (activeStep === "done" || currentIndex < activeIndex) {
      step.classList.add("done");
    } else if (currentIndex === activeIndex) {
      step.classList.add("active");
    }
  });
}

function activateTab(id) {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === id);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === id);
  });
}

function setupPdfWorker() {
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
  }
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function inferDocumentType(file) {
  if (!file) return "文本输入";
  const extension = getExtension(file.name).toUpperCase() || "未知";
  return `${extension} 标书文件`;
}

function isPlainText(file) {
  const extension = getExtension(file.name);
  return ["txt", "md", "csv"].includes(extension) || String(file.type || "").startsWith("text/");
}

function getExtension(fileName) {
  return String(fileName || "").split(".").pop()?.toLowerCase() || "";
}

function normalizeArray(items) {
  return Array.isArray(items) ? items.filter(Boolean) : [];
}

function normalizeStringArray(items, fallback = []) {
  const values = normalizeArray(items)
    .map((item) => (typeof item === "string" ? item : item?.text || item?.requirement || item?.title || ""))
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length ? values : fallback;
}

function arrayToText(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean).join("；");
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function clampConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }
  if (number <= 1) {
    return Math.round(number * 100);
  }
  return Math.max(0, Math.min(100, Math.round(number)));
}

function setText(id, text) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = text;
  }
}

function setAnalyzeButton(isBusy) {
  state.busy = isBusy;
  for (const id of ["fileInput", "sampleBtn", "clearBtn", "companyName",
    "documentText", "analysisMode", "exportTask", "importReport"]) {
    els[id].disabled = isBusy;
  }
  els.analyzeBtn.querySelector("span").textContent = isBusy ? "分析中" : "一键分析";
  updateModeStatus();
}

function showStatus(message, type = "normal") {
  els.statusMessage.textContent = message;
  els.statusMessage.classList.remove("warning", "error");
  if (type === "warning" || type === "error") {
    els.statusMessage.classList.add(type);
  }
}

function formatNumber(value) {
  return Number(value).toLocaleString("zh-CN", {
    maximumFractionDigits: 2,
  });
}

function flashButton(button, label) {
  const span = button.querySelector("span");
  const original = span.textContent;
  span.textContent = label;
  setTimeout(() => {
    span.textContent = original;
  }, 1200);
}
