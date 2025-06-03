/**
 * utils/token.js
 * --------------
 * 封裝 `signPlayback()`：
 *   - 傳入 playbackId 與允許的最高畫質
 *   - 回傳可直接拼在 Mux HLS URL 後的 `token` 字串
 */
// utils/token.js
const { JWT } = require("@mux/mux-node");

function signPlayback(playbackId, maxRes = "720p") {
  // Mux 只看 keyId / keySecret 及 max_resolution；exp 設 30 分即可
  return JWT.sign(playbackId, {
    keyId: process.env.MUX_SIGNING_KEY_ID,
    keySecret: process.env.MUX_SIGNING_PRIVATE_KEY,
    exp: Math.floor(Date.now() / 1000) + 60 * 30, // 有效 30 分
    max_resolution: maxRes,
  });
}

module.exports = { signPlayback };
