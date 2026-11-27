const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const workflow = require("./workflow");

const ROOT = __dirname;
const DEFAULT_HOST = process.env.HOST || "0.0.0.0";
const DEFAULT_PORT = Number(process.env.PORT || 5173);
const MAX_BODY_BYTES = 12 * 1024 * 1024;
const PUBLIC_FILES = new Set(["/index.html", "/app.js", "/workflow.js", "/styles.css"]);

const DEFAULT_CONFIG = {
  endpoint: "https://api.z.ai/api/paas/v4/chat/completions",
  model: "glm-5.1",
  temperature: 0.2,
  maxTokens: 65536,
  thinking: "enabled",
  timeoutMs: 300000,
};

function loadConfig() {
  const configPath = path.join(ROOT, "config.local.json");
  let local = {};

  if (fs.existsSync(configPath)) {
    try {
      local = JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch (error) {
      console.warn(`config.local.json 解析失败：${error.message}`);
    }
  }

  return {
    ...DEFAULT_CONFIG,
    ...local,
    apiKey: (process.env.ZHIPU_API_KEY || "").trim(),
    endpoint: process.env.ZHIPU_ENDPOINT || local.endpoint || DEFAULT_CONFIG.endpoint,
    model: process.env.ZHIPU_MODEL || local.model || DEFAULT_CONFIG.model,
    maxTokens: Number(process.env.ZHIPU_MAX_TOKENS || local.maxTokens || DEFAULT_CONFIG.maxTokens),
    temperature: Number(process.env.ZHIPU_TEMPERATURE || local.temperature || DEFAULT_CONFIG.temperature),
    thinking: process.env.ZHIPU_THINKING || local.thinking || DEFAULT_CONFIG.thinking,
    timeoutMs: Number(process.env.ZHIPU_TIMEOUT_MS || local.timeoutMs || DEFAULT_CONFIG.timeoutMs),
  };
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  try {
    if (req.method === "GET" && url.pathname === "/api/status") {
      return sendJson(res, 200, getStatus());
    }

    if (req.method === "POST" && url.pathname === "/api/analyze") {
      return await handleAnalyze(req, res);
    }

    if (req.method === "GET" || req.method === "HEAD") {
      return serveStatic(req, res, url.pathname);
    }

    return sendJson(res, 405, { error: "METHOD_NOT_ALLOWED", message: "不支持的请求方法。" });
  } catch (error) {
    return sendJson(res, 500, { error: "SERVER_ERROR", message: "服务请求失败，请检查配置后重试。" });
  }
}

function getStatus() {
  const config = loadConfig();
  return {
    provider: "zhipu",
    model: config.model,
    endpoint: maskEndpoint(config.endpoint),
    thinking: config.thinking,
    maxTokens: config.maxTokens,
    configured: Boolean(config.apiKey),
  };
}

async function handleAnalyze(req, res) {
  const config = loadConfig();
  if (!config.apiKey) {
    return sendJson(res, 412, {
      error: "ZHIPU_API_KEY_MISSING",
      message: "请设置服务器环境变量 ZHIPU_API_KEY，或使用本地 Agent 分析。",
    });
  }

  let task;
  try {
    task = workflow.validateTask(await readJsonBody(req));
  } catch (error) {
    return sendJson(res, 400, { message: error.message });
  }
  let zhipuResponse, analysis;
  try {
    zhipuResponse = await requestJson(config.endpoint, buildZhipuPayload(config, task), config.apiKey, config.timeoutMs);
    const parsed = parseJsonObject(extractMessageContent(zhipuResponse));
    if (task.documents.length > 1) workflow.comparisonResult(parsed, task);
    analysis = task.documents.length > 1 ? parsed : workflow.singleResult(parsed);
  } catch {
    return sendJson(res, 502, { message: "模型调用失败或报告格式无效，请检查密钥、模型权限及额度后重试。" });
  }

  return sendJson(res, 200, {
    provider: "zhipu",
    model: config.model,
    thinking: config.thinking,
    usage: zhipuResponse.usage || null,
    analysis,
  });
}

function buildZhipuPayload(config, task) {
  const payload = {
    model: config.model,
    messages: workflow.messages(task),
    temperature: config.temperature,
    max_tokens: config.maxTokens,
    response_format: { type: "json_object" },
  };

  if (config.thinking && config.thinking !== "disabled") {
    payload.thinking = { type: config.thinking };
  }

  return payload;
}

function extractMessageContent(response) {
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((part) => part.text || part.content || "").join("\n");
  }
  if (content && typeof content === "object") {
    return JSON.stringify(content);
  }
  throw new Error("智谱返回中未找到 message.content。");
}

function parseJsonObject(text) {
  const cleaned = String(text || "")
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("模型未返回可解析的 JSON。");
  }
}

function requestJson(endpoint, payload, apiKey, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint);
    const body = JSON.stringify(payload);
    const client = url.protocol === "http:" ? http : https;

    const req = client.request(
      {
        method: "POST",
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: timeoutMs,
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          let parsed;
          try {
            parsed = data ? JSON.parse(data) : {};
          } catch {
            parsed = { raw: data };
          }

          if (res.statusCode < 200 || res.statusCode >= 300) {
            const message = parsed?.error?.message || parsed?.message || data || `HTTP ${res.statusCode}`;
            reject(new Error(`智谱接口错误：${message}`));
            return;
          }
          resolve(parsed);
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error("智谱接口调用超时。"));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy(new Error("请求体过大。"));
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new Error("请求 JSON 解析失败。"));
      }
    });

    req.on("error", reject);
  });
}

function serveStatic(req, res, pathname) {
  const decoded = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  const filePath = path.resolve(ROOT, `.${decoded}`);

  if (!PUBLIC_FILES.has(decoded)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  res.writeHead(200, {
    "Content-Type": getMimeType(filePath),
    "Cache-Control": "no-store",
  });

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  fs.createReadStream(filePath).pipe(res);
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
  };
  return map[ext] || "application/octet-stream";
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function maskEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "";
  }
}

function startServer(port, attempt = 0) {
  const server = http.createServer(handleRequest);
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE" && attempt < 20) {
      startServer(port + 1, attempt + 1);
      return;
    }
    console.error(error);
    process.exitCode = 1;
  });

  server.listen(port, DEFAULT_HOST, () => {
    const shownHost = DEFAULT_HOST === "0.0.0.0" ? "127.0.0.1" : DEFAULT_HOST;
    console.log(`AI 标书分析工作台已启动：http://${shownHost}:${server.address().port}`);
  });
}

if (require.main === module) startServer(DEFAULT_PORT);
module.exports = { handleRequest };
