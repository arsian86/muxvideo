const express = require("express");
const app = express();
const cors = require("cors");
require("dotenv").config();

// 中介層設定
app.use(cors());
app.use(require("./mux"));
app.use(express.json());

// 讓瀏覽器能直接抓到html畫面
app.use(express.static("views"));

// 啟動伺服器
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`伺服器正在 http://localhost:${port} 上運作中`);
});
