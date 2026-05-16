const http = require('http');
const Gun = require('gun');

// Railway/Render等のクラウド環境はPORT環境変数を自動で渡してくる
const PORT = process.env.PORT || 8765;

const server = http.createServer().listen(PORT, () => {
  console.log(`⚡ WIRER Relay Server running on port ${PORT}`);
});

// Gun.jsをHTTPサーバーにドッキング
const gun = Gun({
  web: server,
  // クラウド環境用: メモリ上にのみデータを保持（radata不要）
  radisk: false,
});

console.log(`🔗 Gun peer endpoint: http://localhost:${PORT}/gun`);