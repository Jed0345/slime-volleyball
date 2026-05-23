// Determinism + rollback-correctness harness. Faithfully mirrors the sim core
// in public/index.html (same constants, same physics, Math.sqrt not hypot) and
// checks the two properties rollback relies on:
//   A) save -> advance -> restore -> replay == continuous simulation (bit-exact)
//   B) predict-opponent-wrong + rollback == having had the correct input all along
// Run: node rollback.test.js

// ---- constants (mirror index.html) ----
var W = 750, H = 375;
var GROUND = H - 26, WALL = 6, FIELD_L = WALL, FIELD_R = W - WALL;
var GRAV = 1.38, MOVE = 6.25, JUMP = 20.0;
var SLIME_R = 40, BALL_R = 11, NET_W = 6, NET_H = 56, netX = W / 2;
var BALL_GRAV = 0.30, MAX_RISE = 130, MAX_UP = Math.sqrt(2 * BALL_GRAV * MAX_RISE);
var MAX_VX = 11.0, MAX_SPEED = 17.0, WALL_BOUNCE = 0.7, WIN = 6;

// ---- mutable game state ----
var p1, p2, ball, scores, state, server;
function resetSlimes(){
  p1.x = W*0.25; p1.y = GROUND; p1.vx=0; p1.vy=0; p1.onGround=true;
  p2.x = W*0.75; p2.y = GROUND; p2.vx=0; p2.vy=0; p2.onGround=true;
}
function resetPositions(toServer){
  resetSlimes();
  var sx = (toServer==='p1') ? W*0.25 : W*0.75;
  ball = {x:sx, y:GROUND-170, vx:0, vy:0, r:BALL_R, live:false};
}
function newMatch(){
  p1 = {x:0,y:GROUND,vx:0,vy:0,r:SLIME_R,left:true,onGround:true};
  p2 = {x:0,y:GROUND,vx:0,vy:0,r:SLIME_R,left:false,onGround:true};
  scores = {p1:0,p2:0}; server='p1'; state='point';
  resetPositions(server);
}

