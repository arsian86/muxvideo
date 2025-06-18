const { Mux } = require("@mux/mux-node");
const config = require("../config/index");
const { tokenId, tokenSecret, webhookSecret } = config.get("mux");
const logger = require("../config/logger");
const generateError = require("../utils/generateError");
const { getLatestSubscription } = require("../services/checkServices");
const AppDataSource = require("../db/data-source"); // 引入資料庫連線
const chapterRepo = AppDataSource.getRepository("Course_Chapter");
const planRepo = AppDataSource.getRepository("Plan");

const mux = new Mux({
  tokenId,
  tokenSecret,
  webhookSecret,
});

// 教練上傳影片
// <mux-uploader>是 Mux 官方的 Web Component，底層用 upchunk 實作「分段上傳」。最大 200GB
async function uploadVideo(req, res, next) {
  try {
    const chapterId = req.params.chapterId;

    // 從 Mux 取得一次性 upload URL
    const upload = await mux.video.uploads.create({
      cors_origin: "https://boston.zeabur.app", //必須跟前端的 CORS origin 相同
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
    const uploadId = evt.data.upload_id;
    const assetId = evt.data.id;
    if (evt.type === "video.asset.deleted") {
      // 查出這個 uploadId 對應哪個 chapter
      const chapter = await chapterRepo.findOneBy({ mux_asset_id: assetId });
      if (!chapter) return next(generateError(404, "找不到對應章節"));
      chapter.mux_asset_id = null;
      chapter.mux_playback_id = null;
      chapter.duration = null;
      chapter.video_created_at = null;
      chapter.resolution_tier = null;
      chapter.status = "deleted";
      await chapterRepo.save(chapter);
      logger.info({ chapter }, "webhook received，影片刪除成功");
      res.status(200).json({
        status: true,
        message: `${evt.type}, webhook received，影片刪除成功`,
        data: chapter,
      });
    }

    // 查出這個 uploadId 對應哪個 chapter
    const chapter = await chapterRepo.findOneBy({ mux_upload_id: uploadId });
    if (!chapter) return next(generateError(404, "找不到對應章節"));
    // 處理上傳完成的事件
    if (evt.type === "video.asset.ready") {
      console.log(evt);
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
      logger.info({ type: evt.type }, "webhook received，影片尚未建立完成");
      res.status(200).json({
        status: true,
        message: `${evt.type}, webhook received，影片尚未建立完成`,
        data: chapter,
      });
    }
  } catch (error) {
    logger.error({ error }, "webhook 處理失敗:");
    next(error);
  }
}

// 學員請求播放
async function getVideoPlayer(req, res, next) {
  try {
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
    const chapter = await chapterRepo.findOneBy({ id: chapterId });
    const playbackId = chapter.mux_playback_id;
    if (!playbackId) return next(generateError(404, "找不到對應播放 ID"));
    //取得此人有權限觀看的最大解析度
    const maxRes = plan.max_resolution + "p";
    //本地env跟部署到正式環境的env格式可能不同，確保 muxKeySecret 的格式正確
    let muxKeySecret = process.env.MUX_SIGNING_PRIVATE_KEY;
    // 移除可能的引號
    if (muxKeySecret.startsWith('"') && muxKeySecret.endsWith('"')) {
      muxKeySecret = muxKeySecret.slice(1, -1);
    }
    // 處理 \n 轉換為真實換行
    muxKeySecret = muxKeySecret.replace(/\\n/g, "\n");

    //製作mux播放token，防止未授權播放，並規定於6小時後過期
    let baseOptions = {
      keyId: process.env.MUX_SIGNING_KEY_ID,
      keySecret: muxKeySecret,
      expiration: "6h", // E.g 60, "2 days", "10h", "7d", numeric value interpreted as seconds
      //設定其他參數 Modify playback behavior
      //限制使用者可觀看的畫質，一起帶入token內，mux會自動解析
      params: {
        max_resolution: maxRes, // 480p, 720p, 1080p
      },
    };
    const token = await mux.jwt.signPlaybackId(playbackId, { ...baseOptions, type: "video" });

    //取得此人有權限觀看的最大解析度

    const streamUrl = `https://stream.mux.com/${playbackId}.m3u8?token=${token}`;
    const data = {
      streamUrl,
      chapterId,
      chapter_title: chapter.title,
      chapter_subtitle: chapter.subtitle,
      playbackId,
      max_resolution: maxRes,
      duration: chapter.duration,
      video_created_at: chapter.video_created_at,
    };
    console.log(data);
    res.status(200).json({
      status: true,
      message: "影片播放資訊已成功取得",
      data,
    });
  } catch (error) {
    logger.error({ error }, "取得影片播放資訊失敗:");
    next(error);
  }
}

module.exports = {
  uploadVideo,
  videoUploadCheck,
  getVideoPlayer,
};
