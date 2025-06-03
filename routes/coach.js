const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth");
const isCoach = require("../middlewares/isCoach");
const isSelf = require("../middlewares/isSelf");
const coachController = require("../controllers/coach");
const muxController = require("../controllers/mux");

//固定路由
//取得所有課程觀看資料，或依照輸入的課程id找對應課程
router.get("/courses/views", auth, isCoach, coachController.getCoachViewStats);
//Mux webhook回傳影片資訊
router.post(
  "/courses/video-upload-check",
  express.raw({ type: "application/json" }), // 保留 raw Buffer 給驗簽
  muxController.videoUploadCheck
);
//動態路由
router.patch("/:coachId", auth, isCoach, isSelf, coachController.patchProfile);

//教練上傳影片
router.post("/courses/:chapterId/video/v1/upload", auth, isCoach, muxController.uploadVideo);

module.exports = router;
