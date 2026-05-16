const http = require('http');
const Gun = require('gun');

const PORT = process.env.PORT || 8765;

const server = http.createServer().listen(PORT, () => {
  console.log(`⚡ WIRER Relay Server running on port ${PORT}`);
});

const gun = Gun({
  web: server,
  radisk: false,
});

console.log(`🔗 Gun peer endpoint available at /gun`);
