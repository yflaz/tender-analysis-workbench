const sampleTender = `项目名称：示例设备供货项目（虚构）
招标范围：三套工业设备与验收文件。
最高限价：人民币200万元。合同生效后90日内交货。
投标人必须提交合格证和出厂试验报告。关键设备不得分包。`;

const state = {
  file: null,
  documents: [],
  analysis: null,
  api: {
    checked: false,
    server: false,
    configured: false,
    model: "glm-5.1",
  },
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  [
    "fileInput",
    "companyName",
    "documentList",
    "apiHint",
    "exportTask",
    "importReport",
    "reportFile",
    "comparisonReport",
    "fileName",
    "dropZone",
    "documentText",
    "analysisMode",
    "useAiToggle",
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

  els.useAiToggle.addEventListener("change", () => updateModeStatus());
  els.analysisMode.addEventListener("change", () => updateModeStatus());

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => activateTab(tab.dataset.tab));
  });
}

async function checkApiStatus() {
  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("status unavailable");
    }
    const data = await response.json();
    state.api = {
      checked: true,
      server: true,
      configured: Boolean(data.configured),
      model: data.model || "glm-5.1",
      thinking: data.thinking || "enabled",
    };
  } catch {
    state.api = {
      checked: true,
      server: false,
      configured: false,
      model: "glm-5.1",
      thinking: "enabled",
    };
  }
  els.apiHint.textContent = state.api.configured
    ? "启用在线 AI 时，标书正文和公司名称会发送给模型服务。"
    : "尚未配置 API。请在服务端配置 ZHIPU_API_KEY，或导出任务给本地 Agent 分析。";
  updateModeStatus();
}

function updateModeStatus(forcedLabel) {
  const useAi = Boolean(els.useAiToggle?.checked);
  const apiPill = els.apiStatusPill;
  apiPill.classList.remove("ready", "warning", "muted");

  if (state.api.server && state.api.configured) {
    const thinkingLabel = state.api.thinking === "enabled" ? "深度思考" : "普通分析";
    apiPill.textContent = `${state.api.model} ${thinkingLabel}`;
    apiPill.classList.add("ready");
  } else if (state.api.server) {
    apiPill.textContent = "API 待配置";
    apiPill.classList.add("warning");
  } else {
    apiPill.textContent = "本地规则模式";
    apiPill.classList.add("muted");
  }

  if (forcedLabel) {
    els.modePill.textContent = forcedLabel;
    return;
  }

  if (useAi && state.api.server && state.api.configured) {
    els.modePill.textContent = "AI 深度分析";
  } else if (useAi && state.api.server) {
    els.modePill.textContent = "API 待配置";
  } else {
    els.modePill.textContent = "规则分析";
  }
}

