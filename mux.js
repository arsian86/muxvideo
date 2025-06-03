const express = require("express"); // 引入 express 模組
const router = express.Router(); // 創建 express 路由
const dotenv = require("dotenv"); // 引入 dotenv 模組以便使用環境變數
dotenv.config(); // 載入環境變數
const { Mux } = require("@mux/mux-node");

const mux = new Mux({
  tokenId: process.env.MUX_TOKEN_ID,
  tokenSecret: process.env.MUX_TOKEN_SECRET,
  webhookSecret: process.env.MUX_WEBHOOK_SECRET,
});
const { signPlayback } = require("./utils/token");
const store = require("./utils/store"); // assetId ↔ playbackId 暫存

//產生一次性 direct‑upload URL
router.post("/video/v1/uploads", async (req, res) => {
  try {
    // 1) 從 Mux 取得一次性 upload URL
    const upload = await mux.video.uploads.create({
      cors_origin: process.env.FRONT_ORIGIN,
      new_asset_settings: {
        playback_policy: ["signed"],
        video_quality: "plus",
      },
    });
    // 2) 將 uploadUrl 與 uploadId 回傳給前端
    res.json({ uploadUrl: upload.url, uploadId: upload.id });
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
});

//webhook
router.post(
  "/webhook",
  express.raw({ type: "application/json" }), // <-- 保留 raw Buffer 給驗簽
  async (req, res) => {
    try {
      mux.webhooks.verifySignature(req.body.toString("utf8"), req.headers);
      console.log(req.headers["mux-signature"]);
    } catch (err) {
      console.log(req.headers["mux-signature"]);
      console.warn("webhook 驗簽失敗:", err.message);
      return res.sendStatus(400);
    }

    const evt = JSON.parse(req.body); // 驗簽通過後再 parse
    console.log("webhook received:", evt.type);

    // 只關心轉檔完成的事件，其它類型可按需擴充
    if (evt.type === "video.asset.ready") {
      const assetId = evt.data.id;
      // 建立 signed playbackId
      const playback = await mux.video.assets.createPlaybackId(assetId, {
        policy: "signed",
      });
      store.set(assetId, playback.id); // 暫存進 Map
      console.log("✔ asset.ready →", assetId, "→ playback", playback.id);
    }
    res.sendStatus(200);
  }
);

//學員請求播放
router.get("/video/v1/chapters/:chapterId/stream", async (req, res) => {
  const { plan } = req.user; // middleware 先解 JWT 取訂閱方案
  const chapter = await db.findChapter(req.params.chapterId);

  const maxResMap = { A: "720p", B: "1080p", C: "2160p" };
  const token = signPlayback(chapter.playbackId, maxResMap[plan]);

  const streamUrl = `https://stream.mux.com/${chapter.playbackId}.m3u8?token=${token}`;
  res.json({ streamUrl, title: chapter.title });
});

//依訂閱方案產生播放網址
//GET /stream/:assetId?plan=A
router.get("/stream/:assetId", (req, res) => {
  const { plan = "A" } = req.query;
  const playbackId = store.get(req.params.assetId);
  if (!playbackId) return res.status(404).json({ msg: "no asset" });

  const max = { A: "720p", B: "1080p", C: "2160p" }[plan];
  const token = signPlayback(playbackId, max);
  res.json({
    streamUrl: `https://stream.mux.com/${playbackId}.m3u8?token=${token}`,
  });
});

//測試用
router.get("/health", (req, res) => res.send("OK"));
router.get("/", (req, res) => {
  res.send("Mux demo server, routes: /video/v1/uploads, /webhook");
});

module.exports = router;