// ---- physics (copied from index.html, pure / no DOM) ----
function moveSlime(s, mvLeft, mvRight, jump, spd){
  s.vx = 0;
  if(mvLeft) s.vx = -spd;
  if(mvRight) s.vx = spd;
  s.x += s.vx;
  if(jump && s.onGround){ s.vy = -JUMP; s.onGround = false; }
  s.vy += GRAV;
  s.y += s.vy;
  if(s.y >= GROUND){ s.y = GROUND; s.vy = 0; s.onGround = true; }
  if(s.left){
    if(s.x < FIELD_L + s.r) s.x = FIELD_L + s.r;
    if(s.x > netX - NET_W/2 - s.r) s.x = netX - NET_W/2 - s.r;
  } else {
    if(s.x < netX + NET_W/2 + s.r) s.x = netX + NET_W/2 + s.r;
    if(s.x > FIELD_R - s.r) s.x = FIELD_R - s.r;
  }
}
function collideSlime(s){
  var dx = ball.x - s.x, dy = ball.y - s.y;
  var dist = Math.sqrt(dx*dx + dy*dy);
  var minD = s.r + ball.r;
  if(dist >= minD || dy > 0) return;
  var nx, ny;
  if(dist < 0.01){ nx = 0; ny = -1; } else { nx = dx/dist; ny = dy/dist; }
  ball.x = s.x + nx*(minD+0.5); ball.y = s.y + ny*(minD+0.5);
  var rvx = ball.vx - s.vx, rvy = ball.vy - s.vy;
  var vn = rvx*nx + rvy*ny;
  if(vn < 0){
    var refX = rvx - 2*vn*nx, refY = rvy - 2*vn*ny;
    var speed = Math.sqrt(refX*refX + refY*refY);
    var BLEND = 0.6;
    var bx = (1-BLEND)*refX + BLEND*nx*speed, by = (1-BLEND)*refY + BLEND*ny*speed;
    var bmag = Math.sqrt(bx*bx + by*by) || 1;
    refX = bx/bmag*speed; refY = by/bmag*speed;
    ball.vx = refX + s.vx; ball.vy = refY + s.vy;
    if(ball.vy < -MAX_UP) ball.vy = -MAX_UP;
    if(ball.vx > MAX_VX) ball.vx = MAX_VX;
    if(ball.vx < -MAX_VX) ball.vx = -MAX_VX;
    var sp = Math.sqrt(ball.vx*ball.vx + ball.vy*ball.vy);
    if(sp>MAX_SPEED){ ball.vx*=MAX_SPEED/sp; ball.vy*=MAX_SPEED/sp; }
  }
}
function scorePoint(who){ // pure (the simReplaying=true branch)
  if(state!=='play') return;
  scores[who]++; server = who;
  if(scores[who] >= WIN) state = 'gameover';
  else { state = 'point'; resetSlimes(); }
}
function updateBall(){
  if(!ball.live) return;
  ball.vy += BALL_GRAV;
  var steps = Math.max(1, Math.ceil(Math.sqrt(ball.vx*ball.vx + ball.vy*ball.vy) / (ball.r * 0.5)));
  var stepX = ball.vx / steps, stepY = ball.vy / steps;
  var netLeft = netX - NET_W/2, netRight = netX + NET_W/2, netTop = GROUND - NET_H;
  for(var i=0; i<steps; i++){
    ball.x += stepX; ball.y += stepY;
    if(ball.x < FIELD_L + ball.r){ ball.x = FIELD_L + ball.r; ball.vx = Math.abs(ball.vx)*WALL_BOUNCE; }
    if(ball.x > FIELD_R - ball.r){ ball.x = FIELD_R - ball.r; ball.vx = -Math.abs(ball.vx)*WALL_BOUNCE; }
    if(ball.x+ball.r > netLeft && ball.x-ball.r < netRight && ball.y+ball.r > netTop){
      if(ball.y < netTop && ball.vy>0){ ball.vy = -Math.abs(ball.vy)*0.8; ball.y = netTop - ball.r; }
      else { if(ball.x < netX){ ball.x = netLeft - ball.r; ball.vx = -Math.abs(ball.vx); } else { ball.x = netRight + ball.r; ball.vx = Math.abs(ball.vx); } }
    }
    collideSlime(p1); collideSlime(p2);
    if(ball.y >= GROUND - ball.r){
      ball.y = GROUND - ball.r; ball.live = false;
      if(ball.x < netX) scorePoint('p2'); else scorePoint('p1');
      return;
    }
    stepX = ball.vx / steps; stepY = ball.vy / steps;
  }
}
function startPoint(){
  if(state==='menu' || state==='point' || state==='gameover'){
    if(state==='gameover'){ scores={p1:0,p2:0}; }
    resetPositions(server); ball.live = true; state = 'play';
  }
}
function simStep(inA, inB){
  if(state === 'gameover') return;
  if(state !== 'play'){
    var srv = (server === 'p1') ? inA : inB;
    if(srv && srv.jump) startPoint();
    if(state !== 'play') return;
  }
  moveSlime(p1, inA.left, inA.right, inA.jump, MOVE);
  moveSlime(p2, inB.left, inB.right, inB.jump, MOVE);
  updateBall();
}
function getGameState(){
  return {p1:{x:p1.x,y:p1.y,vx:p1.vx,vy:p1.vy,g:p1.onGround},
          p2:{x:p2.x,y:p2.y,vx:p2.vx,vy:p2.vy,g:p2.onGround},
          ball:{x:ball.x,y:ball.y,vx:ball.vx,vy:ball.vy,live:ball.live},
          a:scores.p1,b:scores.p2,sv:server,st:state};
}
function setGameState(s){
  p1.x=s.p1.x;p1.y=s.p1.y;p1.vx=s.p1.vx;p1.vy=s.p1.vy;p1.onGround=s.p1.g;
  p2.x=s.p2.x;p2.y=s.p2.y;p2.vx=s.p2.vx;p2.vy=s.p2.vy;p2.onGround=s.p2.g;
  ball.x=s.ball.x;ball.y=s.ball.y;ball.vx=s.ball.vx;ball.vy=s.ball.vy;ball.live=s.ball.live;
  scores.p1=s.a;scores.p2=s.b;server=s.sv;state=s.st;
}