async function loadBatch(files) {
  if (!files.length || els.analyzeBtn.disabled) return;
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
    if (source !== "规则") TenderWorkflow.singleResult(report);
    state.analysis = normalizeAnalysis(report, doc.text, { name: doc.fileName });
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
  if (!file || els.analyzeBtn.disabled) return;
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
  try {
    const task = currentTask();
    const comparison = task.documents.length > 1;
    const useAi = els.useAiToggle.checked && state.api.configured;
    if (comparison && !useAi) throw new Error("横向评分需要配置 API 并启用 AI，或导出任务交给本地 Agent。");
    setAnalyzeButton(true);
    resetReport();
    setPipelineState("extract");
    showStatus(useAi ? "正在等待 AI 分析…" : "正在执行本地规则分析…");
    const report = useAi ? await runRemoteAnalysis(task) : analyzeTender(task.documents[0].text, state.file);
    applyReport(report, task, useAi ? state.api.model : "规则");
    showStatus(useAi ? "AI 分析完成，请复核原文证据。" : "本地规则分析完成。");
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

function analyzeTender(text, file) {
  const quote = extractQuote(text);
  const delivery = extractDelivery(text);
  const deadline = extractDeadline(text);
  const projectName = extractProjectName(text, file);
  const technicalRequirements = extractTechnicalRequirements(text);
  const risks = extractRisks(text, technicalRequirements, delivery);
  const outsourcing = extractOutsourcing(text);
  const compliance = buildCompliance(text, risks);
  const confidence = calculateConfidence(text, quote, delivery, technicalRequirements);

  return {
    project: {
      name: projectName,
      fileName: file?.name || "未命名标书",
      analyzedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
      documentType: inferDocumentType(file),
    },
    keyFacts: {
      quote,
      delivery,
      deadline,
      riskLevel: getRiskLevel(risks),
      confidence,
    },
    summary: buildSummary(projectName, quote, delivery, deadline, technicalRequirements, risks, outsourcing),
    departments: buildDepartmentFocus(quote, delivery, technicalRequirements, risks, outsourcing),
    pricing: buildPricing(quote),
    timeline: buildTimeline(delivery),
    technicalRequirements,
    risks,
    outsourcing,
    compliance,
    sourceReferences: buildSourceReferences(text),
  };
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

function normalizeAnalysis(value, text, file) {
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
    sourceReferences: normalizeArray(input.sourceReferences || input.source_references || buildSourceReferences(text)),
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

function extractProjectName(text, file) {
  const match = text.match(/项目名称[:：]\s*([^\n。；]+)/);
  if (match) {
    return match[1].trim();
  }
  return file?.name ? file.name.replace(/\.[^.]+$/, "") : "未命名标书项目";
}

function extractQuote(text) {
  const patterns = [
    /(投标总价|控制价|报价|预算金额|最高限价)[^0-9人民币]{0,20}(?:人民币)?\s*([0-9,.]+)\s*(万元|万|元)?/i,
    /人民币\s*([0-9,.]+)\s*(万元|万|元)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }

    const rawNumber = match[2] || match[1];
    const rawUnit = match[3] || match[2] || "";
    const amount = Number(String(rawNumber).replace(/,/g, ""));
    if (!Number.isFinite(amount)) {
      continue;
    }

    const amountWan = rawUnit.includes("元") && !rawUnit.includes("万") ? amount / 10000 : amount;
    return {
      label: `${formatNumber(amountWan)} 万元`,
      note: "来自价格条款",
      amountWan,
      evidence: match[0].slice(0, 120),
    };
  }

  return {
    label: "未识别",
    note: "需销售复核",
    amountWan: null,
    evidence: "",
  };
}

function extractDelivery(text) {
  const candidates = [];
  const patterns = [
    /(?:交货期|供货周期|交付周期|交货时间)[^。；\n]{0,36}?([0-9]{1,3})\s*(日历天|天|日|个月|月)/g,
    /([0-9]{1,3})\s*(日历天|天|日|个月|月)[^。；\n]{0,18}?(?:完成)?(?:交货|供货|交付)/g,
    /(?:交货|供货|交付)[^。；\n]{0,36}?([0-9]{1,3})\s*(日历天|天|日|个月|月)/g,
  ];

  patterns.forEach((pattern) => {
    for (const match of text.matchAll(pattern)) {
      const value = Number(match[1]);
      const unit = match[2];
      const days = unit.includes("月") ? value * 30 : value;
      const contextStart = Math.max(0, (match.index || 0) - 24);
      const contextEnd = Math.min(text.length, (match.index || 0) + match[0].length + 24);
      candidates.push({
        label: `${value}${unit}`,
        note: days <= 90 ? "周期偏紧" : "常规周期",
        days,
        raw: match[0],
        evidence: text.slice(contextStart, contextEnd).slice(0, 140),
      });
    }
  });

  if (!candidates.length) {
    return { label: "未识别", note: "需项目经理复核", days: null, evidence: "" };
  }

  const deliveryCandidates = candidates.filter(
    (candidate) => !/质保|保修|投运后/.test(candidate.evidence) && !/交货后|到货后/.test(candidate.raw)
  );
  return (deliveryCandidates.length ? deliveryCandidates : candidates).sort((a, b) => b.days - a.days)[0];
}

function extractDeadline(text) {
  const match = text.match(/(投标截止|递交截止|开标时间)[^0-9]{0,20}([0-9]{4}年[0-9]{1,2}月[0-9]{1,2}日(?:[0-9]{1,2}[:：][0-9]{2})?)/);
  if (!match) {
    return { label: "未识别", note: "需销售复核", evidence: "" };
  }
  return {
    label: match[2],
    note: match[1],
    evidence: match[0].slice(0, 120),
  };
}

function extractTechnicalRequirements(text) {
  const sentences = splitSentences(text);
  const keywords = [
    "燃烧器",
    "NOx",
    "排放",
    "调节比",
    "燃料",
    "防爆",
    "Ex",
    "IIC",
    "T4",
    "PLC",
    "火检",
    "点火",
    "IP",
    "FAT",
    "材质",
    "焊接",
    "检测",
    "质保",
  ];

  const matched = sentences.filter((sentence) =>
    keywords.some((keyword) => sentence.toLowerCase().includes(keyword.toLowerCase()))
  );

  const rows = matched.slice(0, 10).map((sentence) => {
    const category = inferRequirementCategory(sentence);
    return {
      category,
      requirement: sentence,
      priority: inferPriority(sentence),
      owner: inferOwner(category),
      evidence: sentence,
    };
  });

  if (rows.length > 0) {
    return rows;
  }

  return [
    {
      category: "通用技术",
      requirement: "未识别到明确技术条款，建议补充 OCR 或解析结果后复核。",
      priority: "中",
      owner: "技术顾问",
      evidence: "",
    },
  ];
}

function extractRisks(text, requirements, delivery) {
  const risks = [];
  const sentences = splitSentences(text);
  const highRiskKeywords = ["废标", "不得", "必须", "保证金", "罚款", "违约", "偏离", "否决"];
  const mediumRiskKeywords = ["防爆", "NOx", "排放", "第三方", "质保", "交货", "验收"];

  sentences.forEach((sentence) => {
    if (highRiskKeywords.some((keyword) => sentence.includes(keyword))) {
      risks.push({
        title: "硬性响应风险",
        level: "高",
        detail: sentence,
        impact: "可能导致废标、成本增加或商务扣分。",
        mitigation: "逐条响应并形成偏离表，投标前由销售、技术和法务会签。",
        owner: "销售/技术",
        evidence: sentence,
      });
    } else if (mediumRiskKeywords.some((keyword) => sentence.includes(keyword))) {
      risks.push({
        title: "技术或履约风险",
        level: "中",
        detail: sentence,
        impact: "可能影响技术响应完整性或交付验收。",
        mitigation: "补充证书、测试方案、供应商承诺和项目排期。",
        owner: "项目/质量",
        evidence: sentence,
      });
    }
  });

  if (delivery.days && delivery.days <= 90) {
    risks.push({
      title: "交付周期偏紧",
      level: "中",
      detail: `识别到交付周期约 ${delivery.days} 天，需提前锁定长周期阀组、仪表与控制柜。`,
      impact: "可能压缩设计、采购、制造与 FAT 周期。",
      mitigation: "投标前完成长周期物料询价和关键供应商交期确认。",
      owner: "项目/采购",
      evidence: delivery.evidence || "",
    });
  }

  if (requirements.some((item) => item.requirement.includes("防爆"))) {
    risks.push({
      title: "防爆合规",
      level: "中",
      detail: "防爆等级涉及现场仪表、阀组和控制柜选型，需供应商资质与证书闭环。",
      impact: "证书缺失可能造成技术偏离或现场验收风险。",
      mitigation: "采购前锁定防爆证书、铭牌信息和适用区域。",
      owner: "电控部/采购",
      evidence: requirements.find((item) => item.requirement.includes("防爆"))?.evidence || "",
    });
  }

  return uniqueBy(risks, (risk) => `${risk.title}-${risk.detail}`).slice(0, 8);
}

function extractOutsourcing(text) {
  const candidates = [
    {
      package: "第三方检测",
      scope: "材质证明、焊接记录、性能测试、低氮排放测试见证",
      triggers: ["第三方检测", "检测报告", "低氮排放测试"],
      deliverable: "检测报告、见证记录、整改闭环清单",
      supplierType: "具备石化装备检测资质的第三方机构",
    },
    {
      package: "运输与包装",
      scope: "设备包装、防潮防震、超限运输、到场交接",
      triggers: ["包装", "运输", "交货"],
      deliverable: "运输方案、装箱单、到货验收记录",
      supplierType: "石化装备物流服务商",
    },
    {
      package: "现场安装协作",
      scope: "指导安装、冷态检查、点火联调、人员培训",
      triggers: ["安装", "调试", "培训"],
      deliverable: "安装记录、调试报告、培训签到与考核",
      supplierType: "燃烧器现场服务或安装单位",
    },
    {
      package: "保温防腐",
      scope: "保温材料、防腐涂装、现场修补",
      triggers: ["保温", "防腐"],
      deliverable: "施工记录、材料合格证、隐蔽验收资料",
      supplierType: "保温防腐专业分包商",
    },
  ];

  return candidates
    .filter((candidate) => candidate.triggers.some((keyword) => text.includes(keyword)))
    .map((candidate) => ({
      package: candidate.package,
      scope: candidate.scope,
      trigger: candidate.triggers.filter((keyword) => text.includes(keyword)).join(" / "),
      deliverable: candidate.deliverable,
      supplierType: candidate.supplierType,
      owner: "采购部",
      riskNotes: "投标阶段需确认该范围是否允许分包及责任边界。",
    }));
}

function buildCompliance(text, risks) {
  const sentences = splitSentences(text);
  const mustRespondItems = sentences
    .filter((sentence) => /必须|不得|不接受|废标|否决|保证金|逐条响应|投标截止/.test(sentence))
    .slice(0, 8);
  const deviationItems = sentences.filter((sentence) => /偏离|澄清|变更|例外|差异/.test(sentence)).slice(0, 6);
  const missingItems = [];

  if (!/付款|支付|预付款|进度款|质保金/.test(text)) {
    missingItems.push("未识别到付款条件，需销售或商务复核。");
  }
  if (!/税|增值税|发票/.test(text)) {
    missingItems.push("未识别到税费或发票条款，需商务复核。");
  }
  if (!/质保|保修/.test(text)) {
    missingItems.push("未识别到质保条款，需质量和销售复核。");
  }

  const clarificationQuestions = [
    "是否允许运输、检测、保温防腐或现场服务分包。",
    "低氮排放测试的工况、燃料组成和验收边界。",
    "控制柜、阀组、仪表的品牌短名单和防爆证书要求。",
  ];

  if (risks.some((risk) => risk.level === "高")) {
    clarificationQuestions.unshift("高风险条款是否可通过澄清或偏离表处理。");
  }

  return {
    mustRespondItems: mustRespondItems.length ? mustRespondItems : ["未识别到明确必须响应条款，仍需人工抽检。"],
    deviationItems: deviationItems.length ? deviationItems : ["未识别到明确偏离条款，需投标前逐条复核。"],
    missingItems,
    clarificationQuestions,
  };
}

function buildSourceReferences(text) {
  return splitSentences(text)
    .filter((sentence) => /报价|控制价|交货|投标截止|保证金|NOx|防爆|FAT|质保|废标|分包|外包|检测/.test(sentence))
    .slice(0, 10)
    .map((sentence, index) => ({
      section: inferSourceSection(sentence),
      page: null,
      text: sentence.slice(0, 180),
      id: index + 1,
    }));
}

function buildSummary(projectName, quote, delivery, deadline, requirements, risks, outsourcing) {
  const topRequirements = requirements.slice(0, 2).map((item) => item.requirement).join("；");
  return [
    `${projectName}的核心范围集中在燃烧器成套供货、控制系统、检验测试与现场调试。`,
    `商务侧已识别报价为${quote.label}，交货期为${delivery.label}，投标截止为${deadline.label}。`,
    `技术侧优先关注：${topRequirements || "低氮排放、防爆等级、控制联锁、出厂验收资料"}`,
    `当前风险等级为${getRiskLevel(risks).label}，需要重点复核废标项、技术偏离、第三方检测和长周期物料。`,
    `可形成${outsourcing.length || 0}个外包包件，适合采购提前询价并锁定交付边界。`,
  ];
}

function buildDepartmentFocus(quote, delivery, requirements, risks, outsourcing) {
  return [
    `销售：复核${quote.label}报价口径、保证金、投标截止和商务偏离表。`,
    `技术顾问：逐条响应${requirements.length}项技术要求，补齐低氮、防爆、火检、控制联锁证据。`,
    `项目经理：按${delivery.label}倒排设计、采购、制造、FAT、发运和现场调试。`,
    `采购：优先处理${outsourcing.length || 0}个外包包件，以及阀组、仪表、控制柜等长周期物料。`,
    `质量：准备FAT、材质证明、焊接记录、第三方检测和排放测试资料。`,
    `管理层：关注高风险条款数量、毛利空间、交付可行性与资源占用。`,
    risks.length ? `风险委员会：${risks[0].detail}` : "风险委员会：暂无高风险条款，仍需人工抽检。",
  ];
}

function buildPricing(quote) {
  if (!quote.amountWan) {
    return [
      { item: "报价总额", value: "未识别", owner: "销售/财务", evidence: "需人工复核" },
      { item: "成本拆分", value: "待补充", owner: "销售/采购", evidence: "需结合报价清单" },
    ];
  }

  const amount = quote.amountWan;
  return [
    ["燃烧器本体及附件", amount * 0.42, "制造中心", "招标范围/技术规格"],
    ["燃气阀组与现场仪表", amount * 0.18, "采购部", "防爆与工艺控制要求"],
    ["点火、火检、PLC控制柜", amount * 0.16, "电控部", "控制联锁与安全要求"],
    ["检验测试与第三方见证", amount * 0.08, "质量部", "FAT/检测报告条款"],
    ["包装运输与现场服务", amount * 0.10, "项目部", "交货与调试服务"],
    ["风险预备费", amount * 0.06, "销售/财务", "偏离、质保、周期风险"],
  ].map(([item, value, owner, evidence]) => ({
    item,
    value: `${formatNumber(value)} 万元`,
    owner,
    evidence,
  }));
}

function buildTimeline(delivery) {
  const totalDays = delivery.days || 120;
  const ranges = [
    ["技术澄清与方案冻结", Math.max(7, Math.round(totalDays * 0.12)), "偏离表、技术协议、BOM冻结", "销售/技术"],
    ["采购与外协锁定", Math.max(14, Math.round(totalDays * 0.22)), "阀组、仪表、控制柜、检测资源", "采购"],
    ["制造与装配", Math.max(28, Math.round(totalDays * 0.34)), "燃烧器本体、阀组、柜体集成", "制造中心"],
    ["FAT与整改", Math.max(7, Math.round(totalDays * 0.12)), "测试记录、问题闭环、发运放行", "质量/技术"],
    ["包装发运与到货", Math.max(7, Math.round(totalDays * 0.10)), "装箱单、运输交接、到货验收", "项目部"],
    ["现场调试", 30, "点火联调、性能验证、培训交付", "项目/服务"],
  ];

  return ranges.map(([stage, days, output, owner]) => ({
    stage,
    period: `${days}天`,
    output,
    owner,
  }));
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

function splitSentences(text) {
  return normalizeText(text)
    .split(/[。；;\n]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 6);
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function inferRequirementCategory(sentence) {
  if (/NOx|排放|调节比|燃料|燃烧器/i.test(sentence)) return "燃烧性能";
  if (/防爆|Ex|IP|PLC|火检|点火|控制/i.test(sentence)) return "电仪控制";
  if (/FAT|检测|材质|焊接|报告|质保/i.test(sentence)) return "检验试验";
  return "其他";
}

function inferSourceSection(sentence) {
  if (/报价|控制价|价格|付款|保证金/.test(sentence)) return "商务条款";
  if (/交货|工期|投标截止|开标/.test(sentence)) return "进度与投标";
  if (/NOx|防爆|燃烧器|PLC|FAT|检测|质保/.test(sentence)) return "技术要求";
  if (/废标|偏离|不得|必须|分包|外包/.test(sentence)) return "风险合规";
  return "原文";
}

function inferOwner(category) {
  const map = {
    燃烧性能: "技术顾问",
    电仪控制: "电控部",
    检验试验: "质量部",
    其他: "项目部",
  };
  return map[category] || "项目部";
}

function inferPriority(sentence) {
  if (/废标|不得|必须|不高于|不低于|防爆|NOx|保证金|否决/i.test(sentence)) return "高";
  if (/提供|完成|质保|测试|交货|验收/i.test(sentence)) return "中";
  return "低";
}

function getRiskLevel(risks) {
  if (risks.some((risk) => risk.level === "高")) {
    return { label: "高", note: `${risks.length} 条风险`, score: 3 };
  }
  if (risks.length >= 3) {
    return { label: "中", note: `${risks.length} 条风险`, score: 2 };
  }
  if (risks.length > 0) {
    return { label: "低", note: `${risks.length} 条风险`, score: 1 };
  }
  return { label: "低", note: "未识别高风险", score: 0 };
}

function calculateConfidence(text, quote, delivery, requirements) {
  let score = 48;
  if (text.length > 300) score += 10;
  if (text.length > 1200) score += 6;
  if (quote.amountWan) score += 12;
  if (delivery.days) score += 10;
  if (requirements.length >= 3) score += 10;
  if (state.file && isPlainText(state.file)) score += 4;
  return Math.min(score, 92);
}

function inferDocumentType(file) {
  if (!file) return "文本输入";
  const extension = getExtension(file.name).toUpperCase() || "未知";
  return `${extension} 标书文件`;
}

function getParserLabel(file) {
  const extension = getExtension(file.name);
  if (extension === "pdf") return "PDF 解析";
  if (extension === "docx") return "Word 解析";
  if (isPlainText(file)) return "文本解析";
  return "附件解析";
}

function isPlainText(file) {
  const extension = getExtension(file.name);
  return ["txt", "md", "csv"].includes(extension) || String(file.type || "").startsWith("text/");
}

function getExtension(fileName) {
  return String(fileName || "").split(".").pop()?.toLowerCase() || "";
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
  for (const id of ["analyzeBtn", "fileInput", "sampleBtn", "clearBtn", "companyName",
    "documentText", "analysisMode", "useAiToggle", "exportTask", "importReport"]) {
    els[id].disabled = isBusy;
  }
  els.analyzeBtn.querySelector("span").textContent = isBusy ? "分析中" : "一键分析";
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
