import express from "express";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 5050;
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || "*";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "merazil2025";
const AI_PROVIDER = (process.env.AI_PROVIDER || "openai").toLowerCase();
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-latest";
const SEARCH_PROVIDER = (process.env.SEARCH_PROVIDER || "auto").toLowerCase();
const MAX_CONTEXT_RESULTS = Number(process.env.MAX_CONTEXT_RESULTS || 5);

const app = express();
const dataDir = path.join(__dirname, "data");
const logFile = path.join(dataDir, "usage-log.json");
const chatsFile = path.join(dataDir, "chat-log.jsonl");

fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(logFile)) fs.writeFileSync(logFile, JSON.stringify({ chats: 0, searches: 0, users: 0, lastRequestAt: null }, null, 2));

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

function readLog() {
  try { return JSON.parse(fs.readFileSync(logFile, "utf8")); }
  catch { return { chats: 0, searches: 0, users: 0, lastRequestAt: null }; }
}
function writeLog(log) { fs.writeFileSync(logFile, JSON.stringify(log, null, 2)); }
function bump(key) {
  const log = readLog();
  log[key] = Number(log[key] || 0) + 1;
  log.lastRequestAt = new Date().toISOString();
  writeLog(log);
}
function safeText(value, max = 8000) {
  return String(value || "").replace(/[\u0000-\u001F\u007F]/g, " ").slice(0, max).trim();
}
function clientId(req) {
  return crypto.createHash("sha256").update(req.ip + (req.headers["user-agent"] || "")).digest("hex").slice(0, 12);
}
function requireAdmin(req, res, next) {
  if (String(req.headers["x-admin-password"] || "") !== ADMIN_PASSWORD) return res.status(401).json({ error: "Unauthorized" });
  next();
}

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());
app.use(cors({ origin: PUBLIC_ORIGIN === "*" ? true : PUBLIC_ORIGIN.split(",").map(s => s.trim()) }));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.CHAT_RATE_LIMIT_PER_MIN || 30),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Bahut zyada requests aa rahi hain. Thodi der baad try karo." }
});

async function searchWithSerper(query) {
  const r = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": process.env.SERPER_API_KEY },
    body: JSON.stringify({ q: query, num: MAX_CONTEXT_RESULTS })
  });
  if (!r.ok) throw new Error(`Serper error ${r.status}`);
  const d = await r.json();
  return (d.organic || []).slice(0, MAX_CONTEXT_RESULTS).map(x => ({ title: x.title, url: x.link, snippet: x.snippet }));
}
async function searchWithTavily(query) {
  const r = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query, max_results: MAX_CONTEXT_RESULTS, search_depth: "advanced" })
  });
  if (!r.ok) throw new Error(`Tavily error ${r.status}`);
  const d = await r.json();
  return (d.results || []).slice(0, MAX_CONTEXT_RESULTS).map(x => ({ title: x.title, url: x.url, snippet: x.content }));
}
async function searchWithBrave(query) {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(MAX_CONTEXT_RESULTS));
  const r = await fetch(url, { headers: { "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY } });
  if (!r.ok) throw new Error(`Brave error ${r.status}`);
  const d = await r.json();
  return (d.web?.results || []).slice(0, MAX_CONTEXT_RESULTS).map(x => ({ title: x.title, url: x.url, snippet: x.description }));
}
async function webSearch(query) {
  const providers = SEARCH_PROVIDER === "auto" ? ["serper", "tavily", "brave"] : [SEARCH_PROVIDER];
  for (const p of providers) {
    try {
      if (p === "serper" && process.env.SERPER_API_KEY) return await searchWithSerper(query);
      if (p === "tavily" && process.env.TAVILY_API_KEY) return await searchWithTavily(query);
      if (p === "brave" && process.env.BRAVE_SEARCH_API_KEY) return await searchWithBrave(query);
    } catch (e) { console.warn("search provider failed", p, e.message); }
  }
  return [];
}
function shouldSearch(text, forced) {
  if (forced) return true;
  return /latest|today|news|price|current|real\s*time|search|google|web|abhi|aaj|kal|recent|live|market|xauusd|job|remote/i.test(text);
}

async function callAI({ system, messages, searchResults }) {
  const searchContext = searchResults?.length
    ? "\n\nLIVE WEB SEARCH CONTEXT:\n" + searchResults.map((r, i) => `${i + 1}. ${r.title}\n${r.url}\n${r.snippet || ""}`).join("\n\n")
    : "";
  const sys = `${system || "Tum Merazil Digital AI ho. Helpful, clear, Hindi/English/Hinglish mein jawab do."}${searchContext}\n\nOwner: Muzammil. Brand: Merazil Digital. Never reveal API keys or admin secrets.`;

  if (AI_PROVIDER === "anthropic") {
    if (!anthropic) throw new Error("ANTHROPIC_API_KEY set nahi hai.");
    const resp = await anthropic.messages.create({ model: ANTHROPIC_MODEL, max_tokens: 1200, system: sys, messages });
    return resp.content?.map(c => c.text || "").join("").trim();
  }
  if (!openai) throw new Error("OPENAI_API_KEY set nahi hai.");
  const input = [{ role: "system", content: [{ type: "input_text", text: sys }] }];
  for (const m of messages) input.push({ role: m.role, content: [{ type: "input_text", text: m.content }] });
  const resp = await openai.responses.create({ model: OPENAI_MODEL, input });
  return resp.output_text?.trim();
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, app: "Merazil AI Ultra", provider: AI_PROVIDER, model: AI_PROVIDER === "anthropic" ? ANTHROPIC_MODEL : OPENAI_MODEL, apiConfigured: Boolean(openai || anthropic), searchConfigured: Boolean(process.env.SERPER_API_KEY || process.env.TAVILY_API_KEY || process.env.BRAVE_SEARCH_API_KEY) });
});