// ---- deterministic input stream (seeded) ----
function rng(seed){ var s = seed>>>0; return function(){ s = (s*1664525 + 1013904223)>>>0; return s/4294967296; }; }
function makeInputs(seed, n){
  var r = rng(seed), a = [], b = [], ha={left:false,right:false,jump:false}, hb={left:false,right:false,jump:false};
  for(var f=0; f<n; f++){
    // change inputs occasionally to mimic held keys with bursts; serve early
    if(r()<0.15) ha = {left:r()<0.4, right:r()<0.4, jump:r()<0.3};
    if(r()<0.15) hb = {left:r()<0.4, right:r()<0.4, jump:r()<0.3};
    if(f===3) ha = {left:false,right:false,jump:true};   // host serves at frame 3
    a.push({left:ha.left,right:ha.right,jump:ha.jump});
    b.push({left:hb.left,right:hb.right,jump:hb.jump});
  }
  return {a:a,b:b};
}
function fingerprint(){ var s=getGameState(); return JSON.stringify(s); }

// ---- Test A: continuous vs save/restore/replay ----
function testA(seed, N){
  var inp = makeInputs(seed, N);
  newMatch();
  for(var f=0; f<N; f++) simStep(inp.a[f], inp.b[f]);
  var cont = fingerprint();

  newMatch();
  var rrng = rng(seed ^ 0x9e3779b9);
  for(var f2=0; f2<N; f2++){
    if(rrng() < 0.2 && f2+5 < N){           // occasionally: save, run ahead, restore, replay
      var snap = getGameState(), at = f2;
      for(var k=0;k<5;k++) simStep(inp.a[at+k], inp.b[at+k]); // speculative advance
      setGameState(snap);                    // rollback
      // (continue normal loop from f2 — re-simulates the same frames)
    }
    simStep(inp.a[f2], inp.b[f2]);
  }
  var rolled = fingerprint();
  return cont === rolled;
}

// ---- Test B: wrong opponent prediction + rollback == perfect info ----
// Mirrors the real rbRemoteForFrame / rbOnRemoteInput. We are p1; p2's inputs
// "arrive" `delay` frames late, predicted as "repeat last confirmed" until then.
function eqIn(a,b){ return a.left===b.left && a.right===b.right && a.jump===b.jump; }
function testB(seed, N){
  var inp = makeInputs(seed, N);
  newMatch();
  for(var f=0; f<N; f++) simStep(inp.a[f], inp.b[f]); // truth: perfect info throughout
  var truth = fingerprint();

  newMatch();
  var saved={}, used={}, remote={}, frame=0, lastRemoteInput={left:false,right:false,jump:false}, lastRemoteFrame=-1;
  function remoteFor(f){ return remote[f] ? remote[f] : lastRemoteInput; }
  function simOne(){
    saved[frame] = getGameState();
    var ri = remoteFor(frame); used[frame] = ri;
    simStep(inp.a[frame], ri);
    frame++;
  }
  function deliver(f){                       // a confirmed remote input arrives
    if(f < 0 || f >= N || remote[f]) return;
    remote[f] = inp.b[f];
    if(f > lastRemoteFrame){ lastRemoteFrame = f; lastRemoteInput = inp.b[f]; }
    if(f < frame && used[f] && !eqIn(used[f], inp.b[f])){
      var target = frame; setGameState(saved[f]); frame = f;
      while(frame < target) simOne();
    }
  }
  while(frame < N){ simOne(); deliver(frame - 1 - delayB); } // delayB-frame-late delivery, in order
  for(var g = Math.max(0, frame - delayB - 1); g < N; g++) deliver(g); // flush trailing frames
  return truth === fingerprint();
}
var delayB = 3;

var pass = true;
for(var s=1; s<=50; s++){
  if(!testA(s*7+1, 400)){ console.log("FAIL test A (save/restore/replay) seed", s); pass=false; break; }
  if(!testB(s*13+5, 400)){ console.log("FAIL test B (predict+rollback) seed", s); pass=false; break; }
}
if(pass){
  // show a sample final state so we can see points were actually scored
  console.log("PASS: 50 seeds x 400 frames — rollback replay is bit-identical to continuous + perfect-info sim");
  testB(99, 400); console.log("sample final score:", JSON.stringify(scores), "state:", state);
}
process.exit(pass?0:1);
