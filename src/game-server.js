const { randomUUID } = require('crypto');
const rooms = new Map();
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const SOLIDS = [[-9,-8,2.5,1],[9,-8,2.5,1],[-9,8,2.5,1],[9,8,2.5,1],[0,-3,1.1,2],[0,4,1.1,2],[-14,0,1,2.5],[14,0,1,2.5],[-4,0,1.7,.55],[4,0,1.7,.55]];
function blocked(x,z,r=.42){if(x < -18.5+r || x > 18.5-r || z < -18.5+r || z > 18.5-r)return true;return SOLIDS.some(([cx,cz,hx,hz])=>Math.abs(x-cx)<hx+r&&Math.abs(z-cz)<hz+r);}
function send(ws, data) { if (ws.readyState === 1) ws.send(JSON.stringify(data)); }
function roomSnapshot(room) {
  return { type: 'snapshot', room: room.code, players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, x: p.x, z: p.z, yaw: p.yaw, hp: p.hp, score: p.score, slowedUntil: p.slowedUntil })) };
}
function broadcast(room) { const packet = JSON.stringify(roomSnapshot(room)); for (const p of room.players.values()) if (p.ws.readyState === 1) p.ws.send(packet); }
function attachGameServer(wss) {
  wss.on('connection', ws => {
    let player = null; let room = null;
    ws.on('message', raw => {
      let msg; try { msg = JSON.parse(raw.toString()); } catch { return send(ws, { type: 'error', message: 'Invalid message' }); }
      if (msg.type === 'join') {
        const code = String(msg.room || 'QUICK').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12) || 'QUICK';
        room = rooms.get(code);
        if (!room) { room = { code, players: new Map() }; rooms.set(code, room); }
        if (room.players.size >= 2) return send(ws, { type: 'error', message: 'Комната заполнена. Попробуй другой код.' });
        player = { id: randomUUID(), ws, name: String(msg.name || 'Оперативник').slice(0, 18), x: 0, z: room.players.size ? -14.8 : 14.8, yaw: room.players.size ? 0 : Math.PI, hp: 100, score: 0, slowedUntil: 0, lastAction: 0 };
        room.players.set(player.id, player);
        send(ws, { type: 'joined', id: player.id, room: code, slot: room.players.size });
        broadcast(room);
      } else if (!player || !room) return;
      else if (msg.type === 'state') {
        player.x = clamp(Number(msg.x) || 0, -17, 17); player.z = clamp(Number(msg.z) || 0, -17, 17); player.yaw = Number(msg.yaw) || 0;
        broadcast(room);
      } else if (msg.type === 'ability' && msg.name === 'slow') {
        const now = Date.now(); if (now - player.lastAction < 4000) return;
        player.lastAction = now;
        for (const other of room.players.values()) if (other.id !== player.id) other.slowedUntil = now + 1800;
        broadcast(room);
        send(ws, { type: 'ability', name: 'slow', cooldown: 4000 });
      } else if (msg.type === 'hit') {
        const target = room.players.get(String(msg.target));
        if (!target || target.id === player.id || player.hp<=0 || target.hp<=0 || Date.now() - player.lastAction < 100) return;
        const requestedDamage = Number(msg.damage); const damage = Number.isFinite(requestedDamage) ? Math.max(10, Math.min(55, requestedDamage)) : 25;
        target.hp = Math.max(0, target.hp - damage); player.lastAction = Date.now();
        if (target.hp === 0) player.score += 1;
        broadcast(room);
      } else if (msg.type === 'respawn') { player.hp = 100; player.x = 0; player.z = player.z < 0 ? -14.8 : 14.8; broadcast(room); }
    });
    ws.on('close', () => {
      if (player && room) { room.players.delete(player.id); broadcast(room); if (!room.players.size) rooms.delete(room.code); }
    });
  });
}
module.exports = { attachGameServer };