app.get("/api/admin-info", requireAdmin, (_req, res) => {
  res.json({ ok: true, stats: readLog(), provider: AI_PROVIDER, model: AI_PROVIDER === "anthropic" ? ANTHROPIC_MODEL : OPENAI_MODEL, searchProvider: SEARCH_PROVIDER });
});

app.post("/api/search", chatLimiter, async (req, res) => {
  const query = safeText(req.body.query, 300);
  if (!query) return res.status(400).json({ error: "Query missing hai." });
  const results = await webSearch(query);
  bump("searches");
  res.json({ ok: true, query, results });
});

app.post("/api/chat", chatLimiter, async (req, res) => {
  try {
    const system = safeText(req.body.system, 4000);
    const rawMessages = Array.isArray(req.body.messages) ? req.body.messages : [];
    const messages = rawMessages
      .filter(m => m && typeof m.content === "string" && ["user", "assistant"].includes(m.role))
      .slice(-16)
      .map(m => ({ role: m.role, content: safeText(m.content, 6000) }));
    if (!messages.length) return res.status(400).json({ error: "Message missing hai." });

    const lastUser = [...messages].reverse().find(m => m.role === "user")?.content || "";
    let searchResults = [];
    if (shouldSearch(lastUser, Boolean(req.body.search))) searchResults = await webSearch(lastUser);

    const reply = await callAI({ system, messages, searchResults });
    if (!reply) return res.status(500).json({ error: "AI reply empty aayi." });

    bump("chats");
    fs.appendFile(chatsFile, JSON.stringify({ at: new Date().toISOString(), user: clientId(req), q: lastUser.slice(0, 500), searchUsed: searchResults.length > 0 }) + "\n", () => {});
    res.json({ ok: true, reply, searchUsed: searchResults.length > 0, sources: searchResults });
  } catch (error) {
    console.error("chat error:", error);
    const message = error?.status === 429 ? "Rate limit hit hui hai. Thodi der baad try karo." : error?.message || "Server error hua.";
    res.status(500).json({ error: message });
  }
});

app.get("/admin", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => console.log(`Merazil AI Ultra running on http://localhost:${PORT}`));
