const { randomUUID } = require('crypto');
const rooms = new Map();
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const SOLIDS = [[-9,-8,2.5,1],[9,-8,2.5,1],[-9,8,2.5,1],[9,8,2.5,1],[0,-3,1.1,2],[0,4,1.1,2],[-14,0,1,2.5],[14,0,1,2.5],[-4,0,1.7,.55],[4,0,1.7,.55]];
function blocked(x,z,r=.42){if(x < -18.5+r || x > 18.5-r || z < -18.5+r || z > 18.5-r)return true;return SOLIDS.some(([cx,cz,hx,hz])=>Math.abs(x-cx)<hx+r&&Math.abs(z-cz)<hz+r);}
function send(ws, data) { if (ws.readyState === 1) ws.send(JSON.stringify(data)); }
function roomSnapshot(room, recipientId) {
  const players = [...room.players.values()];
  const recipient = room.players.get(recipientId);
  return { type: 'snapshot', room: room.code, selfId: recipientId, slot: recipient ? recipient.slot : 0, round: room.round, roundEndsAt: room.roundEndsAt, roundNotice: room.lastRoundNotice, players: players.map(p => ({ id: p.id, name: p.name, slot: p.slot, x: p.x, z: p.z, yaw: p.yaw, hp: p.hp, score: p.score, deaths: p.deaths, slowedUntil: p.slowedUntil })) };
}
function broadcast(room) {
  for (const p of room.players.values()) {
    if (p.ws.readyState === 1) p.ws.send(JSON.stringify(roomSnapshot(room, p.id)));
  }
}
function attachGameServer(wss) {
  wss.on('connection', ws => {
    let player = null; let room = null;
    ws.on('message', raw => {
      let msg; try { msg = JSON.parse(raw.toString()); } catch { return send(ws, { type: 'error', message: 'Invalid message' }); }
      if (msg.type === 'join') {
        const code = String(msg.room || 'QUICK').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12) || 'QUICK';
        room = rooms.get(code);
        if (!room) { room = { code, players: new Map(), round: 1, roundEndsAt: Date.now() + 180000, lastRoundNotice: '' }; rooms.set(code, room); }
        if (room.players.size >= 2) return send(ws, { type: 'error', message: 'Комната заполнена. Попробуй другой код.' });
        const slot = room.players.size + 1;
        const spawn = slot === 1 ? { x: -3.2, z: 14.8, yaw: Math.PI } : { x: 3.2, z: -14.8, yaw: 0 };
        player = { id: randomUUID(), ws, name: String(msg.name || 'Оперативник').slice(0, 18), slot, x: spawn.x, z: spawn.z, yaw: spawn.yaw, hp: 100, score: 0, deaths: 0, slowedUntil: 0, lastAction: 0 };
        room.players.set(player.id, player);
        send(ws, { type: 'joined', id: player.id, room: code, slot: player.slot, x: player.x, z: player.z, yaw: player.yaw, round: room.round, roundEndsAt: room.roundEndsAt });
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
        if (target.hp === 0) { player.score += 1; target.deaths += 1; }
        broadcast(room);
      } else if (msg.type === 'respawn') { player.hp = 100; player.x = player.slot === 1 ? -3.2 : 3.2; player.z = player.slot === 1 ? 14.8 : -14.8; player.yaw = player.slot === 1 ? Math.PI : 0; broadcast(room); }
    });
    ws.on('close', () => {
      if (player && room) { room.players.delete(player.id); broadcast(room); if (!room.players.size) rooms.delete(room.code); }
    });
  });
}
// Keep round clocks authoritative and synchronized for every player in a room.
const roundTicker = setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (now >= room.roundEndsAt) {
      const winner = [...room.players.values()].sort((a,b) => b.score - a.score)[0];
      room.lastRoundNotice = winner ? `Раунд ${room.round} завершён. Лидер: ${winner.name} (${winner.score})` : `Раунд ${room.round} завершён`;
      room.round += 1; room.roundEndsAt = now + 180000;
      for (const p of room.players.values()) { p.hp=100; p.x=p.slot===1?-3.2:3.2; p.z=p.slot===1?14.8:-14.8; p.yaw=p.slot===1?Math.PI:0; p.slowedUntil=0; }
    }
    broadcast(room);
  }
}, 500);
if (roundTicker.unref) roundTicker.unref();
module.exports = { attachGameServer };
