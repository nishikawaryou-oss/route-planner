import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM, buildUserMessage } from "./prompt.js";

const MODEL = "claude-opus-5-5";
const MAX_ROUNDS = 4; // pause_turn からの再開を含めた最大リクエスト数

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/plan" && request.method === "POST") return handlePlan(request, env);
    if (url.pathname.startsWith("/api/")) return json({ error: "見つかりません。" }, 404);
    return env.ASSETS.fetch(request);
  },
};

async function handlePlan(request, env) {
  if (!env.ANTHROPIC_API_KEY) return json({ error: "サーバーにAPIキーが設定されていません。" }, 500);
  if (env.APP_PASSCODE && request.headers.get("x-passcode") !== env.APP_PASSCODE) {
    return json({ error: "合言葉が違います。", code: "passcode" }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "リクエストの形式が正しくありません。" }, 400);
  }
  const input = body.input || {};
  if (input.imode === "free" ? !String(input.free || "").trim() : !String(input.dest || "").trim()) {
    return json({ error: "行先を入れてください。" }, 400);
  }

  const here = validHere(body.here);
  if (here) here.address = await reverseGeocode(here.lat, here.lng);

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const messages = [{
    role: "user",
    content: buildUserMessage({
      input,
      profile: body.profile,
      here,
      now: nowInTokyo(),
      previous: body.previous,
      refine: body.refine,
    }),
  }];

  let response;
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium" },
        system: SYSTEM,
        tools: [{
          type: "web_search_20260209",
          name: "web_search",
          max_uses: 6,
          user_location: { type: "approximate", country: "JP", timezone: "Asia/Tokyo" },
        }],
        messages,
      });
      if (response.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: response.content });
    }
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return json({ error: "混み合っています。少し待ってからもう一度お試しください。" }, 429);
    if (err instanceof Anthropic.AuthenticationError) return json({ error: "サーバーのAPIキーが無効です。" }, 500);
    if (err instanceof Anthropic.APIError) return json({ error: `経路の作成に失敗しました（${err.status ?? "接続エラー"}）。` }, 502);
    throw err;
  }

  if (response.stop_reason === "refusal") return json({ error: "この内容では作成できませんでした。依頼を変えてお試しください。" }, 422);
  if (response.stop_reason === "pause_turn") return json({ error: "調べものが長引いて時間切れになりました。もう一度お試しください。" }, 504);

  const plan = parsePlan(response.content);
  if (!plan) return json({ error: "結果をうまく読み取れませんでした。もう一度お試しください。" }, 502);
  plan.sources = collectSources(response.content);
  plan.here_address = here?.address || null;
  return json({ plan });
}

function validHere(h) {
  if (!h) return null;
  const lat = Number(h.lat), lng = Number(h.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng, accuracy: Number(h.accuracy) || null };
}

// 座標をおおまかな住所にする（OpenStreetMap Nominatim）。失敗しても座標だけで続ける。
async function reverseGeocode(lat, lng) {
  try {
    const u = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&accept-language=ja&lat=${lat}&lon=${lng}`;
    const r = await fetch(u, { headers: { "User-Agent": "route-planner/1.0 (personal itinerary app)" } });
    if (!r.ok) return null;
    const d = await r.json();
    return d.display_name || null;
  } catch {
    return null;
  }
}

function nowInTokyo() {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric",
    weekday: "short", hour: "2-digit", minute: "2-digit",
  }).format(new Date());
}

// 最後のテキストからJSONを取り出す。前後に文章が混ざっても最初の { から最後の } までを読む。
function parsePlan(content) {
  const texts = content.filter((b) => b.type === "text").map((b) => b.text);
  for (let i = texts.length; i > 0; i--) {
    const t = texts.slice(i - 1).join("");
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a < 0 || b <= a) continue;
    try {
      const plan = JSON.parse(t.slice(a, b + 1));
      if (plan && Array.isArray(plan.steps) && plan.steps.length) return plan;
    } catch {}
  }
  return null;
}

function collectSources(content) {
  const seen = new Map();
  for (const b of content) {
    if (b.type !== "text" || !Array.isArray(b.citations)) continue;
    for (const c of b.citations) {
      if (c.url && !seen.has(c.url)) seen.set(c.url, c.title || c.url);
    }
  }
  return [...seen].slice(0, 6).map(([url, title]) => ({ url, title }));
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
