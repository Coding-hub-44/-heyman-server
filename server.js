const http = require("http");
const https = require("https");

const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY || "";
const PORT = process.env.PORT || 3000;

const ALLOWED = [
  "https://www.heymanacademy.com",
  "https://heymanacademy.com",
  "http://localhost",
  "null",
];

function cors(req) {
  const origin = req.headers["origin"] || "";
  const allowed = ALLOWED.includes(origin) ? origin : "*";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
}

function callAnthropic(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const options = {
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "web-search-2025-03-05",
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error("Invalid JSON: " + data.slice(0, 200))); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function extractText(content) {
  return (content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
}

function extractJSON(text) {
  const clean = text.replace(/```json|```/g, "").trim();
  const m = clean.match(/\{[\s\S]*\}/);
  return m ? m[0] : null;
}

const server = http.createServer(async (req, res) => {
  const headers = cors(req);

  if (req.method === "OPTIONS") { res.writeHead(204, headers); res.end(); return; }

  // GET allowed for /health only
  if (req.method === "GET") {
    const gp = new URL(req.url, "http://localhost").pathname;
    if (gp === "/health") {
      res.writeHead(200, headers);
      res.end(JSON.stringify({ status: "ok", key: ANTHROPIC_KEY ? "set" : "missing" }));
      return;
    }
    res.writeHead(405, headers); res.end(JSON.stringify({ error: "Method not allowed" })); return;
  }

  if (req.method !== "POST") { res.writeHead(405, headers); res.end(JSON.stringify({ error: "Method not allowed" })); return; }

  let rawBody = "";
  for await (const chunk of req) rawBody += chunk;
  let body;
  try { body = JSON.parse(rawBody); }
  catch { res.writeHead(400, headers); res.end(JSON.stringify({ error: "Invalid JSON body" })); return; }

  const path = new URL(req.url, "http://localhost").pathname;

  if (path === "/search") {
    const { skill = "", audience = "", values = "" } = body;
    try {
      const data = await callAnthropic({
        model: "claude-sonnet-4-6", max_tokens: 800,
        system: 'You are a market research assistant. Output ONLY valid JSON with key "search_results". No other text.',
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [{ role: "user", content: `Search and return JSON.\n1. "${skill} creator viral youtube 2025"\n2. "${skill} instagram reels trending 2025 ${audience}"\n3. "${skill} personal brand sub niche ${values} 2025"\nReturn: {"search_results":["finding",...up to 12]}` }],
      });
      const json = extractJSON(extractText(data.content));
      res.writeHead(200, headers);
      res.end(json || JSON.stringify({ search_results: [] }));
    } catch (err) { res.writeHead(500, headers); res.end(JSON.stringify({ error: err.message, search_results: [] })); }
    return;
  }

  if (path === "/generate") {
    const { prompt = "" } = body;
    if (!prompt) { res.writeHead(400, headers); res.end(JSON.stringify({ error: "Missing prompt" })); return; }
    try {
      const data = await callAnthropic({
        model: "claude-sonnet-4-6", max_tokens: 4000,
        system: `You are the Heyman Academy Personal Brand Intelligence Engine.\nABSOLUTE RULES:\n1. Output ONLY valid JSON — zero markdown, zero backticks\n2. NEVER paste student words into output\n3. Professionally synthesise everything\n4. Run 9 analysis stages internally\n5. Final check: rewrite any field that applies to other creators`,
        messages: [{ role: "user", content: prompt }],
      });
      const json = extractJSON(extractText(data.content));
      if (!json) { res.writeHead(500, headers); res.end(JSON.stringify({ error: "AI did not return valid JSON" })); return; }
      res.writeHead(200, headers);
      res.end(JSON.stringify({ result: json }));
    } catch (err) { res.writeHead(500, headers); res.end(JSON.stringify({ error: err.message })); }
    return;
  }

  if (path === "/health") {
    res.writeHead(200, headers);
    res.end(JSON.stringify({ status: "ok", key: ANTHROPIC_KEY ? "set" : "missing" }));
    return;
  }

  res.writeHead(404, headers); res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, () => {
  console.log(`Heyman Academy server running on port ${PORT}`);
  console.log(`API key: ${ANTHROPIC_KEY ? "✅ set" : "❌ MISSING"}`);
});
