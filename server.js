const http = require("http");
const https = require("https");

const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://dmyimtmyfczrzjkdmhbe.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRteWltdG15ZmN6cnpqa2RtaGJlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3MjAzNzksImV4cCI6MjA5NzI5NjM3OX0.zqWT-yhgtrf3xaFGvOOs0fOpyWwPLKs3h2Gj6Ae4RwA";
const PORT = process.env.PORT || 3000;

// ── Allowed origins (add your Wix URL here) ──────────────────────
const ALLOWED = [
  "https://www.heymanacademy.com",
  "https://heymanacademy.com",
  "http://localhost",
  "null", // Wix preview
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
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error("Invalid JSON from Anthropic: " + data.slice(0, 200)));
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function extractText(content) {
  return (content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function extractJSON(text) {
  const clean = text.replace(/```json|```/g, "").trim();
  const m = clean.match(/\{[\s\S]*\}/);
  return m ? m[0] : null;
}

const server = http.createServer(async (req, res) => {
  const headers = cors(req);

  if (req.method === "OPTIONS") {
    res.writeHead(204, headers);
    res.end();
    return;
  }

  // Allow GET for health check
  if (req.method === "GET") {
    const getPath = new URL(req.url, "http://localhost").pathname;
    if (getPath === "/health") {
      res.writeHead(200, headers);
      res.end(JSON.stringify({ status: "ok", key: ANTHROPIC_KEY ? "set" : "missing" }));
      return;
    }
  }

  if (req.method !== "POST") {
    res.writeHead(405, headers);
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  // Read body
  let rawBody = "";
  for await (const chunk of req) rawBody += chunk;
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    res.writeHead(400, headers);
    res.end(JSON.stringify({ error: "Invalid JSON body" }));
    return;
  }

  const path = new URL(req.url, "http://localhost").pathname;

  // ── /search ────────────────────────────────────────────────────
  if (path === "/search") {
    const { skill = "", audience = "", values = "" } = body;
    try {
      const data = await callAnthropic({
        model: "claude-sonnet-4-6",
        max_tokens: 800,
        system:
          'You are a market research assistant. Output ONLY valid JSON with key "search_results". No other text.',
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [
          {
            role: "user",
            content: `Search the web and return real findings as JSON.
Do THREE searches:
1. "${skill} creator viral youtube 2025 high views" — find real video titles with millions of views
2. "${skill} instagram reels trending 2025 ${audience}" — find what formats are working
3. "${skill} personal brand sub niche ${values} 2025 trending"
Return: {"search_results":["finding with platform, title, creator, why it worked",...up to 12 findings]}`,
          },
        ],
      });
      const text = extractText(data.content);
      const json = extractJSON(text);
      res.writeHead(200, headers);
      res.end(json || JSON.stringify({ search_results: [] }));
    } catch (err) {
      res.writeHead(500, headers);
      res.end(JSON.stringify({ error: err.message, search_results: [] }));
    }
    return;
  }

  // ── /generate ──────────────────────────────────────────────────
  if (path === "/generate") {
    const { prompt = "" } = body;
    if (!prompt) {
      res.writeHead(400, headers);
      res.end(JSON.stringify({ error: "Missing prompt" }));
      return;
    }
    try {
      const data = await callAnthropic({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        system: `You are the Heyman Academy Personal Brand Intelligence Engine — senior brand strategist, consumer psychologist, content director and social media trend researcher combined.
ABSOLUTE RULES:
1. Output ONLY valid JSON — zero markdown, zero backticks, zero text outside the JSON object
2. Student answers are RAW MATERIAL — NEVER paste any student words into output regardless of language
3. Every field must be professionally synthesised from your analysis, not copy-pasted
4. Run all 9 analysis stages internally before generating JSON
5. Final check: can any field apply to a different creator unchanged? If yes, rewrite it`,
        messages: [{ role: "user", content: prompt }],
      });
      const text = extractText(data.content);
      const json = extractJSON(text);
      if (!json) {
        res.writeHead(500, headers);
        res.end(
          JSON.stringify({ error: "AI did not return valid JSON", raw: text.slice(0, 400) })
        );
        return;
      }
      res.writeHead(200, headers);
      res.end(JSON.stringify({ result: json }));
    } catch (err) {
      res.writeHead(500, headers);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── /health ────────────────────────────────────────────────────
  if (path === "/health") {
    res.writeHead(200, headers);
    res.end(JSON.stringify({ status: "ok", key: ANTHROPIC_KEY ? "set" : "missing" }));
    return;
  }

  // ── /check-email ───────────────────────────────────────────────
  if (path === "/check-email") {
    const { email = "" } = body;
    if (!email) {
      res.writeHead(400, headers);
      res.end(JSON.stringify({ allowed: false, error: "No email provided" }));
      return;
    }
    try {
      const encodedEmail = encodeURIComponent(email.toLowerCase().trim());
      const supabaseUrl = `${SUPABASE_URL}/rest/v1/allowed_emails?Email=ilike.${encodedEmail}&select=Email`;
      const supaRes = await new Promise((resolve, reject) => {
        const opts = new URL(supabaseUrl);
        const req2 = https.request({
          hostname: opts.hostname,
          path: opts.pathname + opts.search,
          method: "GET",
          headers: {
            "apikey": SUPABASE_KEY,
            "Authorization": "Bearer " + SUPABASE_KEY,
            "Content-Type": "application/json"
          }
        }, (r) => {
          let d = "";
          r.on("data", c => d += c);
          r.on("end", () => resolve({ status: r.statusCode, body: d }));
        });
        req2.on("error", reject);
        req2.end();
      });
      const data = JSON.parse(supaRes.body);
      const allowed = Array.isArray(data) && data.length > 0;
      res.writeHead(200, headers);
      res.end(JSON.stringify({ allowed }));
    } catch (err) {
      res.writeHead(500, headers);
      res.end(JSON.stringify({ allowed: false, error: err.message }));
    }
    return;
  }

  res.writeHead(404, headers);
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, () => {
  console.log(`Heyman Academy server running on port ${PORT}`);
  console.log(`API key: ${ANTHROPIC_KEY ? "✅ set" : "❌ MISSING — set ANTHROPIC_KEY env var"}`);
});
