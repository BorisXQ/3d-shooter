import * as THREE from 'three';

const $ = id => document.getElementById(id);
const menu = $('menu'), game = $('game'), statusEl = $('menuStatus'), toast = $('toast');
let renderer, scene, camera, clock, ws = null, online = false, myId = null, roomName = '—';
let running = false, paused = false, pointerLocked = false, botMode = false, dead = false, deathAt = 0, lastShotAt = 0, weaponKick = 0, walkPhase = 0;
let yaw = 0, pitch = 0, spawnSide = 1, hp = 100, score = 0, slowReadyAt = 0, dashReadyAt = 0, lastNetSend = 0;
let jumpHeight = 0, jumpVelocity = 0, weaponType = 1, sidearm = null, rifle = null;
let fireHeld=false, aimHeld=false, ammo=30, reserveAmmo=120, reloadUntil=0, lastMouseMoveAt=0, ignoreNextMouseMove=true, baseFov=76, shotCounter=0;
const keys = new Set(); const remotes = new Map(); const colliders = []; const raycaster = new THREE.Raycaster();
const player = { x: 0, z: 7, y: 1.65, speed: 5.2 };
let weapon, bot, botRoot, muzzleFlash, slowUntil = 0, slowVisualUntil = 0, deathOverlay;
const ARENA_SOLIDS = [ [-9,-8,2.5,1], [9,-8,2.5,1], [-9,8,2.5,1], [9,8,2.5,1], [0,-3,1.1,2], [0,4,1.1,2], [-14,0,1,2.5], [14,0,1,2.5], [-4,0,1.7,.55], [4,0,1.7,.55] ];
const mat = (color, roughness=0.9) => new THREE.MeshStandardMaterial({color, roughness});
// Small procedural textures keep the arena detailed without downloading image assets.
function patternTexture(kind, base, detailColor, repeatX=4, repeatY=4) {
  const c=document.createElement('canvas'); c.width=256; c.height=256;
  const ctx=c.getContext('2d'); ctx.fillStyle=base; ctx.fillRect(0,0,256,256);
  let seed=kind==='brick'?17:kind==='asphalt'?41:kind==='concrete'?73:97;
  const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  if(kind==='brick'){
    const rowH=32, brickW=64;
    for(let y=0,row=0;y<256;y+=rowH,row++){
      ctx.fillStyle=detailColor;ctx.fillRect(0,y,256,3);
      for(let x=(row%2? -brickW/2:0);x<256;x+=brickW){ctx.fillStyle=detailColor;ctx.fillRect(x,y,3,rowH);}
      for(let i=0;i<110;i++){const x=rand()*256, yy=y+rand()*rowH;ctx.fillStyle=rand()>.5?'rgba(255,220,190,.07)':'rgba(30,12,8,.08)';ctx.fillRect(x,yy,rand()*18+2,1+rand()*3);}
    }
  } else if(kind==='asphalt'){
    for(let i=0;i<2400;i++){const v=rand()>.5?255:0;ctx.fillStyle=`rgba(${v},${v},${v},${rand()*.12})`;const r=rand()*2+.3;ctx.fillRect(rand()*256,rand()*256,r,r);}
    for(let i=0;i<18;i++){ctx.strokeStyle='rgba(220,220,200,.08)';ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(rand()*256,rand()*256);ctx.lineTo(rand()*256,rand()*256);ctx.stroke();}
  } else if(kind==='concrete'){
    for(let i=0;i<600;i++){ctx.fillStyle=rand()>.5?'rgba(255,255,255,.06)':'rgba(0,0,0,.06)';ctx.fillRect(rand()*256,rand()*256,rand()*14+1,rand()*3+1);}
  } else {
    for(let i=0;i<1200;i++){ctx.fillStyle=rand()>.5?'rgba(255,255,255,.08)':'rgba(0,0,0,.09)';ctx.fillRect(rand()*256,rand()*256,1+rand()*2,1+rand()*5);}
  }
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(repeatX,repeatY);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=2;return t;
}
function texturedMat(color, texture, roughness=.9){return new THREE.MeshStandardMaterial({color,map:texture,roughness});}

