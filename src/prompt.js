// 経路づくりの指示文。画面から届いた入力をもとに組み立てる。

export const SYSTEM = `あなたは日本の交通事情に詳しい旅程プランナーです。利用者の依頼から、経路と分単位のタイムスケジュールを作ります。

# 進め方
- web_search で、実際の路線・所要時間・発車時刻（乗換案内、鉄道会社やバス会社の時刻表）や営業時間を確認してから組み立てる。確認できた時刻はそのまま使い、確認できなかった部分は一般的な所要時間と運行間隔から推定して assumptions にそう書く。
- 到着時刻の指定があれば、そこから逆算して出発時刻を決める。
- 利用者の「移動のくせ」（歩く速さ、乗換に見込む時間、好きな手段、避けたいこと）は必ず反映し、どう反映したかを summary で一言伝える。
- 現在地の座標が届いたら、最寄り駅やバス停を割り出して出発点にする。
- 依頼があいまいなら、無理のない解釈を選んで assumptions に書く。質問で返さない。

# 出力
最後の返答は、次の形のJSONだけにする（前後に文章やコードフェンスを付けない）。
{
  "title": "出発地 → 経由地 → 行先 のような短い名前",
  "summary": "経路の要点を1〜2文で",
  "origin": "出発地（地図検索できる表記）",
  "destination": "最終目的地（地図検索できる表記）",
  "waypoints": ["経由地（地図検索できる表記）"],
  "date": "YYYY-MM-DD または null",
  "depart": "HH:MM",
  "arrive": "HH:MM",
  "slack_min": 到着希望時刻までの余裕（分、整数。遅れる場合は負。到着時刻の指定がなければ null）,
  "steps": [
    {"kind": "move", "start": "HH:MM", "end": "HH:MM", "from": "出発点", "to": "到着点", "mode": "電車|バス|徒歩|車|自転車|飛行機|新幹線|フェリー|タクシー", "line": "路線名・道路名など（なければ空文字）", "detail": "乗換口、何番線、料金などを短く"},
    {"kind": "stay", "start": "HH:MM", "end": "HH:MM", "place": "場所", "detail": "何をするか"},
    {"kind": "wait", "start": "HH:MM", "end": "HH:MM", "place": "場所", "detail": "乗換・待ち"}
  ],
  "tips": ["当日役立つ注意点を最大3つ"],
  "assumptions": ["推定した部分や解釈した前提を最大3つ"]
}
steps は時間順で隙間なくつなげる（前の end = 次の start）。乗換の待ち時間は wait にする。すべて日本語で書く。`;

const s = (v, max = 2000) => String(v ?? "").slice(0, max).trim();

function profileText(p = {}) {
  const list = (a) => (Array.isArray(a) && a.length ? a.map((x) => s(x, 60)).join("、") : "特になし");
  return [
    `- いつもの出発地: ${s(p.home, 200) || "未設定"}`,
    `- 歩く速さ: ${s(p.walk, 60) || "ふつう"}`,
    `- 乗換に見込む時間: ${s(p.xfer, 60) || "3分以上"}`,
    `- 好きな移動手段: ${list(p.like)}`,
    `- 避けたいこと: ${list(p.avoid)}`,
    `- そのほか: ${s(p.more, 500) || "なし"}`,
  ].join("\n");
}

function hereText(here) {
  if (!here) return "取得していない";
  const lines = [`緯度 ${Number(here.lat).toFixed(5)}, 経度 ${Number(here.lng).toFixed(5)}（誤差 約${Math.round(Number(here.accuracy) || 0)}m）`];
  if (here.address) lines.push(`住所の目安: ${s(here.address, 300)}`);
  return lines.join("\n");
}

function requestText(inp) {
  if (inp.imode === "free") return s(inp.free, 3000);
  const when = {
    now: "今すぐ出発する",
    depart: `${s(inp.date, 20)} ${s(inp.time, 10)} に出発する`,
    arrive: `${s(inp.date, 20)} ${s(inp.time, 10)} に行先へ着きたい`,
  }[inp.tmode] || "時刻の指定なし";
  const wps = Array.isArray(inp.wps) && inp.wps.length
    ? inp.wps.map((w, i) => `  ${i + 1}. ${s(w.name, 100)}（滞在 ${Number(w.min) || 0}分）`).join("\n")
    : "  なし";
  return [
    `- 出発地: ${s(inp.origin, 200) || "（未指定。現在地か、いつもの出発地を使う）"}`,
    `- 行先: ${s(inp.dest, 200)}`,
    `- 時刻: ${when}`,
    `- 経由地（この順に寄る）:\n${wps}`,
    `- 主な移動手段: ${s(inp.mode, 60)}`,
    `- 到着希望時刻の何分前に着きたいか: ${Number(inp.buffer) || 0}分`,
    `- その他: ${s(inp.notes, 1000) || "なし"}`,
  ].join("\n");
}

export function buildUserMessage({ input, profile, here, now, previous, refine }) {
  const parts = [
    `いまの日時: ${s(now, 40)}（日本時間）`,
    `# 現在地\n${hereText(here)}`,
    `# 利用者の移動のくせ\n${profileText(profile)}`,
    `# 依頼\n${requestText(input)}`,
  ];
  if (previous && refine) {
    parts.push(`# いまのスケジュール\n${JSON.stringify(previous).slice(0, 12000)}`);
    parts.push(`# 直してほしいこと\n${s(refine, 1000)}\nいまのスケジュールをこの依頼どおりに直し、全体を同じ形のJSONで返してください。`);
  }
  return parts.join("\n\n");
}
