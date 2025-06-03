const { Mux } = require("@mux/mux-node");
const config = require("../config/index");
const { tokenId, tokenSecret, webhookSecret } = config.get("mux");
const AppDataSource = require("../db/data-source"); // 引入資料庫連線
const videoRepo = AppDataSource.getRepository("Course_Video");
const planRepo = AppDataSource.getRepository("Plan");

const mux = new Mux({
  tokenId,
  tokenSecret,
  webhookSecret,
});

const { signPlayback } = require("./utils/token");
const { getLatestSubscription } = require("../services/checkServices");

async function uploadVideo(req, res, next) {
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
}

// webhook回傳影片信息，儲存資訊到資料庫
async function videoUploadCheck(req, res, next) {
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
    //將assetId 與 playbackId存入course_video表
    const newVideo = await videoRepo.create({
      mux_asset_id: assetId,
      mux_playback_id: playback.id,
    });
    const data = await videoRepo.save(newVideo);

    console.log("✔ asset.ready →", assetId, "→ playback", playback.id);
  }
  res.sendStatus(200);
}

// 學員請求播放
async function getVideoPlayer(req, res, next) {
  const chapterId = req.params.chapterId;
  const userId = req.user.id;
  //判斷訂閱是否有效
  const hasActiveSubscription = req.user.hasActiveSubscription;
  if (!hasActiveSubscription) {
    return next(generateError(403, "尚未訂閱或訂閱已失效，無可觀看課程類別"));
  }
  //取得此人最新的訂閱紀錄
  const latestSubscription = await getLatestSubscription(userId);
  const planId = latestSubscription.plan_id;
  const plan = await planRepo.findOneBy({ id: planId });

  const video = await videoRepo.findOneBy({ chapter_id: chapterId });
  const playbackId = video.mux_playback_id;
  if (!playbackId) return res.status(404).json({ msg: "no asset" });
  const max = plan.max_resolution + "p";
  const token = signPlayback(playbackId, max);
  const streamUrl = `https://stream.mux.com/${playbackId}.m3u8?token=${token}`;
  res.json({ streamUrl, title: video.title + " - " + video.subtitle });
}

module.exports = {
  uploadVideo,
  videoUploadCheck,
  getVideoPlayer,
};
