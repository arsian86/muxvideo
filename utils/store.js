// 用 Map 暫存 { assetId → playbackId }；之後可替換為 DB
const m = new Map(); // key: assetId, value: playbackId
module.exports = m;
