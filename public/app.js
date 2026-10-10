(() => {
  const $ = (id) => document.getElementById(id);
  const STORE = "route-planner-draft-v2";
  const PROF = "route-planner-profile-v1";
  const PASS = "route-planner-pass";
  const get = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } };
  const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  // 最初に見せる例（作った結果ではないことを明示する）
  const EXAMPLE_PLAN = {
    example: true,
    title: "横浜駅 → 鶴岡八幡宮 → 長谷寺",
    summary: "JR横須賀線で鎌倉へ出て八幡宮に参拝し、江ノ電で長谷へ。到着希望の6分前に着きます。",
    origin: "横浜駅", destination: "長谷寺", waypoints: ["鶴岡八幡宮"],
    depart: "09:05", arrive: "10:54", slack_min: 6,
    steps: [
      { kind: "move", start: "09:05", end: "09:30", from: "横浜駅", to: "鎌倉駅", mode: "電車", line: "JR横須賀線（久里浜行）", detail: "乗換なし。鎌倉駅は東口へ。" },
      { kind: "move", start: "09:30", end: "09:45", from: "鎌倉駅", to: "鶴岡八幡宮", mode: "徒歩", line: "若宮大路・段葛", detail: "約1.2km。" },
      { kind: "stay", start: "09:45", end: "10:30", place: "鶴岡八幡宮", detail: "参拝・境内散策（45分）" },
      { kind: "move", start: "10:30", end: "10:42", from: "鶴岡八幡宮", to: "鎌倉駅", mode: "徒歩", line: "", detail: "江ノ電ホームは西口側。" },
      { kind: "wait", start: "10:42", end: "10:44", place: "鎌倉駅（江ノ電）", detail: "乗換・待ち" },
      { kind: "move", start: "10:44", end: "10:49", from: "鎌倉駅", to: "長谷駅", mode: "電車", line: "江ノ島電鉄線（藤沢行）", detail: "3駅。" },
      { kind: "move", start: "10:49", end: "10:54", from: "長谷駅", to: "長谷寺", mode: "徒歩", line: "", detail: "約400m。" }
    ],
    tips: ["これは画面の見本です。上の欄に行きたい場所を書いて「スケジュールを作る」を押してください。"]
  };

  let current = null, lastInput = null, ctl = null, here = null;

  // ---------- 入力のしかた ----------
  function syncMode() {
    const free = document.querySelector('input[name="imode"]:checked').value === "free";
    $("freeBox").hidden = !free; $("formBox").hidden = free;
    const now = document.querySelector('input[name="tmode"]:checked').value === "now";
    $("whenRow").hidden = now;
  }
  document.querySelectorAll('input[name="imode"], input[name="tmode"]').forEach((r) => r.addEventListener("change", syncMode));

  function wpRow(name = "", min = 30) {
    const row = document.createElement("div");
    row.className = "wp";
    const n = document.createElement("input");
    n.placeholder = "経由地の名前"; n.value = name; n.setAttribute("aria-label", "経由地");
    const mWrap = document.createElement("div"); mWrap.className = "min";
    const m = document.createElement("input");
    m.type = "number"; m.min = "0"; m.step = "5"; m.inputMode = "numeric"; m.value = String(min); m.setAttribute("aria-label", "滞在時間（分）");
    const unit = document.createElement("span"); unit.textContent = "分";
    mWrap.append(m, unit);
    const del = document.createElement("button");
    del.type = "button"; del.className = "icon-btn"; del.textContent = "×"; del.setAttribute("aria-label", "この経由地を削除");
    del.onclick = () => { row.remove(); save(); };
    row.append(n, mWrap, del);
    $("wps").append(row);
    return n;
  }
  $("addWp").onclick = () => wpRow().focus();

  function readForm() {
    return {
      imode: document.querySelector('input[name="imode"]:checked').value,
      free: $("free").value.trim(),
      origin: $("origin").value.trim(),
      dest: $("dest").value.trim(),
      tmode: document.querySelector('input[name="tmode"]:checked').value,
      date: $("date").value,
      time: $("time").value,
      wps: [...$("wps").children].map((r) => {
        const [n, m] = r.querySelectorAll("input");
        return { name: n.value.trim(), min: Math.max(0, parseInt(m.value, 10) || 0) };
      }).filter((w) => w.name),
      mode: $("mode").value,
      buffer: $("buffer").value,
      notes: $("notes").value.trim()
    };
  }
  function fillForm(v) {
    document.getElementById(v.imode === "form" ? "im-form" : "im-free").checked = true;
    document.getElementById("tm-" + (["now", "depart"].includes(v.tmode) ? v.tmode : "arrive")).checked = true;
    $("free").value = v.free || "";
    $("origin").value = v.origin || "";
    $("dest").value = v.dest || "";
    $("date").value = v.date || "";
    $("time").value = v.time || "";
    $("wps").innerHTML = "";
    (v.wps || []).forEach((w) => wpRow(w.name, w.min));
    if (v.mode) $("mode").value = v.mode;
    if (v.buffer != null) $("buffer").value = v.buffer;
    $("notes").value = v.notes || "";
    syncMode();
  }
  const save = () => put(STORE, { input: readForm(), plan: current, planInput: lastInput });
  $("form").addEventListener("input", save);
  $("form").addEventListener("change", save);

  // ---------- 個人設定 ----------
  const checked = (id) => [...$(id).querySelectorAll("input:checked")].map((c) => c.value);
  function readProfile() {
    return { home: $("pHome").value.trim(), walk: $("pWalk").value, xfer: $("pXfer").value,
      like: checked("pLike"), avoid: checked("pAvoid"), more: $("pMore").value.trim() };
  }
  function fillProfile(p) {
    $("pHome").value = p.home || "";
    if (p.walk) $("pWalk").value = p.walk;
    if (p.xfer) $("pXfer").value = p.xfer;
    $("pLike").querySelectorAll("input").forEach((c) => (c.checked = (p.like || []).includes(c.value)));
    $("pAvoid").querySelectorAll("input").forEach((c) => (c.checked = (p.avoid || []).includes(c.value)));
    $("pMore").value = p.more || "";
  }
  function profileSummary() {
    const p = readProfile();
    const bits = [p.home && "出発 " + p.home.split(/[（(]/)[0], "歩き" + p.walk.split("（")[0], "乗換" + p.xfer];
    if (p.like.length) bits.push("好き：" + p.like.map((x) => x.split("・")[0]).join("・"));
    $("profSum").textContent = bits.filter(Boolean).join("／");
  }
  const onProf = () => { put(PROF, readProfile()); put(PASS, $("pass").value); profileSummary(); };
  $("prof").addEventListener("input", onProf);
  $("prof").addEventListener("change", onProf);

  // ---------- 現在地 ----------
  function setHere(h) {
    here = h;
    $("hereBtn").classList.toggle("on", !!h);
    $("hereLabel").textContent = h ? "現在地から出発（取得済み）" : "現在地から出発";
    $("hereHint").textContent = h
      ? `誤差 約${Math.round(h.accuracy)}m。もう一度押すと解除します。`
      : "押すと位置情報の利用を確認されます。";
  }
  $("hereBtn").onclick = () => {
    if (here) { setHere(null); return; }
    if (!("geolocation" in navigator)) { $("hereHint").textContent = "この端末では現在地を使えません。"; return; }
    $("hereHint").textContent = "現在地を取得しています…";
    navigator.geolocation.getCurrentPosition(
      (pos) => setHere({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, at: Date.now() }),
      (err) => {
        setHere(null);
        $("hereHint").textContent = err.code === 1
          ? "位置情報が許可されていません。端末の設定でこのアプリ（またはブラウザ）に位置情報を許可してください。"
          : "現在地を取得できませんでした。屋外や窓際でもう一度お試しください。";
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  };

  // ---------- 時刻ユーティリティ ----------
  const toMin = (hm) => { const m = /^(\d{1,2}):(\d{2})/.exec(hm || ""); return m ? (+m[1]) * 60 + (+m[2]) : null; };
  function span(a, b) {
    const x = toMin(a), y = toMin(b);
    if (x == null || y == null) return "";
    let d = y - x; if (d < 0) d += 1440;
    return d >= 60 ? `${Math.floor(d / 60)}時間${d % 60 ? (d % 60) + "分" : ""}` : `${d}分`;
  }
  function dateLabel(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
    const d = new Date(iso + "T00:00:00"); const [, m, dd] = iso.split("-");
    return `${+m}月${+dd}日（${"日月火水木金土"[d.getDay()]}）`;
  }

  // ---------- 描画 ----------
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function mapsUrl(plan, inp) {
    const dest = plan.destination || (inp && inp.dest);
    if (!dest) return null;
    const p = new URLSearchParams({ api: "1", destination: dest });
    if (plan.origin) p.set("origin", plan.origin);
    if (Array.isArray(plan.waypoints) && plan.waypoints.length) p.set("waypoints", plan.waypoints.map(String).join("|"));
    const tm = { "車": "driving", "徒歩": "walking", "自転車": "bicycling" }[inp && inp.mode] || "transit";
    p.set("travelmode", tm);
    return "https://www.google.com/maps/dir/?" + p.toString();
  }

  function asText(plan) {
    const lines = [`${plan.title}${plan.date ? "　" + dateLabel(plan.date) : ""}`, `出発 ${plan.depart} → 到着 ${plan.arrive}`, ""];
    for (const s of plan.steps || []) {
      const head = s.kind === "move" ? `${s.from} → ${s.to}（${[s.mode, s.line].filter(Boolean).join("・")}）` : `${s.place}${s.kind === "wait" ? "（待ち）" : ""}`;
      lines.push(`${s.start}–${s.end}　${head}`);
      if (s.detail) lines.push(`　　${s.detail}`);
    }
    if (plan.tips && plan.tips.length) { lines.push(""); plan.tips.forEach((t) => lines.push("・" + t)); }
    return lines.join("\n");
  }

  function render(plan, inp) {
    const b = $("board"); b.innerHTML = "";
    const head = el("div", "board-head");
    if (plan.example) head.append(el("span", "tag", "見本"));
    else if (plan.date) head.append(el("span", "tag", dateLabel(plan.date)));
    head.append(el("h2", null, plan.title || "タイムスケジュール"));
    if (plan.summary) head.append(el("p", null, plan.summary));
    if (plan.here_address) head.append(el("p", "hint", "現在地：" + plan.here_address));

    const kpis = el("div", "kpis");
    const kpi = (v, l, warn) => { const k = el("div", "kpi" + (warn ? " warn" : "")); k.append(el("b", null, v), el("span", null, l)); kpis.append(k); };
    kpi(plan.depart || "--:--", "出発");
    kpi(plan.arrive || "--:--", "到着");
    kpi(span(plan.depart, plan.arrive) || "-", "所要");
    if (typeof plan.slack_min === "number") kpi(plan.slack_min >= 0 ? `${plan.slack_min}分` : `${-plan.slack_min}分遅れ`, "希望時刻までの余裕", plan.slack_min < 0);
    head.append(kpis);
    b.append(head);

    const ol = el("ol", "tl");
    for (const s of plan.steps || []) {
      const kind = ["move", "stay", "wait"].includes(s.kind) ? s.kind : "move";
      const li = el("li", "step " + kind);
      const t = el("div", "t", s.start || "");
      if (s.end && s.end !== s.start) t.append(el("small", null, s.end));
      const rail = el("div", "rail"); rail.append(el("span", "dot"));
      const body = el("div", "body");
      body.append(el("div", "what", kind === "move" ? `${s.from || ""} → ${s.to || ""}` : (s.place || "")));
      const meta = el("div", "meta");
      meta.append(el("span", "chip mode", kind === "move" ? (s.mode || "移動") : kind === "stay" ? "滞在" : "待ち"));
      if (s.line) meta.append(el("span", "chip", s.line));
      const d = span(s.start, s.end); if (d) meta.append(el("span", "dur", d));
      body.append(meta);
      if (s.detail) body.append(el("p", "detail", s.detail));
      li.append(t, rail, body);
      ol.append(li);
    }
    b.append(ol);

    const notes = [...(plan.tips || []), ...(plan.assumptions || [])];
    if (notes.length) {
      const n = el("div", "notes");
      n.append(el("h3", null, "注意点・前提"));
      const ul = el("ul"); notes.forEach((x) => ul.append(el("li", null, x))); n.append(ul);
      b.append(n);
    }
    if (plan.sources && plan.sources.length) {
      const n = el("div", "notes sources");
      n.append(el("h3", null, "調べた情報"));
      const ul = el("ul");
      plan.sources.forEach((s) => { const li = el("li"); const a = el("a", null, s.title || s.url); a.href = s.url; a.target = "_blank"; a.rel = "noopener"; li.append(a); ul.append(li); });
      n.append(ul); b.append(n);
    }

    const tools = el("div", "tools");
    const copy = el("button", null, "テキストでコピー"); copy.type = "button";
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(asText(plan)); copy.textContent = "コピーしました"; }
      catch (e) { copy.textContent = "コピーできませんでした"; }
      setTimeout(() => (copy.textContent = "テキストでコピー"), 2500);
    };
    tools.append(copy);
    if (navigator.share) {
      const sh = el("button", null, "共有"); sh.type = "button";
      sh.onclick = () => navigator.share({ title: plan.title, text: asText(plan) }).catch(() => {});
      tools.append(sh);
    }
    const url = mapsUrl(plan, inp);
    if (url) { const a = el("a", null, "地図で経路を見る ↗"); a.href = url; a.target = "_blank"; a.rel = "noopener"; tools.append(a); }
    b.append(tools);
    $("refineBox").hidden = !!plan.example;
  }

  let timer = null;
  function showStatus(msg) {
    const b = $("board"); b.innerHTML = "";
    const s = el("div", "status");
    const sec = el("span", "elapsed", "0秒");
    s.append(el("span", "spinner"), el("span", null, msg), sec);
    b.append(s);
    const t0 = Date.now();
    clearInterval(timer);
    timer = setInterval(() => (sec.textContent = Math.round((Date.now() - t0) / 1000) + "秒"), 1000);
  }

  // ---------- サーバーへの依頼 ----------
  async function run(extra) {
    const inp = extra.input;
    ctl?.abort();
    ctl = new AbortController();
    const prev = current, prevInp = lastInput;
    $("formErr").hidden = true;
    $("go").disabled = true; $("refineGo").disabled = true; $("stop").hidden = false;
    showStatus("時刻表や乗換を調べながら経路を作っています（1〜2分かかります）");
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        signal: ctl.signal,
        headers: { "content-type": "application/json", "x-passcode": $("pass").value },
        body: JSON.stringify({ input: inp, profile: readProfile(), here, ...extra.more })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.plan) {
        if (data.code === "passcode") $("prof").open = true;
        throw new Error(data.error || "経路を作れませんでした。もう一度お試しください。");
      }
      current = data.plan; lastInput = inp;
      render(current, lastInput);
      save();
      return true;
    } catch (e) {
      if (prev) render(prev, prevInp); else $("board").innerHTML = "";
      if (e.name === "AbortError") return false;
      $("formErr").textContent = navigator.onLine === false ? "ネットにつながっていません。" : e.message;
      $("formErr").hidden = false;
      return false;
    } finally {
      clearInterval(timer);
      $("go").disabled = false; $("refineGo").disabled = false; $("stop").hidden = true;
    }
  }

  $("stop").onclick = () => ctl?.abort();

  $("form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const inp = readForm();
    const err = (msg, focus) => { $("formErr").textContent = msg; $("formErr").hidden = false; $(focus).focus(); };
    if (inp.imode === "free" && !inp.free) return err("行きたい場所と時間を書いてください。", "free");
    if (inp.imode === "form" && !inp.dest) return err("行先を入れてください。", "dest");
    run({ input: inp });
  });

  $("refineGo").onclick = async () => {
    const ask = $("refine").value.trim();
    if (!ask || !current || current.example) return;
    const previous = { ...current }; delete previous.sources; delete previous.here_address;
    if (await run({ input: lastInput || readForm(), more: { previous, refine: ask } })) $("refine").value = "";
  };
  $("refine").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); $("refineGo").click(); } });

  // ---------- 起動 ----------
  const p = get(PROF); if (p) fillProfile(p);
  $("pass").value = get(PASS) || "";
  profileSummary();
  const saved = get(STORE);
  if (saved && saved.input) fillForm(saved.input); else syncMode();
  if (saved && saved.plan && Array.isArray(saved.plan.steps)) { current = saved.plan; lastInput = saved.planInput; }
  else { current = EXAMPLE_PLAN; lastInput = null; }
  render(current, lastInput);
  if (!$("pass").value) $("prof").open = true;

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
})();