function createRenderer() {
  renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25)); renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  scene = new THREE.Scene(); scene.background = new THREE.Color(0x83c8f2); scene.fog = new THREE.Fog(0x83c8f2, 34, 72);
  camera = new THREE.PerspectiveCamera(76, window.innerWidth/window.innerHeight, .1, 100); camera.rotation.order = 'YXZ'; baseFov=76;
  // Camera-mounted first-person weapon meshes must be part of the rendered scene graph.
  scene.add(camera);
  clock = new THREE.Clock();
  scene.add(new THREE.HemisphereLight(0xc8d2d0, 0x272b2c, 2.1));
  const sun = new THREE.DirectionalLight(0xffe5c5, 2.5); sun.position.set(-8, 16, 8); sun.castShadow = true; sun.shadow.mapSize.set(1024,1024); scene.add(sun);
}
function box(x,y,z,sx,sy,sz,material,solid=true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx,sy,sz),material); mesh.position.set(x,y,z); mesh.castShadow=true; mesh.receiveShadow=true; scene.add(mesh);
  if (solid) colliders.push({x,z,hx:sx/2,hz:sz/2,hy:sy/2,y,mesh}); return mesh;
}
function buildArena() {
  colliders.length=0;
  const brick= texturedMat(0xffffff,patternTexture('brick','#a75e48','#593b32',3,2)), brickLight=mat(0xc78369), concrete=texturedMat(0xffffff,patternTexture('concrete','#858b8d','#858b8d',2,2)), dark=mat(0x454d52), asphalt=texturedMat(0xffffff,patternTexture('asphalt','#30383d','#30383d',5,5)), mark=mat(0xe6d7a7), metal=mat(0x364b5a), blue=mat(0x287e9c), deck=texturedMat(0xffffff,patternTexture('metal','#64737a','#64737a',2,2)), grass=texturedMat(0xffffff,patternTexture('grass','#477b43','#477b43',3,3)), sand=mat(0x9a8a65), yellow=mat(0xe2b84f), cyan=new THREE.MeshStandardMaterial({color:0x53d6e5,emissive:0x12606b,emissiveIntensity:.45});
  const detail=(x,y,z,sx,sy,sz,m)=>{const o=box(x,y,z,sx,sy,sz,m,false);o.castShadow=false;o.receiveShadow=false;return o;};
  // Blue sky, asphalt combat lanes and grassy shoulders.
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(40,40),asphalt);ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;scene.add(ground);
  for(const side of [-1,1]){const lawn=new THREE.Mesh(new THREE.PlaneGeometry(7,36),grass);lawn.rotation.x=-Math.PI/2;lawn.position.set(side*15.9,.012,0);lawn.receiveShadow=true;scene.add(lawn);}
  for(const z of [-8,-4,0,4,8])detail(0,.025,z,7,.018,.06,mark);
  for(let z=-17;z<=17;z+=4){detail(-8,.024,z,.05,.018,1.4,concrete);detail(8,.024,z,.05,.018,1.4,concrete);}
  // Brick perimeter with lightweight mortar courses.
  box(0,2,-19,40,4,1,brick);box(0,2,19,40,4,1,brick);box(-19,2,0,1,4,40,brick);box(19,2,0,1,4,40,brick);
  for(const z of [-18.47,18.47]){for(let y=.55;y<3.8;y+=.52)detail(0,y,z,37,.025,.018,brickLight);for(let x=-18;x<=18;x+=1.5)detail(x,1,z,.025,.9,.02,dark);}
  for(const x of [-18.47,18.47]){for(let y=.55;y<3.8;y+=.52)detail(x,y,0,.018,.025,37,brickLight);for(let z=-18;z<=18;z+=1.5)detail(x,1,z,.02,.9,.025,dark);}
  // Fixed spawn rooms. Two offset exits per side; chicane walls block immediate sightlines.
  for(const side of [-1,1]){
    const z0=side*14.2;box(-16.8,1.8,z0,.42,3.6,9.6,brick);box(16.8,1.8,z0,.42,3.6,9.6,brick);
    const wz=side*9.35;box(-15.5,1.8,wz,7,3.6,.55,brick);box(0,1.8,wz,12,3.6,.55,brick);box(15.5,1.8,wz,7,3.6,.55,brick);
    box(-10.7,1.65,side*7.25,.55,3.3,4.1,dark);box(-8.4,1.65,side*5.3,4.5,3.3,.55,brick);
    box(10.7,1.65,side*7.25,.55,3.3,4.1,dark);box(8.4,1.65,side*5.3,4.5,3.3,.55,brick);
    box(-4.1,.85,side*14.3,3,1.7,1,dark);box(4.1,.85,side*14.3,3,1.7,1,dark);detail(0,3.3,side*18.25,5.8,.12,.18,metal);
    for(const x of [-12,-8,8,12]){detail(x,3.05,side*18.3,.65,.1,.12,cyan);detail(x,2.83,side*18.3,.45,.035,.12,yellow);}
    for(let y=.45;y<3.4;y+=.5){detail(-16.55,y,z0,.025,.025,8.9,brickLight);detail(16.55,y,z0,.025,.025,8.9,brickLight);}
  }
  // Clean MID: one readable central lane, low cover, and two wide elevated side routes.
  // Keep the main approach open so players can cross without weaving through clutter.
  box(-4.4,.55,0,1.0,1.1,3.8,concrete);
  box(4.4,.55,0,1.0,1.1,3.8,concrete);
  box(0,.55,-4.1,3.4,1.1,.75,dark);
  box(0,.55,4.1,3.4,1.1,.75,dark);
  // Central landmark: low enough to preserve sightline choices without blocking movement.
  box(0,.48,0,1.8,.96,1.8,metal);
  detail(0,.98,0,1.62,.035,1.62,yellow);
  // Two broad, four-step climbs on the left and right. Each step is wide and aligned.
  for(const side of [-1,1]){
    for(let i=0;i<4;i++){
      const h=.42*(i+1), x=side*(2.7+i*.88);
      box(x,h/2,side*-.15,1.05,h,3.6,i%2?deck:concrete);
      detail(x,h+.018,side*-.15,1.0,.025,3.48,yellow);
    }
    // Raised overlook decks sit beside, not across, the main route.
    box(side*7.2,1.68,0,2.8,.36,4.2,deck);
    detail(side*7.2,1.88,0,2.68,.035,4.05,yellow);
    // Simple side-lane cover: two pieces per side, leaving a continuous walkable path.
    box(side*11.2,.62,-3.3,1.1,1.24,2.0,brick);
    box(side*11.2,.62,3.3,1.1,1.24,2.0,concrete);
    detail(side*11.2,1.27,-3.3,.92,.04,1.8,yellow);
  }
  for(const [x,z] of [[-15,-15],[15,-15],[-15,15],[15,15]]){box(x,.9,z,1.7,1.8,1.7,dark);detail(x,1.86,z,1.25,.12,1.25,metal);detail(x,2.2,z-.86,.6,.08,.05,cyan);}
  for(const side of [-1,1])for(const z of [-16.8,-12.8,12.8,16.8])detail(side*17.3,2.6,z,.06,.06,1.3,yellow);
  // Architectural dressing: warm wall sconces, low route lights, painted lane arrows and center signage.
  for(const side of [-1,1]){
    for(const z of [-12,-7,7,12]){
      box(side*16.35,2.75,z,.12,.72,.28,dark,false);
      const lamp=box(side*16.27,2.78,z,.055,.42,.13,side===1?yellow:cyan,false);lamp.material.emissive=side===1?new THREE.Color(0x6a3710):new THREE.Color(0x064c59);lamp.material.emissiveIntensity=.45;lamp.castShadow=false;
    }
    // Double yellow edge lines guide players toward MID without exposing spawn sightlines.
    detail(side*2.2,.03,-8,.055,.02,7,mark);detail(side*2.2,.03,8,.055,.02,7,mark);
  }
  // Center platform has restrained accent trim rather than a rainbow palette.
  for(const x of [-1.65,1.65]){detail(x,2.46,0,.045,.035,3.05,yellow);}
  for(const z of [-1.65,1.65]){detail(0,2.46,z,3.05,.035,.045,yellow);}
  const glow=new THREE.PointLight(0x3dcde0,.8,15);glow.position.set(0,4.2,0);scene.add(glow);const warm=new THREE.PointLight(0xffc16d,.35,8);warm.position.set(-13,2.2,-13);scene.add(warm);
}
function makeCharacter(color, name) {
  const root=new THREE.Group();
  const uniform=mat(color,.72), dark=mat(0x242b2d,.55), skin=mat(0xb6a18b,.8), boot=mat(0x171b1c,.8), visor=mat(0x1d2a2c,.25);
  const part=(geo,material,x,y,z,parent=root)=>{const m=new THREE.Mesh(geo,material);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;};
  part(new THREE.CapsuleGeometry(.29,.58,5,10),uniform,0,1.03,0);
  part(new THREE.BoxGeometry(.58,.38,.3),dark,0,1.1,-.015);
  part(new THREE.BoxGeometry(.2,.12,.08),mat(0xc0b26b,.5),0,1.17,-.18);
  const head=part(new THREE.SphereGeometry(.205,16,12),skin,0,1.68,0);
  part(new THREE.SphereGeometry(.21,16,10,0,Math.PI*2,0,Math.PI*.52),dark,0,1.72,0);
  part(new THREE.BoxGeometry(.28,.075,.09),visor,0,1.67,-.17);
  const limbs=[];
  for(const side of [-1,1]){
    const armPivot=new THREE.Group();armPivot.position.set(side*.36,1.29,-.01);root.add(armPivot);
    part(new THREE.CapsuleGeometry(.085,.37,4,8),uniform,0,-.2,-.02,armPivot);part(new THREE.SphereGeometry(.085,8,6),skin,0,-.41,-.03,armPivot);limbs.push({pivot:armPivot,kind:'arm',side});
    const legPivot=new THREE.Group();legPivot.position.set(side*.16,.77,0);root.add(legPivot);
    part(new THREE.CapsuleGeometry(.105,.43,4,8),uniform,0,-.24,0,legPivot);part(new THREE.BoxGeometry(.19,.12,.31),boot,0,-.49,-.065,legPivot);limbs.push({pivot:legPivot,kind:'leg',side});
  }
  // Detailed carbine silhouette held by both operators.
  const rifle=new THREE.Group();
  // Character-local right side is mirrored in screen space when facing the player.
  // Use negative local X so an opponent facing the camera carries the rifle on the same screen side as the first-person weapon.
  rifle.position.set(.23,1.22,-.25);rifle.rotation.y=-.12;root.add(rifle);
  part(new THREE.BoxGeometry(.15,.13,.48),dark,0,0,-.15,rifle);
  part(new THREE.BoxGeometry(.13,.1,.34),uniform,0,.015,-.48,rifle);
  part(new THREE.CylinderGeometry(.026,.03,.42,10),boot,0,.015,-.75,rifle).rotation.x=Math.PI/2;
  part(new THREE.CylinderGeometry(.04,.04,.075,10),dark,0,.015,-.97,rifle).rotation.x=Math.PI/2;
  const magazine=part(new THREE.BoxGeometry(.095,.23,.14),dark,0,-.16,-.31,rifle);magazine.rotation.x=-.12;
  part(new THREE.BoxGeometry(.09,.19,.12),uniform,0,-.12,-.03,rifle);
  part(new THREE.BoxGeometry(.065,.045,.14),boot,0,.085,-.2,rifle);
  part(new THREE.BoxGeometry(.055,.04,.12),mat(0x66c4c8,.25),0,.095,-.53,rifle);
  root.userData.name=name;root.userData.limbs=limbs;root.userData.head=head;root.userData.rifle=rifle;scene.add(root);return root;
}
function makeWeapon() {
  if(weapon) camera.remove(weapon); if(sidearm) camera.remove(sidearm);
  weapon=new THREE.Group(); sidearm=new THREE.Group();
  const black=mat(0x171d20,.32), polymer=mat(0x343e42,.58), steel=mat(0x7d898b,.28), accent=mat(0xc1a45c,.42), glass=new THREE.MeshStandardMaterial({color:0x6ecbd0,metalness:.35,roughness:.18,emissive:0x16494b,emissiveIntensity:.4});
  const part=(root,geo,material,x,y,z)=>{const m=new THREE.Mesh(geo,material);m.position.set(x,y,z);m.castShadow=true;root.add(m);return m;};
  // Primary: modern carbine with stock, rail, optic, magazine and handguard.
  part(weapon,new THREE.BoxGeometry(.17,.15,.48),black,.27,-.22,-.5);
  part(weapon,new THREE.BoxGeometry(.15,.12,.38),polymer,.27,-.205,-.83);
  part(weapon,new THREE.BoxGeometry(.08,.035,.66),steel,.27,-.125,-.64);
  const barrel=part(weapon,new THREE.CylinderGeometry(.025,.032,.5,12),steel,.27,-.19,-1.12);barrel.rotation.x=Math.PI/2;
  const muzzle=part(weapon,new THREE.CylinderGeometry(.045,.04,.12,12),black,.27,-.19,-1.39);muzzle.rotation.x=Math.PI/2;
  part(weapon,new THREE.BoxGeometry(.13,.13,.32),polymer,.27,-.22,-.16);
  part(weapon,new THREE.BoxGeometry(.09,.23,.13),polymer,.27,-.37,-.44);
  const mag=part(weapon,new THREE.BoxGeometry(.105,.25,.15),black,.27,-.39,-.66);mag.rotation.x=-.15;
  part(weapon,new THREE.BoxGeometry(.055,.025,.16),accent,.27,-.3,-.66);
  part(weapon,new THREE.BoxGeometry(.06,.055,.14),black,.27,-.105,-.61);
  part(weapon,new THREE.CylinderGeometry(.045,.045,.12,12),black,.27,-.065,-.8);
  part(weapon,new THREE.CylinderGeometry(.031,.031,.125,12),glass,.27,-.065,-.8);
  part(weapon,new THREE.BoxGeometry(.06,.04,.12),accent,.27,-.12,-.98);
  muzzleFlash=new THREE.Mesh(new THREE.ConeGeometry(.105,.28,8),new THREE.MeshBasicMaterial({color:0xffd08a,transparent:true,opacity:.95}));muzzleFlash.rotation.x=-Math.PI/2;muzzleFlash.position.set(.27,-.19,-1.55);weapon.add(muzzleFlash);muzzleFlash.visible=false;
  // Secondary: compact sidearm; press 2 to equip, 1 returns to carbine.
  part(sidearm,new THREE.BoxGeometry(.14,.13,.34),black,.28,-.25,-.49);
  part(sidearm,new THREE.BoxGeometry(.12,.09,.2),steel,.28,-.205,-.7);
  const pistolBarrel=part(sidearm,new THREE.CylinderGeometry(.025,.028,.24,10),steel,.28,-.22,-.83);pistolBarrel.rotation.x=Math.PI/2;
  const slide=part(sidearm,new THREE.BoxGeometry(.135,.06,.3),polymer,.28,-.17,-.56);
  part(sidearm,new THREE.BoxGeometry(.09,.2,.12),black,.28,-.38,-.42);
  part(sidearm,new THREE.BoxGeometry(.045,.025,.11),accent,.28,-.12,-.55);
  camera.add(weapon);camera.add(sidearm);setWeapon(1);
}
function setWeapon(type){
  weaponType=type===2?2:1;
  if(weapon)weapon.visible=weaponType===1;
  if(sidearm)sidearm.visible=weaponType===2;
  const tag=document.getElementById('weaponTag');if(tag)tag.textContent=weaponType===1?'CARBINE · 1':'SIDEARM · 2';
  toast.textContent=weaponType===1?'CARBINE · 1':'SIDEARM · 2';
}

