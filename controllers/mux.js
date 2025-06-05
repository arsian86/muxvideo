const { Mux } = require("@mux/mux-node");
const config = require("../config/index");
const { tokenId, tokenSecret, webhookSecret } = config.get("mux");
const logger = require("../config/logger");
const generateError = require("../utils/generateError");
const AppDataSource = require("../db/data-source"); // 引入資料庫連線
const chapterRepo = AppDataSource.getRepository("Course_Chapter");
const planRepo = AppDataSource.getRepository("Plan");

const mux = new Mux({
  tokenId,
  tokenSecret,
  webhookSecret,
});

const { signPlayback } = require("../utils/mux");
const { getLatestSubscription } = require("../services/checkServices");

// 教練上傳影片
// <mux-uploader>是 Mux 官方的 Web Component，底層用 upchunk 實作「分段上傳」。最大 200GB
async function uploadVideo(req, res, next) {
  try {
    const chapterId = req.params.chapterId;
    // 從 Mux 取得一次性 upload URL
    const upload = await mux.video.uploads.create({
      cors_origin: "https://boston.zeabur.app",
      new_asset_settings: {
        playback_policy: ["signed"],
        video_quality: "plus",
      },
    });
    // 先存一筆暫時資料，記錄 uploadId 與 chapterId 的對應
    await chapterRepo.save({
      id: chapterId,
      mux_upload_id: upload.id,
      status: "uploading",
    });
    // 將 uploadUrl 與 uploadId 回傳給前端
    res.json({ uploadUrl: upload.url, uploadId: upload.id });
  } catch (error) {
    next(error);
  }
}

// webhook回傳影片信息，儲存資訊到資料庫
async function videoUploadCheck(req, res, next) {
  try {
    // 驗證這個 webhook 確實來自 Mux
    //req.body是物件格式，要轉成字串格式才能驗簽
    mux.webhooks.verifySignature(JSON.stringify(req.body), req.headers, webhookSecret);
    logger.info({ body: req.body, headers: req.headers }, "webhook 驗簽成功");
  } catch (error) {
    logger.warn({ body: req.body, headers: req.headers }, "webhook 驗簽失敗");
    return next(generateError(400, "webhook 驗簽失敗"));
  }
  // 驗簽通過後，繼續處理 webhook 事件
  try {
    const evt = req.body; // 驗簽通過後再 parse
    logger.info({ type: evt.type }, "webhook received:");
    // 處理上傳完成的事件
    if (evt.type === "video.asset.ready") {
      console.log(evt);
      const uploadId = evt.data.upload_id;
      const assetId = evt.data.id;
      // 查出這個 uploadId 對應哪個 chapter
      const chapter = await chapterRepo.findOneBy({ mux_upload_id: uploadId });
      if (!chapter) return next(generateError(404, "找不到對應章節"));
      const signedPlayback = evt.data.playback_ids.find((playback) => playback.policy === "signed");
      const signedPlaybackId = signedPlayback.id ? signedPlayback.id : null;
      if (!signedPlaybackId) return next(generateError(404, "找不到對應播放 ID"));
      chapter.mux_asset_id = assetId;
      chapter.mux_playback_id = signedPlaybackId;
      chapter.duration = evt.data.duration;
      chapter.video_created_at = new Date(evt.data.created_at * 1000);
      chapter.resolution_tier = evt.data.resolution_tier;
      chapter.status = "ready";
      await chapterRepo.save(chapter);
      console.log("影片上傳完成，儲存到資料庫:", chapter);
      res.status(200).json({
        status: true,
        message: "影片已成功上傳",
        data: chapter,
      });
    } else {
      logger.error({ error }, "影片尚未建立完成");
      return next(generateError(400, "影片尚未建立完成"));
    }
  } catch (error) {
    logger.error({ error }, "webhook 處理失敗:");
    next(error);
  }
}

// // 學員請求播放
async function getVideoPlayer(req, res, next) {
  // const chapterId = req.params.chapterId;
  // const userId = req.user.id;
  // //判斷訂閱是否有效
  // const hasActiveSubscription = req.user.hasActiveSubscription;
  // if (!hasActiveSubscription) {
  //   return next(generateError(403, "尚未訂閱或訂閱已失效，無可觀看課程類別"));
  // }
  // //取得此人最新的訂閱紀錄
  // const latestSubscription = await getLatestSubscription(userId);
  // const planId = latestSubscription.plan_id;
  // const plan = await planRepo.findOneBy({ id: planId });
  // const video = await videoRepo.findOneBy({ chapter_id: chapterId });
  // const playbackId = video.mux_playback_id;
  // if (!playbackId) return res.status(404).json({ msg: "no asset" });
  // const max = plan.max_resolution + "p";
  // const token = signPlayback(playbackId, max);
  // const streamUrl = `https://stream.mux.com/${playbackId}.m3u8?token=${token}`;
  // res.json({ streamUrl, title: video.title + " - " + video.subtitle });
}

module.exports = {
  uploadVideo,
  videoUploadCheck,
  getVideoPlayer,
};
