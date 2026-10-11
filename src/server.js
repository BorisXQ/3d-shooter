const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const { attachGameServer } = require('./game-server');

const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT) || 3000;
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, game: 'RIFT//ZERO', mode: 'multiplayer-beta', websocket: '/ws' }));
const threeBuildDir = path.dirname(require.resolve('three'));
app.get('/vendor/three.module.js', (_req, res) => res.sendFile(path.join(threeBuildDir, 'three.module.js')));
app.get('/vendor/three.core.js', (_req, res) => res.sendFile(path.join(threeBuildDir, 'three.core.js')));

const wss = new WebSocketServer({ server, path: '/ws' });
attachGameServer(wss);
server.listen(PORT, '0.0.0.0', () => console.log(`RIFT//ZERO listening on ${PORT}`));