function resetScene() {
  for(const r of remotes.values()) scene.remove(r.mesh); remotes.clear();
  if(botRoot) scene.remove(botRoot); botRoot=null; bot=null;
  for(const child of [...scene.children]) if(child.userData?.temporary) scene.remove(child);
  player.x=0;player.z=spawnSide*14.8;player.y=1.65; jumpHeight=0;jumpVelocity=0;yaw=spawnSide===1?Math.PI:0;pitch=0;hp=100;score=0;slowReadyAt=0;dashReadyAt=0;
  $('health').textContent='100';$('healthBar').style.width='100%';$('score').textContent='0';
}
function startScene() {
  if(!renderer) createRenderer();
  dead=false; if(deathOverlay)deathOverlay.classList.add('hidden');
  // Recreate world to keep colliders and meshes in sync between sessions.
  for(const child of [...scene.children]) if(child!==camera) scene.remove(child);
  colliders.length=0; remotes.clear(); botRoot=null; bot=null;
  scene.add(new THREE.HemisphereLight(0xc8d2d0,0x272b2c,2.1)); const sun=new THREE.DirectionalLight(0xffe5c5,2.5);sun.position.set(-8,16,8);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);scene.add(sun);
  buildArena(); if(weapon)camera.remove(weapon); makeWeapon();
  player.x=0;player.z=spawnSide*14.8;hp=100;score=0;yaw=spawnSide===1?Math.PI:0;pitch=0;jumpHeight=0;jumpVelocity=0;slowReadyAt=0;dashReadyAt=0;dead=false;weaponKick=0;
  $('health').textContent='100';$('healthBar').style.width='100%';$('score').textContent='0'; ammo=30;reserveAmmo=120;fireHeld=false;aimHeld=false;reloadUntil=0;updateAmmoHud();
  if(botMode){botRoot=makeCharacter(0x8b9b78,'TRAINING BOT');botRoot.position.set(0,0,-14.8);bot={x:0,z:-14.8,hp:100,shotAt:0,respawnAt:0};}
  camera.position.set(player.x,player.y+jumpHeight,player.z);camera.rotation.set(pitch,yaw,0);camera.add(weapon); weapon.position.set(0,0,0);
  running=true;paused=false;game.classList.remove('hidden');menu.classList.add('hidden');$('pause').classList.add('hidden');toast.textContent='Щёлкни по арене, чтобы захватить мышь';clock.start();animate();
}
function joinOnline() {
  if(ws) { try{ws.close()}catch{} ws=null; }
  const proto=location.protocol==='https:'?'wss':'ws'; ws=new WebSocket(`${proto}://${location.host}/ws`);
  statusEl.textContent='Подключение к серверу…';
  ws.onopen=()=>ws.send(JSON.stringify({type:'join',room:$('roomCode').value.trim()||'QUICK',name:$('callsign').value.trim()||'Operative'}));
  ws.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return}
    if(m.type==='error'){statusEl.textContent=m.message;toast.textContent=m.message;return}
    if(m.type==='joined'){myId=m.id;spawnSide=m.slot===1?1:-1;roomName=m.room;$('roomLabel').textContent=roomName;statusEl.textContent='Подключено. Комната '+roomName;startScene();toast.textContent='Сетевой режим: жди второго игрока';}
    if(m.type==='snapshot') updateSnapshot(m);
    if(m.type==='ability'&&m.name==='slow'){slowReadyAt=performance.now()+m.cooldown;toast.textContent='TIME SHIFT активирован';}
  };
  ws.onerror=()=>{statusEl.textContent='Не удалось подключиться. Проверь сервер и попробуй снова.'};
  ws.onclose=()=>{if(online&&running)toast.textContent='Соединение закрыто';};
}
function updateSnapshot(m) {
  for(const p of m.players){if(p.id===myId){hp=p.hp;score=p.score;$('health').textContent=hp;$('healthBar').style.width=hp+'%';$('score').textContent=score;if(hp<=0)showDeath();else if(dead){dead=false;paused=false;if(deathOverlay)deathOverlay.classList.add('hidden');toast.textContent='ВОЗРОЖДЕНИЕ · 100 HP';}continue;}
    let r=remotes.get(p.id);if(!r){const mesh=makeCharacter(0xb5a16e,p.name);r={mesh,data:p};remotes.set(p.id,r)}
    r.data=p;r.mesh.position.set(p.x,0,p.z);r.mesh.rotation.y=p.yaw;
    if(Date.now()<p.slowedUntil) r.mesh.traverse(o=>{if(o.material?.color)o.material.color.set(0x7e9b9d)});
  }
  for(const [id,r] of remotes) if(!m.players.some(p=>p.id===id)){scene.remove(r.mesh);remotes.delete(id)}
  if(online&&remotes.size===0)toast.textContent='Комната '+roomName+': ждём второго игрока';else if(online)toast.textContent='Противник в матче';
}
function collides(x,z,radius=.42,feetY=0) {
  if(x < -18.5+radius || x > 18.5-radius || z < -18.5+radius || z > 18.5-radius)return true;
  const bodyHeight=1.65;
  return colliders.some(c=>{const bottom=c.y-c.hy, top=c.y+c.hy; const verticalOverlap=feetY < top-.04 && feetY+bodyHeight > bottom+.04; return verticalOverlap && Math.abs(x-c.x)<c.hx+radius && Math.abs(z-c.z)<c.hz+radius;});
}
function platformTopAt(x,z,radius=.38,maxHeight=Infinity){
  let top=0;
  for(const c of colliders){
    const surface=c.y+c.hy;
    // The player's footprint must overlap the platform; only consider surfaces below the supplied ceiling.
    if(surface<=maxHeight && Math.abs(x-c.x)<c.hx+radius && Math.abs(z-c.z)<c.hz+radius && surface>top) top=surface;
  }
  return top;
}
function lineBlocked(ax,az,bx,bz){const dx=bx-ax,dz=bz-az,len=Math.hypot(dx,dz);if(len<.1)return false;const steps=Math.ceil(len/.18);for(let i=1;i<steps;i++){const t=i/steps;if(collides(ax+dx*t,az+dz*t,.16))return true;}return false;}
function moveBotToward(dx,dz,dt){const len=Math.hypot(dx,dz)||1;dx/=len;dz/=len;const speed=(bot&&performance.now()<slowVisualUntil)?0.8:2.0;const options=[[dx,dz],[dx*.7-dz*.7,dz*.7+dx*.7],[dx*.7+dz*.7,dz*.7-dx*.7],[-dz,dx],[dz,-dx]];for(const [ox,oz] of options){const nx=bot.x+ox*speed*dt,nz=bot.z+oz*speed*dt;if(!collides(nx,bot.z,.38)&&!collides(nx,nz,.38)){bot.x=nx;bot.z=nz;botRoot.position.set(nx,0,nz);return true;}}return false;}
function showDeath(){if(dead)return;dead=true;deathAt=performance.now();keys.clear();if(document.pointerLockElement)document.exitPointerLock();paused=true;$('pause').classList.add('hidden');if(deathOverlay)deathOverlay.classList.remove('hidden');toast.textContent='Оперативник выведен из строя';}
function movePlayer(dt) {
  // Continuous vertical integration with swept landing checks prevents falling through platforms.
  const oldHeight=jumpHeight;
  const oldVelocity=jumpVelocity;
  if(jumpHeight>0 || jumpVelocity>0){
    jumpVelocity-=18*dt;
    const nextHeight=Math.max(0,jumpHeight+jumpVelocity*dt);
    if(jumpVelocity<=0){
      let landing=0;
      for(const c of colliders){
        const top=c.y+c.hy;
        const overlaps=Math.abs(player.x-c.x)<c.hx+.30 && Math.abs(player.z-c.z)<c.hz+.30;
        if(overlaps && oldHeight>=top-.015 && nextHeight<=top+.015 && top>landing) landing=top;
      }
      if(landing>0){jumpHeight=landing;jumpVelocity=0;}
      else {jumpHeight=nextHeight;if(jumpHeight===0)jumpVelocity=0;}
    } else jumpHeight=nextHeight;
  }
  let f=(keys.has('KeyW')?1:0)-(keys.has('KeyS')?1:0),s=(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0);
  if(f||s){
    const len=Math.hypot(f,s)||1;f/=len;s/=len;
    const speed=(online&&Date.now()<slowUntil)?2.3:5.2;
    const dx=(-Math.sin(yaw)*f+Math.cos(yaw)*s)*speed*dt;
    const dz=(-Math.cos(yaw)*f-Math.sin(yaw)*s)*speed*dt;
    const feet=jumpHeight;
    // Substep movement so fast motion cannot tunnel through thin walls/blocks.
    const steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.12));
    for(let i=0;i<steps;i++){
      const sx=dx/steps, sz=dz/steps;
      if(!collides(player.x+sx,player.z,.38,feet)) player.x+=sx;
      if(!collides(player.x,player.z+sz,.38,feet)) player.z+=sz;
    }
    if(jumpHeight>0 && platformTopAt(player.x,player.z,.30)<jumpHeight-.05 && jumpVelocity===0) jumpVelocity=-.01;
  }
}
function dash() { const now=performance.now();if(now<dashReadyAt)return;dashReadyAt=now+2400;const dx=-Math.sin(yaw)*2.8,dz=-Math.cos(yaw)*2.8;const nx=player.x+dx,nz=player.z+dz;if(!collides(nx,player.z))player.x=nx;if(!collides(player.x,nz))player.z=nz;toast.textContent='DASH';setTimeout(()=>{if(running)toast.textContent=''},500); }
function slowTime() { if(performance.now()<slowReadyAt)return;if(online&&ws?.readyState===1){ws.send(JSON.stringify({type:'ability',name:'slow'}));}else{slowReadyAt=performance.now()+4000;slowVisualUntil=performance.now()+1800;if(bot)bot.respawnAt=Math.max(bot.respawnAt,performance.now()+900);toast.textContent='TIME SHIFT · ВРЕМЯ ЗАМЕДЛЕНО';setTimeout(()=>{if(running)toast.textContent=''},700);} }
function updateAmmoHud(){const tag=$('weaponTag');if(tag)tag.textContent=(weaponType===1?'CARBINE':'SIDEARM')+' · '+ammo+' / '+reserveAmmo+(aimHeld?' · ADS':'');}
function reloadWeapon(){if(!running||paused||dead||reloadUntil>performance.now()||ammo>=30||reserveAmmo<=0)return;fireHeld=false;reloadUntil=performance.now()+1450;toast.textContent='ПЕРЕЗАРЯДКА…';setTimeout(()=>{if(!running)return;const need=30-ammo,take=Math.min(need,reserveAmmo);ammo+=take;reserveAmmo-=take;reloadUntil=0;updateAmmoHud();toast.textContent='МАГАЗИН ЗАМЕНЁН';},1450);}
function shoot() {
  const now=performance.now();if(!running||paused||dead||now<reloadUntil)return;
  if(ammo<=0){if(reserveAmmo>0)reloadWeapon();else toast.textContent='БОЕПРИПАСЫ ЗАКОНЧИЛИСЬ';return;}
  const interval=weaponType===1?92:260;if(now-lastShotAt<interval)return;lastShotAt=now;ammo--;shotCounter++;weaponKick=Math.min(.24,weaponKick+.075);updateAmmoHud();
  muzzleFlash.position.set(.27,-.19,weaponType===1?-1.55:-.98);muzzleFlash.visible=true;setTimeout(()=>{if(muzzleFlash)muzzleFlash.visible=false},45);
  // Full-auto recoil and spread grow during a spray; aiming tightens the cone.
  const aim=aimHeld?1:0, spread=(aim?.0015:.006)+(fireHeld?Math.min(.014,shotCounter*.00065):0);
  const sx=(Math.random()-.5)*spread,sy=(Math.random()-.5)*spread;
  raycaster.setFromCamera(new THREE.Vector2(sx,sy),camera);raycaster.far=70;
  const targetRoots=[...remotes.values()].map(r=>r.mesh);if(botRoot)targetRoots.push(botRoot);
  const targetHits=raycaster.intersectObjects(targetRoots,true);
  const wallHits=raycaster.intersectObjects(colliders.map(c=>c.mesh).filter(Boolean),false);
  const targetHit=targetHits[0],wallHit=wallHits[0];
  if(!targetHit||(wallHit&&wallHit.distance<targetHit.distance)){if(wallHit)toast.textContent='ПОПАДАНИЕ В УКРЫТИЕ';return;}
  let target=targetHit.object;while(target.parent&&!targetRoots.includes(target))target=target.parent;
  const localY=targetHit.point.y-(target.position?.y||0);const zone=localY>1.48?'ГОЛОВА':localY<.68?'НОГИ':'КОРПУС';
  const damage=zone==='ГОЛОВА'?30:zone==='НОГИ'?10:18;
  if(botRoot&&target===botRoot){bot.hp-=damage;toast.textContent='ПОПАДАНИЕ: '+zone+' · -'+damage+' · '+Math.max(0,bot.hp)+' HP';shotCounter=aimHeld?0:shotCounter;if(bot.hp<=0){score++;$('score').textContent=score;bot.hp=100;bot.x=(Math.random()-.5)*8;bot.z=-(11+Math.random()*5);if(collides(bot.x,bot.z,.5)){bot.x=0;bot.z=-14.8;}botRoot.position.set(bot.x,0,bot.z);toast.textContent='ЦЕЛЬ УСТРАНЕНА · +1';}return;}
  for(const [id,r] of remotes)if(r.mesh===target&&ws?.readyState===1){ws.send(JSON.stringify({type:'hit',target:id,zone,damage}));toast.textContent='ПОПАДАНИЕ: '+zone;break;}
}
function drawMinimap() {
  const canvas=$('minimap'); if(!canvas) return;
  const ctx=canvas.getContext('2d'); if(!ctx) return;
  const w=canvas.width,h=canvas.height,scale=w/40;
  ctx.clearRect(0,0,w,h);ctx.fillStyle='#1a2426';ctx.fillRect(0,0,w,h);
  // Subtle tactical grid. World coordinates span -20..20 on both axes.
  ctx.strokeStyle='#344246';ctx.lineWidth=1;
  for(let n=-20;n<=20;n+=5){const x=(n+20)*scale,z=(n+20)*scale;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();ctx.beginPath();ctx.moveTo(0,z);ctx.lineTo(w,z);ctx.stroke();}
  // Render every solid collider as a top-down footprint, including walls and cover.
  for(const c of colliders){
    const x=(c.x-c.hx+20)*scale,y=(c.z-c.hz+20)*scale;
    ctx.fillStyle=(c.hy>1.45)?'#82908e':'#586664';
    ctx.fillRect(x,y,Math.max(2,c.hx*2*scale),Math.max(2,c.hz*2*scale));
    ctx.strokeStyle='#a0aaa4';ctx.lineWidth=.7;ctx.strokeRect(x,y,Math.max(2,c.hx*2*scale),Math.max(2,c.hz*2*scale));
  }
  // Player arrow points in the current view direction.
  const px=(player.x+20)*scale,pz=(player.z+20)*scale;
  ctx.save();ctx.translate(px,pz);ctx.rotate(yaw);ctx.fillStyle='#c3e36b';ctx.strokeStyle='#efffc0';ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(0,-7);ctx.lineTo(5,5);ctx.lineTo(0,3);ctx.lineTo(-5,5);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
  // Fog-of-war rule: opponents and training bots are never drawn on the minimap.
  ctx.strokeStyle='#c3e36b';ctx.lineWidth=2;ctx.strokeRect(1,1,w-2,h-2);
}
function animate() {
  if(!running)return;requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.04);if(!paused){movePlayer(dt);if(fireHeld)shoot();const targetFov=aimHeld?48:baseFov;if(Math.abs(camera.fov-targetFov)>.1){camera.fov+=(targetFov-camera.fov)*Math.min(1,dt*12);camera.updateProjectionMatrix();}
    if(bot&&botRoot&&!dead){const t=performance.now();if(t>bot.respawnAt){const dx=player.x-bot.x,dz=player.z-bot.z,d=Math.hypot(dx,dz);if(d>2.15)moveBotToward(dx,dz,dt);botRoot.rotation.y=Math.atan2(player.x-bot.x,player.z-bot.z);
      const blocked=lineBlocked(bot.x,bot.z,player.x,player.z);if(d<13&&!blocked&&t-bot.shotAt>1250){bot.shotAt=t;if(Math.random()>.30){hp=Math.max(0,hp-10);$('health').textContent=hp;$('healthBar').style.width=hp+'%';if(hp===0)showDeath();}}
      const moving=d>2.15;for(const limb of botRoot.userData.limbs||[]){limb.pivot.rotation.x=moving?Math.sin(t*.009)*(limb.kind==='leg'?.62:.28)*(limb.side===1?1:-1):0;}
    }}
    // subtle weapon sway and recoil
    walkPhase+=dt*9;const moving=keys.has('KeyW')||keys.has('KeyA')||keys.has('KeyS')||keys.has('KeyD');if(weapon){weaponKick=Math.max(0,weaponKick-dt*.75);weapon.position.y=(moving?Math.sin(walkPhase)*.008:0)-weaponKick*.45;weapon.position.x=(moving?Math.cos(walkPhase*.5)*.006:0);weapon.rotation.x=-weaponKick;}
    camera.position.set(player.x,player.y+jumpHeight,player.z);camera.rotation.set(pitch,yaw,0);
    if(online&&ws?.readyState===1&&performance.now()-lastNetSend>65&&!dead){lastNetSend=performance.now();ws.send(JSON.stringify({type:'state',x:player.x,z:player.z,yaw}));}
    $('slowText').textContent=performance.now()<slowReadyAt?'ПЕРЕЗАРЯДКА':'ГОТОВО';$('slowAbility').style.opacity=performance.now()<slowReadyAt?'.55':'1';drawMinimap();
  }
  renderer.render(scene,camera);
}
function leaveGame() { running=false;paused=false;game.classList.add('hidden');menu.classList.remove('hidden');if(document.pointerLockElement)document.exitPointerLock();if(ws){ws.close();ws=null;}online=false;botMode=false;statusEl.textContent='В меню'; }
deathOverlay=document.createElement('div');deathOverlay.id='deathScreen';deathOverlay.className='death-screen hidden';deathOverlay.innerHTML='<div class="death-kicker">RIFT//ZERO · COMBAT LOG</div><h2>YOU ARE DOWN</h2><p>Оперативник выведен из строя</p><div class="death-rule"></div><button id="respawnBtn" class="primary">ВОЗРОДИТЬСЯ</button><small>После возрождения здоровье восстановится до 100</small>';game.appendChild(deathOverlay);
$('respawnBtn').addEventListener('click',()=>{if(online&&ws?.readyState===1){ws.send(JSON.stringify({type:'respawn'}));}else{dead=false;paused=false;hp=100;player.x=0;player.z=spawnSide*14.8;yaw=spawnSide===1?Math.PI:0;pitch=0;$('health').textContent='100';$('healthBar').style.width='100%';deathOverlay.classList.add('hidden');toast.textContent='ВОЗРОЖДЕНИЕ · 100 HP';if(!pointerLocked)$('view').requestPointerLock?.();}});
$('onlineBtn').addEventListener('click',()=>{online=true;botMode=false;joinOnline()});
$('botBtn').addEventListener('click',()=>{online=false;botMode=true;roomName='TRAINING';$('roomLabel').textContent='TRAINING';statusEl.textContent='Тренировочный режим';startScene()});
$('leaveBtn').addEventListener('click',leaveGame);
$('view').addEventListener('click',()=>{if(running&&!paused&&!pointerLocked){ignoreNextMouseMove=true;$('view').requestPointerLock?.()}});
document.addEventListener('pointerlockchange',()=>{pointerLocked=document.pointerLockElement===$('view');ignoreNextMouseMove=true;lastMouseMoveAt=performance.now();if(!pointerLocked){fireHeld=false;aimHeld=false;game.classList.remove('aiming');camera&&(camera.fov=baseFov,camera.updateProjectionMatrix());updateAmmoHud();}if(running&&!pointerLocked&&!paused&&!dead){paused=true;$('pause').classList.remove('hidden')}});
document.addEventListener('mousemove',e=>{if(!pointerLocked||paused)return;const now=performance.now();if(ignoreNextMouseMove){ignoreNextMouseMove=false;lastMouseMoveAt=now;return;}lastMouseMoveAt=now;const mx=Number(e.movementX)||0,my=Number(e.movementY)||0;if(Math.abs(mx)>900||Math.abs(my)>900)return;const sensitivity=aimHeld?.0021:.0042;yaw-=mx*sensitivity;pitch-=my*sensitivity;pitch=Math.max(-1.42,Math.min(1.42,pitch));});
document.addEventListener('keydown',e=>{if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();if(e.code==='KeyR'){reloadWeapon();return;}keys.add(e.code);if(!running)return;if(e.code==='Escape'){if(paused){paused=false;$('pause').classList.add('hidden');ignoreNextMouseMove=true;$('view').requestPointerLock?.()}else if(pointerLocked)document.exitPointerLock();}if(e.code==='ShiftLeft'||e.code==='ShiftRight')dash();if(e.code==='KeyQ')slowTime();if(e.code==='Space'&&running&&!paused&&!dead&&jumpVelocity===0){jumpVelocity=7.2;}if(e.code==='Digit1'){setWeapon(1);ammo=30;updateAmmoHud()}if(e.code==='Digit2'){setWeapon(2);updateAmmoHud()}});
document.addEventListener('keyup',e=>keys.delete(e.code));document.addEventListener('mousedown',e=>{if(!pointerLocked||paused)return;if(e.button===0){fireHeld=true;shotCounter=0;shoot()}if(e.button===2){aimHeld=true;shotCounter=0;game.classList.add('aiming');updateAmmoHud()}});document.addEventListener('mouseup',e=>{if(e.button===0){fireHeld=false;shotCounter=0}if(e.button===2){aimHeld=false;game.classList.remove('aiming');updateAmmoHud()}});document.addEventListener('contextmenu',e=>{if(running)e.preventDefault()});
window.addEventListener('resize',()=>{if(!renderer||!camera)return;camera.aspect=window.innerWidth/window.innerHeight;camera.updateProjectionMatrix();renderer.setSize(window.innerWidth,window.innerHeight);});
