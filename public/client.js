import * as THREE from 'three';

const $ = id => document.getElementById(id);
const menu = $('menu'), game = $('game'), statusEl = $('menuStatus'), toast = $('toast');
let renderer, scene, camera, clock, ws = null, online = false, myId = null, roomName = '—';
let running = false, paused = false, pointerLocked = false, botMode = false, dead = false, deathAt = 0, lastShotAt = 0, weaponKick = 0, walkPhase = 0;
let yaw = 0, pitch = 0, spawnSide = 1, spawnX = -3.2, hp = 100, score = 0, deaths = 0, roundEndsAt = Date.now()+180000, intermissionEndsAt = 0, roundState = 'waiting', roundNumber = 1, slowReadyAt = 0, dashReadyAt = 0, lastNetSend = 0;
let jumpHeight = 0, jumpVelocity = 0, weaponType = 1, sidearm = null, rifle = null;
let fireHeld=false, aimHeld=false, ammo=30, reserveAmmo=120, reloadUntil=0, lastMouseMoveAt=0, ignoreNextMouseMove=true, baseFov=76, shotCounter=0;
const keys = new Set(); const remotes = new Map(); const colliders = []; const raycaster = new THREE.Raycaster(); const shatterEffects = []; let matchOverShown = false;
const player = { x: 0, z: 7, y: 1.65, speed: 5.2 };
let weapon, bot, botRoot, muzzleFlash, slowUntil = 0, slowVisualUntil = 0, deathOverlay, lastRoundNotice = '';
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
  scene = new THREE.Scene(); scene.background = new THREE.Color(0x83c8f2); scene.fog = new THREE.Fog(0x83c8f2, 48, 105);
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
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(68,68),asphalt);ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;scene.add(ground);
  for(const side of [-1,1]){const lawn=new THREE.Mesh(new THREE.PlaneGeometry(9,62),grass);lawn.rotation.x=-Math.PI/2;lawn.position.set(side*28.5,.012,0);lawn.receiveShadow=true;scene.add(lawn);}
  for(const z of [-8,-4,0,4,8])detail(0,.025,z,7,.018,.06,mark);
  for(let z=-17;z<=17;z+=4){detail(-8,.024,z,.05,.018,1.4,concrete);detail(8,.024,z,.05,.018,1.4,concrete);}
  // Brick perimeter with lightweight mortar courses.
  box(0,2,-34,68,4,1,brick);box(0,2,34,68,4,1,brick);box(-34,2,0,1,4,68,brick);box(34,2,0,1,4,68,brick);
  for(const z of [-33.47,33.47]){for(let y=.55;y<3.8;y+=.52)detail(0,y,z,65,.025,.018,brickLight);for(let x=-32;x<=32;x+=1.5)detail(x,1,z,.025,.9,.02,dark);}
  for(const x of [-33.47,33.47]){for(let y=.55;y<3.8;y+=.52)detail(x,y,0,.018,.025,65,brickLight);for(let z=-32;z<=32;z+=1.5)detail(x,1,z,.02,.9,.025,dark);}
  // Fixed spawn rooms. Two offset exits per side; chicane walls block immediate sightlines.
  for(const side of [-1,1]){
    const z0=side*27.4;box(-16.8,1.8,z0,.42,3.6,9.6,brick);box(16.8,1.8,z0,.42,3.6,9.6,brick);
    const wz=side*22.3;box(-15.5,1.8,wz,7,3.6,.55,brick);box(0,1.8,wz,12,3.6,.55,brick);box(15.5,1.8,wz,7,3.6,.55,brick);
    box(-10.7,1.65,side*20.2,.55,3.3,4.1,dark);box(-8.4,1.65,side*33.3,4.5,3.3,.55,brick);
    box(10.7,1.65,side*20.2,.55,3.3,4.1,dark);box(8.4,1.65,side*33.3,4.5,3.3,.55,brick);
    box(-4.1,.85,side*27.5,3,1.7,1,dark);box(4.1,.85,side*27.5,3,1.7,1,dark);detail(0,3.3,side*33.25,5.8,.12,.18,metal);
    for(const x of [-12,-8,8,12]){detail(x,3.05,side*33.3,.65,.1,.12,cyan);detail(x,2.83,side*33.3,.45,.035,.12,yellow);}
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
  for(const side of [-1,1])for(const z of [-30,-25,-20,20,25,30])detail(side*32.3,2.6,z,.06,.06,1.3,yellow);
  // Architectural dressing: warm wall sconces, low route lights, painted lane arrows and center signage.
  for(const side of [-1,1]){
    for(const z of [-29,-23,-12,-7,7,12,23,29]){
      box(side*31.35,2.75,z,.12,.72,.28,dark,false);
      const lamp=box(side*31.27,2.78,z,.055,.42,.13,side===1?yellow:cyan,false);lamp.material.emissive=side===1?new THREE.Color(0x6a3710):new THREE.Color(0x064c59);lamp.material.emissiveIntensity=.45;lamp.castShadow=false;
    }
    // Double yellow edge lines guide players toward MID without exposing spawn sightlines.
    detail(side*2.2,.03,-8,.055,.02,7,mark);detail(side*2.2,.03,8,.055,.02,7,mark);
  }
  // Tactical flank lanes: staggered chest-high cover creates crossfire choices and safe rotations.
  for(const side of [-1,1]){
    box(side*13.1,.68,-5.4,2.0,1.36,1.0,concrete);
    box(side*13.1,.68,5.4,2.0,1.36,1.0,brick);
    box(side*8.9,.78,8.2,2.4,1.56,.8,dark);
    box(side*8.9,.78,-8.2,2.4,1.56,.8,dark);
    detail(side*13.1,1.38,-5.4,1.65,.045,.72,yellow);
    detail(side*13.1,1.38,5.4,1.65,.045,.72,yellow);
  }
  // Center platform has restrained accent trim rather than a rainbow palette.
  for(const x of [-1.65,1.65]){detail(x,2.46,0,.045,.035,3.05,yellow);}
  for(const z of [-1.65,1.65]){detail(0,2.46,z,3.05,.035,.045,yellow);}
  // EXPANDED TACTICAL RING: the playable footprint is now 68x68, with distinct routes.
  // Outer spawn courtyards connect to three approaches: central boulevard, covered flank tunnels, and raised catwalks.
  for(const side of [-1,1]){
    // Long flank service corridors, broken up to create several entry/exit choices.
    box(side*24.5,.95,side*1.5,1.1,1.9,13.5,concrete);
    box(side*24.5,.95,side*19.5,1.1,1.9,8.0,concrete);
    box(side*20.5,.72,side*8.5,4.0,1.44,1.0,dark);
    box(side*28.0,.72,side*12.0,3.2,1.44,1.0,brick);
    box(side*20.5,.72,side*20.5,4.0,1.44,1.0,brick);
    detail(side*20.5,1.47,side*8.5,3.4,.045,.72,yellow);
    detail(side*28.0,1.47,side*12.0,2.7,.045,.72,cyan);
    // Tall warehouse blocks with open corners: players can wrap around or breach through side doors.
    box(side*13.2,2.0,side*25.0,8.8,4.0,1.0,brick);
    box(side*17.6,2.0,side*29.0,1.0,4.0,8.0,brick);
    box(side*10.0,2.0,side*29.0,1.0,4.0,8.0,brick);
    // Industrial loading-bay lintels leave a deliberate walk-through gap at the center.
    box(side*13.8,3.55,side*29.0,4.0,.9,1.0,dark);
    detail(side*13.8,4.05,side*29.0,3.4,.06,.72,yellow);
    // Container stacks create strong and weak cover options.
    box(side*29.0,.75,side*23.0,3.0,1.5,5.0,metal);
    box(side*29.0,2.2,side*23.0,3.0,1.4,5.0,deck);
    box(side*26.5,.62,side*29.5,2.0,1.24,1.0,concrete);
    detail(side*29.0,2.95,side*23.0,2.6,.08,4.5,yellow);
    // Low wall zig-zags break long sightlines but preserve rotation paths.
    box(side*7.0,.72,side*22.0,1.0,1.44,5.0,dark);
    box(side*4.2,.72,side*25.5,5.0,1.44,1.0,concrete);
    box(side*7.0,.72,side*30.0,1.0,1.44,4.0,brick);
    // Catwalks and stairs on each flank. Railings are visual, decks are collidable surfaces.
    box(side*22.0,2.15,side*15.0,3.2,.3,10.0,deck);
    box(side*20.3,2.55,side*15.0,.12,.8,10.0,metal,false);
    box(side*23.7,2.55,side*15.0,.12,.8,10.0,metal,false);
    for(let i=0;i<5;i++){
      const h=.38*(i+1);
      box(side*(17.2+i*.75),h/2,side*15.0,1.0,h,2.6,i%2?deck:concrete);
      detail(side*(17.2+i*.75),h+.025,side*15.0,.92,.035,2.45,yellow);
    }
  }
  // Cross-map transverse routes, each with multiple openings rather than a single choke point.
  for(const zSide of [-1,1]){
    box(-3.0,.68,zSide*22.0,5.8,1.36,1.0,concrete);
    box(5.0,.68,zSide*22.0,4.8,1.36,1.0,dark);
    box(-9.5,.9,zSide*29.5,1.0,1.8,7.0,metal);
    box(2.0,.9,zSide*31.0,1.0,1.8,4.0,brick);
    box(8.0,.9,zSide*29.5,1.0,1.8,7.0,concrete);
    // Covered checkpoints and beacon pillars mark tactical landmarks.
    box(0,1.35,zSide*25.0,3.4,2.7,1.2,deck);
    detail(0,2.75,zSide*25.0,2.7,.08,.85,cyan);
    for(const x of [-5,5]){
      box(x,.72,zSide*18.0,1.2,1.44,2.6,dark);
      detail(x,1.48,zSide*18.0,1.0,.04,2.2,yellow);
    }
  }
  // Elevated central bridge linking both sides, with side rails and supports.
  box(0,3.1,0,3.0,.28,17.0,deck);
  box(-1.48,3.45,0,.12,.7,17.0,metal,false);box(1.48,3.45,0,.12,.7,17.0,metal,false);
  for(const z of [-7,-3,3,7]){box(0,1.5,z,.45,3.0,.45,metal);detail(0,3.28,z,.7,.06,.7,cyan);}
  // Extra light poles, cable runs, warning stripes, and floor markings make the larger facility readable.
  for(const x of [-30,-22,22,30])for(const z of [-30,-22,22,30]){
    box(x,2.4,z,.22,4.8,.22,dark,false);
    box(x,4.7,z,.85,.12,.85,metal,false);
    const lamp=box(x,4.55,z,.5,.08,.5,(Math.abs(x)===30)?cyan:yellow,false);lamp.material.emissive=new THREE.Color((Math.abs(x)===30)?0x064c59:0x6a3710);lamp.material.emissiveIntensity=.55;
  }
  for(const x of [-31,-27,-23,23,27,31])for(const z of [-17,-13,13,17])detail(x,.035,z,.06,.025,2.0,mark);
  // V20 industrial dressing: ribbed shipping containers, hazard barrels, cable reels and fabric faction banners.
  const ribbed=texturedMat(0xffffff,patternTexture('metal','#315b68','#172c34',8,2));
  const rust=texturedMat(0xffffff,patternTexture('metal','#80533b','#352b27',3,4));
  const container=(x,z,w,d,h,m,rot=0)=>{const c=box(x,h/2,z,w,h,d,m,true);c.rotation.y=rot;for(let i=-Math.floor(w/2)+1;i<Math.floor(w/2);i+=.42){const r=detail(x+i,h/2,z,w>.8?.035:.035,h-.16,d+.025,metal);r.rotation.y=rot;}detail(x,h+.035,z,w-.15,.07,d-.12,yellow);return c;};
  // Container stacks make the outer routes narrow and create hard corner-peek decisions.
  container(-27,-16,7,2.8,2.9,ribbed);container(-27,-12.7,7,2.8,2.9,deck);
  container(27,16,7,2.8,2.9,ribbed);container(27,12.7,7,2.8,2.9,deck);
  container(-19,7,5.5,2.4,2.7,deck);container(19,-7,5.5,2.4,2.7,ribbed);
  container(-18,-4,4.5,2.2,2.5,rust);container(18,4,4.5,2.2,2.5,rust);
  // Reinforced corridor walls: offsets leave alternate routes while preventing a single long open sightline.
  for(const side of [-1,1]){
    box(side*16,1.7,-13, .65,3.4,8,concrete);box(side*16,1.7,13,.65,3.4,8,concrete);
    box(side*20,1.65,-2,7,3.3,.65,brick);box(side*20,1.65,2,7,3.3,.65,brick);
    for(const z of [-15,-11,11,15]){detail(side*15.64,2.5,z,.06,.55,1.1,yellow);detail(side*15.63,1.7,z,.07,.08,1.25,cyan);}
  }
  // Procedural cloth banners with readable hazard graphics, mounted on wall faces.
  function bannerTexture(label,base,accent){const c=document.createElement('canvas');c.width=512;c.height=192;const g=c.getContext('2d');g.fillStyle=base;g.fillRect(0,0,512,192);g.fillStyle=accent;g.fillRect(0,0,512,13);g.fillRect(0,179,512,13);g.globalAlpha=.25;for(let x=-192;x<600;x+=70){g.beginPath();g.moveTo(x,13);g.lineTo(x+70,179);g.lineTo(x+95,179);g.lineTo(x+25,13);g.fill();}g.globalAlpha=1;g.fillStyle='#e6e1cf';g.font='bold 47px sans-serif';g.textAlign='center';g.fillText(label,256,104);g.font='bold 18px sans-serif';g.fillText('RIFT // ZERO  •  SECTOR 04',256,143);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return new THREE.MeshStandardMaterial({map:t,roughness:.85,side:THREE.DoubleSide});}
  const bannerA=bannerTexture('NO ENTRY','#182c35','#d2a84b'),bannerB=bannerTexture('SECTOR 04','#203b49','#53b7c7');
  for(const [x,y,z,ry,m] of [[-33.42,2.7,-18,Math.PI/2,bannerA],[-33.42,2.7,18,Math.PI/2,bannerB],[33.42,2.7,-18,-Math.PI/2,bannerB],[33.42,2.7,18,-Math.PI/2,bannerA],[0,3.55,-33.42,0,bannerB],[0,3.55,33.42,Math.PI,bannerA]]){const b=new THREE.Mesh(new THREE.PlaneGeometry(5.4,1.65),m);b.position.set(x,y,z);b.rotation.y=ry;scene.add(b);for(const dx of [-2.65,2.65])detail(x+dx,y,z,.045,1.85,.055,metal);}
  // Hazard barrels and tire stacks provide waist-high micro-cover around mid and flank junctions.
  function barrel(x,z,material=rust){const group=new THREE.Group();group.position.set(x,0,z);const body=new THREE.Mesh(new THREE.CylinderGeometry(.43,.43,1.12,16),material);body.position.y=.56;body.castShadow=true;body.receiveShadow=true;group.add(body);for(const y of [.22,.82]){const hoop=new THREE.Mesh(new THREE.TorusGeometry(.435,.045,6,18),metal);hoop.rotation.x=Math.PI/2;hoop.position.y=y;group.add(hoop);}const lid=new THREE.Mesh(new THREE.CylinderGeometry(.39,.39,.045,16),dark);lid.position.y=1.13;group.add(lid);scene.add(group);colliders.push({x,z,hx:.46,hz:.46,hy:.56,y:.56,mesh:body});}
  for(const [x,z] of [[-5,-10],[-6,-8],[6,10],[5,8],[-14,3],[14,-3],[-24,5],[24,-5],[-21,18],[21,-18]])barrel(x,z);
  // Utility lights, wall-mounted cable conduits and caution chevrons make vertical surfaces less empty.
  for(const side of [-1,1]){for(const z of [-27,-20,-9,9,20,27]){detail(side*33.42,3.45,z,.045,.08,2.2,yellow);detail(side*33.4,1.05,z,.055,.1,1.4,metal);}for(const z of [-6,6]){const sign=detail(side*16.31,2.95,z, .06,.72,2.2,cyan);sign.material=mat(0x236d7b,.55);}}
  const glow=new THREE.PointLight(0x3dcde0,.8,15);glow.position.set(0,4.2,0);scene.add(glow);const warm=new THREE.PointLight(0xffc16d,.35,8);warm.position.set(-13,2.2,-13);scene.add(warm);  // V21: medieval fortress pass inspired by the supplied layout and art references.
  const stone=texturedMat(0xffffff,patternTexture('stone','#827b6a','#484a46',3,2));
  const stoneLight=texturedMat(0xffffff,patternTexture('stone','#a49a83','#6c665a',3,2));
  const timber=mat(0x493326), gold=mat(0xb9974f), roof=mat(0x743e32);
  function watchtower(x,z){
    box(x,2,z,4.2,4,4.2,stone);box(x,4.08,z,4.65,.22,4.65,stoneLight);
    for(const d of [-1.65,-.55,.55,1.65])for(const side of [-1,1]){
      box(x+d,4.48,z+side*1.85,.48,.68,.48,stone);
      box(x+side*1.85,4.48,z+d,.48,.68,.48,stone);
    }
    box(x,4.72,z,2.5,.18,2.5,roof,false);
    for(const side of [-1,1]){detail(x+side*2.12,2.5,z,.035,.5,.16,dark);detail(x,2.5,z+side*2.12,.16,.5,.035,dark);}
  }
  for(const [x,z] of [[-29,-29],[29,-29],[-29,29],[29,29]])watchtower(x,z);
  // Masonry buttresses reinforce the perimeter and make the arena read as a fortress.
  for(const side of [-1,1])for(const z of [-31,-24,-17,-10,10,17,24,31]){
    box(side*33,2,z,.9,4,1.2,stone);box(side*33,4.08,z,1.2,.18,1.5,stoneLight,false);
  }
  // Red and blue banners at the opposing spawn courtyards.
  function flagTexture(label,base,accent){const c=document.createElement('canvas');c.width=256;c.height=384;const g=c.getContext('2d');g.fillStyle=base;g.fillRect(0,0,256,384);g.fillStyle=accent;g.fillRect(0,0,256,14);g.fillRect(0,370,256,14);g.strokeStyle=accent;g.lineWidth=9;g.beginPath();g.moveTo(40,75);g.lineTo(216,300);g.moveTo(216,75);g.lineTo(40,300);g.stroke();g.fillStyle='#eee4cf';g.font='bold 30px sans-serif';g.textAlign='center';g.fillText(label,128,205);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return new THREE.MeshStandardMaterial({map:t,side:THREE.DoubleSide,roughness:.9});}
  const redFlag=flagTexture('BAZA 1','#762d2c','#d8b76a'),blueFlag=flagTexture('BAZA 2','#214a70','#d8b76a');
  for(const side of [-1,1]){
    box(-13,2.25,side*28,1,4.5,.8,stone);box(13,2.25,side*28,1,4.5,.8,stone);
    const f=new THREE.Mesh(new THREE.PlaneGeometry(2,3),side===-1?redFlag:blueFlag);f.position.set(0,3.8,side*32.4);f.rotation.y=side===-1?0:Math.PI;scene.add(f);
  }
  // Four open approaches frame the central keep; pillars and lintels form high walk-through gates.
  for(const sign of [-1,1]){
    box(sign*10.5,1.65,0,.65,3.3,1,stone);box(sign*13,1.65,0,.65,3.3,1,stone);
    box(sign*11.75,3.25,0,3.1,.55,1.1,stoneLight,false);
    box(0,1.65,sign*10.5,1,3.3,.65,stone);box(0,1.65,sign*13,1,3.3,.65,stone);
    box(0,3.25,sign*11.75,1.1,.55,3.1,stoneLight,false);
  }
  // Low stone edging around the central plaza, leaving four broad entrances open.
  for(const [x,z,w,d] of [[-5.4,0,1.1,7],[5.4,0,1.1,7],[0,-5.4,7,1.1],[0,5.4,7,1.1]]){
    box(x,.95,z,w,1.9,d,stone);for(const y of [.55,1.35])detail(x,y,z,w+.04,.045,d+.04,stoneLight);
  }
  for(const [x,z] of [[-3.6,-3.6],[3.6,-3.6],[-3.6,3.6],[3.6,3.6]]){box(x,.65,z,1,1.3,1,stone);box(x,1.34,z,1.15,.12,1.15,gold,false);}
  // Reachable raised flank walks with broad aligned steps and stone parapets.
  for(const side of [-1,1])for(const z0 of [-18,18]){
    box(side*23,1.05,z0,4.2,.28,8,stoneLight);
    box(side*20.82,1.28,z0,.16,.55,8,stone,false);box(side*25.18,1.28,z0,.16,.55,8,stone,false);
    for(let i=0;i<5;i++){const h=.28*(i+1);box(side*(18+i*.55),h/2,z0,1.05,h,2.4,i%2?stone:stoneLight);}
  }
  // Timber supply crates and colored barrels provide recognizable waist-high cover.
  function supplyCrate(x,z,scale=1){box(x,.48*scale,z,.95*scale,.96*scale,.95*scale,timber);for(const y of [.12,.84])detail(x,y*scale,z,.99*scale,.075*scale,1*scale,stoneLight);detail(x,.48*scale,z-.48*scale,.07*scale,.86*scale,.035*scale,gold);}
  for(const [x,z,k] of [[-12,-11,1.1],[-14,-9,.9],[12,11,1.1],[14,9,.9],[-25,4,1.2],[25,-4,1.2],[-9,20,1],[9,-20,1],[0,-17,.9],[0,17,.9]])supplyCrate(x,z,k);
  function woodBarrel(x,z,color){const m=mat(color,.8),body=new THREE.Mesh(new THREE.CylinderGeometry(.38,.42,.95,12),m);body.position.set(x,.48,z);body.castShadow=true;scene.add(body);for(const y of [.2,.75]){const r=new THREE.Mesh(new THREE.TorusGeometry(.405,.035,5,14),gold);r.rotation.x=Math.PI/2;r.position.set(x,y,z);scene.add(r);}colliders.push({x,z,hx:.42,hz:.42,hy:.48,y:.48,mesh:body});}
  for(const [x,z,c] of [[-10,-14,0x7b352e],[-11,-13,0x315a79],[10,14,0x7b352e],[11,13,0x315a79],[-26,13,0x5c6046],[26,-13,0x5c6046]])woodBarrel(x,z,c);
  // Warm torch points add depth to the stone architecture while retaining daytime visibility.
  for(const [x,z] of [[-18,-18],[18,-18],[-18,18],[18,18],[-7,0],[7,0],[0,-7],[0,7]]){
    box(x,2.45,z,.16,.8,.16,timber,false);
    const flame=new THREE.Mesh(new THREE.ConeGeometry(.16,.42,7),new THREE.MeshStandardMaterial({color:0xffa13a,emissive:0xff5a12,emissiveIntensity:1.3}));flame.position.set(x,2.98,z);scene.add(flame);
    const light=new THREE.PointLight(0xffa24a,.45,7);light.position.set(x,3.1,z);scene.add(light);
  }

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
  player.x=spawnX;player.z=spawnSide*29.0;player.y=1.65; jumpHeight=0;jumpVelocity=0;yaw=spawnSide===1?Math.PI:0;pitch=0;hp=100;score=0;slowReadyAt=0;dashReadyAt=0;
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
  player.x=spawnX;player.z=spawnSide*29.0;hp=100;score=0;deaths=0;yaw=spawnSide===1?Math.PI:0;pitch=0;jumpHeight=0;jumpVelocity=0;slowReadyAt=0;dashReadyAt=0;dead=false;weaponKick=0;
  $('health').textContent='100';$('healthBar').style.width='100%';$('score').textContent='0';$('deaths').textContent='0';$('matchScore').textContent='0 — 0'; ammo=30;reserveAmmo=120;fireHeld=false;aimHeld=false;reloadUntil=0;updateAmmoHud();
  if(botMode){botRoot=makeCharacter(0x8b9b78,'TRAINING BOT');botRoot.position.set(0,0,-29);bot={x:0,z:-29,hp:100,shotAt:0,respawnAt:0};}
  camera.position.set(player.x,player.y+jumpHeight,player.z);camera.rotation.set(pitch,yaw,0);camera.add(weapon); weapon.position.set(0,0,0);
  matchOverShown=false;roundNumber=1;$('roundNumber').textContent='1';$('maxRounds').textContent='10';$('points').textContent='0';$('roundWins').textContent='0';roundEndsAt=Date.now()+180000;
  running=true;paused=false;game.classList.remove('hidden');menu.classList.add('hidden');$('pause').classList.add('hidden');toast.textContent='Щёлкни по арене, чтобы захватить мышь';clock.start();animate();
}
function ensureOnlineScene() {
  // `running` alone is not sufficient: a stale training/session flag can be true while the menu is visible.
  const menuVisible = !menu.classList.contains('hidden');
  const gameHidden = game.classList.contains('hidden');
  if (!running || menuVisible || gameHidden) startScene();
  if (menu.classList.contains('hidden') && !game.classList.contains('hidden')) return;
  throw new Error('меню осталось открытым после запуска сцены');
}
function joinOnline(mode='friend') {
  // A fresh join must never inherit a stale identity or a hidden/menu scene state.
  myId=null; remotes.clear();
  if(ws) { try{ws.onclose=null;ws.close()}catch{} ws=null; }
  const proto=location.protocol==='https:'?'wss':'ws'; ws=new WebSocket(`${proto}://${location.host}/ws`);
  statusEl.textContent='Подключение к серверу…';
  ws.onopen=()=>{const name=$('callsign').value.trim()||'Operative';if(mode==='quick'){statusEl.textContent='Ищем случайного соперника…';ws.send(JSON.stringify({type:'quick-match',name}));}else ws.send(JSON.stringify({type:'join',room:$('roomCode').value.trim()||'FRIEND',name}));};
  ws.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{statusEl.textContent='Сервер прислал некорректный ответ';return}
    if(m.type==='error'){statusEl.textContent=m.message;toast.textContent=m.message;return}
    if(m.type==='queue-status'){statusEl.textContent=m.message;return}
    if(m.type==='match-found'){statusEl.textContent='Соперник найден! Подключаем арену…';ws.send(JSON.stringify({type:'join',room:m.room,name:$('callsign').value.trim()||'Operative'}));return;}
    if(m.type==='joined'){
      $('friendRoomPanel').classList.add('hidden');
      myId=m.id;spawnSide=m.slot===1?1:-1;spawnX=m.slot===1?-3.2:3.2;roundNumber=m.round||1;roundEndsAt=m.roundEndsAt||0;roundState=m.roundState||'waiting';roomName=m.room;$('roomLabel').textContent=roomName;$('roundNumber').textContent=roundNumber;
      statusEl.textContent='Подключено. Комната '+roomName;
      try { ensureOnlineScene(); toast.textContent='Сетевой режим: ждём второго игрока'; }
      catch(err){ console.error('RIFT startScene failed:',err); statusEl.textContent='Сервер подключён, но арена не открылась: '+(err?.message||err); toast.textContent='Ошибка запуска сцены'; }
    }
    if(m.type==='snapshot'){
      // Recovery path: the personalized snapshot can start the match even if the joined event was missed by a stale tab.
      if(online && m.selfId && !myId){myId=m.selfId;spawnSide=m.slot===1?1:-1;spawnX=m.slot===1?-3.2:3.2;roomName=m.room;$('roomLabel').textContent=roomName;statusEl.textContent='Подключено. Комната '+roomName;}
      if(online && myId && (menu.classList.contains('hidden')===false || game.classList.contains('hidden') || !running)){try{ensureOnlineScene();}catch(err){console.error('RIFT snapshot start failed:',err);statusEl.textContent='Не удалось открыть арену: '+(err?.message||err);}}
      if(myId) updateSnapshot(m);
    }
    if(m.type==='ability'&&m.name==='slow'){slowReadyAt=performance.now()+m.cooldown;toast.textContent='TIME SHIFT активирован';}
  };
  ws.onerror=()=>{statusEl.textContent='Не удалось подключиться. Проверь сервер и попробуй снова.'};
  ws.onclose=()=>{if(online){if(running)toast.textContent='Соединение закрыто — вернись в меню и подключись снова';else statusEl.textContent='Соединение закрыто. Нажми сетевую дуэль ещё раз.';} online=false;};
}
function updateSnapshot(m) {
  const previousRound=roundNumber, previousState=roundState;
  $('maxRounds').textContent=m.maxRounds||10;
  if(m.round){roundNumber=m.round;$('roundNumber').textContent=roundNumber;$('topRound').textContent=roundNumber;}
  roundState=m.roundState||'waiting';roundEndsAt=m.roundEndsAt||0;intermissionEndsAt=m.intermissionEndsAt||0;
  if(online && m.round && m.round!==previousRound){
    player.x=spawnX;player.z=spawnSide*29.0;yaw=spawnSide===1?Math.PI:0;pitch=0;jumpHeight=0;jumpVelocity=0;dead=false;hp=100;camera.position.set(player.x,player.y,player.z);camera.rotation.set(pitch,yaw,0);
    if(deathOverlay){deathOverlay.classList.add('hidden');deathOverlay.querySelector('#respawnBtn').classList.remove('hidden');}
    paused=false;matchOverShown=false;toast.textContent=`РАУНД ${roundNumber} · БОЙ!`;
  }
  if(roundState==='intermission'&&previousState!=='intermission'){
    if(document.pointerLockElement)document.exitPointerLock();paused=true;keys.clear();fireHeld=false;aimHeld=false;
  }
  if(roundState==='playing'&&previousState!=='playing'&&!m.matchOver){paused=false;}
  const mine=m.players.find(p=>p.id===myId), rival=m.players.find(p=>p.id!==myId);
  const mineWins=mine?.roundWins||0,rivalWins=rival?.roundWins||0;
  $('matchScore').textContent=`${mineWins} — ${rivalWins}`;$('topMatchScore').innerHTML=`${mineWins} <i>—</i> ${rivalWins}`;$('topScoreOne').textContent=mineWins;$('topScoreTwo').textContent=rivalWins;
  $('teamOneName').textContent=(mine?.name||'ОПЕРАТИВНИК 1').toLocaleUpperCase();$('teamTwoName').textContent=(rival?.name||'ОЖИДАНИЕ СОПЕРНИКА').toLocaleUpperCase();$('points').textContent=mine?.points||0;$('roundWins').textContent=mineWins;
  if(m.matchOver&&!matchOverShown){matchOverShown=true;paused=true;dead=true;if(document.pointerLockElement)document.exitPointerLock();if(deathOverlay){deathOverlay.classList.remove('hidden');const won=m.winnerId===myId;deathOverlay.querySelector('h2').textContent=won?'ПОБЕДА':'МАТЧ ОКОНЧЕН';deathOverlay.querySelector('p').textContent=m.roundNotice||'Серия из 10 раундов завершена';deathOverlay.querySelector('#respawnBtn').classList.add('hidden');deathOverlay.querySelector('small').textContent=`Итог: ${mine?.roundWins||0} раундов · ${mine?.points||0} очков`;}toast.textContent=m.roundNotice||'МАТЧ ОКОНЧЕН';}
  if(m.roundNotice&&m.roundNotice!==lastRoundNotice){lastRoundNotice=m.roundNotice;toast.textContent=m.roundNotice;}
  for(const p of m.players){
    if(p.id===myId){const wasDown=dead||hp<=0;hp=p.hp;score=p.score;deaths=p.deaths||0;$('health').textContent=hp;$('healthBar').style.width=hp+'%';$('score').textContent=score;$('deaths').textContent=deaths;
      if(hp<=0&&roundState==='intermission')showDeath();
      else if(hp>0&&wasDown){dead=false;deathAt=0;if(deathOverlay)deathOverlay.classList.add('hidden');}
      continue;
    }
    let r=remotes.get(p.id);if(!r){const mesh=makeCharacter(0xb5a16e,p.name);r={mesh,data:null};remotes.set(p.id,r);}
    if(r.data&&r.data.hp>0&&p.hp<=0){spawnShatter(r.mesh.position.x,r.mesh.position.z,0xb5a16e);r.mesh.visible=false;}
    if(p.hp>0)r.mesh.visible=true;
    r.data=p;r.mesh.position.set(p.x,0,p.z);r.mesh.rotation.y=p.yaw;
    if(Date.now()<p.slowedUntil)r.mesh.traverse(o=>{if(o.material?.color)o.material.color.set(0x7e9b9d)});
  }
  for(const [id,r] of remotes)if(!m.players.some(p=>p.id===id)){scene.remove(r.mesh);remotes.delete(id);}
  if(online&&remotes.size===0&&!m.matchOver)toast.textContent='Комната '+roomName+': ждём второго игрока';
}
function collides(x,z,radius=.42,feetY=0) {
  if(x < -33.5+radius || x > 33.5-radius || z < -33.5+radius || z > 33.5-radius)return true;
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
function spawnShatter(x,z,color=0xb5a16e){
  if(!scene)return;
  const uniform=new THREE.MeshStandardMaterial({color,roughness:.72,transparent:true});
  const dark=new THREE.MeshStandardMaterial({color:0x242b2d,roughness:.6,transparent:true});
  const skin=new THREE.MeshStandardMaterial({color:0xb6a18b,roughness:.8,transparent:true});
  const boot=new THREE.MeshStandardMaterial({color:0x171b1c,roughness:.8,transparent:true});
  // Fragments resemble the actual character: torso capsule, helmet/head, shoulder/arm ovals, legs and boots.
  const pieces=[
    [new THREE.CapsuleGeometry(.29,.58,5,10),uniform,0,1.03,0,.8],
    [new THREE.SphereGeometry(.205,14,10),skin,0,1.68,0,1.2],
    [new THREE.SphereGeometry(.21,12,8,0,Math.PI*2,0,Math.PI*.52),dark,0,1.72,0,1.4],
    [new THREE.CapsuleGeometry(.085,.37,4,8),uniform,-.36,1.09,-.02,1.1],
    [new THREE.CapsuleGeometry(.085,.37,4,8),uniform,.36,1.09,-.02,1.1],
    [new THREE.CapsuleGeometry(.105,.43,4,8),uniform,-.16,.53,0,1.0],
    [new THREE.CapsuleGeometry(.105,.43,4,8),uniform,.16,.53,0,1.0],
    [new THREE.BoxGeometry(.19,.12,.31),boot,-.16,.28,-.065,1.5],
    [new THREE.BoxGeometry(.19,.12,.31),boot,.16,.28,-.065,1.5],
    [new THREE.BoxGeometry(.58,.38,.3),dark,0,1.1,-.015,1.25],
    [new THREE.BoxGeometry(.15,.13,.48),dark,.23,1.22,-.4,1.6]
  ];
  for(const [geometry,material,ox,oy,oz,power] of pieces){
    const mesh=new THREE.Mesh(geometry,material.clone());mesh.position.set(x+ox*.65,Math.max(.25,oy),z+oz);mesh.rotation.set(Math.random()*2,Math.random()*2,Math.random()*2);mesh.castShadow=false;scene.add(mesh);
    const a=Math.random()*Math.PI*2,s=power*(.7+Math.random()*1.2);shatterEffects.push({mesh,vx:Math.cos(a)*s+(ox*.8),vy:1.2+Math.random()*3.4,vz:Math.sin(a)*s+(oz*.8),life:1.0+Math.random()*.5,maxLife:1.5});
  }
}
function updateShatter(dt){for(let i=shatterEffects.length-1;i>=0;i--){const p=shatterEffects[i];p.life-=dt;p.vy-=7*dt;p.mesh.position.x+=p.vx*dt;p.mesh.position.y+=p.vy*dt;p.mesh.position.z+=p.vz*dt;p.mesh.rotation.x+=dt*7;p.mesh.rotation.y+=dt*9;p.mesh.material.opacity=Math.max(0,p.life/p.maxLife);p.mesh.material.transparent=true;if(p.life<=0){scene.remove(p.mesh);p.mesh.geometry.dispose();p.mesh.material.dispose();shatterEffects.splice(i,1);}}}
function showDeath(){if(dead)return;dead=true;deathAt=performance.now();const thisDeath=deathAt;spawnShatter(player.x,player.z,0xb5a16e);keys.clear();if(document.pointerLockElement)document.exitPointerLock();paused=online;$('pause').classList.add('hidden');if(deathOverlay){deathOverlay.classList.add('hidden');if(online)deathOverlay.querySelector('#respawnBtn').classList.add('hidden');}toast.textContent='ОПЕРАТИВНИК РАСФРАГМЕНТИРОВАН';setTimeout(()=>{if(dead&&deathAt===thisDeath&&!matchOverShown&&deathOverlay)deathOverlay.classList.remove('hidden');},850);}
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
  if(botRoot&&target===botRoot){bot.hp-=damage;toast.textContent='ПОПАДАНИЕ: '+zone+' · -'+damage+' · '+Math.max(0,bot.hp)+' HP';shotCounter=aimHeld?0:shotCounter;if(bot.hp<=0){score++;$('score').textContent=score;bot.hp=100;bot.x=(Math.random()-.5)*8;bot.z=-(24+Math.random()*5);if(collides(bot.x,bot.z,.5)){bot.x=0;bot.z=-29;}botRoot.position.set(bot.x,0,bot.z);toast.textContent='ЦЕЛЬ УСТРАНЕНА · +1';}return;}
  for(const [id,r] of remotes)if(r.mesh===target&&ws?.readyState===1){ws.send(JSON.stringify({type:'hit',target:id,zone,damage}));toast.textContent='ПОПАДАНИЕ: '+zone;break;}
}
function drawMinimap() {
  const canvas=$('minimap'); if(!canvas) return;
  const ctx=canvas.getContext('2d'); if(!ctx) return;
  const w=canvas.width,h=canvas.height,scale=w/68;
  ctx.clearRect(0,0,w,h);ctx.fillStyle='#1a2426';ctx.fillRect(0,0,w,h);
  // Subtle tactical grid. World coordinates span -20..20 on both axes.
  ctx.strokeStyle='#344246';ctx.lineWidth=1;
  for(let n=-30;n<=30;n+=10){const x=(n+34)*scale,z=(n+34)*scale;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();ctx.beginPath();ctx.moveTo(0,z);ctx.lineTo(w,z);ctx.stroke();}
  // Render every solid collider as a top-down footprint, including walls and cover.
  for(const c of colliders){
    const x=(c.x-c.hx+34)*scale,y=(c.z-c.hz+34)*scale;
    ctx.fillStyle=(c.hy>1.45)?'#82908e':'#586664';
    ctx.fillRect(x,y,Math.max(2,c.hx*2*scale),Math.max(2,c.hz*2*scale));
    ctx.strokeStyle='#a0aaa4';ctx.lineWidth=.7;ctx.strokeRect(x,y,Math.max(2,c.hx*2*scale),Math.max(2,c.hz*2*scale));
  }
  // Player arrow points in the current view direction.
  const px=(player.x+34)*scale,pz=(player.z+34)*scale;
  ctx.save();ctx.translate(px,pz);ctx.rotate(yaw);ctx.fillStyle='#c3e36b';ctx.strokeStyle='#efffc0';ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(0,-7);ctx.lineTo(5,5);ctx.lineTo(0,3);ctx.lineTo(-5,5);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
  // Fog-of-war rule: opponents and training bots are never drawn on the minimap.
  ctx.strokeStyle='#c3e36b';ctx.lineWidth=2;ctx.strokeRect(1,1,w-2,h-2);
}
function animate() {
  if(!running)return;requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.04);updateShatter(dt);if(!paused){movePlayer(dt);if(fireHeld)shoot();const targetFov=aimHeld?48:baseFov;if(Math.abs(camera.fov-targetFov)>.1){camera.fov+=(targetFov-camera.fov)*Math.min(1,dt*12);camera.updateProjectionMatrix();}
    if(bot&&botRoot&&!dead){const t=performance.now();if(t>bot.respawnAt){const dx=player.x-bot.x,dz=player.z-bot.z,d=Math.hypot(dx,dz);if(d>2.15)moveBotToward(dx,dz,dt);botRoot.rotation.y=Math.atan2(player.x-bot.x,player.z-bot.z);
      const blocked=lineBlocked(bot.x,bot.z,player.x,player.z);if(d<13&&!blocked&&t-bot.shotAt>1250){bot.shotAt=t;if(Math.random()>.30){hp=Math.max(0,hp-10);$('health').textContent=hp;$('healthBar').style.width=hp+'%';if(hp===0)showDeath();}}
      const moving=d>2.15;for(const limb of botRoot.userData.limbs||[]){limb.pivot.rotation.x=moving?Math.sin(t*.009)*(limb.kind==='leg'?.62:.28)*(limb.side===1?1:-1):0;}
    }}
    // subtle weapon sway and recoil
    walkPhase+=dt*9;const moving=keys.has('KeyW')||keys.has('KeyA')||keys.has('KeyS')||keys.has('KeyD');if(weapon){weaponKick=Math.max(0,weaponKick-dt*.75);weapon.position.y=(moving?Math.sin(walkPhase)*.008:0)-weaponKick*.45;weapon.position.x=(moving?Math.cos(walkPhase*.5)*.006:0);weapon.rotation.x=-weaponKick;}
    camera.position.set(player.x,player.y+jumpHeight,player.z);camera.rotation.set(pitch,yaw,0);
    if(online&&ws?.readyState===1&&performance.now()-lastNetSend>65&&!dead){lastNetSend=performance.now();ws.send(JSON.stringify({type:'state',x:player.x,z:player.z,yaw}));}
    const secondsLeft=roundState==='playing'&&roundEndsAt?Math.max(0,Math.ceil((roundEndsAt-Date.now())/1000)):roundState==='intermission'&&intermissionEndsAt?Math.max(0,Math.ceil((intermissionEndsAt-Date.now())/1000)):null;const timerText=secondsLeft===null?(roundState==='finished'?'ФИНИШ':'ОЖИДАНИЕ'):roundState==='intermission'?`СЛЕД. РАУНД ${secondsLeft}`:String(Math.floor(secondsLeft/60)).padStart(2,'0')+':'+String(secondsLeft%60).padStart(2,'0');$('roundTimer').textContent=timerText;$('topTimer').textContent=timerText;$('slowText').textContent=performance.now()<slowReadyAt?'ПЕРЕЗАРЯДКА':'ГОТОВО';$('slowAbility').style.opacity=performance.now()<slowReadyAt?'.55':'1';drawMinimap();
  }
  renderer.render(scene,camera);
}
function leaveGame() { running=false;paused=false;game.classList.add('hidden');menu.classList.remove('hidden');if(document.pointerLockElement)document.exitPointerLock();if(ws){ws.close();ws=null;}online=false;botMode=false;statusEl.textContent='В меню'; }
deathOverlay=document.createElement('div');deathOverlay.id='deathScreen';deathOverlay.className='death-screen hidden';deathOverlay.innerHTML='<div class="death-kicker">RIFT//ZERO · COMBAT LOG</div><h2>YOU ARE DOWN</h2><p>Оперативник рассыпается на фрагменты</p><div class="death-rule"></div><button id="respawnBtn" class="primary">ВОЗРОДИТЬСЯ СЕЙЧАС</button><small>Автовозрождение через 2,4 секунды на своём спавне</small>';game.appendChild(deathOverlay);
$('respawnBtn').addEventListener('click',()=>{if(online&&ws?.readyState===1){ws.send(JSON.stringify({type:'respawn'}));}else{dead=false;paused=false;hp=100;player.x=spawnX;player.z=spawnSide*29.0;yaw=spawnSide===1?Math.PI:0;pitch=0;$('health').textContent='100';$('healthBar').style.width='100%';deathOverlay.classList.add('hidden');deathAt=0;toast.textContent='ВОЗРОЖДЕНИЕ · 100 HP';if(!pointerLocked)$('view').requestPointerLock?.();}});
$('onlineBtn').addEventListener('click',()=>{if(ws && ws.readyState<=1){statusEl.textContent='Подключение или поиск уже выполняется…';return;}online=true;botMode=false;joinOnline('quick')});
$('friendBtn').addEventListener('click',()=>{$('friendRoomPanel').classList.toggle('hidden');statusEl.textContent='Для игры с другом введите одинаковый код комнаты на обоих устройствах.';});
$('friendJoinBtn').addEventListener('click',()=>{if(ws && ws.readyState<=1){statusEl.textContent='Подключение уже выполняется…';return;}online=true;botMode=false;joinOnline('friend')});
$('botBtn').addEventListener('click',()=>{online=false;botMode=true;roomName='TRAINING';$('roomLabel').textContent='TRAINING';statusEl.textContent='Тренировочный режим';startScene()});
$('leaveBtn').addEventListener('click',leaveGame);
$('view').addEventListener('click',()=>{if(running&&!paused&&!pointerLocked){ignoreNextMouseMove=true;$('view').requestPointerLock?.()}});
document.addEventListener('pointerlockchange',()=>{pointerLocked=document.pointerLockElement===$('view');ignoreNextMouseMove=true;lastMouseMoveAt=performance.now();if(!pointerLocked){fireHeld=false;aimHeld=false;game.classList.remove('aiming');camera&&(camera.fov=baseFov,camera.updateProjectionMatrix());updateAmmoHud();}if(running&&!pointerLocked&&!paused&&!dead){paused=true;$('pause').classList.remove('hidden')}});
document.addEventListener('mousemove',e=>{if(!pointerLocked||paused)return;const now=performance.now();if(ignoreNextMouseMove){ignoreNextMouseMove=false;lastMouseMoveAt=now;return;}lastMouseMoveAt=now;const mx=Number(e.movementX)||0,my=Number(e.movementY)||0;if(Math.abs(mx)>900||Math.abs(my)>900)return;const sensitivity=aimHeld?.0021:.0042;yaw-=mx*sensitivity;pitch-=my*sensitivity;pitch=Math.max(-1.42,Math.min(1.42,pitch));});
document.addEventListener('keydown',e=>{if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();if(e.code==='KeyR'){reloadWeapon();return;}keys.add(e.code);if(!running)return;if(e.code==='Escape'){if(paused){paused=false;$('pause').classList.add('hidden');ignoreNextMouseMove=true;$('view').requestPointerLock?.()}else if(pointerLocked)document.exitPointerLock();}if(e.code==='ShiftLeft'||e.code==='ShiftRight')dash();if(e.code==='KeyQ')slowTime();if(e.code==='Space'&&running&&!paused&&!dead&&jumpVelocity===0){jumpVelocity=7.2;}if(e.code==='Digit1'){setWeapon(1);ammo=30;updateAmmoHud()}if(e.code==='Digit2'){setWeapon(2);updateAmmoHud()}});
document.addEventListener('keyup',e=>keys.delete(e.code));document.addEventListener('mousedown',e=>{if(!pointerLocked||paused)return;if(e.button===0){fireHeld=true;shotCounter=0;shoot()}if(e.button===2){aimHeld=true;shotCounter=0;game.classList.add('aiming');updateAmmoHud()}});document.addEventListener('mouseup',e=>{if(e.button===0){fireHeld=false;shotCounter=0}if(e.button===2){aimHeld=false;game.classList.remove('aiming');updateAmmoHud()}});document.addEventListener('contextmenu',e=>{if(running)e.preventDefault()});
window.addEventListener('resize',()=>{if(!renderer||!camera)return;camera.aspect=window.innerWidth/window.innerHeight;camera.updateProjectionMatrix();renderer.setSize(window.innerWidth,window.innerHeight);});
