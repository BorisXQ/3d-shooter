const { randomUUID } = require('crypto');
const rooms = new Map();
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const SOLIDS = [[-9,-8,2.5,1],[9,-8,2.5,1],[-9,8,2.5,1],[9,8,2.5,1],[0,-3,1.1,2],[0,4,1.1,2],[-14,0,1,2.5],[14,0,1,2.5],[-4,0,1.7,.55],[4,0,1.7,.55]];
function blocked(x,z,r=.42){if(x < -33.5+r || x > 33.5-r || z < -33.5+r || z > 33.5-r)return true;return SOLIDS.some(([cx,cz,hx,hz])=>Math.abs(x-cx)<hx+r&&Math.abs(z-cz)<hz+r);}
function send(ws, data) { if (ws.readyState === 1) ws.send(JSON.stringify(data)); }
function roomSnapshot(room, recipientId) {
  const players = [...room.players.values()];
  const recipient = room.players.get(recipientId);
  return { type: 'snapshot', room: room.code, selfId: recipientId, slot: recipient ? recipient.slot : 0, round: room.round, maxRounds: room.maxRounds, roundState: room.roundState, roundEndsAt: room.roundEndsAt, intermissionEndsAt: room.intermissionEndsAt, roundNotice: room.lastRoundNotice, matchOver: room.matchOver, winnerId: room.winnerId || null, players: players.map(p => ({ id:p.id,name:p.name,slot:p.slot,x:p.x,z:p.z,yaw:p.yaw,hp:p.hp,score:p.score,kills:p.kills,deaths:p.deaths,roundWins:p.roundWins,roundKills:p.roundKills,points:p.points,slowedUntil:p.slowedUntil })) };
}
function broadcast(room) { for (const p of room.players.values()) send(p.ws, roomSnapshot(room,p.id)); }
function spawnFor(p) { return p.slot===1 ? {x:-3.2,z:29,yaw:Math.PI} : {x:3.2,z:-29,yaw:0}; }
function placeAtSpawn(p) { const s=spawnFor(p);p.x=s.x;p.z=s.z;p.yaw=s.yaw;p.hp=100;p.slowedUntil=0;p.respawnAt=0; }
function beginRound(room, now=Date.now()) { room.roundState='playing';room.roundEndsAt=now+180000;room.intermissionEndsAt=0;room.lastRoundNotice=`РАУНД ${room.round} / ${room.maxRounds} · БОЙ!`;for(const p of room.players.values()){placeAtSpawn(p);p.roundKills=0;} }
function finishRound(room, killer, victim=null, now=Date.now()) {
  if(room.roundState!=='playing') return;
  if(killer){killer.roundWins++;killer.roundKills++;killer.score++;killer.points+=100;}
  room.roundState='intermission';room.roundEndsAt=0;room.intermissionEndsAt=now+5000;
  room.lastRoundNotice = killer ? `РАУНД ${room.round}: ${killer.name} ПОЛУЧАЕТ ОЧКО` : `РАУНД ${room.round}: ВРЕМЯ · НИЧЬЯ`;
  for(const p of room.players.values())p.slowedUntil=0;
  if(victim)victim.hp=0;
}
function attachGameServer(wss) {
  wss.on('connection', ws => {
    let player=null, room=null;
    ws.on('message', raw => {
      let msg;try{msg=JSON.parse(raw.toString());}catch{return send(ws,{type:'error',message:'Invalid message'});}
      if(msg.type==='join'){
        const code=String(msg.room||'QUICK').toUpperCase().replace(/[^A-Z0-9-]/g,'').slice(0,12)||'QUICK';room=rooms.get(code);
        if(!room){room={code,players:new Map(),round:1,maxRounds:10,roundState:'waiting',roundEndsAt:0,intermissionEndsAt:0,lastRoundNotice:'ОЖИДАНИЕ СОПЕРНИКА',matchOver:false,winnerId:null};rooms.set(code,room);}
        if(room.players.size>=2)return send(ws,{type:'error',message:'Комната заполнена. Попробуй другой код.'});
        if(room.matchOver){room.players.clear();room.round=1;room.roundState='waiting';room.roundEndsAt=0;room.intermissionEndsAt=0;room.lastRoundNotice='';room.matchOver=false;room.winnerId=null;}
        const usedSlots=new Set([...room.players.values()].map(p=>p.slot));const slot=usedSlots.has(1)?2:1;const spawn=slot===1?{x:-3.2,z:29,yaw:Math.PI}:{x:3.2,z:-29,yaw:0};
        player={id:randomUUID(),ws,name:String(msg.name||'Оперативник').slice(0,18),slot,x:spawn.x,z:spawn.z,yaw:spawn.yaw,hp:100,score:0,points:0,kills:0,deaths:0,roundWins:0,roundKills:0,slowedUntil:0,lastAction:0};room.players.set(player.id,player);
        if(room.players.size===2 && room.roundState==='waiting')beginRound(room);
        send(ws,{type:'joined',id:player.id,room:code,slot:player.slot,x:player.x,z:player.z,yaw:player.yaw,round:room.round,roundEndsAt:room.roundEndsAt,roundState:room.roundState});broadcast(room);
      } else if(!player||!room)return;
      else if(msg.type==='state'){
        player.x=clamp(Number(msg.x)||0,-32,32);player.z=clamp(Number(msg.z)||0,-32,32);player.yaw=Number(msg.yaw)||0;broadcast(room);
      } else if(msg.type==='ability'&&msg.name==='slow'){
        if(room.roundState!=='playing'||player.hp<=0)return;const now=Date.now();if(now-player.lastAction<4000)return;player.lastAction=now;for(const other of room.players.values())if(other.id!==player.id)other.slowedUntil=now+1800;broadcast(room);send(ws,{type:'ability',name:'slow',cooldown:4000});
      } else if(msg.type==='hit'){
        if(room.roundState!=='playing'||room.matchOver||player.hp<=0)return;const target=room.players.get(String(msg.target));if(!target||target.id===player.id||target.hp<=0||Date.now()-player.lastAction<80)return;
        const requestedDamage=Number(msg.damage);const damage=Number.isFinite(requestedDamage)?Math.max(10,Math.min(55,requestedDamage)):25;target.hp=Math.max(0,target.hp-damage);player.lastAction=Date.now();
        if(target.hp===0){target.deaths++;player.kills++;finishRound(room,player,target);}
        broadcast(room);
      } else if(msg.type==='respawn'){
        // Respawning during a live round is forbidden. Both players return to their own spawn after the 5s break.
        if(room.roundState==='intermission' && Date.now()>=room.intermissionEndsAt)advanceRound(room,Date.now());
      }
    });
    ws.on('close',()=>{if(player&&room){room.players.delete(player.id);if(room.players.size<2&&!room.matchOver){room.roundState='waiting';room.roundEndsAt=0;room.intermissionEndsAt=0;room.lastRoundNotice='ОЖИДАНИЕ СОПЕРНИКА';for(const p of room.players.values())placeAtSpawn(p);}broadcast(room);if(!room.players.size)rooms.delete(room.code);}});
  });
}
function advanceRound(room, now) {
  if(room.round>=room.maxRounds){const players=[...room.players.values()].sort((a,b)=>b.roundWins-a.roundWins||b.points-a.points||b.kills-a.kills);const winner=players[0];room.matchOver=true;room.roundState='finished';room.winnerId=winner?.id||null;room.roundEndsAt=0;room.intermissionEndsAt=0;room.lastRoundNotice=winner?`МАТЧ ОКОНЧЕН · ПОБЕДИТЕЛЬ: ${winner.name} · ${winner.roundWins} : ${players.find(p=>p.id!==winner.id)?.roundWins||0} · ${winner.points} ОЧКОВ`:'МАТЧ ОКОНЧЕН · НИЧЬЯ';for(const p of room.players.values())p.hp=0;return;}
  room.round++;beginRound(room,now);
}
const ticker=setInterval(()=>{const now=Date.now();for(const room of rooms.values()){
  if(room.matchOver){broadcast(room);continue;}
  if(room.players.size<2){room.roundState='waiting';room.roundEndsAt=0;room.intermissionEndsAt=0;broadcast(room);continue;}
  if(room.roundState==='playing'&&now>=room.roundEndsAt)finishRound(room,null,null,now);
  else if(room.roundState==='intermission'&&now>=room.intermissionEndsAt)advanceRound(room,now);
  broadcast(room);
}},200);if(ticker.unref)ticker.unref();
module.exports={attachGameServer};
