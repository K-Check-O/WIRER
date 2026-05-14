const http = require('http');
const Gun = require('gun');

// 8765ポートで空のHTTPサーバーを建てる
const server = http.createServer().listen(8765);

// そのサーバーにGun.jsをドッキングする
const gun = Gun({ web: server });

console.log('⚡ WIRER Relay Server running on http://localhost:8765/gun');