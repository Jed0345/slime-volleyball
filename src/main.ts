// @ts-nocheck
// Slime Volleyball 2 — main game module (migrated from the inline <script>).
// TODO: incrementally split into modules (sim / netcode / render / ui) and add types.
(function(){
  var cv = document.getElementById('game');
  var ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  var W = cv.width, H = cv.height;

  var GROUND = H - 26;
  var WALL = 6;
  var FIELD_L = WALL, FIELD_R = W - WALL;

  var SKY_TOP = '#5cb3f5', SKY_BOT = '#2f86dd';
  var COURT = '#3aa838', COURTLINE = '#2f8f30';
  var COURT_DARK = '#2c8a2b';
  var CLOUD = '#ffffff', CLOUD_SHADE = '#dfeefb';
  var NETCOL = '#f4f4f4';

  // Environment theme: 'grassy' (the painted green court, default), 'city' (the
  // rooftop backdrop with drifting clouds), or 'beach' (a sunny beach court).
  var theme = 'grassy';
  try{ var _st = localStorage.getItem('slimeTheme'); if(_st === 'city' || _st === 'grassy' || _st === 'beach' || _st === 'finaldestination') theme = _st; }catch(e){}
  // Two layered backdrops for the city theme: a far skyline (drawn behind the
  // clouds) and a near rooftop with brick buildings/fence/floor (drawn in front
  // of the clouds). Both are the same size and share one destination rect.
  var cityBgImg = new Image(); var cityBgReady = false;
  cityBgImg.onload = function(){ cityBgReady = true; };
  cityBgImg.src = 'City%20Background.webp';
  var cityFgImg = new Image(); var cityFgReady = false;
  cityFgImg.onload = function(){ cityFgReady = true; };
  cityFgImg.src = 'City%20Foreground.webp';
  // Sky color filling the strip above the artwork (matches the skyline's top)
  // and the source-image row of the rooftop floor, so it lines up with GROUND.
  var CITY_SKY = '#018ffc';
  var CITY_FLOOR_SRC = 687;
  // Beach theme: a single full-scene backdrop (sky, sea, sandy court), scaled to
  // the court width and positioned so the sand court's front line sits on GROUND.
  var beachImg = new Image(); var beachReady = false;
  beachImg.onload = function(){ beachReady = true; };
  beachImg.src = 'Beach_Scene.webp';
  var fdImg = new Image(); var fdReady = false;
  fdImg.onload = function(){ fdReady = true; };
  fdImg.src = 'Finaldestination.webp';
  var BEACH_SKY = '#068cfc';     // fills any strip above the artwork (matches its top)
  var BEACH_FLOOR_SRC = 828;     // source row of the court's front line

  // Difficulty is built from SKILL, not size. Speeds scale to the player's MOVE
  // (6.25); rmul (body size) is kept nearly flat so a boss can't just wall off
  // the court. The real ramp comes from how each boss READS and PLACES the ball:
  //   react      - tracking tightness (1 = no lag; sets the dead zone)
  //   speed      - foot speed
  //   jumpChance - how eagerly it leaps to meet the ball
  //   anticip    - frames it reads ahead: low = chases the ball reactively and
  //                arrives late, high = already waiting where it'll land
  //   aim        - shot placement: 0 = bonks it straight back, 1 = reads the
  //                player's position and drives the return into the open zone
  //   spikeChance- how often it smashes (Power mode)
  //   counter    - chance to dig the player's spike back up (Power mode)
  //   drop       - occasional drop-shot at the net (Red's signature)
  // Every knob ramps monotonically: White -> Red -> Master -> Psycho -> Big Blue,
  // so each boss out-thinks the last rather than just out-sizing it.
  var OPPS = [
    {name:'White Slime',  col:'#f3f3f3', cold:'#8f8f8f', react:0.42, speed:4.4, jumpChance:0.105, rmul:1.0,  flash:false, anticip:1, aim:0},
    {name:'Red Slimons',  col:'#d83a3a', cold:'#8f1f1f', react:0.60, speed:5.4, jumpChance:0.1365, rmul:1.0,  flash:false, anticip:1.3, aim:0.30, drop:true},
    {name:'Slime Master', col:'#222222', cold:'#000000', react:0.74, speed:6.0, jumpChance:0.1611, rmul:1.04, flash:false, anticip:1.534, aim:0.60, spikeChance:0.07},
    {name:'Psycho Slime', col:'#c040d0', cold:'#5c1d6b', react:0.86, speed:6.4, jumpChance:0.1785, rmul:1.08, flash:true,  anticip:1.6997, aim:0.85, spikeChance:0.12, counter:0.30},
    {name:'Big Blue Boss',col:'#2a55d6', cold:'#16307e', react:0.94, speed:6.8, jumpChance:0.19, rmul:1.15, flash:false, anticip:1.8098, aim:1.0,  spikeChance:0.18, counter:0.55}
  ];
  var oppIdx = 0;
  // Single-player gauntlet: set when the player beats a boss, so the next serve
  // after the win screen advances to the next boss instead of replaying this one.
  var advanceToNextBoss = false;

  var GRAV = 1.38;
  var MOVE = 6.25;
  var JUMP = 20.0;
  var SLIME_R = 40, BALL_R = 11;
  var NET_W = 6, NET_H = 56;
  var netX = W/2;
  // Floaty ball (classic slime-volleyball feel): gentle gravity gives the ball
  // a long, readable hang time so rallies arc lazily like the original.
  var BALL_GRAV = 0.30;

  // Height cap: the ball can't rise more than MAX_RISE px above its hit point.
  // From kinematics: v_max = sqrt(2 * g * h). This doubles as the off-screen
  // guard together with the slime's jump height (see JUMP/GRAV): jumpHeight +
  // MAX_RISE must stay under ~287px so even a full-power apex spike can't push
  // the ball off the top — no ceiling collision needed.
  var MAX_RISE = 130;
  var MAX_UP = Math.sqrt(2 * BALL_GRAV * MAX_RISE);
  // Separate caps so the ball can bounce high (for juggling) without traveling
  // fast across the court: MAX_VX limits horizontal pace, MAX_UP limits bounce
  // height, and MAX_SPEED is just an overall safety net above both combined.
  var MAX_VX = 11.0;
  var MAX_SPEED = 17.0;
  // Side walls absorb some horizontal speed on each bounce, so a hard spike to
  // the far wall can't rebound all the way back across the court.
  var WALL_BOUNCE = 0.7;

  // --- Spike special move (down/S button) ----------------------------------
  // When the ball is on your own side, moving toward the opponent, high, fast,
  // and near the net, it "charges" (flashes). Pressing spike then launches the
  // slime up to the ball and smashes it into the open part of the opponent's
  // court (away from where they're standing). A spike can exceed the normal
  // MAX_VX — it's a power move — but the trajectory always clears the net.
  var SPIKE_SPEED   = 6.5;            // min ball speed (px/frame) to charge a spike
  var SPIKE_MAX_BALL_Y = GROUND - 100;// ball must be ABOVE this (smaller y = higher)
  var SPIKE_NET_DIST = 155;           // ...and within this many px of the net (so the
                                      //    smash can clear it from your own side)
  var SPIKE_VX      = 16.0;           // horizontal smash cap (above the normal MAX_VX)
  var SPIKE_VY      = 1.2;            // gentle initial dip; gravity steepens the fall,
                                      //    so it crosses the net flat then drops hard
  var SPIKE_COOLDOWN = 40;            // frames before the same slime can spike again
  var SPIKE_FX_FRAMES = 16;           // spike flash duration (visual only, not sim)
  var SPIKE_TRAIL_FRAMES = 30;        // how long the wave trail streams off a spike
  var SPIKE_GHOST_FRAMES = 20;        // after-image lifetime (frames) of the blended shadow trail
  var SPIKE_GHOST_STEPS  = 8;         // minimum dome stamps along the trail (density floor)
  var SPIKE_GHOST_BLUR   = 8;         // px of GPU canvas blur (motion-blur softness of the trail)
  // Counter (press down as a spiked ball reaches your side): get under it and
  // spring it gently back up into a controllable volley instead of conceding.
  var COUNTER_UP      = 5.5;          // upward pop speed of a countered ball
  var COUNTER_VX_KEEP = 0.18;         // fraction of the spike's cross-court speed kept
  // A counter is named by WHERE the ball was met. Three zones:
  //   BLOCK   - a central column (centered on the net) from the TOP of the screen
  //             down to BLOCK_ZONE_BOTTOM: you walled it off at the net.
  //   DIG     - a full-width band near the floor (DIG_ZONE_TOP down to the ground):
  //             a low save off the deck.
  //   COUNTER - anywhere else. Purely cosmetic labels (see showCounteredPop/draw).
  var BLOCK_ZONE_W      = 220;             // central BLOCK column width (centered on the net)
  var BLOCK_ZONE_CX     = netX;            // column center X
  var BLOCK_ZONE_BOTTOM = GROUND - NET_H - 6; // column runs from y=0 (screen top) down to just above the net
  var DIG_ZONE_TOP      = GROUND - NET_H;  // DIG band: this y down to the ground (net-top height)
  function counterKind(x, y){
    if(Math.abs(x - BLOCK_ZONE_CX) <= BLOCK_ZONE_W/2 && y <= BLOCK_ZONE_BOTTOM) return 'BLOCKED';
    if(y >= DIG_ZONE_TOP) return 'DIG';
    return 'COUNTER';
  }
  var DEBUG_COUNTER_ZONES = false;      // draw the zone overlay; toggle with the C key
  var lastCounterKind = 'COUNTER';      // render-only: kind of latest counter (BLOCKED/DIG/COUNTER)

  // Bounce SFX counters: the deterministic sim bumps bounceSeq on every ball
  // contact (slime/wall/net/floor) and bouncePlayerSeq only on slime hits. Both
  // are part of the saved game state so rollback replays restore them instead of
  // double-counting; draw() compares them once per render frame (replays never
  // reach draw()), plays at most one cue, and picks the volume by whether the
  // new contact included a player hit (surfaces play at half).
  var bounceSeq = 0, _lastBounceShown = 0;
  var bouncePlayerSeq = 0, _lastPlayerShown = 0;
  var counterSeq = 0, _lastCounterShown = 0; // popup cue: bumped on a successful counter

  var p1, p2, ball, scores, state, server, twoPlayer=false;
  // Manual pause for offline play (Enter key / tap the game screen). Online is
  // NOT pausable — rollback runs in lockstep, so a local freeze would desync.
  var userPaused = false;
  // Networking state: netMode is 'host', 'guest', or null (offline).
  var netMode = null;
  var hosting = false; // created/connected a room: Leave (red) replaces Create in the lobby
  var specCount = 0;     // host: how many spectators are watching
  var specTarget = null; // spectator: latest received state snapshot
  var _specFrame = 0;
  var netPaused = false; // true while the opponent is mid-reconnect (grace window)
  // Online uses ROLLBACK netcode: both peers run the identical deterministic
  // simulation, exchange only per-frame inputs, predict the opponent's input
  // when it hasn't arrived, and re-simulate ("roll back") when a prediction
  // turns out wrong. simReplaying is true whenever the sim is being advanced for
  // rollback so the physics produce NO DOM side-effects (presentNet() draws the
  // resulting state once per render instead). rb holds the live session.
  var simReplaying = false;
  var rb = null;
  // Round-trip latency to the relay for each side (shown in the ping indicator).
  var myPing = 0, peerPing = 0, pingTimer = null;
  // Which transport gameplay is actually on, for the on-screen indicator:
  // '' = relay (WS fallback), 'direct' = direct P2P, 'turn' = P2P via TURN relay.
  // rtcRtt is the measured peer round-trip over the data channel (ms).
  var rtcTransport = '', rtcRtt = 0;
  function nowMs(){ return (window.performance && performance.now) ? performance.now() : Date.now(); }

  var BLUE = '#2f7fd6', BLUE_D = '#1c3f6e';
  var PINK = '#e8537f', PINK_D = '#7a1f3a';

  // Six color presets shown as swatches; a custom color picker sits beside them.
  var SKINS = [
    '#2f7fd6', // blue
    '#e8537f', // pink
    '#5dd663', // green
    '#f4b73e', // yellow
    '#222222', // black
    '#f3f3f3'  // white
  ];
  // Ball color presets (pink, green, yellow, white) shown alongside the eyedropper.
  var BALL_SKINS = [
    '#e8537f', // pink
    '#5dd663', // green
    '#f4b73e', // yellow
    '#f3f3f3'  // white
  ];
  // Boss skins: cosmetic-only (color + optional effect). Cycled with the "Boss"
  // button; selecting one overrides the chosen color. The flash flag gives the
  // Psycho Slime skin the same strobing effect as the AI Psycho boss.
  var BOSS_SKINS = [
    { name:'White Slime',  color:'#f3f3f3' },
    { name:'Red Slimons',  color:'#d83a3a' },
    { name:'Slime Master', color:'#222222' },
    { name:'Psycho Slime', color:'#c040d0', flash:true },
    { name:'Big Blue Boss',color:'#2a55d6', rmul:1.15 } // a touch bigger, like the AI boss
  ];
  function bossSkinByName(name){
    for(var i=0;i<BOSS_SKINS.length;i++){ if(BOSS_SKINS[i].name === name) return BOSS_SKINS[i]; }
    return null;
  }
  // Per side: a chosen color and an optional boss skin name ('' = none).
  var slimeSkins = { p1: {color: BLUE, boss: ''}, p2: {color: PINK, boss: ''} };
  var ballColor = '#ffd23f'; // default gold; changeable in the skins panel
  // Special ball skins (cosmetic only), cycled with the "Ball" button. The
  // volleyball comes in three sizes, but the PHYSICS ball is always BALL_R, so
  // collisions are identical regardless of skin/size — and online stays
  // deterministic since the size only affects drawing (see drawBall).
  var BALL_BOSS = [
    { name:'Volleyball', style:'volleyball', rmul:1.3 },
    { name:'Beach Ball', style:'beachball', rmul:1.3 }
  ];
  var ballSkin = ''; // '' = plain colored ball; otherwise a BALL_BOSS name
  function ballBossByName(n){ for(var i=0;i<BALL_BOSS.length;i++){ if(BALL_BOSS[i].name===n) return BALL_BOSS[i]; } return null; }
  // The volleyball skin renders the Noto volleyball emoji (🏐, U+1F3D0) — same
  // source as the chat emojis. crossOrigin keeps the canvas untainted so the
  // pixi filters still work; a plain white ball shows until the image loads.
  var volleyImg = new Image();
  var volleyReady = false;
  volleyImg.crossOrigin = 'anonymous';
  volleyImg.onload = function(){ volleyReady = true; };
  volleyImg.src = 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f3d0/emoji.svg';
  // 'Beach Ball' ball skin: the hand-drawn volleyball (transparent SVG), drawn round in drawBall.
  var beachBallImg = new Image();
  var beachBallReady = false;
  beachBallImg.onload = function(){ beachBallReady = true; };
  beachBallImg.src = 'Beach_Volleyball.svg';
  var shadesImg = new Image(); var shadesReady = false;
  shadesImg.onload = function(){ shadesReady = true; };
  shadesImg.src = 'shades.svg';
  function skinDark(hex){ return darken(hex, 0.45); }

  // In online play, each side's scoreboard label shows the player's chosen
  // chat username. The remote name is whatever the peer last broadcast.
  var peerName = '';
  // Insert a soft hyphen (U+00AD) between every character so a too-long name wraps
  // WITH a visible dash at the break. A plain word-break shows no dash, and CSS
  // hyphens:auto only fires on real dictionary words — not on ALL-CAPS usernames.
  // The soft hyphen is invisible unless a line break actually lands on it.
  // Array.from() splits by code point so emoji/multi-byte names aren't broken.
  function softHyphens(s){ return Array.from(s == null ? '' : String(s)).join('­'); }
  function updateScoreboardNames(){
    if(!netMode) return; // offline: updateLabels() handles defaults
    var localName = (typeof chatUsername === 'string' && chatUsername) ? chatUsername : 'PLAYER';
    var remoteName = peerName || 'OPPONENT';
    var p1lbl = document.getElementById('p1name');
    var p2lbl = document.getElementById('p2name');
    if(netMode === 'host'){
      p1lbl.textContent = softHyphens(localName.toUpperCase());
      p2lbl.textContent = softHyphens(remoteName.toUpperCase());
    } else {
      p1lbl.textContent = softHyphens(remoteName.toUpperCase());
      p2lbl.textContent = softHyphens(localName.toUpperCase());
    }
  }

  function newSlime(left, opp){
    var r = SLIME_R * (left ? 1 : (opp?opp.rmul:1));
    return {x:0, y:GROUND, vx:0, vy:0, r:r, left:left,
            col: left?BLUE:(opp?opp.col:PINK),
            cold:left?BLUE_D:(opp?opp.cold:PINK_D),
            flash: (!left && opp) ? !!opp.flash : false, // AI boss (Psycho) flashes
            onGround:true,
            spikeCD:0, spikeHeld:false, // spike cooldown + edge-detect (sim state)
            counterTried:false}; // AI: rolled-for-this-spike flag (offline only; see aiControl)
  }
  function curOpp(){ return OPPS[oppIdx]; }

  function resetSlimes(){
    p1.x = W*0.25 - 20; p1.y = GROUND; p1.vx=0; p1.vy=0; p1.onGround=true;
    p2.x = W*0.75 + 20; p2.y = GROUND; p2.vx=0; p2.vy=0; p2.onGround=true;
  }
  function resetPositions(toServer){
    resetSlimes();
    var sx = (toServer==='p1') ? W*0.25 - 20 : W*0.75 + 20;
    ball = {x:sx, y:GROUND-170, vx:0, vy:0, r:BALL_R, live:false, spiked:false};
  }
  function init(){
    var opp = curOpp();
    p1 = newSlime(true, null);
    p2 = newSlime(false, twoPlayer?null:opp);
    if(twoPlayer){ p2.col=PINK; p2.cold=PINK_D; p2.r=SLIME_R; }
    applyLocalSkins();
    scores = {p1:0, p2:0};
    server = 'p1';
    state = 'menu';
    advanceToNextBoss = false;
    setWin(DEFAULT_WIN); // offline always plays to the default; also (re)renders the "FIRST TO N" label from WIN
    resetPositions(server);
    updateScore();
    updateLabels();
    if(typeof updateSkinPickerVisibility === 'function') updateSkinPickerVisibility();
  }

  // Resolve a side's chosen skin (color or boss) onto its slime object,
  // including the shifting-colors flag for animated boss skins.
  function applySkinToSlime(slime, side){
    if(!slime) return;
    var sk = slimeSkins[side];
    var b = sk.boss ? bossSkinByName(sk.boss) : null;
    var col = b ? b.color : sk.color;
    slime.col = col;
    slime.cold = skinDark(col);
    slime.flash = b ? !!b.flash : false;
    // Radius is part of the simulation. Online (rollback) it must be identical
    // on both peers and constant for the match, so boss skins stay color-only
    // there; offline, the Big Blue Boss skin can be larger.
    slime.r = (!netMode && b && b.rmul) ? SLIME_R * b.rmul : SLIME_R;
  }
  // Apply chosen skins to the controllable slimes. In 1P, p2 belongs to the AI
  // opponent, so we don't override it.
  function applyLocalSkins(){
    applySkinToSlime(p1, 'p1');
    if(twoPlayer || netMode) applySkinToSlime(p2, 'p2');
  }

  var DEFAULT_WIN = 6;
  var WIN = DEFAULT_WIN;
  var hostWin = DEFAULT_WIN; // the host's chosen target for the next online game
  var WIN_OPTIONS = [3, 5, 6, 7, 10, 15]; // values the host cycles with the Mode button

  // Gameplay ruleset. 'classic' = the original mechanics (default); 'power' =
  // Power Slime, which enables the spike special move. It's constant for a whole
  // match, so the sim can read it directly; online, the host's choice is synced
  // to the guest before the sim starts (see startOnlineMatch / handleNetMessage).
  var gameMode = 'classic';
  try{ var _gm = localStorage.getItem('slimeGameMode'); if(_gm === 'classic' || _gm === 'power') gameMode = _gm; }catch(e){}
  function gameModeLabel(m){ return m === 'power' ? 'Power Slime' : 'Classic Slime'; }
  // Reflect the current mode in the toggle label and the touch SPIKE button
  // (which is pointless outside Power Slime, so hide it in Classic).
  function updateGameModeUI(){
    var b = document.getElementById('gamemodebtn');
    if(b){
      b.textContent = gameModeLabel(gameMode);
      b.classList.toggle('rules-power', gameMode === 'power');   // yellow
      b.classList.toggle('rules-classic', gameMode !== 'power'); // blue
    }
    var sp = document.getElementById('joystick-spike');
    if(sp) sp.style.display = (gameMode === 'power') ? '' : 'none';
    // Power Slime spike/counter hint, shown only when those moves are active.
    // The below-game line keeps the "Power Slime:" prefix for context; the menu
    // copy (already inside the Rules pane) drops it.
    // In the Mode menu, the power-slime controls replace the basic control hint
    // when Power rules are on (the below-game copy still shows both).
    var _mch = document.getElementById('controlhint');
    if(_mch) _mch.style.display = (gameMode === 'power') ? 'none' : '';
    var _phFull = 'Power Slime: <b style="color:#fff36b">S</b> to spike, or to block/dig &nbsp;&middot;&nbsp; Counter zones: <b>C</b>';
    var _phShort = '<b style="color:#fff36b">S</b> to spike, or to block/dig &nbsp;&middot;&nbsp; Counter zones: <b>C</b>';
    var phs = document.querySelectorAll('.powerhint');
    for(var _pi=0; _pi<phs.length; _pi++){
      phs[_pi].innerHTML = (phs[_pi].id === 'powerhint') ? _phShort : _phFull;
      phs[_pi].style.display = (gameMode === 'power') ? '' : 'none';
    }
  }
  function updateWinModeBtn(){
    var b = document.getElementById('winmodebtn');
    if(b) b.textContent = 'Mode: First to ' + WIN;
  }
  // Set the points-to-win, rebuild the dot row, and refresh the "FIRST TO N"
  // label. Used offline (default) and online (host's choice, synced to guest).
  function setWin(n){
    n = parseInt(n, 10);
    WIN = (n >= 1 && n <= 99) ? n : DEFAULT_WIN;
    buildDots();
    var ft = document.getElementById('sv-firstto');
    if(ft) ft.textContent = 'FIRST TO ' + WIN;
    if(scores) updateScore();
  }
  function buildDots(){
    var rowP1 = document.getElementById('dots-p1');
    var rowP2 = document.getElementById('dots-p2');
    rowP1.innerHTML = ''; rowP2.innerHTML = '';
    for(var i=0;i<WIN;i++){
      var d1 = document.createElement('span'); d1.className = 'dot blue'; rowP1.appendChild(d1);
      var d2 = document.createElement('span'); d2.className = 'dot pink'; rowP2.appendChild(d2);
    }
  }
  function updateDots(){
    var d1 = document.getElementById('dots-p1').children;
    var d2 = document.getElementById('dots-p2').children;
    for(var i=0;i<d1.length;i++){ d1[i].classList.toggle('on', i < scores.p1); }
    for(var j=0;j<d2.length;j++){ d2[j].classList.toggle('on', j < scores.p2); }
  }
  function pad(n){ return (n<10?'0':'')+n; }
  function updateScore(){
    document.getElementById('p1score').textContent = pad(scores.p1);
    document.getElementById('p2score').textContent = pad(scores.p2);
    updateDots();
  }
  // Update every copy of the controls hint (the line below the game + the copy in
  // the Mode menu) so both always read the same.
  function setControlHint(html){
    var els = document.querySelectorAll('.controlhint');
    for(var i=0;i<els.length;i++) els[i].innerHTML = html;
  }
  // A wrapped control's surrounding .menu-field (label + control), or the control
  // itself before the menu wraps it — so hiding a control hides its label too.
  function fieldOf(el){ return (el && el.closest && el.closest('.menu-field')) || el; }
  function updateLabels(){
    // The local player's slime shows their chat username once they've set one.
    document.getElementById('p1name').textContent = softHyphens(chatNameCustom ? chatUsername.toUpperCase() : 'BLUE SLIME');
    // In local 2-player, Player 2 (pink) shows its own chat-set name; otherwise
    // it's the AI opponent's name (1P) or PINK SLIME (default 2P).
    document.getElementById('p2name').textContent = softHyphens(
      twoPlayer ? (p2NameCustom ? p2Username.toUpperCase() : 'PINK SLIME') : curOpp().name.toUpperCase());
    // The Player 2 name field only makes sense in local 2-player; the P1 label is
    // clarified to "Blue Slime:" there so the two fields read as Blue/Pink.
    var local2P = twoPlayer && !netMode;
    var p2prof = document.getElementById('chat-profile-p2');
    if(p2prof) p2prof.style.display = local2P ? '' : 'none';
    var p1ProfLbl = document.getElementById('chat-profile-label');
    if(p1ProfLbl) p1ProfLbl.textContent = local2P ? 'Blue Slime:' : 'Username:';
    fieldOf(document.getElementById('oppbtn')).style.display = twoPlayer ? 'none' : '';
    fieldOf(document.getElementById('resetbtn')).style.display = twoPlayer ? 'none' : ''; // Restart is a single-player action
    document.getElementById('oppbtn').textContent = curOpp().name;
    document.getElementById('modebtn').textContent = (twoPlayer ? 'Two Player' : 'Single Player');
    // Extra single-player hotkeys shown next to the movement keys.
    var extra = ' &nbsp;&middot;&nbsp; Pause: <b>Enter</b>';
    setControlHint(twoPlayer
      ? 'Blue: <b>A / W / D</b> &nbsp;&middot;&nbsp; Pink: <b>J / I / L</b> or <b>&larr; &uarr; &rarr;</b>' + extra
      : 'Move/jump: <b>A / W / D</b> or <b>&larr; &uarr; &rarr;</b>' + extra);
  }

  var keys = {};
  function setMsg(t, s){
    document.getElementById('msgtext').innerHTML = t;
    document.getElementById('msgsub').innerHTML = s;
    document.getElementById('msg').style.display = 'flex';
  }
  function hideMsg(){ document.getElementById('msg').style.display = 'none'; }
  // Restart the counter popup animation (remove + reflow + re-add the class).
  // The label depends on WHERE the ball was met: BLOCKED / DIG / COUNTER.
  function showCounteredPop(){
    var el = document.getElementById('countered-pop');
    if(!el) return;
    el.textContent = lastCounterKind;
    el.classList.remove('play');
    void el.offsetWidth; // force reflow so the animation can replay
    el.classList.add('play');
  }
  var _zoneShown = false; // whether the "in the zone" cue fired for the current match point
  function showZonePop(){
    var el = document.getElementById('zone-pop');
    if(!el) return;
    el.classList.remove('play'); void el.offsetWidth; el.classList.add('play');
  }

  function startPoint(){
    if(state==='menu' || state==='point' || state==='gameover'){
      if(state==='gameover'){
        if(advanceToNextBoss){
          advanceToNextBoss = false;
          oppIdx++;       // move on to the next boss in the gauntlet
          init();         // rebuild against the new boss (resets scores, state='menu', server='p1')
        } else {
          scores={p1:0,p2:0}; if(!simReplaying) updateScore();
        }
      }
      resetPositions(server);
      ball.live = true;
      state = 'play';
      userPaused = false; // never start a point already paused
      if(!simReplaying) hideMsg();
    }
  }

  function nameFor(who){
    if(who==='p1') return 'BLUE';
    return twoPlayer ? 'PINK' : curOpp().name.toUpperCase();
  }
  function scorePoint(who){
    if(state!=='play') return;
    scores[who]++;
    server = who;
    if(scores[who] >= WIN){
      state = 'gameover';
    } else {
      state = 'point';
      // Leave the ball resting where it landed so players can see where the
      // point ended; only the slimes return to ready. The ball is moved to
      // the serve position later, in startPoint().
      resetSlimes();
    }
    // Rollback re-simulates frames silently; presentNet() reflects the state to
    // the DOM once per render, so skip all side-effects during replay.
    if(simReplaying) return;
    updateScore();
    if(state === 'gameover'){
      var label = (who==='p1') ? 'BLUE<br>WINS!' : (twoPlayer ? 'PINK<br>WINS!' : nameFor(who)+'<br>WINS');
      var sub = netMode ? '' : 'PRESS SPACE OR TAP';
      // Single-player gauntlet: beating a boss advances you to the next one.
      if(!netMode && !twoPlayer && who === 'p1'){
        if(oppIdx < OPPS.length - 1){
          advanceToNextBoss = true;
          sub = 'NEXT: ' + OPPS[oppIdx+1].name.toUpperCase() + '<br>PRESS SPACE OR TAP';
        } else {
          label = 'YOU BEAT<br>ALL BOSSES!';
        }
      }
      setMsg(label, sub);
      if(netMode) onEnterGameOver();
    } else {
      setMsg(nameFor(who)+'<br>SCORES', 'PRESS SPACE OR TAP');
      // Offline 1P: the AI has no human to press Space, so auto-serve when it's
      // the server. (Online serving is an in-sim input — see simStep.)
      if(!netMode && !twoPlayer && server === 'p2'){
        setTimeout(function(){
          if(state === 'point' && server === 'p2'){ startPoint(); }
        }, 1100);
      }
    }
  }

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

  // --- Spike special move --------------------------------------------------
  // Available when the ball is on slime s's own side, heading toward the
  // opponent, near the net, high, and fast. Pure read of sim state, so it's
  // deterministic — used both to fire the spike and to flash the ball cue.
  function canSpike(s){
    if(gameMode !== 'power') return false; // spike is a Power Slime mechanic only
    if(state !== 'play' || !ball.live) return false;
    var ownSide    = s.left ? (ball.x < netX) : (ball.x > netX);
    var toOpp      = s.left ? (ball.vx > 0)   : (ball.vx < 0);
    var nearNet    = s.left ? (ball.x > netX - SPIKE_NET_DIST) : (ball.x < netX + SPIKE_NET_DIST);
    var highEnough = ball.y < SPIKE_MAX_BALL_Y;
    var fast       = (ball.vx*ball.vx + ball.vy*ball.vy) >= SPIKE_SPEED*SPIKE_SPEED;
    return ownSide && toOpp && nearNet && highEnough && fast;
  }
  // Launch slime s up to the ball and smash it into the opponent's open court.
  function doSpike(s, opp){
    var dir = s.left ? 1 : -1;
    var gx0 = s.x, gy0 = s.y; // remember where the leap STARTED (for the after-image)
    // 1) Launch the slime up to the ball, kept inside its own half.
    var tx = ball.x;
    if(s.left){
      if(tx < FIELD_L + s.r) tx = FIELD_L + s.r;
      if(tx > netX - NET_W/2 - s.r) tx = netX - NET_W/2 - s.r;
    } else {
      if(tx < netX + NET_W/2 + s.r) tx = netX + NET_W/2 + s.r;
      if(tx > FIELD_R - s.r) tx = FIELD_R - s.r;
    }
    s.x = tx;
    s.y = Math.min(GROUND, ball.y + s.r*0.9); // pop up to meet the ball
    s.onGround = false;
    s.vy = 2.0;                               // then fall back down
    // 2) Park the ball just clear of the dome (up + toward the opponent) so the
    //    normal slime collision can't fire this frame and clobber the smash.
    ball.x = s.x + dir*(ball.r + 4);
    ball.y = s.y - (s.r + ball.r + 4);
    // 3) Aim at the open gap: opponent deep -> drop it short over the net;
    //    opponent up near the net -> drive it deep to the far corner.
    var oppMid  = s.left ? (netX + FIELD_R)/2 : (FIELD_L + netX)/2;
    var oppDeep = s.left ? (opp.x > oppMid) : (opp.x < oppMid);
    var targetX;
    if(s.left) targetX = oppDeep ? (netX + NET_W/2 + ball.r + 45) : (FIELD_R - ball.r - 30);
    else       targetX = oppDeep ? (netX - NET_W/2 - ball.r - 45) : (FIELD_L + ball.r + 30);
    // 4) Solve the horizontal speed that lands at targetX given the fall time
    //    from this height; clamp to the spike cap and guarantee forward pace so
    //    it always crosses the net onto the opponent's side. (sqrt is one of the
    //    few bit-identical ops, so this stays deterministic for rollback.)
    var T = (-SPIKE_VY + Math.sqrt(SPIKE_VY*SPIKE_VY + 2*BALL_GRAV*(GROUND - ball.y))) / BALL_GRAV;
    var vx = (targetX - ball.x) / T;
    if(vx >  SPIKE_VX) vx =  SPIKE_VX;
    if(vx < -SPIKE_VX) vx = -SPIKE_VX;
    if(dir > 0 && vx <  6) vx =  6;
    if(dir < 0 && vx > -6) vx = -6;
    ball.vx = vx;
    ball.vy = SPIKE_VY;
    ball.live = true;
    ball.spiked = true;                       // mark it a spike so it can be countered
    s.spikeCD = SPIKE_COOLDOWN;
    bounceSeq++; bouncePlayerSeq++;           // smash SFX via the bounce-cue path
    // Cosmetic burst (not sim state): online runs the real step with
    // simReplaying=true, so DON'T gate this on it or the FX never shows online.
    // A rare rollback may re-arm it; harmless since draw() only runs post-replay.
    spikeFxT = SPIKE_FX_FRAMES; spikeFxX = ball.x; spikeFxY = ball.y;
    ballSpikeTrailT = SPIKE_TRAIL_FRAMES;
    // After-image: a motion blur of the leap from the start point (gx0,gy0) up to
    // the smash point (s.x,s.y). Uses the slime's BODY color (not its dark shade)
    // so it reads as a blurred copy of the slime itself, not a cast shadow.
    spikeGhostX0 = gx0; spikeGhostY0 = gy0;
    spikeGhostX1 = s.x; spikeGhostY1 = s.y;
    spikeGhostR = s.r; spikeGhostCol = s.col;
    spikeGhostT = SPIKE_GHOST_FRAMES;
  }
  // A spiked ball heading onto slime s's side can be COUNTERED: any time it's
  // airborne on your own half, before it lands. (Defensive, so no cooldown.)
  // It must be the OPPONENT's spike coming AT you — not your own outgoing one,
  // which lingers on your half for a few frames right after you launch it. Your
  // spike moves away from you, theirs moves toward you, so gate on direction:
  // left slime counters a leftward (incoming) spike, right slime a rightward one.
  function canCounter(s){
    if(gameMode !== 'power') return false;
    if(state !== 'play' || !ball.live || !ball.spiked) return false;
    var ownSide  = s.left ? (ball.x < netX) : (ball.x > netX);
    var incoming = s.left ? (ball.vx < 0)   : (ball.vx > 0);
    return ownSide && incoming;
  }
  // Get under the ball and spring it gently back up into a controllable volley,
  // killing most of the spike's cross-court pace. Neutralizes the spike.
  function doCounter(s){
    // Name it by WHERE the ball was met, BEFORE we move it onto the dome below:
    // central column = BLOCKED, low band = DIG, otherwise = COUNTER. Render-only.
    lastCounterKind = counterKind(ball.x, ball.y);
    var tx = ball.x; // slide under the ball, kept inside our own half
    if(s.left){
      if(tx < FIELD_L + s.r) tx = FIELD_L + s.r;
      if(tx > netX - NET_W/2 - s.r) tx = netX - NET_W/2 - s.r;
    } else {
      if(tx < netX + NET_W/2 + s.r) tx = netX + NET_W/2 + s.r;
      if(tx > FIELD_R - s.r) tx = FIELD_R - s.r;
    }
    s.x = tx;
    s.y = Math.min(GROUND, ball.y + s.r*0.8);
    s.onGround = (s.y >= GROUND);
    s.vy = 1.0;
    ball.x = s.x;
    ball.y = s.y - (s.r + ball.r + 3);   // sit just above the dome
    ball.vx *= COUNTER_VX_KEEP;          // bleed the spike's cross-court speed
    ball.vy = -COUNTER_UP;               // gentle upward spring -> soft volley
    ball.spiked = false;                 // spike neutralized
    bounceSeq++; bouncePlayerSeq++;      // soft contact SFX
    counterSeq++;                        // fire the "COUNTERED" popup (see draw())
  }
  // Per-frame spike/counter handling for a human slime, on the rising edge of
  // the down input. A counterable incoming spike takes priority over spiking.
  function tickSpike(s, pressed, opp){
    if(s.spikeCD > 0) s.spikeCD--;
    if(pressed && !s.spikeHeld){
      if(canCounter(s)) doCounter(s);
      else if(s.spikeCD <= 0 && canSpike(s)) doSpike(s, opp);
    }
    s.spikeHeld = pressed;
  }

  function aiControl(){
    var opp = curOpp();
    var predictX = ball.x;
    if(ball.vy > -2){
      var t = (GROUND - 70 - ball.y) / Math.max(ball.vy, 0.5);
      // anticip = how far ahead this boss reads the ball's arc. A short horizon
      // makes it target where the ball is NOW (so it chases and arrives late); a
      // long one lets it stand where the ball will actually land.
      t = Math.max(0, Math.min(t, opp.anticip || 60));
      predictX = ball.x + ball.vx * t;
    }
    var ballComing = ball.x > netX - 30;
    // Serve detection: ball is alive, has essentially no horizontal velocity,
    // and is still well above the slime. Standing directly under it would
    // bounce the ball straight back up (collision normal is vertical), so we
    // stand offset to the RIGHT of where it'll land — that puts the ball on
    // the slime's LEFT side at impact, angling the bounce toward the net.
    var isServing = ball.live && Math.abs(ball.vx) < 0.5 && ball.y < GROUND - 100;
    var target;
    if(ballComing){
      if(isServing){
        target = predictX + p2.r * 0.75;
      } else {
        // Shot placement. Standing to the ball's RIGHT angles the dome bounce
        // back over the net; the SIZE of that offset sets the depth — a small
        // offset lobs it high and short, a big one drives it flat and deep.
        // Skilled bosses read where the player is and aim at the open zone: drop
        // it short when they're camped at the back, drive it deep when they've
        // crept up to the net. aim=0 bosses just bonk it off the top of the dome.
        if(opp.aim){
          var foeBack = p1.x < (FIELD_L + netX) / 2;
          var off = foeBack ? (0.55 - 0.20*opp.aim) : (0.55 + 0.55*opp.aim);
          target = predictX + p2.r * off;
        } else {
          target = predictX;
        }
        if(opp.drop && ball.vy>0 && ball.x>netX+40 && Math.random()<0.02) target = netX + NET_W/2 + p2.r;
      }
    } else {
      target = W*0.72;
    }
    target = Math.max(netX + NET_W/2 + p2.r, Math.min(FIELD_R - p2.r, target));
    var lag = 1 - opp.react;
    var dead = 6 + lag*36;
    var ml=false, mr=false, jp=false;
    if(p2.x > target + dead){ ml = true; }
    else if(p2.x < target - dead){ mr = true; }
    if(ballComing && ball.y < GROUND-50 && Math.abs(ball.x - p2.x) < p2.r+16 && ball.vy>=-1){
      if(Math.random() < opp.jumpChance) jp = true;
    }
    moveSlime(p2, ml, mr, jp, opp.speed);
    // Bosses can unleash the same spike. spikeChance ramps with difficulty
    // (weaker bosses leave it 0); availability + cooldown gate it like a player.
    if(p2.spikeCD > 0) p2.spikeCD--;
    if(opp.spikeChance && p2.spikeCD <= 0 && canSpike(p2) && Math.random() < opp.spikeChance){
      doSpike(p2, p1);
    }
    // Tough bosses don't just eat a spike — they can dig it back up (Power mode).
    // Roll ONCE per incoming spike (not per frame): canCounter() is true for many
    // frames while the spiked ball is airborne, so a per-frame roll would make any
    // counter>0 a near-certainty. counterTried gates it to a single chance, then
    // resets once the ball is no longer a counterable spike.
    if(canCounter(p2)){
      if(!p2.counterTried){
        p2.counterTried = true;
        if(opp.counter && Math.random() < opp.counter) doCounter(p2);
      }
    } else {
      p2.counterTried = false;
    }
  }

  function collideSlime(s){
    var dx = ball.x - s.x;
    var dy = ball.y - s.y;
    // sqrt(a*a+b*b) rather than Math.hypot: only IEEE-754 +/*/sqrt are
    // bit-identical across JS engines, and rollback needs cross-browser
    // determinism (Math.hypot's precision is implementation-defined).
    var dist = Math.sqrt(dx*dx + dy*dy);
    var minD = s.r + ball.r;
    // The slime is a dome (upper hemisphere). Only collide when the ball is at
    // or above the slime's center line; the region below the center is the
    // flat bottom and has no surface.
    if(dist >= minD || dy > 0) return;
    // Contact normal from slime center out to the ball. Guard the degenerate
    // near-center case so a tiny dx/dy can't produce a wild direction.
    var nx, ny;
    if(dist < 0.01){ nx = 0; ny = -1; }
    else { nx = dx/dist; ny = dy/dist; }
    // Always push the ball out onto the dome surface so it never sits inside
    // the slime, even if it's already moving away.
    ball.x = s.x + nx*(minD+0.5);
    ball.y = s.y + ny*(minD+0.5);
    // Ball velocity relative to the slime, and its component along the normal.
    var rvx = ball.vx - s.vx;
    var rvy = ball.vy - s.vy;
    var vn = rvx*nx + rvy*ny;
    // Only change the velocity when the ball is actually moving INTO the
    // surface. (Previously the velocity was always rewritten, which nudged the
    // ball even when it was already leaving — a source of erratic bounces.)
    if(vn < 0){
      bounceSeq++; bouncePlayerSeq++; // ball struck the slime's dome (full volume)
      ball.spiked = false; // a normal block ends the spike (a counter is handled before this)
      // Classic slime-volleyball bounce: launch the ball RADIALLY out from the
      // slime's center through the contact point, at the incoming relative
      // speed. This is what makes returns predictable — the direction is set by
      // where on the dome you make contact (i.e. by positioning your slime),
      // not by the incoming angle. We keep a small reflection component so it
      // isn't perfectly robotic, blending direction only and renormalizing to
      // the incoming speed (a plain vector blend would shrink it).
      var refX = rvx - 2*vn*nx;
      var refY = rvy - 2*vn*ny;
      var speed = Math.sqrt(refX*refX + refY*refY);
      var BLEND = 0.6;
      var bx = (1-BLEND)*refX + BLEND*nx*speed;
      var by = (1-BLEND)*refY + BLEND*ny*speed;
      var bmag = Math.sqrt(bx*bx + by*by) || 1;
      refX = bx/bmag*speed;
      refY = by/bmag*speed;
      // Add the slime's full velocity so jumping INTO the ball spikes it and
      // moving into it pushes it — like the original. The caps below keep the
      // bounce bounded (and on screen) no matter how hard it's hit.
      ball.vx = refX + s.vx;
      ball.vy = refY + s.vy;
      // No forced upward pop: a hit near the EDGE of the dome stays flat and
      // can carry the ball's downward momentum through, so edge contacts drive
      // the ball down/forward (a smash) while tip contacts lob it up — the way
      // contact position dictates angle in the original.
      // Height cap (also the off-screen guard): clamp upward speed to MAX_UP.
      if(ball.vy < -MAX_UP) ball.vy = -MAX_UP;
      // Horizontal cap (independent of bounce height) keeps cross-court pace down.
      if(ball.vx > MAX_VX) ball.vx = MAX_VX;
      if(ball.vx < -MAX_VX) ball.vx = -MAX_VX;
      // Overall safety net.
      var sp = Math.sqrt(ball.vx*ball.vx + ball.vy*ball.vy);
      if(sp>MAX_SPEED){ ball.vx*=MAX_SPEED/sp; ball.vy*=MAX_SPEED/sp; }
    }
  }

  // The net is a solid rounded rectangle (circle-vs-AABB). This runs AFTER the
  // slime collisions in each sub-step, so a slime pressed against the net can't
  // shove the ball through it: any overlap is ejected here. A ball squeezed deep
  // into the corner between a slime and the net pops out along the shallowest
  // axis — preferring UP, over the net — instead of tunnelling through or
  // jittering between the two resolvers (the old glitch).
  function collideNet(){
    var nl = netX - NET_W/2, nr = netX + NET_W/2, ntop = GROUND - NET_H, r = ball.r;
    // Ball center driven inside the net column (deep penetration): eject along
    // the shallowest of up / left / right, preferring up so it clears the net.
    if(ball.x > nl && ball.x < nr && ball.y > ntop){
      bounceSeq++; ball.spiked = false; // ball ejected out of the net column
      var toUp = ball.y - (ntop - r), toLeft = ball.x - (nl - r), toRight = (nr + r) - ball.x;
      if(toUp <= toLeft && toUp <= toRight){
        ball.y = ntop - r; if(ball.vy > 0) ball.vy = -Math.abs(ball.vy) * 0.8;
      } else if(toLeft <= toRight){
        ball.x = nl - r; if(ball.vx > 0) ball.vx = -Math.abs(ball.vx);
      } else {
        ball.x = nr + r; if(ball.vx < 0) ball.vx = Math.abs(ball.vx);
      }
      return;
    }
    // Ball center outside the net: bounce off the closest point of the rect, so
    // faces reflect cleanly and the top corners round off naturally.
    var qx = Math.max(nl, Math.min(ball.x, nr));
    var qy = Math.max(ntop, Math.min(ball.y, GROUND));
    var dx = ball.x - qx, dy = ball.y - qy;
    var d2 = dx*dx + dy*dy;
    if(d2 >= r*r || d2 === 0) return;
    var d = Math.sqrt(d2), nx = dx/d, ny = dy/d;
    ball.x = qx + nx*r; ball.y = qy + ny*r;
    var vn = ball.vx*nx + ball.vy*ny;
    if(vn < 0){
      bounceSeq++; ball.spiked = false; // ball bounced off a net face/cap
      ball.vx -= 2*vn*nx;
      ball.vy -= 2*vn*ny;
      if(ny < -0.5) ball.vy *= 0.8; // landing on the top cap: damp like before
    }
  }

  function updateBall(){
    if(!ball.live) return;
    ball.vy += BALL_GRAV;
    // Sub-step the movement so a fast ball can't sink deep into (or tunnel
    // through) a slime before the collision is detected. Each sub-step advances
    // the ball at most ~half its radius and resolves all collisions, so the
    // contact normal is computed from a shallow overlap and the bounce is clean.
    var steps = Math.max(1, Math.ceil(Math.sqrt(ball.vx*ball.vx + ball.vy*ball.vy) / (ball.r * 0.5)));
    var stepX = ball.vx / steps, stepY = ball.vy / steps;
    for(var i=0; i<steps; i++){
      ball.x += stepX;
      ball.y += stepY;
      if(ball.x < FIELD_L + ball.r){ ball.x = FIELD_L + ball.r; ball.vx = Math.abs(ball.vx)*WALL_BOUNCE; bounceSeq++; ball.spiked = false; }
      if(ball.x > FIELD_R - ball.r){ ball.x = FIELD_R - ball.r; ball.vx = -Math.abs(ball.vx)*WALL_BOUNCE; bounceSeq++; ball.spiked = false; }
      collideSlime(p1);
      collideSlime(p2);
      collideNet(); // after the slimes: the net gets the final say, so it can't be shoved through
      if(ball.y >= GROUND - ball.r){
        ball.y = GROUND - ball.r;
        bounceSeq++; // ball thuds on the floor
        ball.live = false;
        ball.spiked = false;
        if(ball.x < netX) scorePoint('p2'); else scorePoint('p1');
        return;
      }
      // Collisions above may have changed the velocity; advance the remaining
      // sub-steps with the updated value.
      stepX = ball.vx / steps; stepY = ball.vy / steps;
    }
  }

  var flashT = 0;
  // Spike visuals (NOT part of the sim/rollback state): a brief burst at the
  // smash point, and a flag set each frame telling drawBall to flash the
  // "charged" ball for whoever can currently spike.
  var spikeFxT = 0, spikeFxX = 0, spikeFxY = 0;
  var ballSpikeTrailT = 0; // frames of wave trail left on the currently-spiked ball
  // Spike after-image: a stepped trail of faint slime silhouettes tracing the
  // leap from where the slime launched up to the smash point. Render-only.
  var spikeGhostT = 0, spikeGhostX0 = 0, spikeGhostY0 = 0,
      spikeGhostX1 = 0, spikeGhostY1 = 0, spikeGhostR = 0, spikeGhostCol = '#1c3f6e';
  var ghostCv = null, ghostCtx = null, ghostBlurOK = false; // offscreen buffer for the blended trail
  var ballSpikeReady = false;
  function darken(hex, f){
    // f<1 darkens; returns a hex string in the same color family
    var h = hex.replace('#','');
    if(h.length===3){ h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2]; }
    var r = Math.round(parseInt(h.substr(0,2),16)*f);
    var g = Math.round(parseInt(h.substr(2,2),16)*f);
    var b = Math.round(parseInt(h.substr(4,2),16)*f);
    function c(n){ n = Math.max(0,Math.min(255,n)); var s=n.toString(16); return s.length<2?'0'+s:s; }
    return '#'+c(r)+c(g)+c(b);
  }

  // Match-point aura (Power Slime): a glowing red light trail that follows the
  // eye (a soft blob when idle, a streak while moving) plus occasional sparks.
  // Additive ('lighter') blending gives a shader-like glow without WebGL.
  function drawZoneFx(s, ex, ey, er){
    if(!s.zoneTrail){ s.zoneTrail = []; s.zoneT = 0; s.zoneFlash = 0; s.zoneSeed = 0; }
    s.zoneT++;
    var moving = Math.abs(s.vx) > 0.4;
    s.zoneTrail.push({x:ex, y:ey});
    if(s.zoneTrail.length > 24) s.zoneTrail.shift();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // soft core glow at the eye (always)
    var g = ctx.createRadialGradient(ex, ey, 0, ex, ey, er*1.8);
    g.addColorStop(0, 'rgba(255,70,70,0.5)'); g.addColorStop(1, 'rgba(255,40,40,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ex, ey, er*1.8, 0, Math.PI*2); ctx.fill();
    if(moving){
      // moving: a glowing light trail follows the eye
      ctx.lineCap = 'round';
      for(var t=1; t<s.zoneTrail.length; t++){
        var k = t / s.zoneTrail.length;
        ctx.strokeStyle = 'rgba(255,80,80,' + (0.32*k).toFixed(3) + ')';
        ctx.lineWidth = er * 0.55 * k;
        ctx.beginPath(); ctx.moveTo(s.zoneTrail[t-1].x, s.zoneTrail[t-1].y); ctx.lineTo(s.zoneTrail[t].x, s.zoneTrail[t].y); ctx.stroke();
      }
    } else {
      // idle: lightning streaks flash out, then go dark until the next flash
      if(s.zoneFlash <= 0 && Math.random() < 0.06){ s.zoneFlash = 11; s.zoneSeed = Math.random() * 6.28; } // flash at random intervals
      if(s.zoneFlash > 0){
        var fa = s.zoneFlash / 11; // bright -> fade across the flash
        ctx.strokeStyle = 'rgba(255,90,90,' + (0.9*fa).toFixed(3) + ')';
        ctx.lineCap = 'round'; ctx.lineWidth = 1.4;
        for(var b=0; b<5; b++){
          var dir = (b % 2 === 0) ? 1 : -1;          // horizontal only: alternate right/left
          var len = er * (5.5 + (b % 3) * 1.4);      // long streaks
          ctx.beginPath(); ctx.moveTo(ex, ey);
          for(var si=1; si<=4; si++){
            var tt = si/4;
            ctx.lineTo(ex + dir*len*tt, ey + Math.sin(b*13.7 + si*5.1 + s.zoneSeed) * er * 0.6);
          }
          ctx.stroke();
        }
        s.zoneFlash--;
      }
    }
    ctx.restore();
  }
  function drawSlime(s){
    var col = s.col;
    var outline = darken(s.cold, 0.7);
    if(s.flash){
      // Psycho Slime effect: strobe the body between its color and yellow.
      var flashOn = (Math.floor(flashT/4)%2===0);
      col = flashOn ? s.col : '#ffe14d';
      outline = flashOn ? darken(s.cold, 0.7) : '#6e5a00';
    }
    // Cast shadow + lit shading in the outdoor photo themes (light from the upper
    // left). The default grassy theme keeps the flat, shadow-free look.
    if(theme === 'city' || theme === 'beach' || theme === 'finaldestination'){
      var hAbove = GROUND - s.y;
      var sc = Math.max(0.45, 1 - hAbove/420);
      // Tuck the shadow under the slime's FULL base so it meets both base edges
      // (the old one was too narrow + offset, leaving the left side detached).
      // shRx - shOff sets the left edge: 1.05r reaches just past the slime's left
      // base, while the offset still throws the cast to the lower-right (light is
      // upper-left). Both shrink with height so it pulls in as the slime jumps.
      var shOff = s.r * 0.20 * sc;  // lower-right cast offset
      var shX   = s.x + shOff;
      var shRx  = s.r * 1.25 * sc;  // half-width; left edge = s.x - 1.05r*sc
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,' + (0.28*sc).toFixed(3) + ')';
      ctx.beginPath();
      ctx.ellipse(shX, GROUND, shRx, s.r*0.20*sc, 0, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    }
    // dome shape (arc + flat bottom)
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, Math.PI, 0);
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.fill();
    // Inner shading clipped to the dome: a soft highlight at the upper-left and
    // a shadow toward the lower-right, selling a single upper-left light source.
    if(theme === 'city' || theme === 'beach' || theme === 'finaldestination'){
      ctx.save();
      ctx.clip();
      var hi = ctx.createRadialGradient(s.x - s.r*0.45, s.y - s.r*0.65, s.r*0.05,
                                        s.x - s.r*0.45, s.y - s.r*0.65, s.r*1.15);
      hi.addColorStop(0, 'rgba(255,255,255,0.35)');
      hi.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hi;
      ctx.fillRect(s.x - s.r, s.y - s.r, s.r*2, s.r);
      var sh = ctx.createLinearGradient(s.x - s.r*0.5, s.y - s.r*0.8, s.x + s.r*0.7, s.y);
      sh.addColorStop(0, 'rgba(0,0,0,0)');
      sh.addColorStop(0.55, 'rgba(0,0,0,0)');
      sh.addColorStop(1, 'rgba(0,0,0,0.40)');
      ctx.fillStyle = sh;
      ctx.fillRect(s.x - s.r, s.y - s.r, s.r*2, s.r);
      ctx.restore();
    }
    // outline: a darker analogous shade in the slime's own color family
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, Math.PI, 0);
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = outline;
    ctx.lineWidth = 2;
    ctx.stroke();
    var faceRight = s.left;
    var ex = s.x + (faceRight ? s.r*0.45 : -s.r*0.45);
    var ey = s.y - s.r*0.5;
    var er = s.r*0.18;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(ex, ey, er, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = outline; ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(ex, ey, er, 0, Math.PI*2); ctx.stroke();
    var ang = Math.atan2(ball.y-ey, ball.x-ex);
    var pr = er*0.5;
    ctx.fillStyle = outline;
    ctx.beginPath(); ctx.arc(ex+Math.cos(ang)*er*0.45, ey+Math.sin(ang)*er*0.45, pr, 0, Math.PI*2); ctx.fill();
    // Match point (Power Slime): glowing red light trail + occasional sparks.
    if(false && gameMode === 'power' && ((s === p1 && scores.p1 === WIN - 1) || (s === p2 && scores.p2 === WIN - 1))){
      drawZoneFx(s, ex, ey, er);
    } else if(s.zoneTrail){ s.zoneTrail = null; s.zoneSparks = null; }
    // The White Slime wears shades (shades.svg): scaled to the slime, centred
    // over the eye and mirrored to face the way it's looking. Drawn once loaded.
    if(false && s.col === '#f3f3f3' && shadesReady && theme === 'beach'){ // shades disabled for now
      var dir = faceRight ? 1 : -1;
      var sw = s.r * 1.15;             // shades width relative to the dome radius
      var sh = sw * 0.380;             // shades.svg aspect (viewBox 28.45 x 10.81)
      var scx = s.x + dir * s.r * 0.28;  // horizontal placement (4px right nudge removed)
      var scy = s.y - s.r * 0.48;
      ctx.save();
      ctx.translate(scx, scy);
      if(dir > 0) ctx.scale(-1, 1);    // shades.svg faces left by default; mirror to face right
      ctx.drawImage(shadesImg, -sw/2, -sh/2, sw, sh);
      ctx.restore();
    }
  }

  // Static background decorations (positioned relative to field width/ground).
  // Clouds use the uploaded raster pixel-art sprites, randomized per cloud, drawn small.
  var CLOUD_SPRITES = [
    {w:84, h:47, src:'data:image/png;base64,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'},
    {w:84, h:35, src:'data:image/png;base64,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'},
    {w:84, h:35, src:'data:image/png;base64,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'},
    {w:84, h:36, src:'data:image/png;base64,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'},
    {w:84, h:40, src:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFQAAAAoCAYAAABgi917AAANuElEQVR4nO2abaxlV1nHf89aa+9zzzn3ZWY601ortBjUgFZpU7RQaqqgDaExJCUxJkr8oERj1GjCJ6N8sIZE1G9iwhfFT77FNtXChwYQ0kKw0CpipVYKtDPT6czcuTP33nP22S/refyw1t7n3s60OJ3b2hRW5tw5L/tl7f/6P//n+T97w3fHgQ75/57AKz1ufPdv2M7mScwU9SU+BMaFx5vnq//y8e84PK54TK56na1vHLK1tXVbXVu31dU1W11bt0NHr7af++iX7UqP/x2zIqPpYfPjdT7zyXtRq+nalqiKqSEY3WLBXT//ywgl1fnj3zG4vOThixVbGU9tvlhY0zTWdd3watvaTp89Y0VZ2Hj98BWx1B3UhF+tI4yOmA9isV2wqGaghojgnMN7j3MOzPDO0TYt1fYWMDHA7vz9+y4b3Nc8oF1znlE5pm5qmnpBCA5EMDPMDDAEz3S6RjXfpW4aYEFZFmyMy8s+32sW0I1r32yA3X/v/cxmM5xztG2Hc56UOhKos1nDzrxBDWYLWNRgFqnrhif/7kOElfFlsTS8LFfzKhhSOny5wje+9RS785rVyYgwDagaGJiBCIzHBSIO56CuI94ZO7Oa2byiWizwUtBR/Z/P+5plaBCHD4GqavHOiFEBQwScAycpuzsHzglkHjaNURSBumlR60AuT0Zfswwtx2PECcdPnODkyU0klDiBjfUNJINZFI7JuGR7t0bNAEcU4eSpc4hEgnPIZVaWr/l6qyymduTYYR7/728i6qjbmiIIhXd4B4bRtBHF0bUd0YxnT5zAi+fOn72d08+dgsvA6RVj6PrRa6ytKswUnODEA2CxpW07DMOHwMpowvb5swe20KtvfjezzSe57tgqqsqXHn8Gry3jcYmq0sXIha1tnjtzmqJc4eqrr+Un334T5WSV3/zCaf7wB+Sy5vKKMXS8dsja+W6SKjMMcukCQsoQIkIoSpq6OvB5hSBmajz61FlC1+BEiTHSth3z2Yym63Au8L3X3cCbrl+nmB6m2tm67Hm8bICuHrna6kWFIIgYX3/iv1hbW00Z9qJJCCaAGTFG3vDGH6RuW1QVL57F7MKBzfPIkQ2rm5hq0Jzph1k4oVlUNG336pNC50OqmvNr58KOxajWRbUYo8Wo1raddZ1a7NJnVbWui+a927fv733Nrrhp0Y8Vz75jv8Dr1TF+6Kd+wYqVVUtGxKxrW2va1rrYZRCjqZqpxgxu3PO9mppa/jf4bDOz0WRqrhy9ei70RcaB1qGyfh3BCz2fohqmgkaQrJECYILIssSTIe4EBDRGomouZUDbDqd6kFN92caBacV4fcOa2S7b29uEECjLS/tgVcWJSxqWdbMHEpKmqaZyBsA7R13X1HXNtTe8kTC9iu3jX7to3uVk1bRdDKIoCIWU4AIlnvPV5iuiiwdWNlXbFxiNRpgqLgTMkiu5lPr1YPWgSn4vKd8D2W2LAIYTRzEqmG+d4apD33fJ8zfz3X2fnfOYVIhz1Acnwd92XDGg09VVa6Oxc36Tuq5ZGa/g+tAmhXbyzjYAmX9KLsQSwCnT58y7B1hDCEXAqbCzs8M99/wBf/6xZ8ykRGODdyDW8fUnn8S7pGCDtAioGs4HXveG7zeNimG8/vZf5YkHPvKyMPaKAZ3tJmaU5QiLJWaagZPEVucGIFMJJcvP+f1g7wYwbdBcADVQFcw5OqCtdgkra1Tbm2DG2nTKdDrBS4kP4L0f5mdmtF3H7tbm8J1uPnWll/2C4yUnpdHaUVuZrpqZ0TQNZlCUmhsNmZ8iaJ9MJDFRTfPHPb/lIZLiX8TRi6rlcHUCQQKT6TrBB+rdLWY7u0RVNre2GJUjijI3jPuRae5FmM/nzKs5s9mMo/4Mk+mqrR46cuBa8KIMven9H7HH/vqDOF9mnVNUOwDqnbOsjMdAn8FJbRx6EGQAox+yx8X1LOy3H95juCysZoZq0uKoxqKNjMZrvPOuu7jpR36Y0coIAULoL2OZkAZ5MUAcRVFgBq4QbnnLjUxGnmdPPcfT02vt9Te9l8f/+Y8ORAJeFNDRSmRt4zBdUyOuP98Iw2GxG9hm1gd5qoUkZ/G9IAGILYESkeFzrqVyjzKDob0d7aES6g5uf9d7eNONN/OeO96em8W21GlsT/WwPG+KGgeiOO/5kz/9M3Znuzxz8jjvuO0Ozn3jkYPA8oUBnRy73mILT/7TX/Dxv/pL1tfXmEwnKYSbhnm1zWP/8zQijjOb51HtuObY0ezTwdDEEuvxSrbOsu90kpksS23V5xkUywmr6ZTYRcwcQeDo+ipTf3Ve4FxJ0IOe/u5dwB5k5wSRZJPKUclG2MB5+N0P/g4fvuePKdaPWbt9Rr7nx++2zcceoIvNcEzxBTifehAaUW1xxTVofeoiVl+a5s6ZD4GV4Dl7dpOiLFNyyTNvu5Z/+PTDGMIdN/8YgnHd1UfoWdYz0DLCQ6gbCVjN5ZLIfmbBvmRkZtRtpK5TJESNjAphVIS0nZN8k42B+ctIv1huJN9LEkDNMDVMjI2NDRbVAtVAMZ7gtCLGCIB3SZdTPrCk+6J4N6FafJsegxTrNt44Zv1QM6u6zrouWUMzSzaxXdiiaaxpW/vbT3zK7n3wc6Zmdn67StYy6uDNTc1U1aJG0/xdVDWN0czMjp/asuMnN816j5/Ppaq2eaGyrQt1em1XFmNMljS2g2XtZ6qq+fdlX6Cfs5mZ7rG41aKzRX7tzmv71Oe+YA898hVb3Ths77j1Vju3M7PZ7q4tFovhPDFGa5vW5vO5zWYze/jhz1o5Xbe3vv/D+1ZuX8hbt8OKLzBTmqYlhEDBUsd6Fql4QtZKkYACUcEs+8l8q3ZgzZ5gkL7aH9gpOO/RRBsGQUxCAeLobwLts6i9UJLPO8hJr8uSI6afS65uc8sQAe8EZ45nTp2mazvOnH4WLOJdAHFDXTsQzglFUaS2n0aK4Cis2b8NQLlxg+nOt7iwPWMyHQ/2cC8gl8rYe7P25vkFXWdMxqkaWJtOMiB79jVS/WPG5tacqMY1R1Pjd7dqcBJYNF0KsR78frHNAGWlFFZG5fMsaw5lM0yW+y0hF1QjO7MW7TVcDCfJ2koRUFMKIt75TCCXdXd5flPFVGk14n0gOMf77r6b+x94gK5tZWDoaFxgtkEoQxZwlw+QNakHr3c1smSI5WK8bTWxQlzK3j0IPRt7RIfs7fB+uUjaKXhDzA8aS++g+kUVB7KnaGfZ03QuJ0Ezzp6bszYtWVkp+mo29QhMEDOixlQrB4/zQls1iBiTabkvCpYkMlSFqo44EbwvEOeYzWcUKxOKsqRrWwZAvU8O5JGvPk012+Wdt/0oi1oxM0alJCvZlzM9MzKY5y4sElFcCqv5QhGBxYUGU+WqtQJV2K0jupwfhzdGOCec265BwfB0eVFkiRiDYc3nXSyUqmqJMVIWJSulEMp0P31Rx+TOfGC2UGaL1CwxBEdfkoFGpSg9n3zo83jvuPNtP4F3DKbASGzfS4qolp6FEoeJYW2HmaNpun0Ni5CXHkXpuo66aYlqtLHDiaDmiV2/Mi65GIOtnQpwGDlr5+HyBVhm5oVZl7LqwPA04WrR0TQR1axvjn13GPvadg8dB6aJOMQLTRdpI1DpwHrELTM4/S3jLMVAETyff+wxRqNUBjrxhJBu2M2qNl9D7oqZo+46mqZFESaTEVs7Ozz6H09QjgIB4dzWWVSN937sS3bfB26RkCbfgSr1omLRtdz74BcHARJr+Jnbb016QsxggbiQ+pW5DPGJAmlCOWSWgW5Z6iQnBWOnatKkSWWJywnNLDPB9thOJzhJpYvz6XaJGCiGRoMkiThJfDZNZVFqjoDkHq0ZmDOiCruzGWUoCM7xmS8+imD89NtuoWkjgqEKXexo2oiZUJQFn/3Xf8M7IYxKuhhZ1Avm8zkiwn0fuKXvx8D17/p1Ky58k196352owVveehtd11EET/AO1QaH28eaASxb1pBDKw5Jq5wzqprinF/Wl5p0Ov2umSmCuJwI8qIhlhdtH02Xb83QXg1yRh/y3xCyS9kwwCEUIbAsBtKcuhhp25jr46GTgCo4L5RFIPgCgKhKGyP/+e9f5u//8RNs7bQ885UHl4D2Q8Tb6voh/uaBT9MuKnzwCEnEY5cuzuUn11zOpr3G9C7STLJTSvlnKNgzQ5PltNSvRAffnxNrvkiXO1MJEB3KHdufdTOwPZttzzbLIkCIqnSaHZMkY9CD2oNZtx0xpmN6JzgnqQLICc87l6qDvGAnnj3Bb//ar3DzL36Ihz76WwOO++tQE6pFRVPN0WZBnDdo7JhXFTEawXvKUYnIfmez5KxmhqSwjDEZSlNFY7rTGMThvKMsRykJZAupasP/sYvDsUMIqR7MzmigYO5kaWrvYygoWYvzE3aqtG1L03V0XQcIwXu0LGiDxztBLT2mE6OiOVrEpcd4XEgPlkVVGo0URUGRndP25nGqeU0Tr9oL4aWtp/eF+eCfx65Lbfkioy8GXvLYU2pdzjlf6DAvuN3zRezSG+/dxYUSY0wzP3PRTpdsjsTYZscRM8vc4E2U7GEkIbZXt2BZgF98RYmJTjxIn6SGGE9MzzfmRA3b0/Xvvf5gJvZUBKZZhxHM9XvkBl5u//E87ZdcsPcdNLMsXU7w4rJkKBrTq78eJw5flCCe8dq1NPMzL7AI3x0HNv4XvAveoq9fersAAAAASUVORK5CYII='},
    {w:84, h:32, src:'data:image/png;base64,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'}
  ];
  // Preload all cloud sprites into Image objects
  var cloudImgs = CLOUD_SPRITES.map(function(sp){
    var img = new Image(); img.ready = false;
    img.onload = function(){ img.ready = true; };
    img.src = sp.src;
    return img;
  });
  var CLOUD_SPEED = 0.18;            // px per frame, slow drift to the right
  function randCloudSprite(){ return Math.floor(Math.random()*CLOUD_SPRITES.length); }
  var CLOUDS = [
    {x:120, y:64, sp:randCloudSprite()},
    {x:380, y:48, sp:randCloudSprite()},
    {x:620, y:80, sp:randCloudSprite()}
  ];
  var BUSH_SPRITES = [
    {w:96, h:51, src:'data:image/png;base64,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'},
    {w:96, h:39, src:'data:image/png;base64,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'},
    {w:96, h:44, src:'data:image/png;base64,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'},
    {w:96, h:42, src:'data:image/png;base64,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'},
    {w:96, h:42, src:'data:image/png;base64,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'},
    {w:96, h:36, src:'data:image/png;base64,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'}
  ];
  var bushImgs = BUSH_SPRITES.map(function(sp){
    var img = new Image(); img.ready = false;
    img.onload = function(){ img.ready = true; };
    img.src = sp.src;
    return img;
  });
  function randBushSprite(){ return Math.floor(Math.random()*BUSH_SPRITES.length); }
  var BUSHES = [
    {x:-0.02, sp:randBushSprite()},
    {x:0.40, sp:randBushSprite()},
    {x:1.02, sp:randBushSprite()}
  ];

  function drawCloud(c){
    var img = cloudImgs[c.sp];
    if(!img.ready) return;
    var sp = CLOUD_SPRITES[c.sp];
    ctx.drawImage(img, Math.round(c.x - sp.w/2), Math.round(c.y), sp.w, sp.h);
  }

  function drawBush(b){
    var img = bushImgs[b.sp];
    if(!img.ready) return;
    var sp = BUSH_SPRITES[b.sp];
    // Anchor the shrub so its base sits a few px below the ground line; the
    // court fill (drawn after) overlaps the bottom so it reads as a hedge at
    // the back of the ground plane.
    var baseY = GROUND + 6;
    ctx.drawImage(img, Math.round(b.x*W - sp.w/2), Math.round(baseY - sp.h), sp.w, sp.h);
  }

  // City theme backdrops, scaled to the court width and positioned so the
  // rooftop floor lands on the game's GROUND line (both layers share this rect).
  function cityRect(img, extraUp){
    var scale = W / img.naturalWidth;
    // -20 base nudge for both layers; the foreground lifts an extra amount.
    return { y: GROUND - CITY_FLOOR_SRC * scale - 20 - (extraUp||0), h: img.naturalHeight * scale };
  }
  // Far skyline behind the clouds; the strip above it is filled with the sky
  // color (matches the artwork's top) so the join is seamless.
  function drawCityBg(){
    ctx.fillStyle = CITY_SKY; ctx.fillRect(0, 0, W, H);
    if(cityBgReady){
      var r = cityRect(cityBgImg);
      // The backdrops are hi-res illustrations downscaled to the court width, so
      // smooth the scaling (the global default is nearest-neighbour, which keeps
      // the pixel-art sprites crisp but leaves these edges jagged). Restored after.
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(cityBgImg, 0, r.y, W, r.h);
      ctx.imageSmoothingEnabled = false;
    }
  }
  // Near rooftop (brick buildings, fence, floor) drawn in front of the clouds.
  function drawCityFg(){
    if(cityFgReady){
      var r = cityRect(cityFgImg, 10); // foreground sits 10px higher than the skyline
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(cityFgImg, 0, r.y, W, r.h);
      ctx.imageSmoothingEnabled = false;
    }
  }
  // Beach backdrop: one full-scene image scaled to the court width, positioned so
  // the sand court's front line lands on GROUND. Smoothed like the city art.
  function drawBeach(){
    ctx.fillStyle = BEACH_SKY; ctx.fillRect(0, 0, W, H);
    if(beachReady){
      var scale = W / beachImg.naturalWidth;
      var y = GROUND - BEACH_FLOOR_SRC * scale + 16; // nudged 16px down
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(beachImg, 0, y, W, beachImg.naturalHeight * scale);
      ctx.imageSmoothingEnabled = false;
    }
  }
  // Final Destination backdrop: one scene scaled to COVER the court (centred, no
  // distortion). Tweak the y-offset if the platform needs to meet GROUND.
  function drawFinalDest(){
    ctx.fillStyle = '#020108'; ctx.fillRect(0, 0, W, H);
    if(fdReady){
      var sc = Math.max(W / fdImg.naturalWidth, H / fdImg.naturalHeight) * 1.08; // +8% size
      var dw = fdImg.naturalWidth * sc, dh = fdImg.naturalHeight * sc;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(fdImg, (W - dw) / 2, (H - dh) / 2 + 150, dw, dh); // nudged 150px down
      ctx.imageSmoothingEnabled = false;
    }
  }

  // Draw the ball. The DRAWN radius can be scaled by a ball skin, but ball.r
  // (used by all the physics) is untouched, so collisions never change.
  function drawBall(){
    var sk = ballSkin ? ballBossByName(ballSkin) : null;
    var vr = BALL_R * (sk && sk.rmul ? sk.rmul : 1);
    // Charged-spike halo: a yellow ring that PULSES behind the ball (drawn
    // before the body so the ball sits on top), telling you a spike is ready.
    // A sine-eased alpha that never drops below the floor — so the cue keeps
    // glowing the whole time it's available instead of blinking fully out (a
    // hard on/off strobe made it look like the spike kept lapsing).
    if(ballSpikeReady){
      var pulse = 0.5 + 0.5 * Math.sin(flashT * 0.30); // 0..1, ~3 breaths/sec
      ctx.save();
      ctx.globalAlpha = 0.45 + 0.55 * pulse;           // alpha floor 0.45 -> 1.0
      ctx.fillStyle = '#fff36b';
      ctx.beginPath(); ctx.arc(ball.x, ball.y, vr + 6 + 2 * pulse, 0, Math.PI*2); ctx.fill();
      ctx.restore();
    }
    if(sk && sk.style === 'beachball' && beachBallReady){
      // Round ball: clip to a circle and COVER-fit the image so it fills the
      // disc, centered, without distortion. Dark ring for contrast.
      ctx.fillStyle = '#241700';
      ctx.beginPath(); ctx.arc(ball.x, ball.y, vr + 1.5, 0, Math.PI*2); ctx.fill();
      ctx.save();
      ctx.beginPath(); ctx.arc(ball.x, ball.y, vr, 0, Math.PI*2); ctx.clip();
      var biw = beachBallImg.naturalWidth, bih = beachBallImg.naturalHeight;
      var bs = (2*vr) / Math.min(biw, bih);   // cover the disc
      var bdw = biw * bs, bdh = bih * bs;
      ctx.drawImage(beachBallImg, ball.x - bdw/2, ball.y - bdh/2, bdw, bdh);
      ctx.restore();
      return;
    }
    if(sk && sk.style === 'volleyball' && volleyReady){
      // Dark backing disc so the light emoji reads against bright backdrops; it
      // peeks out around the ball as an outline.
      ctx.fillStyle = '#241700';
      ctx.beginPath(); ctx.arc(ball.x, ball.y, vr + 1.25, 0, Math.PI*2); ctx.fill();
      ctx.drawImage(volleyImg, ball.x - vr, ball.y - vr, vr*2, vr*2); // Noto volleyball emoji
      return;
    }
    // plain ball — also the fallback for the volleyball before its emoji loads
    ctx.fillStyle = '#241700'; // dark outline ring for contrast on any background
    ctx.beginPath(); ctx.arc(ball.x, ball.y, vr + 2.5, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = (sk && sk.style === 'volleyball') ? '#eef2f8' : ballColor;
    ctx.beginPath(); ctx.arc(ball.x, ball.y, vr, 0, Math.PI*2); ctx.fill();
  }

  // Blended spike after-image: a soft MOTION BLUR of the leap, built in an
  // offscreen buffer so it reads as one smooth shape instead of discrete steps.
  //   1) stamp a dense run of body-colored slime domes from launch -> smash
  //      (overlaps merge into a clean union, with no per-step alpha banding),
  //   2) fade that union along the path via a gradient alpha mask (solid at the
  //      smash end, vanishing at the launch end),
  //   3) composite it onto the game canvas through a GPU canvas blur for a soft
  //      motion blur. `gtl` is the 1 -> 0 lifetime fade. (When a CRT filter is on
  //      this also flows through the WebGL post-pass, since it lands on #game.)
  function drawSpikeGhost(gtl){
    if(!ghostCv){
      ghostCv = document.createElement('canvas');
      ghostCv.width = W; ghostCv.height = H;
      ghostCtx = ghostCv.getContext('2d');
      ghostBlurOK = ('filter' in ghostCtx); // hardware-accelerated Canvas2D blur
    }
    var oc = ghostCtx, r = spikeGhostR;
    var x0 = spikeGhostX0, y0 = spikeGhostY0, x1 = spikeGhostX1, y1 = spikeGhostY1;
    oc.clearRect(0, 0, W, H);
    // 1) solid union of domes along the leap
    oc.globalCompositeOperation = 'source-over'; oc.globalAlpha = 1;
    oc.fillStyle = spikeGhostCol;
    var dist = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
    var n = Math.max(SPIKE_GHOST_STEPS, Math.round(dist / (r * 0.3)));
    for(var i = 0; i <= n; i++){
      var f = i / n, gx = x0 + (x1 - x0) * f, gy = y0 + (y1 - y0) * f;
      oc.beginPath(); oc.arc(gx, gy, r, Math.PI, 0); oc.closePath(); oc.fill();
    }
    // 2) fade along the path (skip the degenerate zero-length case)
    if(dist >= 1){
      oc.globalCompositeOperation = 'destination-in';
      var grad = oc.createLinearGradient(x0, y0, x1, y1);
      grad.addColorStop(0.0, 'rgba(0,0,0,0)'); // launch end vanishes
      grad.addColorStop(1.0, 'rgba(0,0,0,1)'); // smash end solid
      oc.fillStyle = grad; oc.fillRect(0, 0, W, H);
      oc.globalCompositeOperation = 'source-over';
    }
    // 3) composite as a soft, translucent shadow
    ctx.save();
    ctx.globalAlpha = 0.35 * gtl;
    if(ghostBlurOK) ctx.filter = 'blur(' + SPIKE_GHOST_BLUR + 'px)';
    ctx.drawImage(ghostCv, 0, 0);
    ctx.restore();
  }

  // DEBUG overlay: shade the three counter-outcome zones so you can see exactly
  // where an incoming spike, if countered, reads as a BLOCK (central column to the
  // top), a DIG (low full-width band), or a plain COUNTER (everywhere else).
  // Toggle with the C key (DEBUG_COUNTER_ZONES).
  function drawCounterZones(){
    var bx = BLOCK_ZONE_CX - BLOCK_ZONE_W/2;
    ctx.save();
    ctx.fillStyle = 'rgba(255,170,60,0.06)'; ctx.fillRect(0, 0, W, GROUND);                         // COUNTER (everywhere)
    ctx.fillStyle = 'rgba(80,170,255,0.16)'; ctx.fillRect(bx, 0, BLOCK_ZONE_W, BLOCK_ZONE_BOTTOM);  // BLOCK column (to top)
    ctx.fillStyle = 'rgba(90,220,120,0.16)'; ctx.fillRect(0, DIG_ZONE_TOP, W, GROUND - DIG_ZONE_TOP);// DIG band (near floor)
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1; ctx.setLineDash([6,4]);
    ctx.strokeRect(bx + 0.5, 0.5, BLOCK_ZONE_W, BLOCK_ZONE_BOTTOM);                                 // block outline
    ctx.beginPath(); ctx.moveTo(0, DIG_ZONE_TOP + 0.5); ctx.lineTo(W, DIG_ZONE_TOP + 0.5); ctx.stroke(); // dig top line
    ctx.setLineDash([]);
    ctx.font = "10px 'PixelBold', monospace";
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(150,200,255,0.98)'; ctx.fillText('BLOCK', BLOCK_ZONE_CX, BLOCK_ZONE_BOTTOM - 4); // bottom of the block column
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255,200,110,0.95)'; ctx.fillText('COUNTER', 8, DIG_ZONE_TOP + 4 - 18); // 18px above DIG
    ctx.fillStyle = 'rgba(120,230,150,0.98)'; ctx.fillText('DIG', 8, DIG_ZONE_TOP + 7);          // just inside the top of the dig band
    ctx.restore();
  }

  function draw(){
    // Bounce SFX: the sim recorded one or more new ball contacts since the last
    // rendered frame — play a single cue. (Rollback replays advance bounceSeq but
    // never call draw(), and it's restored on rollback, so there's no echo.)
    if(bounceSeq > _lastBounceShown) playBounce(bouncePlayerSeq > _lastPlayerShown);
    _lastBounceShown = bounceSeq;
    _lastPlayerShown = bouncePlayerSeq;
    // Counter popup, fired the same rollback-safe way as the bounce SFX: the sim
    // bumps counterSeq, draw() (never run during replays) shows it once.
    if(counterSeq > _lastCounterShown) showCounteredPop();
    // "You're in the zone" — announced once when a Power-Slime player hits match point.
    var _myScore = (netMode === 'guest') ? scores.p2 : (twoPlayer ? Math.max(scores.p1, scores.p2) : scores.p1);
    var _atZone = false && (gameMode === 'power') && netMode !== 'spectator' && (_myScore === WIN - 1);
    if(_atZone && !_zoneShown){ _zoneShown = true; showZonePop(); }
    else if(!_atZone){ _zoneShown = false; }
    _lastCounterShown = counterSeq;
    if(theme === 'city'){
      drawCityBg();
    } else if(theme === 'beach'){
      drawBeach();
    } else if(theme === 'finaldestination'){
      drawFinalDest();
    } else {
      var sky = ctx.createLinearGradient(0, 0, 0, GROUND);
      sky.addColorStop(0, SKY_TOP);
      sky.addColorStop(1, SKY_BOT);
      ctx.fillStyle = sky; ctx.fillRect(0,0,W,GROUND);
    }
    // drifting clouds over the grassy sky and between the city's two layers; the
    // beach backdrop has its own painted clouds, so skip them there.
    if(theme !== 'beach' && theme !== 'finaldestination'){ for(var c=0;c<CLOUDS.length;c++){ drawCloud(CLOUDS[c]); } }
    if(theme === 'city'){
      drawCityFg(); // near rooftop (buildings/fence/floor), in front of the clouds
    }
    if(theme === 'grassy'){
      // bushes at the back of the ground plane (drawn before the court so the
      // court surface overlaps their bottoms)
      for(var b=0;b<BUSHES.length;b++){ drawBush(BUSHES[b]); }
      // court
      ctx.fillStyle = COURT; ctx.fillRect(0, GROUND, W, H-GROUND);
      ctx.strokeStyle = COURTLINE; ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(0, GROUND); ctx.lineTo(W, GROUND); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(0,0,WALL,GROUND); ctx.fillRect(W-WALL,0,WALL,GROUND);
    }
    flashT++;
    // Spike after-image: a soft, BLENDED shadow trail of the leap (see
    // drawSpikeGhost), drawn BEFORE the live slimes so they sit on top, fading
    // out over its lifetime.
    if(spikeGhostT > 0){
      drawSpikeGhost(spikeGhostT / SPIKE_GHOST_FRAMES); // 1 -> 0 lifetime fade
      spikeGhostT--;
    }
    // Online: both peers run the real sim, so p1/p2/ball are already the true
    // current simulated state — drawn directly (rollback corrects them in-sim).
    drawSlime(p1);
    drawSlime(p2);
    // Net drawn AFTER the slimes so it sits above their cast shadows (the shadow
    // ellipse spreads onto the net's base). Slimes are clamped to just touch the
    // bar, so their bodies never overlap it; the ball draws last, in front.
    ctx.fillStyle = NETCOL;
    // Beach sits ~16px lower, so draw the net 17px deeper to plant it in the sand.
    // Purely cosmetic — the collision box (GROUND-NET_H..GROUND) is unchanged.
    var netExtra = (theme === 'beach' || theme === 'finaldestination') ? 17 : 0;
    ctx.fillRect(netX-NET_W/2, GROUND-NET_H, NET_W, NET_H + netExtra);
    // DEBUG: show where a counter reads as BLOCK (high) vs DIG (low).
    if(DEBUG_COUNTER_ZONES && gameMode === 'power'){ drawCounterZones(); }
    // Spike "charged" cue: flash the ball when the LOCAL player can spike now.
    ballSpikeReady = false;
    if(state === 'play' && ball.live){
      if(netMode){ ballSpikeReady = canSpike((rb && rb.side === 'p2') ? p2 : p1); }
      else if(twoPlayer){ ballSpikeReady = canSpike(p1) || canSpike(p2); }
      else { ballSpikeReady = canSpike(p1); }
    }
    // Spike wave: an animated sine ribbon streaming behind a smashed ball,
    // drawn before the ball so it appears to trail out from behind it. The
    // amplitude scales with the ball's speed and fades over the trail's life,
    // and the phase shifts each frame so the wave travels — a "dynamic" trail.
    if(ballSpikeTrailT > 0){
      if(ball.live){
        var sp2 = Math.sqrt(ball.vx*ball.vx + ball.vy*ball.vy);
        if(sp2 > 1){
          var dx2 = ball.vx/sp2, dy2 = ball.vy/sp2;        // travel direction
          var px2 = -dy2, py2 = dx2;                        // perpendicular
          var tl  = ballSpikeTrailT / SPIKE_TRAIL_FRAMES;   // 1 -> 0 fade
          var len2 = 58, amp2 = Math.min(11, sp2*0.6) * tl, startBack = BALL_R + 3;
          ctx.save();
          ctx.lineCap = 'round';
          ctx.lineWidth = 3;
          ctx.strokeStyle = '#fff36b';
          ctx.globalAlpha = 0.9 * tl;
          ctx.beginPath();
          var SEG = 18;
          for(var si=0; si<=SEG; si++){
            var ff  = si/SEG;                               // 0 at ball, 1 at tail
            var env = Math.sin(ff*Math.PI);                 // 0 at both ends, peak mid
            var wob = Math.sin(ff*11 - flashT*0.8) * amp2 * env;
            var wx  = ball.x - dx2*(startBack + ff*len2) + px2*wob;
            var wy  = ball.y - dy2*(startBack + ff*len2) + py2*wob;
            if(si===0) ctx.moveTo(wx, wy); else ctx.lineTo(wx, wy);
          }
          ctx.stroke();
          ctx.restore();
        }
        ballSpikeTrailT--;
      } else {
        ballSpikeTrailT = 0; // ball dead: don't carry the trail to the next serve
      }
    }
    drawBall();
    // Spike burst: a quick expanding ring at the smash point.
    if(spikeFxT > 0){
      var k = spikeFxT / SPIKE_FX_FRAMES; // 1 -> 0
      ctx.save();
      ctx.globalAlpha = k;
      ctx.strokeStyle = '#fff36b';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(spikeFxX, spikeFxY, (1 - k) * 46 + 8, 0, Math.PI*2);
      ctx.stroke();
      ctx.restore();
      spikeFxT--;
    }
    // PAUSED overlay (offline manual pause): dim the court and show how to resume.
    if(userPaused){
      ctx.save();
      ctx.fillStyle = 'rgba(10,14,26,0.55)';
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.font = "34px 'PixelTitle','PixelBold',monospace";
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('PAUSED', W/2, H/2 - 2);
      ctx.fillStyle = 'rgba(255,255,255,0.82)';
      ctx.font = "11px 'PixelBold',monospace";
      ctx.fillText(isTouch() ? 'Tap to resume' : 'Press Enter to resume', W/2, H/2 + 22);
      ctx.restore();
    }
  }

  // ===================== NETWORKING =====================
  // The WebSocket relay normally lives on the same origin that served this
  // page (works on localhost, Fly.io, custom domains, preview envs — no
  // manual edit needed). When the game is hosted somewhere static like
  // itch.io that can't run Node, build with `VITE_RELAY_URL=wss://your-app.fly.dev`
  // and that wins over location.host.
  var _envRelay = ((import.meta as any).env && (import.meta as any).env.VITE_RELAY_URL) || '';
  var SERVER_URL = _envRelay ||
    (((location.protocol === 'https:') ? 'wss://' : 'ws://') + location.host);

  var ws = null;

  function lobbyStatus(t){ var el = document.getElementById('lobbystatus'); if(!el) return; el.textContent = t; el.style.display = t ? '' : 'none'; } // hidden until there's a message (e.g. after Create game)

  function netConnect(onOpen){
    try{
      ws = new WebSocket(SERVER_URL);
    }catch(e){
      lobbyStatus('Could not connect to server.');
      return;
    }
    ws.onopen = function(){ if(onOpen) onOpen(); };
    ws.onmessage = netOnMessage;
    ws.onerror = function(){ lobbyStatus('Connection error. Is the server running?'); };
    ws.onclose = function(){
      if(netMode){ lobbyStatus('Disconnected from server.'); }
    };
  }

  function netSend(obj){ if(ws && ws.readyState === WebSocket.OPEN){ ws.send(JSON.stringify(obj)); } }

  // ===================== WEBRTC TRANSPORT =====================
  // Gameplay inputs travel over a direct peer-to-peer WebRTC DataChannel when we
  // can establish one (lower latency than the relay, and no TCP head-of-line
  // blocking). The existing WebSocket carries the one-time handshake (offer /
  // answer / ICE) and remains the fallback transport: if the channel never opens
  // (restrictive NAT, old browser), inputs just keep flowing over the relay, so
  // online play always works. The host is the offerer, the guest the answerer.
  var pc = null, dc = null, pendingIce = [];
  // ICE servers. STUN lets peers discover a DIRECT path (preferred — lowest
  // latency). TURN relays the P2P traffic ONLY when a direct path can't be formed
  // (strict NAT/firewall); ICE always ranks direct (host/srflx) above relay, so
  // TURN is a fallback, never the default. NOTE: these are FREE public Open Relay
  // credentials for testing — swap in your own (Metered/Twilio/self-hosted coturn)
  // for production reliability/throughput.
  var RTC_CONFIG = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'turn:openrelay.metered.ca:80',  username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
    ]
  };
  function noop(){}
  function rtcSupported(){ return typeof RTCPeerConnection !== 'undefined'; }
  function rtcConnected(){ return dc && dc.readyState === 'open'; }
  // ICE candidates can arrive before setRemoteDescription resolves; addIceCandidate
  // rejects then, so queue early candidates and flush once the description is set.
  function rtcAddIce(cand){
    if(pc && pc.remoteDescription && pc.remoteDescription.type){ pc.addIceCandidate(cand).catch(noop); }
    else { pendingIce.push(cand); }
  }
  function rtcFlushIce(){ var q = pendingIce; pendingIce = []; for(var i=0;i<q.length;i++){ if(pc) pc.addIceCandidate(q[i]).catch(noop); } }
  // Prefer the direct channel; fall back to the relay when it isn't open yet.
  function rtcSend(obj){
    if(rtcConnected()){ try{ dc.send(JSON.stringify(obj)); return; }catch(e){} }
    netSend(obj);
  }
  function rtcBindChannel(ch){
    dc = ch;
    ch.onopen = function(){ if(typeof updatePingUI === 'function') updatePingUI(); };
    ch.onclose = function(){ rtcTransport = ''; rtcRtt = 0; if(typeof updatePingUI === 'function') updatePingUI(); };
    ch.onmessage = function(ev){ var m; try{ m = JSON.parse(ev.data); }catch(e){ return; } handleNetMessage(m); };
  }
  function rtcStart(isOfferer){
    rtcCleanup();
    pendingIce = [];
    if(!rtcSupported()) return; // unsupported browser: stay on the relay
    try{ pc = new RTCPeerConnection(RTC_CONFIG); }catch(e){ pc = null; return; }
    pc.onicecandidate = function(e){ if(e.candidate) netSend({type:'rtc-ice', cand: e.candidate}); };
    if(isOfferer){
      // Unreliable + unordered = UDP-like. Lost/reordered input packets are fine:
      // rollback predicts missing frames and the redundant window backfills them.
      rtcBindChannel(pc.createDataChannel('game', { ordered:false, maxRetransmits:0 }));
      pc.createOffer().then(function(o){ return pc.setLocalDescription(o); })
        .then(function(){ netSend({type:'rtc-offer', sdp: pc.localDescription}); }).catch(noop);
    } else {
      pc.ondatachannel = function(e){ rtcBindChannel(e.channel); };
    }
  }
  function rtcOnOffer(sdp){
    rtcStart(false);
    if(!pc) return;
    pc.setRemoteDescription(sdp)
      .then(function(){ rtcFlushIce(); return pc.createAnswer(); })
      .then(function(a){ return pc.setLocalDescription(a); })
      .then(function(){ netSend({type:'rtc-answer', sdp: pc.localDescription}); }).catch(noop);
  }
  function rtcCleanup(){
    if(dc){ try{ dc.close(); }catch(e){} dc = null; }
    if(pc){ try{ pc.close(); }catch(e){} pc = null; }
    rtcTransport = ''; rtcRtt = 0;
  }
  // Poll the live connection to learn (a) whether the selected ICE path is DIRECT
  // or TURN-relayed, and (b) the real peer round-trip — for the transport readout.
  function rtcStatsTick(){
    if(!pc || !rtcConnected()){ if(rtcTransport){ rtcTransport=''; rtcRtt=0; updatePingUI(); } return; }
    if(!pc.getStats){ rtcTransport = rtcTransport || 'direct'; return; }
    pc.getStats(null).then(function(stats){
      var byId = {}, sel = null, selId = null;
      stats.forEach(function(r){ byId[r.id] = r; });
      stats.forEach(function(r){ if(r.type === 'transport' && r.selectedCandidatePairId) selId = r.selectedCandidatePairId; });
      if(selId && byId[selId]) sel = byId[selId];
      if(!sel){ stats.forEach(function(r){ if(r.type === 'candidate-pair' && (r.nominated || r.selected) && r.state === 'succeeded') sel = r; }); }
      if(!sel){ rtcTransport = 'direct'; updatePingUI(); return; } // open but pair not reported yet
      var lc = byId[sel.localCandidateId], rc = byId[sel.remoteCandidateId];
      var relayed = (lc && lc.candidateType === 'relay') || (rc && rc.candidateType === 'relay');
      rtcTransport = relayed ? 'turn' : 'direct';
      if(typeof sel.currentRoundTripTime === 'number') rtcRtt = sel.currentRoundTripTime * 1000;
      updatePingUI();
    }).catch(noop);
  }
  // =================== END WEBRTC TRANSPORT ===================

  // ---- Ping: each side measures its own round-trip to the relay (server echoes
  // 'ping' as 'pong'), then relays that number to the peer so both players can
  // see each other's latency. The ball compensation also reads these values.
  function pingClass(ms){ return ms < 60 ? 'good' : (ms < 120 ? 'ok' : 'bad'); }
  function updatePingUI(){
    var box = document.getElementById('pingbox');
    if(!box) return;
    if(!netMode){ box.style.display = 'none'; return; }
    box.style.display = 'flex';
    var you = document.getElementById('ping-you');
    var opp = document.getElementById('ping-opp');
    you.textContent = myPing   ? Math.round(myPing)  +'ms' : '--';
    opp.textContent = peerPing ? Math.round(peerPing)+'ms' : '--';
    you.className = 'ping-val ' + pingClass(myPing   || 999);
    opp.className = 'ping-val ' + pingClass(peerPing || 999);
    // Transport readout: what gameplay is ACTUALLY using right now.
    var net = document.getElementById('ping-net');
    if(net){
      if(rtcConnected()){
        var rttTxt = rtcRtt ? ' ' + Math.round(rtcRtt) + 'ms' : '';
        if(rtcTransport === 'turn'){ net.textContent = 'TURN' + rttTxt; net.className = 'ping-val ok'; }
        else { net.textContent = 'P2P' + rttTxt; net.className = 'ping-val ' + (rtcRtt ? pingClass(rtcRtt) : 'good'); }
      } else {
        net.textContent = 'RELAY'; net.className = 'ping-val bad';
      }
    }
  }
  function startPing(){
    stopPing();
    myPing = 0; peerPing = 0; rtcTransport = ''; rtcRtt = 0;
    updatePingUI();
    var probe = function(){
      if(ws && ws.readyState === WebSocket.OPEN){ netSend({type:'ping', t: nowMs()}); }
      rtcStatsTick(); // refresh the transport (P2P/TURN/relay) + peer RTT readout
    };
    probe();
    pingTimer = setInterval(probe, 1000);
  }
  function stopPing(){ if(pingTimer){ clearInterval(pingTimer); pingTimer = null; } }

  function randCode(){
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var s = '';
    for(var i=0;i<4;i++){ s += chars[Math.floor(Math.random()*chars.length)]; }
    return s;
  }

  function netCreate(){
    var code = randCode();
    var sel = document.getElementById('winselect');
    hostWin = sel ? parseInt(sel.value, 10) || DEFAULT_WIN : DEFAULT_WIN;
    hosting = true;
    lobbyStatus('Share this code: ' + code + ' — waiting for a friend to join...'); // show the code right away
    netConnect(function(){ netSend({type:'create', code:code}); });
  }
  function netJoin(code){
    if(!code || code.length < 1){ lobbyStatus('Enter a code first.'); return; }
    netConnect(function(){ netSend({type:'join', code:code}); });
  }
  function netSpectate(code){
    if(!code || code.length < 1){ lobbyStatus('Enter a code first.'); return; }
    netConnect(function(){ netSend({type:'spectate', code:code}); });
  }

  // Remember the current online room so a page refresh can rejoin it instead of
  // dropping out. Cleared only when the room truly ends (leave / opponent gone).
  function saveRoom(code, role){ try{ localStorage.setItem('slimeRoom', JSON.stringify({code:code, role:role})); }catch(e){} }
  function loadRoom(){ try{ return JSON.parse(localStorage.getItem('slimeRoom')); }catch(e){ return null; } }
  function clearRoom(){ try{ localStorage.removeItem('slimeRoom'); }catch(e){} }

  function netRejoin(code, role){
    netConnect(function(){ netSend({type:'rejoin', code:code, role:role}); });
  }
  function netLeave(){
    netSend({type:'leave'});
    stopPing();
    rb = null;
    rtcCleanup();
    clearRoom();
    location.reload();
  }

  // ===================== ROLLBACK NETCODE =====================
  // Both peers run this identical deterministic simulation. Each frame we sample
  // our own input, send it (tagged with the frame it applies to), and advance one
  // fixed step using our input + the opponent's. When the opponent's real input
  // for a frame hasn't arrived we PREDICT it (repeat their last input); when the
  // real one arrives and differs, we ROLL BACK to that frame and re-simulate to
  // the present. The state is tiny (two slimes + a ball), so replaying a handful
  // of frames each packet is essentially free.
  var INPUT_DELAY = 2;    // apply local input this many frames late so it usually
                          // reaches the peer before they need it (fewer rollbacks)
  var MAX_ROLLBACK = 10;  // never predict more than this many frames past the last
                          // confirmed remote input — stall instead, to bound replay
  var INPUT_REDUNDANCY = 8; // resend this many recent frames in every packet, so a
                            // dropped packet on the unreliable channel is backfilled
                            // by the next one (rollback can't fix an input that never
                            // arrives). Inputs are 1 byte each, so this stays tiny.

  var NOINPUT = {left:false, right:false, jump:false, spike:false};
  function sampleLocalInput(){
    var left  = !!(keys['a']||keys['A']||keys['ArrowLeft']);
    var right = !!(keys['d']||keys['D']||keys['ArrowRight']);
    var jump  = !!(keys['w']||keys['W']||keys['ArrowUp']||keys[' ']);
    var spike = !!(keys['s']||keys['S']||keys['ArrowDown']); // not directional, no mirror
    // The guest's view is mirrored (they see themselves on the left), so swap
    // horizontal input: pressing "right" should move their slime toward the net
    // on screen. The sent input is already in simulation space, so both peers
    // stay in lockstep.
    if(netMode === 'guest'){ var t = left; left = right; right = t; }
    return {left:left, right:right, jump:jump, spike:spike};
  }
  function inputsEqual(a, b){ return a.left===b.left && a.right===b.right && a.jump===b.jump && a.spike===b.spike; }

  // Full snapshot of everything the simulation reads/writes, for save/restore.
  function getGameState(){
    return {
      p1:{x:p1.x, y:p1.y, vx:p1.vx, vy:p1.vy, g:p1.onGround, scd:p1.spikeCD, sh:p1.spikeHeld},
      p2:{x:p2.x, y:p2.y, vx:p2.vx, vy:p2.vy, g:p2.onGround, scd:p2.spikeCD, sh:p2.spikeHeld},
      ball:{x:ball.x, y:ball.y, vx:ball.vx, vy:ball.vy, live:ball.live, sp:ball.spiked},
      a:scores.p1, b:scores.p2, sv:server, st:state, bs:bounceSeq, bps:bouncePlayerSeq, cs:counterSeq
    };
  }
  function setGameState(s){
    p1.x=s.p1.x; p1.y=s.p1.y; p1.vx=s.p1.vx; p1.vy=s.p1.vy; p1.onGround=s.p1.g; p1.spikeCD=s.p1.scd||0; p1.spikeHeld=!!s.p1.sh;
    p2.x=s.p2.x; p2.y=s.p2.y; p2.vx=s.p2.vx; p2.vy=s.p2.vy; p2.onGround=s.p2.g; p2.spikeCD=s.p2.scd||0; p2.spikeHeld=!!s.p2.sh;
    ball.x=s.ball.x; ball.y=s.ball.y; ball.vx=s.ball.vx; ball.vy=s.ball.vy; ball.live=s.ball.live; ball.spiked=!!s.ball.sp;
    scores.p1=s.a; scores.p2=s.b; server=s.sv; state=s.st; bounceSeq=s.bs||0; bouncePlayerSeq=s.bps||0; counterSeq=s.cs||0;
  }

  // One deterministic tick. inA drives p1 (blue), inB drives p2 (pink).
  function simStep(inA, inB){
    if(state === 'gameover') return;
    if(state !== 'play'){
      // Serving is itself an input: the serving side's jump launches the rally.
      // Both peers process it on the same frame (after rollback), in lockstep.
      var srv = (server === 'p1') ? inA : inB;
      if(srv && srv.jump) startPoint();
      if(state !== 'play') return;
    }
    moveSlime(p1, inA.left, inA.right, inA.jump, MOVE);
    moveSlime(p2, inB.left, inB.right, inB.jump, MOVE);
    tickSpike(p1, inA.spike, p2);
    tickSpike(p2, inB.spike, p1);
    updateBall(); // may end the point/match (purely — DOM is suppressed during sim)
  }

  function rbStart(localSide){
    rb = {
      side: localSide,          // 'p1' (host/blue) or 'p2' (guest/pink)
      frame: 0,                 // next frame to simulate
      local: {},                // applyFrame -> our input
      remote: {},               // applyFrame -> peer input (confirmed)
      used: {},                 // frame -> remote input we actually simulated with
      saved: {},                // frame -> pre-frame state snapshot
      lastRemoteFrame: -1,      // highest confirmed remote frame
      lastRemoteInput: NOINPUT, // newest confirmed remote input (prediction base)
      stalled: false
    };
    simReplaying = false;
  }
  function rbRemoteForFrame(f){
    var r = rb.remote[f];
    return r ? r : rb.lastRemoteInput; // predict: repeat the last confirmed input
  }
  // Simulate exactly the frame at rb.frame, then advance. Caller owns simReplaying.
  function rbSimOne(){
    rb.saved[rb.frame] = getGameState();
    var li = rb.local[rb.frame] || NOINPUT;
    var ri = rbRemoteForFrame(rb.frame);
    rb.used[rb.frame] = ri;
    var inA = (rb.side === 'p1') ? li : ri;
    var inB = (rb.side === 'p1') ? ri : li;
    simStep(inA, inB);
    rb.frame++;
  }
  // One real tick: capture+send our input for a future frame, then simulate (or
  // stall if we'd otherwise predict too far ahead of the peer).
  function rbTick(){
    if(!rb || netPaused) return;
    var applyF = rb.frame + INPUT_DELAY;
    if(rb.local[applyF] === undefined){ rb.local[applyF] = sampleLocalInput(); } // lock this frame's input once
    // Send the newest frame plus a redundant window of recent ones, packed one
    // byte per frame (bit0 left, bit1 right, bit2 jump, bit3 spike). Sent every tick so the
    // unreliable channel self-heals dropped packets; the WS fallback dedupes by
    // frame, so resends are harmless.
    var hist = [];
    for(var hf = applyF - INPUT_REDUNDANCY + 1; hf <= applyF; hf++){
      var li = (hf >= 0 && rb.local[hf]) ? rb.local[hf] : NOINPUT;
      hist.push((li.left?1:0) | (li.right?2:0) | (li.jump?4:0) | (li.spike?8:0));
    }
    rtcSend({type:'in', f:applyF, n:hist});
    if(rb.frame - rb.lastRemoteFrame > MAX_ROLLBACK){ rb.stalled = true; return; }
    rb.stalled = false;
    simReplaying = true;
    rbSimOne();
    simReplaying = false;
    if(rb.frame % 30 === 0){ // periodically drop buffers well behind any rollback point
      var cutoff = rb.frame - 60;
      for(var k in rb.saved){ if((k|0) < cutoff){ delete rb.saved[k]; delete rb.used[k]; delete rb.local[k]; delete rb.remote[k]; } }
    }
  }
  // A peer input packet arrived (a redundant window of frames). Store any frames
  // we don't already have; if any newly-confirmed frame contradicts a prediction
  // we already simulated, roll back ONCE to the earliest such frame and replay
  // forward to the present. Order/duplicates don't matter — frames are keyed.
  function rbOnRemoteInput(m){
    if(!rb || !m.n) return;
    var end = m.f|0, arr = m.n, earliest = -1;
    for(var i=0; i<arr.length; i++){
      var fr = end - (arr.length - 1) + i;
      if(fr < 0 || rb.remote[fr]) continue; // out of range or already confirmed
      var bits = arr[i]|0;
      var inp = {left:!!(bits&1), right:!!(bits&2), jump:!!(bits&4), spike:!!(bits&8)};
      rb.remote[fr] = inp;
      if(fr > rb.lastRemoteFrame){ rb.lastRemoteFrame = fr; rb.lastRemoteInput = inp; }
      if(fr < rb.frame && rb.used[fr] && rb.saved[fr] && !inputsEqual(rb.used[fr], inp)){
        if(earliest < 0 || fr < earliest) earliest = fr;
      }
    }
    if(earliest >= 0){
      var target = rb.frame;
      setGameState(rb.saved[earliest]);
      rb.frame = earliest;
      simReplaying = true;
      while(rb.frame < target){ rbSimOne(); }
      simReplaying = false;
    }
  }
  // Reconnect: the side that stayed is authoritative for the score. Both peers
  // reset to a fresh point at frame 0 with these scores (the in-flight rally is
  // lost, but the score is preserved and the rollback clocks re-align cleanly).
  function rbResync(scP1, scP2, srv){
    scores.p1 = scP1|0; scores.p2 = scP2|0;
    server = (srv === 'p2') ? 'p2' : 'p1';
    resetPositions(server);
    state = (scores.p1 >= WIN || scores.p2 >= WIN) ? 'gameover' : 'point';
    rbStart(rb ? rb.side : (netMode === 'host' ? 'p1' : 'p2'));
    netPaused = false;
    updateScore();
  }

  // Reflect the simulated state to the DOM once per render frame (the sim itself
  // is side-effect-free so rollback can replay it silently). Only updates the
  // scoreboard / message overlay when something actually changed.
  var _presSt = '', _presA = -1, _presB = -1, _presSv = '';
  function presentNet(){
    if(!netMode || !rb) return;
    if(scores.p1 !== _presA || scores.p2 !== _presB){ updateScore(); _presA = scores.p1; _presB = scores.p2; }
    if(netPaused) return; // the 'peer-dropped' handler owns the message while paused
    if(state === _presSt && server === _presSv) return;
    _presSt = state; _presSv = server;
    var mine = rb.side, myServe = (server === mine);
    if(state === 'play'){
      hideRematch(); hideMsg();
    } else if(state === 'point'){
      var sub = myServe ? 'PRESS SPACE OR TAP TO SERVE' : 'WAITING FOR OPPONENT...';
      if(scores.p1 === 0 && scores.p2 === 0) setMsg('GET READY', sub);
      else setMsg(myServe ? 'YOU SCORE' : 'OPPONENT SCORES', sub);
    } else if(state === 'gameover'){
      var iWon = (mine === 'p1') ? (scores.p1 >= WIN) : (scores.p2 >= WIN);
      setMsg(iWon ? 'YOU WIN!' : 'YOU LOSE', '');
      onEnterGameOver();
    }
  }
  // =================== END ROLLBACK NETCODE ===================

  function startOnlineMatch(asHost){
    // Both sides set up identical fixed roles: host = blue (p1), guest = pink (p2).
    twoPlayer = false;
    netMode = asHost ? 'host' : 'guest';
    oppIdx = 0;
    // The host's chosen points-to-win drives the match; the guest receives it
    // via a 'config' message (sent below) and waits for it before its dots match.
    if(asHost) setWin(hostWin);
    p1 = newSlime(true, null);
    p2 = newSlime(false, null);
    p2.col = PINK; p2.cold = PINK_D; p2.r = SLIME_R;
    applyLocalSkins();
    scores = {p1:0, p2:0};
    server = 'p1'; // host (blue) serves first; serving is an in-sim input
    resetPositions(server);
    updateScore();
    document.getElementById('p2name').textContent = 'PINK';
    fieldOf(document.getElementById('oppbtn')).style.display = 'none';
    fieldOf(document.getElementById('modebtn')).style.display = 'none';
    fieldOf(document.getElementById('gamemodebtn')).style.display = asHost ? '' : 'none'; // host can change the ruleset mid-match; guest follows
    fieldOf(document.getElementById('resetbtn')).style.display = 'none';
    setLobbyCreating(true); // connected: Leave (red) in place of Create, Join hidden
    // Only the host can pick the points-to-win; the guest follows via 'config'.
    document.getElementById('winmodebtn').style.display = asHost ? '' : 'none';
    updateWinModeBtn();
    netPaused = false;
    setControlHint(asHost ? 'You are <b>BLUE</b> &middot; Move/jump: <b>A / W / D</b> or arrows'
                          : 'You are <b>PINK</b> &middot; Move/jump: <b>A / W / D</b> or arrows');
    // Mirror the court + scoreboard for the guest so each player sees their own
    // slime on the left (the host already is on the left).
    document.getElementById('stage').classList.toggle('mirror', !asHost);
    document.getElementById('sv-board').classList.toggle('mirror', !asHost);
    updateSkinPickerVisibility();
    // Host tells the guest the target score so both show matching dots, and the
    // ruleset (Classic/Power) so both run an identical deterministic sim.
    if(asHost){ netSend({type:'config', win: WIN}); netSend({type:'gamemode', mode: gameMode}); }
    // Tell the peer which color and username we picked for our slime.
    var mySide = asHost ? 'p1' : 'p2';
    netSend({type:'skin', side: mySide, color: slimeSkins[mySide].color, boss: slimeSkins[mySide].boss});
    netSend({type:'name', name: chatUsername});
    peerName = '';
    updateScoreboardNames();
    // Both peers start the rollback simulation identically at frame 0, on the
    // serve screen. presentNet() renders GET READY / serve prompt from state.
    state = 'point';
    rbStart(asHost ? 'p1' : 'p2');
    _presSt = ''; _presA = -1; _presB = -1; _presSv = '';
    presentNet();
    chatSetConnected(true);
    startPing(); // latency probe drives the on-screen ping indicator
    // Upgrade to a direct peer-to-peer channel: the host offers, the guest
    // answers when the offer arrives. Inputs flow over the relay until it opens.
    if(asHost) rtcStart(true);
  }

  // --- Spectator mode: watch a match rendered from the host's state snapshots ---
  function enterSpectator(){
    netMode = 'spectator';
    p1 = newSlime(true, null);
    p2 = newSlime(false, null);
    p2.col = PINK; p2.cold = PINK_D; p2.r = SLIME_R;
    scores = {p1:0, p2:0}; server = 'p1'; state = 'point';
    resetPositions(server);
    document.getElementById('stage').classList.remove('mirror');
    document.getElementById('sv-board').classList.remove('mirror');
    document.getElementById('p1name').textContent = 'BLUE';
    document.getElementById('p2name').textContent = 'PINK';
    fieldOf(document.getElementById('oppbtn')).style.display = 'none';
    fieldOf(document.getElementById('modebtn')).style.display = 'none';
    setLobbyCreating(true); // hide create/join; the Leave button stops spectating
    updateScore();
    setMsg('SPECTATING', 'WAITING FOR THE MATCH...');
    startPing();
  }
  function presentSpec(){
    if(!specTarget) return;
    p1.x += (specTarget.p1x - p1.x) * 0.35; p1.y += (specTarget.p1y - p1.y) * 0.35;
    p2.x += (specTarget.p2x - p2.x) * 0.35; p2.y += (specTarget.p2y - p2.y) * 0.35;
    ball.x += (specTarget.bx - ball.x) * 0.35; ball.y += (specTarget.by - ball.y) * 0.35;
    ball.spiked = !!specTarget.bsp; server = specTarget.sv;
    if(scores.p1 !== specTarget.a || scores.p2 !== specTarget.b){ scores.p1 = specTarget.a|0; scores.p2 = specTarget.b|0; updateScore(); }
    if(state !== specTarget.st){
      state = specTarget.st;
      if(state === 'play'){ hideMsg(); }
      else if(state === 'gameover'){ setMsg('GAME OVER', (scores.p1 >= WIN ? 'BLUE' : 'PINK') + ' WINS'); }
      else { setMsg('SPECTATING', ''); }
    }
  }

  // WebSocket messages: handle WebRTC signaling here (it only ever arrives over
  // the relay), then defer everything else to the shared dispatcher.
  function netOnMessage(ev){
    var m;
    try{ m = JSON.parse(ev.data); }catch(e){ return; }
    if(m.type === 'rtc-offer'){ rtcOnOffer(m.sdp); return; }
    if(m.type === 'rtc-answer'){ if(pc) pc.setRemoteDescription(m.sdp).then(rtcFlushIce).catch(noop); return; }
    if(m.type === 'rtc-ice'){ if(m.cand) rtcAddIce(m.cand); return; }
    handleNetMessage(m);
  }

  // Shared dispatcher: messages arrive here from the WebSocket relay OR the
  // WebRTC DataChannel (gameplay inputs), so both transports are handled identically.
  function handleNetMessage(m){
    // Latency: our probe came back — update our ping and tell the peer.
    if(m.type === 'pong'){
      var rtt = nowMs() - m.t;
      myPing = myPing ? (myPing * 0.7 + rtt * 0.3) : rtt; // light smoothing
      netSend({type:'netping', ms: Math.round(myPing)});
      updatePingUI();
      return;
    }
    if(m.type === 'netping'){ if(typeof m.ms === 'number'){ peerPing = m.ms; updatePingUI(); } return; }

    // Spectator wiring (host broadcasts state; spectators just render it).
    if(m.type === 'spec-count'){ specCount = m.n|0; return; }
    if(m.type === 'spectating'){ enterSpectator(); return; }
    if(m.type === 'spec-state'){ specTarget = m; return; }
    if(m.type === 'spec-ended'){ netMode = null; specTarget = null; setMsg('MATCH ENDED', 'THE PLAYERS LEFT'); return; }

    if(m.type === 'created'){ saveRoom(m.code, 'host'); lobbyStatus('Share this code: ' + m.code + ' — waiting for a friend to join...'); return; }
    if(m.type === 'joined'){ saveRoom(m.code, 'guest'); lobbyStatus('Joined! Starting...'); return; }
    if(m.type === 'error'){ lobbyStatus(m.reason || 'Error.'); return; }
    if(m.type === 'peer-joined'){ startOnlineMatch(true); return; }   // host: a guest connected
    if(m.type === 'start'){ startOnlineMatch(false); return; }        // guest: match begins
    // Reconnection: we reclaimed our slot after a refresh.
    if(m.type === 'rejoined'){ startOnlineMatch(m.role === 'host'); return; }
    if(m.type === 'rejoin-failed'){
      clearRoom();
      netMode = null;
      rb = null;
      rtcCleanup();
      stopPing();
      updatePingUI();
      lobbyStatus('That room is no longer available.');
      setMsg('SLIME<br>VOLLEYBALL 2', 'PRESS SPACE OR TAP');
      return;
    }
    // The opponent dropped (maybe refreshing) — pause and wait out the grace window.
    if(m.type === 'peer-dropped'){
      netPaused = true;
      setMsg('OPPONENT', 'RECONNECTING...');
      return;
    }
    if(m.type === 'peer-rejoined'){
      // We're the side that stayed, so we hold the authoritative score. Resend
      // identity, then resync both peers' rollback sessions to a fresh point at
      // frame 0 with the current score (the interrupted rally is dropped).
      var side = (netMode === 'host') ? 'p1' : 'p2';
      netSend({type:'skin', side: side, color: slimeSkins[side].color, boss: slimeSkins[side].boss});
      netSend({type:'name', name: chatUsername});
      if(netMode === 'host'){ netSend({type:'config', win: WIN}); netSend({type:'gamemode', mode: gameMode}); }
      netSend({type:'resync', a: scores.p1, b: scores.p2, sv: server});
      _presSt = ''; _presSv = '';
      rbResync(scores.p1, scores.p2, server);
      // Re-establish the P2P channel (the old one died with the disconnect). The
      // host re-offers; the guest answers when the new offer arrives.
      if(netMode === 'host') rtcStart(true);
      return;
    }
    if(m.type === 'peer-left'){
      lobbyStatus('');
      setMsg('OPPONENT LEFT', 'RELOAD TO PLAY AGAIN');
      state = 'gameover';
      netMode = null;
      rb = null;
      rtcCleanup();
      netPaused = false;
      clearRoom();
      hideRematch();
      chatSetConnected(false);
      stopPing();
      updatePingUI();
      return;
    }
    if(m.type === 'chat'){ chatOnPeerMessage(m); return; }

    if(m.type === 'skin' && (m.side === 'p1' || m.side === 'p2')){
      // Remote peer picked a skin (color or boss) — apply to the slime they control.
      slimeSkins[m.side] = {
        color: (typeof m.color === 'string') ? m.color : slimeSkins[m.side].color,
        boss:  (typeof m.boss === 'string') ? m.boss : ''
      };
      applySkinToSlime((m.side === 'p1') ? p1 : p2, m.side);
      return;
    }

    if(m.type === 'name' && typeof m.name === 'string'){
      peerName = m.name.slice(0, 16);
      updateScoreboardNames();
      return;
    }

    if(m.type === 'config' && typeof m.win === 'number'){
      setWin(m.win); // guest adopts the host's points-to-win
      return;
    }
    if(m.type === 'gamemode' && (m.mode === 'classic' || m.mode === 'power')){
      gameMode = m.mode;   // guest adopts the host's ruleset (Classic/Power)
      updateGameModeUI();  // sync the touch SPIKE button / power hint visibility
      if(m.restart) startRematch(); // host changed it mid-match -> reset both sims in lockstep
      return;
    }

    if(m.type === 'rematch-request'){ onRematchRequest(); return; }
    if(m.type === 'rematch-accept'){ startRematch(); return; }
    if(m.type === 'rematch-decline'){ onRematchDecline(); return; }

    // Rollback: a per-frame input from the peer. Feed it to the engine, which
    // re-simulates from that frame if it contradicts what we predicted.
    if(m.type === 'in'){ rbOnRemoteInput(m); return; }
    // Reconnect handshake: adopt the authoritative score and restart the sim.
    if(m.type === 'resync'){ rbResync(m.a, m.b, m.sv); return; }
  }
  // =================== END NETWORKING ===================

  // ===================== REMATCH (online) =====================
  // After an online game ends, both players see a "Rematch" prompt. Whoever
  // clicks it asks the other, who answers Yes/No. On Yes, the host resets the
  // match authoritatively and the guest follows the host's broadcast state.
  var rematchState = 'idle'; // idle | offer | waiting | asked | declined
  function setRematchUI(mode){
    rematchState = mode;
    var panel = document.getElementById('rematch');
    var msg = document.getElementById('rematch-msg');
    var ask = document.getElementById('rematch-ask');
    var yes = document.getElementById('rematch-yes');
    var no  = document.getElementById('rematch-no');
    var hint = document.getElementById('rematch-hint');
    if(mode === 'idle'){ panel.style.display = 'none'; return; }
    panel.style.display = 'flex';
    ask.style.display = yes.style.display = no.style.display = 'none';
    if(mode === 'offer'){       msg.textContent = 'PLAY AGAIN?';                 ask.style.display = ''; hint.textContent = 'Press any key for rematch'; }
    else if(mode === 'waiting'){ msg.textContent = 'WAITING FOR OPPONENT...';                            hint.textContent = ''; }
    else if(mode === 'asked'){   msg.textContent = 'OPPONENT WANTS A REMATCH';   yes.style.display = ''; no.style.display = ''; hint.textContent = 'Press any key to accept'; }
    else if(mode === 'declined'){msg.textContent = 'OPPONENT DECLINED';          ask.style.display = ''; hint.textContent = 'Press any key for rematch'; }
  }
  function hideRematch(){ setRematchUI('idle'); }
  function onEnterGameOver(){ if(netMode && rematchState === 'idle') setRematchUI('offer'); }

  function requestRematch(){
    if(!netMode) return;
    if(rematchState === 'asked'){ acceptRematch(); return; } // they already asked
    netSend({type:'rematch-request'});
    setRematchUI('waiting');
  }
  function onRematchRequest(){
    if(!netMode) return;
    if(rematchState === 'waiting'){ acceptRematch(); return; } // both asked at once
    setRematchUI('asked');
  }
  function acceptRematch(){ netSend({type:'rematch-accept'}); startRematch(); }
  function declineRematch(){ netSend({type:'rematch-decline'}); setRematchUI('offer'); }
  function onRematchDecline(){ setRematchUI('declined'); }

  // Reset for a new game. Both peers reset their rollback session identically
  // to frame 0 on the serve screen, so the simulations stay in lockstep.
  function startRematch(){
    hideRematch();
    scores = {p1:0, p2:0};
    server = 'p1';
    resetPositions(server);
    state = 'point';
    if(netMode){ rbStart(rb ? rb.side : (netMode === 'host' ? 'p1' : 'p2')); }
    _presSt = ''; _presA = -1; _presB = -1; _presSv = '';
    updateScore();
    presentNet();
  }

  document.getElementById('rematch-ask').addEventListener('click', requestRematch);
  document.getElementById('rematch-yes').addEventListener('click', acceptRematch);
  document.getElementById('rematch-no').addEventListener('click', declineRematch);
  // =================== END REMATCH =====================

  // One physics tick. All gameplay advances here at a FIXED rate (see loop()),
  // so the speed is identical regardless of the monitor's refresh rate. (A
  // raw requestAnimationFrame loop runs 2-4x too fast on 120/144/240Hz
  // displays, which is why it looked too fast on some Windows machines.)
  function step(){
    if(netMode === 'spectator'){ return; } // spectator: state comes from host snapshots
    if(netMode){
      // Online: the rollback engine drives the simulation (send input, predict
      // the opponent, advance one frame or stall, re-sim on misprediction).
      rbTick();
    } else if(state==='play' && !userPaused){ // offline; frozen while manually paused
      if(twoPlayer){
        moveSlime(p1, keys['a']||keys['A'], keys['d']||keys['D'], keys['w']||keys['W'], MOVE);
        var p2l = keys['j']||keys['J']||keys['ArrowLeft'];
        var p2r = keys['l']||keys['L']||keys['ArrowRight'];
        var p2j = keys['i']||keys['I']||keys['ArrowUp'];
        moveSlime(p2, p2l, p2r, p2j, MOVE);
        tickSpike(p1, !!(keys['s']||keys['S']), p2);    // P1 spikes with S
        tickSpike(p2, !!keys['ArrowDown'], p1);          // P2 spikes with Down
        updateBall();
      } else {
        var ml = keys['a']||keys['A']||keys['ArrowLeft'];
        var mr = keys['d']||keys['D']||keys['ArrowRight'];
        var jp = keys['w']||keys['W']||keys['ArrowUp']||keys[' '];
        moveSlime(p1, ml, mr, jp, MOVE);
        tickSpike(p1, !!(keys['s']||keys['S']||keys['ArrowDown']), p2);
        aiControl(); // the CPU handles its own spike inside aiControl
        updateBall();
      }
    }
    // drift clouds slowly in one direction, wrapping around the screen
    for(var ci=0; ci<CLOUDS.length; ci++){
      CLOUDS[ci].x += CLOUD_SPEED;
      var spw = CLOUD_SPRITES[CLOUDS[ci].sp].w;
      if(CLOUDS[ci].x - spw/2 > W){
        CLOUDS[ci].x = -spw/2;
        CLOUDS[ci].sp = randCloudSprite();
        CLOUDS[ci].y = 40 + Math.floor(Math.random()*54);
      }
    }
  }

  // Fixed-timestep game loop: render every animation frame (smooth on any
  // refresh rate) but advance the simulation in fixed 1/60s steps, catching up
  // with however much real time elapsed since the last frame.
  var STEP_MS = 1000 / 60;
  var _lastT = 0, _accum = 0, _wasPlaying = null, _courtEl = null;
  function loop(now){
    if(!_lastT) _lastT = now;
    var elapsed = now - _lastT;
    _lastT = now;
    // Clamp so a backgrounded tab (or a long stall) doesn't unleash a flood of
    // catch-up steps when it resumes.
    if(elapsed > 250) elapsed = 250;
    _accum += elapsed;
    var n = 0;
    while(_accum >= STEP_MS && n < 5){
      step();
      _accum -= STEP_MS;
      n++;
    }
    if(n >= 5) _accum = 0; // couldn't keep up; drop the backlog
    if(netMode === 'spectator'){ presentSpec(); }
    else if(netMode){ presentNet(); } // mirror the simulated state to the DOM once per frame
    // Host: stream the match to spectators (~30Hz) whenever any are watching.
    if(netMode === 'host' && specCount > 0 && (++_specFrame % 2 === 0)){
      netSend({type:'spec-state', a:scores.p1, b:scores.p2, sv:server, st:state,
        p1x:Math.round(p1.x), p1y:Math.round(p1.y), p2x:Math.round(p2.x), p2y:Math.round(p2.y),
        bx:Math.round(ball.x), by:Math.round(ball.y), bsp:ball.spiked?1:0});
    }
    // Dim the on-screen menu/chat/music icons during active play — but NOT while
    // paused, so the menu is fully visible/usable when the game is paused.
    var _dim = (state === 'play' && !userPaused);
    if(_wasPlaying !== _dim){
      _wasPlaying = _dim;
      if(!_courtEl) _courtEl = document.getElementById('court');
      if(_courtEl) _courtEl.classList.toggle('playing', _dim);
    }
    draw();
    requestAnimationFrame(loop);
  }

  function tryServe(){
    if(netMode) return; // online: serving is an in-sim input (jump while it's your serve)
    if(state!=='play') startPoint();
  }
  // Manual pause, offline only and only during active play (Enter / tap screen).
  function togglePause(){
    if(netMode || state !== 'play') return;
    userPaused = !userPaused;
  }
  // A tap/click on the play area: pause/resume during play, otherwise serve.
  function onScreenTap(){
    if(!netMode && state === 'play') togglePause();
    else tryServe();
  }

  function isTypingTarget(t){
    if(!t) return false;
    var tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable;
  }
  window.addEventListener('keydown', function(e){
    if(isTypingTarget(e.target)) return;
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' '].indexOf(e.key)>=0) e.preventDefault();
    keys[e.key] = true;
    if(e.key===' '){ tryServe(); }
    if(e.key==='Enter'){ e.preventDefault(); togglePause(); } // pause/resume offline play
    if(e.key==='c' || e.key==='C'){ DEBUG_COUNTER_ZONES = !DEBUG_COUNTER_ZONES; } // toggle counter-zone debug overlay
    // R = request a rematch (online game over), or accept one the opponent offered.
    // requestRematch() internally accepts when we're in the 'asked' state.
    // Online rematch: R, any arrow, or A/W/D/S requests it (or accepts the opponent's).
    if(netMode && rematchState !== 'idle' && ['r','R','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','a','A','w','W','d','D','s','S'].indexOf(e.key) >= 0){ requestRematch(); }
  });
  window.addEventListener('keyup', function(e){
    if(isTypingTarget(e.target)) return;
    keys[e.key] = false;
  });

  // Tap/click the play area to serve, or to pause/resume during offline play.
  // Bound to the pixi-canvas too, since it sits on top when a CRT filter is on.
  cv.addEventListener('click', onScreenTap);
  var pixiCanvasEl = document.getElementById('pixi-canvas');
  if(pixiCanvasEl) pixiCanvasEl.addEventListener('click', onScreenTap);

  function isTouch(){ return ('ontouchstart' in window) || navigator.maxTouchPoints>0; }
  var touchpadEl = document.getElementById('touchpad');
  if(isTouch()){
    touchpadEl.classList.add('show');
    document.body.classList.add('touch-joystick'); // reserve scroll space below the controls
  }
  function bindHold(id, key){
    var el = document.getElementById(id);
    function on(e){ e.preventDefault(); keys[key]=true; tryServe(); }
    function off(e){ e.preventDefault(); keys[key]=false; }
    el.addEventListener('touchstart', on, {passive:false});
    el.addEventListener('touchend', off, {passive:false});
    el.addEventListener('mousedown', on);
    el.addEventListener('mouseup', off);
    el.addEventListener('mouseleave', off);
  }
  bindHold('joystick-jump','w');
  bindHold('joystick-spike','s');

  // Virtual joystick: drag the knob, push past a deadzone left/right to engage
  // the corresponding movement key. Vertical axis is ignored (jump uses the
  // dedicated button so a jump can be tapped while the slime is mid-move).
  (function setupJoystick(){
    var base = document.getElementById('joystick-base');
    var knob = document.getElementById('joystick-knob');
    var activeTouchId = null;
    var usingMouse = false;
    function applyOffset(x, y){
      var r = base.offsetWidth / 2;
      var maxR = r - 14;
      // Locked to the horizontal axis: only left/right matters, so the knob
      // slides along x and stays vertically centered (vertical drag is ignored).
      if(x > maxR) x = maxR;
      else if(x < -maxR) x = -maxR;
      knob.style.transform = 'translate(calc(-50% + ' + x + 'px), -50%)';
      var dead = r * 0.22;
      keys['a'] = x < -dead;
      keys['d'] = x > dead;
    }
    function release(){
      knob.style.transform = '';
      keys['a'] = false; keys['d'] = false;
      base.classList.remove('active');
      activeTouchId = null;
      usingMouse = false;
    }
    function pointFromEvent(clientX, clientY){
      var rect = base.getBoundingClientRect();
      return { x: clientX - rect.left - rect.width/2, y: clientY - rect.top - rect.height/2 };
    }
    base.addEventListener('touchstart', function(e){
      e.preventDefault();
      if(activeTouchId !== null) return;
      var t = e.changedTouches[0];
      activeTouchId = t.identifier;
      base.classList.add('active');
      var p = pointFromEvent(t.clientX, t.clientY);
      applyOffset(p.x, p.y);
    }, {passive:false});
    base.addEventListener('touchmove', function(e){
      if(activeTouchId === null) return;
      for(var i=0; i<e.changedTouches.length; i++){
        var t = e.changedTouches[i];
        if(t.identifier === activeTouchId){
          e.preventDefault();
          var p = pointFromEvent(t.clientX, t.clientY);
          applyOffset(p.x, p.y);
          break;
        }
      }
    }, {passive:false});
    function onTouchEnd(e){
      if(activeTouchId === null) return;
      for(var i=0; i<e.changedTouches.length; i++){
        if(e.changedTouches[i].identifier === activeTouchId){
          e.preventDefault();
          release();
          break;
        }
      }
    }
    base.addEventListener('touchend', onTouchEnd, {passive:false});
    base.addEventListener('touchcancel', onTouchEnd, {passive:false});
    // Mouse fallback so the joystick is usable on a desktop browser with devtools.
    base.addEventListener('mousedown', function(e){
      e.preventDefault(); usingMouse = true; base.classList.add('active');
      var p = pointFromEvent(e.clientX, e.clientY); applyOffset(p.x, p.y);
    });
    window.addEventListener('mousemove', function(e){
      if(!usingMouse) return;
      var p = pointFromEvent(e.clientX, e.clientY); applyOffset(p.x, p.y);
    });
    window.addEventListener('mouseup', function(){ if(usingMouse) release(); });
  })();

  // Controls opacity: the slider fades the joystick + JUMP button so they don't
  // block the view of the court. The eye is a separate toggle that only hides the
  // slider itself (and dims its own icon) — it never touches the joystick opacity.
  // Both the slider value and the hidden state are remembered.
  var joyEl = document.getElementById('touchpad-joystick');
  var opacityInput = document.getElementById('joyopacity');
  var eyeBtn = document.getElementById('joyopacity-eye');
  var joyOpacity = 100;
  var joyHidden = false;
  try{ var jo = parseInt(localStorage.getItem('slimeJoyOpacity'), 10); if(jo >= 10 && jo <= 100) joyOpacity = jo; }catch(e){}
  try{ joyHidden = localStorage.getItem('slimeJoyHidden') === '1'; }catch(e){}
  function applyJoyOpacity(){
    joyEl.style.opacity = (joyOpacity / 100).toString(); // joystick follows the slider only
    opacityInput.style.display = joyHidden ? 'none' : ''; // eye hides/shows the slider
    opacityInput.value = joyOpacity;
    eyeBtn.classList.toggle('off', joyHidden);            // dims the icon + shows the slash
  }
  applyJoyOpacity();
  opacityInput.addEventListener('input', function(){
    var v = parseInt(opacityInput.value, 10); // keep 0 (don't let it fall back to 100)
    joyOpacity = isNaN(v) ? 100 : v;
    try{ localStorage.setItem('slimeJoyOpacity', joyOpacity); }catch(e){}
    applyJoyOpacity();
  });
  eyeBtn.addEventListener('click', function(){
    joyHidden = !joyHidden;
    try{ localStorage.setItem('slimeJoyHidden', joyHidden ? '1' : '0'); }catch(e){}
    applyJoyOpacity();
  });

  document.getElementById('resetbtn').addEventListener('click', function(){
    init(); setMsg('SLIME<br>VOLLEYBALL 2', 'PRESS SPACE OR TAP');
  });
  document.getElementById('leavebtn').addEventListener('click', function(){
    netLeave(); // tells the server, clears the saved room, then reloads to offline
  });

  // Audio gains (0..1). sfxVol is the player-hit volume; surfaces play at a
  // quarter of it (see playBounce). Both are derived from the volume panel's
  // slider positions (see posToGain) and recomputed there on startup.
  var bgmVol = 0.15, sfxVol = 1.0;

  // Ball bounce SFX via the Web Audio API. HTMLAudio's play() has noticeable
  // start latency (decode/buffer), which made the hit sound lag the contact; we
  // decode the four variants into buffers once, then fire a one-shot buffer
  // source on each hit, which starts essentially instantly. draw() calls
  // playBounce() at most once per render frame (see bounceSeq), so it never
  // machine-guns. A new source per hit also lets quick bounces overlap.
  var BOUNCE_SRCS = ['Bounce-1.mp3','Bounce-2.mp3','Bounce-3.mp3','Bounce-4.mp3'];
  var audioCtx = null, bounceBufs = [];
  try{
    var AC = window.AudioContext || window.webkitAudioContext;
    if(AC){
      audioCtx = new AC();
      BOUNCE_SRCS.forEach(function(src, i){
        fetch(src).then(function(r){ return r.arrayBuffer(); })
          .then(function(b){ return audioCtx.decodeAudioData(b); })
          .then(function(buf){ bounceBufs[i] = buf; })
          .catch(function(){});
      });
    }
  }catch(e){ audioCtx = null; }
  // Browsers start the context suspended until a user gesture; resume on the
  // first one (the serve tap/keypress already qualifies).
  (function(){
    if(!audioCtx) return;
    var unlock = function(){
      if(audioCtx.state === 'suspended') audioCtx.resume();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchstart', unlock, {passive:true});
  })();
  var _lastBounceAt = -1e9;
  function playBounce(onPlayer){
    // One hit can register on two consecutive frames (the slime pushing into the
    // ball as it launches), which would double the cue. Treat bounces within
    // ~60ms as the same contact and play only the first; real rally bounces are
    // far further apart, so they still each sound.
    var now = (window.performance ? performance.now() : Date.now());
    var fresh = (now - _lastBounceAt) > 60;
    _lastBounceAt = now;
    if(!fresh || !audioCtx || audioCtx.state !== 'running') return;
    var ready = bounceBufs.filter(Boolean);
    if(!ready.length) return;
    var src = audioCtx.createBufferSource();
    src.buffer = ready[(Math.random()*ready.length)|0];
    var g = audioCtx.createGain();
    g.gain.value = sfxVol * (onPlayer ? 1 : 0.25); // surfaces (wall/net/floor) at 25%
    src.connect(g); g.connect(audioCtx.destination);
    src.start(0);
  }

  // Volume panel (bottom-right of the court): opened/closed by the controls-row
  // sound icon; it holds the music on/off switch (wired below) plus these two
  // level sliders. Both knobs sit dead-centre (50) by DEFAULT so they look
  // balanced, even though the gains differ. posToGain maps a slider position
  // through that centre default: the left half fades to silence, the right half
  // rises to full (1.0). So music's centre is 15% with room to go louder, while
  // SFX's centre is already full (its right half just stays at full). We remember
  // the slider POSITIONS, not the gains.
  var MUSIC_DEF = 0.15, SFX_DEF = 1.0; // gain at the centre (50) slider position
  function posToGain(pos, def){
    pos = Math.max(0, Math.min(100, pos));
    return pos <= 50 ? def * (pos / 50) : def + (1 - def) * ((pos - 50) / 50);
  }
  var bgmPos = 50, sfxPos = 50;
  try{ var _bp = parseInt(localStorage.getItem('slimeBgmPos'), 10); if(_bp >= 0 && _bp <= 100) bgmPos = _bp; }catch(e){}
  try{ var _sp = parseInt(localStorage.getItem('slimeSfxPos'), 10); if(_sp >= 0 && _sp <= 100) sfxPos = _sp; }catch(e){}
  bgmVol = posToGain(bgmPos, MUSIC_DEF);
  sfxVol = posToGain(sfxPos, SFX_DEF);
  var volPanel = document.getElementById('volctl');
  var bgmSlider = document.getElementById('vol-music');
  var sfxSlider = document.getElementById('vol-sfx');
  function applyBgmVol(){ var a = document.getElementById('bgmusic'); if(a) a.volume = bgmVol; }
  function setVolPanel(on){ if(volPanel) volPanel.classList.toggle('show', !!on); }
  if(bgmSlider){
    bgmSlider.value = bgmPos;
    bgmSlider.addEventListener('input', function(){
      bgmPos = parseInt(bgmSlider.value, 10) || 0;
      bgmVol = posToGain(bgmPos, MUSIC_DEF);
      try{ localStorage.setItem('slimeBgmPos', bgmPos); }catch(e){}
      applyBgmVol();
    });
  }
  if(sfxSlider){
    sfxSlider.value = sfxPos;
    sfxSlider.addEventListener('input', function(){
      sfxPos = parseInt(sfxSlider.value, 10) || 0;
      sfxVol = posToGain(sfxPos, SFX_DEF);
      try{ localStorage.setItem('slimeSfxPos', sfxPos); }catch(e){}
    });
    sfxSlider.addEventListener('change', function(){ playBounce(true); }); // preview on release
  }

  // Sound: the controls-row icon opens/closes the volume overlay; the music
  // on/off switch lives inside that overlay alongside the level sliders. Music is
  // off by default (browsers block autoplay) and the choice is remembered.
  (function(){
    var icon = document.getElementById('musicbtn');      // opens/closes the overlay
    var toggle = document.getElementById('musictoggle');  // the music on/off switch (in the overlay)
    var audio = document.getElementById('bgmusic');
    if(!icon || !audio) return;
    applyBgmVol();
    var on = false, open = false;
    try{ on = localStorage.getItem('slimeMusic') === 'on'; }catch(e){}
    function applyMusic(){
      icon.classList.toggle('music-off', !on); // the icon still reflects the muted state
      if(toggle){ toggle.textContent = on ? 'Music: On' : 'Music: Off'; toggle.classList.toggle('on', on); }
      if(on){ var p = audio.play(); if(p && p.catch) p.catch(function(){}); }
      else { audio.pause(); }
    }
    icon.addEventListener('click', function(){ open = !open; setVolPanel(open); });
    if(toggle) toggle.addEventListener('click', function(){
      on = !on;
      try{ localStorage.setItem('slimeMusic', on ? 'on' : 'off'); }catch(e){}
      applyMusic();
    });
    applyMusic();
    // If music was left on, resume on the first user gesture (autoplay policy).
    if(on){
      var resume = function(){ applyMusic(); window.removeEventListener('pointerdown', resume); window.removeEventListener('keydown', resume); };
      window.addEventListener('pointerdown', resume);
      window.addEventListener('keydown', resume);
    }
  })();
  var themeBtn = document.getElementById('themebtn');
  var THEMES = ['grassy', 'city', 'beach', 'finaldestination'];
  function themeLabel(t){ return t === 'finaldestination' ? 'Final Destination' : (t.charAt(0).toUpperCase() + t.slice(1)); }
  function applyTheme(){ themeBtn.textContent = themeLabel(theme); }
  applyTheme();
  // Cycle the stage. The beach scene uses the God Rays filter: choosing beach
  // switches the active filter to God Rays; leaving beach (if God Rays were on)
  // switches back to Off, so the rays ride along with the beach scene.
  themeBtn.addEventListener('click', function(){
    var wasBeach = (theme === 'beach');
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]; // cycle grassy -> city -> beach
    try{ localStorage.setItem('slimeTheme', theme); }catch(e){}
    applyTheme();
    if(theme === 'beach') setFilterByKey('godray');
    else if(wasBeach && FILTERS[filterIdx].key === 'godray') setFilterByKey('off');
  });
  document.getElementById('oppbtn').addEventListener('click', function(){
    oppIdx = (oppIdx+1)%OPPS.length;
    init();
    setMsg('NEXT UP', curOpp().name.toUpperCase());
  });
  document.getElementById('modebtn').addEventListener('click', function(){
    twoPlayer = !twoPlayer;
    init();
    setMsg('SLIME<br>VOLLEYBALL 2', twoPlayer ? '2 PLAYER MODE' : 'PRESS SPACE OR TAP');
  });
  // Ruleset toggle: Classic Slime (default) <-> Power Slime (spike enabled).
  document.getElementById('gamemodebtn').addEventListener('click', function(){
    if(netMode === 'guest') return; // online: only the host sets the ruleset; the guest follows
    gameMode = (gameMode === 'power') ? 'classic' : 'power';
    try{ localStorage.setItem('slimeGameMode', gameMode); }catch(e){}
    updateGameModeUI();
    if(netMode === 'host'){
      // Connected match: gameMode is read live by the deterministic sim, so a
      // mid-rally change would desync. Sync the new ruleset and restart BOTH
      // rollback sims in lockstep (a fresh game under the new rules — scores reset).
      netSend({type:'gamemode', mode: gameMode, restart:true});
      startRematch();
    } else if(ws && ws.readyState === WebSocket.OPEN){
      // Online but not matched yet (e.g. host waiting for a guest). Just record
      // the ruleset — it's sent to the guest when they join. Do NOT start an
      // offline game (that was the bug: Rules dropped you into single-player).
    } else {
      // Truly offline (single / local 2-player): restart the local game.
      init();
      setMsg('SLIME<br>VOLLEYBALL 2', gameModeLabel(gameMode).toUpperCase() + ' MODE');
    }
  });
  updateGameModeUI(); // reflect the persisted/default ruleset on load
  // Online host: cycle the points-to-win. setWin() rebuilds the dot row + "FIRST
  // TO N" label, and the 'config' message makes the guest do the same.
  document.getElementById('winmodebtn').addEventListener('click', function(){
    if(netMode !== 'host') return; // only the host sets the mode
    var idx = WIN_OPTIONS.indexOf(WIN);
    var next = WIN_OPTIONS[(idx + 1) % WIN_OPTIONS.length];
    hostWin = next;
    setWin(next);              // updates WIN, the dots, and the FIRST TO label
    updateWinModeBtn();
    netSend({type:'config', win: next}); // guest adopts it → its dot count updates too
  });

  // Lobby wiring
  // While hosting a room you created, you can't also join another — disable the
  // code field + Join button. Reset (re-enable) whenever the lobby opens fresh.
  function setLobbyCreating(creating){
    var ci = document.getElementById('codeinput'), jb = document.getElementById('joinbtn');
    if(ci) ci.disabled = creating;
    if(jb) jb.disabled = creating;
    // Hosting: hide the whole Join row (OR / code / Join) so only the share code shows.
    var jr = (jb && jb.closest) ? jb.closest('.lobby-row') : null;
    if(jr) jr.style.display = creating ? 'none' : '';
    // Connected/hosting: the Leave button takes the Create button's place.
    var cb = document.getElementById('createbtn'), lb = document.getElementById('leavebtn');
    if(cb) cb.style.display = creating ? 'none' : '';
    if(lb) lb.style.display = creating ? '' : 'none';
  }
  document.getElementById('onlinebtn').addEventListener('click', function(){
    var lob = document.getElementById('lobby');
    var opening = (lob.style.display === 'none');
    lob.style.display = opening ? 'block' : 'none';
    if(opening) setLobbyCreating(false);
    lobbyStatus('');
  });
  document.getElementById('lobbyclose').addEventListener('click', function(){
    document.getElementById('lobby').style.display = 'none';
  });
  document.getElementById('createbtn').addEventListener('click', function(){
    setLobbyCreating(true); // hosting this room — can't also join another
    setMsg('WAITING', 'FOR AN OPPONENT TO JOIN'); // main-screen status while hosting
    lobbyStatus('Connecting...'); netCreate();
  });
  document.getElementById('joinbtn').addEventListener('click', function(){
    var code = document.getElementById('codeinput').value.toUpperCase().trim();
    lobbyStatus('Connecting...'); netJoin(code);
  });
  document.getElementById('spectatebtn').addEventListener('click', function(){
    var code = document.getElementById('codeinput').value.toUpperCase().trim();
    lobbyStatus('Connecting...'); netSpectate(code);
  });
  document.getElementById('codeinput').addEventListener('keydown', function(e){
    if(e.key === 'Enter'){ document.getElementById('joinbtn').click(); }
  });

  // ===================== NOISE OVERLAY =====================
  // Sits above the game (and above the WebGL CRT pass) at all times, adding
  // fine film grain via `mix-blend-mode: multiply`. If public/noise.webp exists
  // we use it directly; otherwise we generate a tileable grain pattern at
  // runtime so the page works with zero extra assets.
  (function setupNoise(){
    var ov = document.getElementById('noise-overlay');
    function generate(){
      var size = 192;
      var c = document.createElement('canvas');
      c.width = size; c.height = size;
      var g = c.getContext('2d');
      var img = g.createImageData(size, size);
      var d = img.data;
      for(var i=0; i<d.length; i+=4){
        // Dark grain with random alpha → multiply blend darkens slightly.
        d[i] = 0; d[i+1] = 0; d[i+2] = 0;
        d[i+3] = Math.floor(Math.random() * 55);
      }
      g.putImageData(img, 0, 0);
      ov.style.backgroundImage = 'url(' + c.toDataURL() + ')';
      ov.style.backgroundSize  = size + 'px ' + size + 'px';
    }
    // Prefer the real grain asset if it's present.
    var probe = new Image();
    probe.onload  = function(){
      ov.style.backgroundImage = 'url(noise.webp)';
      ov.style.backgroundSize  = 'auto';
    };
    probe.onerror = generate;
    probe.src = 'noise.webp';
  })();
  // =================== END NOISE OVERLAY ===================

  // ===================== FILTER (WebGL CRT via pixi-filters) =====================
  // Visually distinct shader pipelines, plus an "Off" pass-through:
  //   - Bloom:     soft phosphor glow on bright pixels (AdvancedBloomFilter)
  //   - Dot Mask:  halftone phosphor dot pattern (DotFilter, color preserved)
  //   - VHS:       chromatic RGB split + grain/scratches (RGBSplit + OldFilm)
  //   - Scanlines: even pixel-aligned horizontal scanlines (custom GLSL, no curve)
  //   - Game Boy:  4-shade DMG palette quantization (custom GLSL)
  //   - 3D:        3-channel chromatic aberration (custom GLSL, R/G/B offsets)
  //   - God Rays:  animated volumetric light shafts (GodrayFilter)
  // The game keeps rendering into #game; when a filter is active, #game is
  // hidden (visibility:hidden so it keeps drawing) and #pixi-canvas displays
  // the filtered output sampled from #game each frame.
  var FILTERS = [
    { key:'off',      label:'Off' },
    { key:'bloom',    label:'Bloom',
      chain:['bloom'],
      bloom:{ threshold:0.65, bloomScale:0.385, brightness:1.0, blur:7, quality:5 } },
    { key:'dot',      label:'Dot Mask',
      chain:['dot'],
      dot:{ size:3.0, strength:0.22 } },
    { key:'vhs',      label:'VHS',
      chain:['rgb','oldfilm'],
      rgb:{ red:[-2,0], green:[0,0], blue:[2,0] },
      oldfilm:{ sepia:0.05, noise:0.18, noiseSize:1.0, scratch:0.45, scratchDensity:0.08, scratchWidth:1.5, vignetting:0, vignettingAlpha:0 } },
    { key:'scanlines', label:'Scanlines',
      chain:['scanlines'],
      scanlines:{ period:4.0, darkness:0.32 } },
    { key:'gameboy',  label:'Game Boy',
      chain:['gameboy'] },
    { key:'3d',       label:'3D',
      chain:['chromatic'],
      chromatic:{ offset:0.005 } },
    { key:'godray',   label:'God Rays',
      chain:['godray'],
      godray:{ gain:0.6, lacunarity:2.75, angle:30, parallel:true, alpha:0.5 } }
  ];
  var filterIdx = 0;
  try{
    var storedFilter = localStorage.getItem('slimeFilter');
    for(var fi=0; fi<FILTERS.length; fi++){
      if(FILTERS[fi].key === storedFilter){ filterIdx = fi; break; }
    }
  }catch(e){}

  var stageEl  = document.getElementById('stage');
  var filterBtn = document.getElementById('filterbtn');

  var pixiApp = null, pixiSprite = null, pixiTex = null;
  var pixiCrt = null, pixiRgb = null, pixiOldFilm = null;
  var pixiBloom = null, pixiDot = null, pixiScanlines = null;
  var pixiGameboy = null, pixiChromatic = null, pixiGodray = null, pixiReady = false;

  // Custom shader: subtle phosphor dot mask — soft dark gaps between bright
  // "phosphor dots". uStrength controls how dark the gaps are (0 = invisible,
  // 1 = full black gaps).
  var DOTMASK_FRAGMENT = [
    'precision highp float;',
    'varying vec2 vTextureCoord;',
    'uniform sampler2D uSampler;',
    'uniform float uTexWidth;',
    'uniform float uTexHeight;',
    'uniform float uDotSize;',
    'uniform float uStrength;',
    'void main(void) {',
    '  vec4 c = texture2D(uSampler, vTextureCoord);',
    '  vec2 px = vTextureCoord * vec2(uTexWidth, uTexHeight);',
    '  vec2 fr = fract(px / uDotSize) - 0.5;',
    '  float d = length(fr);',
    '  float dotMask = smoothstep(0.5, 0.25, d);',
    '  float mul = mix(1.0 - uStrength, 1.0, dotMask);',
    '  gl_FragColor = vec4(c.rgb * mul, c.a);',
    '}'
  ].join('\n');

  // Custom shader: 3-channel chromatic aberration — red sampled offset to
  // the left, green centered, blue sampled offset to the right. Mimics the
  // RGB fringing of a cheap camera lens.
  var CHROMATIC_FRAGMENT = [
    'precision highp float;',
    'varying vec2 vTextureCoord;',
    'uniform sampler2D uSampler;',
    'uniform float uOffset;',
    'void main(void) {',
    '  vec4 r = texture2D(uSampler, vec2(vTextureCoord.x - uOffset, vTextureCoord.y));',
    '  vec4 g = texture2D(uSampler, vTextureCoord);',
    '  vec4 b = texture2D(uSampler, vec2(vTextureCoord.x + uOffset, vTextureCoord.y));',
    '  gl_FragColor = vec4(r.r, g.g, b.b, g.a);',
    '}'
  ].join('\n');

  // Custom shader: authentic Nintendo Game Boy DMG look — luminance is
  // computed from the source pixel, then quantized into one of 4 levels and
  // mapped to the classic green DMG palette.
  var GAMEBOY_FRAGMENT = [
    'precision highp float;',
    'varying vec2 vTextureCoord;',
    'uniform sampler2D uSampler;',
    'void main(void) {',
    '  vec4 color = texture2D(uSampler, vTextureCoord);',
    '  float lum = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));',
    '  vec3 c0 = vec3(0.06, 0.22, 0.06);', // darkest
    '  vec3 c1 = vec3(0.19, 0.38, 0.19);', // dark
    '  vec3 c2 = vec3(0.55, 0.67, 0.06);', // light
    '  vec3 c3 = vec3(0.61, 0.74, 0.06);', // lightest
    '  vec3 outc = mix(c0, c1, step(0.25, lum));',
    '  outc = mix(outc, c2, step(0.50, lum));',
    '  outc = mix(outc, c3, step(0.75, lum));',
    '  gl_FragColor = vec4(outc, color.a);',
    '}'
  ].join('\n');

  // Custom shader: perfectly even, pixel-aligned horizontal scanlines with
  // zero curvature. Every `uPeriod` rows form one dark+light cycle.
  // We use our own `uTexHeight` rather than PIXI's built-in `inputSize` to
  // avoid colliding with the auto-bound vertex-shader uniform of the same name.
  var SCANLINE_FRAGMENT = [
    'precision highp float;',
    'varying vec2 vTextureCoord;',
    'uniform sampler2D uSampler;',
    'uniform float uTexHeight;',
    'uniform float uPeriod;',
    'uniform float uDarkness;',
    'void main(void) {',
    '  vec4 color = texture2D(uSampler, vTextureCoord);',
    '  float row = floor(vTextureCoord.y * uTexHeight);',
    '  float isLight = step(uPeriod * 0.5, mod(row, uPeriod));',
    '  float scan = mix(1.0 - uDarkness, 1.0, isLight);',
    '  gl_FragColor = vec4(color.rgb * scan, color.a);',
    '}'
  ].join('\n');

  function initPixi(){
    if(pixiReady) return true;
    if(!window.PIXI || !window.PIXI.filters || !window.PIXI.filters.CRTFilter){
      console.warn('PixiJS / pixi-filters not loaded — falling back to Off.');
      return false;
    }
    var pixiCanvas = document.getElementById('pixi-canvas');
    pixiApp = new PIXI.Application({
      view: pixiCanvas, width: W, height: H,
      backgroundAlpha: 0, antialias: false, resolution: 1, autoDensity: false
    });
    pixiTex = PIXI.Texture.from(cv);
    pixiSprite = new PIXI.Sprite(pixiTex);
    pixiSprite.width = W; pixiSprite.height = H;
    pixiApp.stage.addChild(pixiSprite);
    pixiCrt     = new PIXI.filters.CRTFilter();
    pixiRgb     = new PIXI.filters.RGBSplitFilter();
    pixiOldFilm = new PIXI.filters.OldFilmFilter();
    pixiBloom   = new PIXI.filters.AdvancedBloomFilter();
    pixiDot     = new PIXI.Filter(null, DOTMASK_FRAGMENT, { uTexWidth: W, uTexHeight: H, uDotSize: 3.0, uStrength: 0.22 });
    pixiScanlines = new PIXI.Filter(null, SCANLINE_FRAGMENT, { uTexHeight: H, uPeriod: 4.0, uDarkness: 0.32 });
    pixiGameboy   = new PIXI.Filter(null, GAMEBOY_FRAGMENT);
    pixiChromatic = new PIXI.Filter(null, CHROMATIC_FRAGMENT, { uOffset: 0.005 });
    pixiGodray    = new PIXI.filters.GodrayFilter();
    pixiApp.ticker.add(function(){
      // Re-upload the latest 2D canvas frame to the GPU texture.
      pixiTex.baseTexture.update();
      pixiCrt.time += 0.5;
      pixiCrt.seed = Math.random();
      pixiOldFilm.seed = Math.random();
      pixiGodray.time += 0.007; // drift the god rays' fractal-noise animation (-30% speed)
    });
    pixiReady = true;
    return true;
  }

  function buildChain(f){
    var filters = [];
    for(var i=0; i<f.chain.length; i++){
      var step = f.chain[i];
      if(step === 'crt'){
        var c = f.crt;
        pixiCrt.curvature       = c.curvature;
        pixiCrt.lineWidth       = c.lineWidth;
        pixiCrt.lineContrast    = c.lineContrast;
        pixiCrt.verticalLine    = !!c.verticalLine;
        pixiCrt.noise           = c.noise;
        pixiCrt.noiseSize       = c.noiseSize;
        pixiCrt.vignetting      = c.vignetting;
        pixiCrt.vignettingAlpha = c.vignettingAlpha;
        pixiCrt.vignettingBlur  = c.vignettingBlur;
        filters.push(pixiCrt);
      } else if(step === 'rgb'){
        var r = f.rgb;
        pixiRgb.red   = r.red;
        pixiRgb.green = r.green;
        pixiRgb.blue  = r.blue;
        filters.push(pixiRgb);
      } else if(step === 'oldfilm'){
        var o = f.oldfilm;
        pixiOldFilm.sepia            = o.sepia;
        pixiOldFilm.noise            = o.noise;
        pixiOldFilm.noiseSize        = o.noiseSize;
        pixiOldFilm.scratch          = o.scratch;
        pixiOldFilm.scratchDensity   = o.scratchDensity;
        pixiOldFilm.scratchWidth     = o.scratchWidth;
        pixiOldFilm.vignetting       = o.vignetting;
        pixiOldFilm.vignettingAlpha  = o.vignettingAlpha;
        filters.push(pixiOldFilm);
      } else if(step === 'bloom'){
        var b = f.bloom;
        pixiBloom.threshold   = b.threshold;
        pixiBloom.bloomScale  = b.bloomScale;
        pixiBloom.brightness  = b.brightness;
        pixiBloom.blur        = b.blur;
        pixiBloom.quality     = b.quality;
        filters.push(pixiBloom);
      } else if(step === 'dot'){
        var d = f.dot;
        pixiDot.uniforms.uTexWidth  = W;
        pixiDot.uniforms.uTexHeight = H;
        pixiDot.uniforms.uDotSize   = d.size;
        pixiDot.uniforms.uStrength  = d.strength;
        filters.push(pixiDot);
      } else if(step === 'scanlines'){
        var sc = f.scanlines;
        pixiScanlines.uniforms.uTexHeight = H;
        pixiScanlines.uniforms.uPeriod    = sc.period;
        pixiScanlines.uniforms.uDarkness  = sc.darkness;
        filters.push(pixiScanlines);
      } else if(step === 'gameboy'){
        filters.push(pixiGameboy);
      } else if(step === 'chromatic'){
        pixiChromatic.uniforms.uOffset = f.chromatic.offset;
        filters.push(pixiChromatic);
      } else if(step === 'godray'){
        var gr = f.godray;
        pixiGodray.gain       = gr.gain;
        pixiGodray.lacunarity = gr.lacunarity;
        pixiGodray.angle      = gr.angle;
        pixiGodray.parallel   = !!gr.parallel;
        pixiGodray.alpha      = gr.alpha;
        filters.push(pixiGodray);
      }
    }
    pixiSprite.filters = filters;
  }

  function applyFilter(){
    var f = FILTERS[filterIdx];
    filterBtn.textContent = f.label;
    if(f.key === 'off'){
      stageEl.setAttribute('data-filter', 'off');
      return;
    }
    if(!initPixi()){
      stageEl.setAttribute('data-filter', 'off');
      return;
    }
    stageEl.setAttribute('data-filter', f.key);
    buildChain(f);
  }
  // Jump straight to a filter by key (used by the stage switch to toggle the
  // beach's God Rays on/off).
  function setFilterByKey(key){
    for(var i=0; i<FILTERS.length; i++){ if(FILTERS[i].key === key){ filterIdx = i; break; } }
    try{ localStorage.setItem('slimeFilter', FILTERS[filterIdx].key); }catch(e){}
    applyFilter();
  }
  applyFilter();
  filterBtn.addEventListener('click', function(){
    filterIdx = (filterIdx + 1) % FILTERS.length;
    try{ localStorage.setItem('slimeFilter', FILTERS[filterIdx].key); }catch(e){}
    applyFilter();
  });
  // =================== END FILTER ===================

  // ===================== CHAT =====================
  var chatUsername = 'Player';
  var chatNameCustom = false; // true once the player sets a name -> it also labels their slime
  try{
    var storedName = localStorage.getItem('slimeChatUsername');
    if(storedName){ chatUsername = storedName; chatNameCustom = true; }
  }catch(e){}
  // Local 2-player: a separate name for Player 2 (the pink slime).
  var p2Username = 'Player 2';
  var p2NameCustom = false;
  try{
    var storedP2 = localStorage.getItem('slimeP2Username');
    if(storedP2){ p2Username = storedP2; p2NameCustom = true; }
  }catch(e){}

  var chatMessages    = document.getElementById('chat-messages');
  var chatInput       = document.getElementById('chat-input');
  var chatSend        = document.getElementById('chat-send');
  var chatStatus      = document.getElementById('chat-status');
  var chatNameInput   = document.getElementById('chat-username-input');
  var chatNameDisplay = document.getElementById('chat-username-display');
  var chatNameSave    = document.getElementById('chat-username-save');
  var chatP2NameInput   = document.getElementById('chat-p2name-input');
  var chatP2NameDisplay = document.getElementById('chat-p2name-display');
  var chatP2NameSave    = document.getElementById('chat-p2name-save');
  var chatEmojiBtn    = document.getElementById('chat-emoji-btn');
  var chatEmojiPicker = document.getElementById('chat-emoji-picker');

  // Emoji icons sourced from Google Noto Emoji's public SVG CDN at
  // fonts.gstatic.com (path: /s/e/notoemoji/latest/<codepoint>/emoji.svg).
  var NOTO_EMOJI_URL = 'https://fonts.gstatic.com/s/e/notoemoji/latest/';
  var EMOJIS = [
    ['😀','1f600'], ['😂','1f602'], ['😍','1f60d'], ['😎','1f60e'],
    ['😢','1f622'], ['😡','1f621'], ['🤔','1f914'], ['😴','1f634'],
    ['👍','1f44d'], ['👎','1f44e'], ['👏','1f44f'], ['🙏','1f64f'],
    ['💪','1f4aa'], ['🤝','1f91d'], ['❤️','2764_fe0f'], ['🔥','1f525'],
    ['💯','1f4af'], ['🎉','1f389'], ['⚡','26a1'], ['🏐','1f3d0'],
    ['🏆','1f3c6'], ['🎮','1f3ae'], ['😭','1f62d'], ['🤡','1f921']
  ];
  EMOJIS.forEach(function(e){
    var b = document.createElement('button');
    b.type = 'button';
    b.title = e[0];
    var img = document.createElement('img');
    img.src = NOTO_EMOJI_URL + e[1] + '/emoji.svg';
    img.alt = e[0];
    img.loading = 'lazy';
    b.appendChild(img);
    b.addEventListener('click', function(ev){
      ev.stopPropagation();
      insertEmoji(e[0]);
    });
    chatEmojiPicker.appendChild(b);
  });
  function insertEmoji(emo){
    if(chatInput.disabled) return;
    var pos = (typeof chatInput.selectionStart === 'number') ? chatInput.selectionStart : chatInput.value.length;
    var v = chatInput.value;
    chatInput.value = v.slice(0,pos) + emo + v.slice(pos);
    var np = pos + emo.length;
    chatInput.focus();
    try{ chatInput.setSelectionRange(np, np); }catch(e){}
  }
  chatEmojiBtn.addEventListener('click', function(ev){
    ev.stopPropagation();
    if(chatEmojiBtn.disabled) return;
    chatEmojiPicker.classList.toggle('open');
  });
  document.addEventListener('click', function(ev){
    if(!chatEmojiPicker.classList.contains('open')) return;
    if(ev.target === chatEmojiBtn || chatEmojiBtn.contains(ev.target)) return;
    if(chatEmojiPicker.contains(ev.target)) return;
    chatEmojiPicker.classList.remove('open');
  });

  function chatRenderUsername(){ chatNameDisplay.textContent = chatUsername; }
  chatRenderUsername();
  function chatRenderP2Username(){ if(chatP2NameDisplay) chatP2NameDisplay.textContent = p2Username; }
  chatRenderP2Username();

  // Collapse toggle: lets mobile players hide the chat panel so the touchpad
  // is easier to reach. Preference persists in localStorage.
  var chatCollapsed = false;
  try{ chatCollapsed = localStorage.getItem('slimeChatCollapsed') === '1'; }catch(e){}
  var chatEl         = document.getElementById('chat');
  var chatToggleBtn  = document.getElementById('chat-toggle');
  var chatToggleLbl  = document.getElementById('chat-toggle-label');
  function applyChatCollapsed(){
    chatEl.classList.toggle('collapsed', chatCollapsed);
    chatToggleLbl.textContent = chatCollapsed ? 'Show chat' : 'Hide chat';
    chatToggleBtn.setAttribute('aria-expanded', chatCollapsed ? 'false' : 'true');
  }
  applyChatCollapsed();
  chatToggleBtn.addEventListener('click', function(){
    chatCollapsed = !chatCollapsed;
    try{ localStorage.setItem('slimeChatCollapsed', chatCollapsed ? '1' : '0'); }catch(e){}
    applyChatCollapsed();
  });

  // Hide/show the skins panel, mirroring the chat toggle. Preference persists.
  var skinsCollapsed = false;
  try{ skinsCollapsed = localStorage.getItem('slimeSkinsCollapsed') === '1'; }catch(e){}
  var skinsEl        = document.getElementById('skinpickers');
  var skinsToggleBtn = document.getElementById('skins-toggle');
  var skinsToggleLbl = document.getElementById('skins-toggle-label');
  function applySkinsCollapsed(){
    skinsEl.classList.toggle('collapsed', skinsCollapsed);
    skinsToggleLbl.textContent = skinsCollapsed ? 'Show skins' : 'Hide skins';
    skinsToggleBtn.setAttribute('aria-expanded', skinsCollapsed ? 'false' : 'true');
  }
  applySkinsCollapsed();
  skinsToggleBtn.addEventListener('click', function(){
    skinsCollapsed = !skinsCollapsed;
    try{ localStorage.setItem('slimeSkinsCollapsed', skinsCollapsed ? '1' : '0'); }catch(e){}
    applySkinsCollapsed();
  });

  function chatSaveUsername(){
    var v = (chatNameInput.value || '').trim().slice(0, 16);
    if(!v) return;
    chatUsername = v;
    chatNameCustom = true;
    try{ localStorage.setItem('slimeChatUsername', chatUsername); }catch(e){}
    chatRenderUsername();
    chatAppendSystem('Username set to ' + chatUsername);
    chatNameInput.value = '';
    if(netMode){
      netSend({type:'name', name: chatUsername});
      updateScoreboardNames();
    } else {
      updateLabels(); // reflect the new name on the single-player scoreboard
    }
  }
  chatNameSave.addEventListener('click', chatSaveUsername);
  chatNameInput.addEventListener('keydown', function(e){
    if(e.key === 'Enter'){ chatSaveUsername(); e.preventDefault(); }
  });
  // Player 2's name (local 2-player). Labels the pink slime on the scoreboard.
  function chatSaveP2Username(){
    var v = (chatP2NameInput.value || '').trim().slice(0, 16);
    if(!v) return;
    p2Username = v;
    p2NameCustom = true;
    try{ localStorage.setItem('slimeP2Username', p2Username); }catch(e){}
    chatRenderP2Username();
    chatAppendSystem('Player 2 name set to ' + p2Username);
    chatP2NameInput.value = '';
    updateLabels();
  }
  if(chatP2NameSave){
    chatP2NameSave.addEventListener('click', chatSaveP2Username);
    chatP2NameInput.addEventListener('keydown', function(e){
      if(e.key === 'Enter'){ chatSaveP2Username(); e.preventDefault(); }
    });
  }

  function chatAppendMessage(user, text, mine){
    var li = document.createElement('li');
    var u = document.createElement('span');
    u.className = 'user';
    u.style.color = mine ? '#bfe0ff' : '#ffc8dd';
    u.textContent = user + ':';
    var t = document.createElement('span');
    t.textContent = ' ' + text;
    li.appendChild(u); li.appendChild(t);
    chatMessages.appendChild(li);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
  function chatAppendSystem(text){
    var li = document.createElement('li');
    li.className = 'system';
    li.textContent = text;
    chatMessages.appendChild(li);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function chatSendMessage(){
    var text = (chatInput.value || '').trim();
    if(!text) return;
    if(!netMode){
      chatStatus.textContent = 'Connect to an opponent to chat.';
      return;
    }
    text = text.slice(0, 200);
    netSend({type:'chat', user: chatUsername, text: text});
    chatAppendMessage(chatUsername, text, true);
    chatInput.value = '';
  }
  chatSend.addEventListener('click', chatSendMessage);
  chatInput.addEventListener('keydown', function(e){
    if(e.key === 'Enter'){ chatSendMessage(); e.preventDefault(); }
  });

  function chatSetConnected(connected){
    chatInput.disabled = !connected;
    chatSend.disabled = !connected;
    chatEmojiBtn.disabled = !connected;
    if(!connected){ chatEmojiPicker.classList.remove('open'); }
    if(connected){
      chatInput.placeholder = 'Say something to your opponent...';
      chatStatus.textContent = 'Connected to opponent.';
      chatAppendSystem('You are now connected. Say hi!');
    } else {
      chatInput.placeholder = 'Connect to an opponent to chat...';
      chatStatus.textContent = '';
      chatAppendSystem('Opponent disconnected.');
    }
  }

  function chatOnPeerMessage(m){
    var user = (m.user ? String(m.user) : 'Opponent').slice(0, 16);
    var text = (m.text ? String(m.text) : '').slice(0, 200);
    if(!text) return;
    chatAppendMessage(user, text, false);
  }
  // =================== END CHAT ===================

  // ===================== SKIN PICKER =====================
  // Apply a side's chosen skin to the slime it controls. In 1P only p1 is the
  // player; p2 is the AI opponent and keeps its own look.
  function applySkinToControlledSlime(side){
    var slime = (side === 'p1') ? p1 : p2;
    if(slime && (side === 'p1' || twoPlayer || netMode)) applySkinToSlime(slime, side);
  }
  function syncSkin(side){
    if(netMode){ netSend({type:'skin', side:side, color:slimeSkins[side].color, boss:slimeSkins[side].boss}); }
  }
  // Pick a preset/custom color: clears any boss skin (color and boss are
  // mutually exclusive — you're either a color or a boss).
  function selectColor(side, col){
    if(side === 'ball'){
      ballColor = col;
      ballSkin = ''; // a chosen colour and the volleyball skin are mutually exclusive
      updateSkinControls('ball');
      return;
    }
    slimeSkins[side].color = col;
    slimeSkins[side].boss = '';
    applySkinToControlledSlime(side);
    updateSkinControls(side);
    syncSkin(side);
  }
  // Cycle the boss skin: Off -> each boss -> Off.
  function cycleBoss(side){
    if(side === 'ball'){ // the ball cycles its own special skins (volleyball sizes)
      var bn = BALL_BOSS.map(function(b){ return b.name; });
      var bi = bn.indexOf(ballSkin) + 1; // -1 (Off) -> 0
      ballSkin = (bi >= bn.length) ? '' : bn[bi];
      updateSkinControls('ball');
      return;
    }
    var names = BOSS_SKINS.map(function(b){ return b.name; });
    var idx = names.indexOf(slimeSkins[side].boss); // -1 when Off
    idx = idx + 1;
    slimeSkins[side].boss = (idx >= names.length) ? '' : names[idx];
    applySkinToControlledSlime(side);
    updateSkinControls(side);
    syncSkin(side);
  }
  function updateSkinControls(side){
    var col = (side === 'ball') ? ballColor : slimeSkins[side].color;
    var boss = (side === 'ball') ? ballSkin : slimeSkins[side].boss;
    var container = document.querySelector('.swatches[data-side="' + side + '"]');
    if(container){
      var sws = container.querySelectorAll('.swatch');
      for(var i=0;i<sws.length;i++){
        sws[i].classList.toggle('selected', !boss && sws[i].dataset.col === col);
      }
    }
    var custom = document.querySelector('.skin-custom[data-side="' + side + '"]');
    if(custom && !boss && /^#[0-9a-fA-F]{6}$/.test(col)){ custom.value = col; }
    var bossBtn = document.querySelector('.skin-boss[data-side="' + side + '"]');
    if(bossBtn){
      bossBtn.textContent = boss ? boss : (side === 'ball' ? 'Ball: Off' : 'Boss: Off');
      bossBtn.classList.toggle('active', !!boss);
    }
  }
  function buildSwatches(){
    ['p1','p2','ball'].forEach(function(side){
      var container = document.querySelector('.swatches[data-side="' + side + '"]');
      if(container){
        container.innerHTML = '';
        var presets = (side === 'ball') ? BALL_SKINS : SKINS;
        presets.forEach(function(col){
          var btn = document.createElement('button');
          btn.className = 'swatch';
          btn.style.background = col;
          btn.dataset.col = col;
          btn.title = col;
          btn.addEventListener('click', function(){ selectColor(side, col); });
          container.appendChild(btn);
        });
      }
      var custom = document.querySelector('.skin-custom[data-side="' + side + '"]');
      if(custom){ custom.addEventListener('input', function(){ selectColor(side, custom.value); }); }
      var bossBtn = document.querySelector('.skin-boss[data-side="' + side + '"]');
      if(bossBtn){ bossBtn.addEventListener('click', function(){ cycleBoss(side); }); }
      updateSkinControls(side);
    });
  }
  function updateSkinPickerVisibility(){
    var p1Picker = document.getElementById('skin-p1');
    var p2Picker = document.getElementById('skin-p2');
    if(!p1Picker || !p2Picker) return;
    p2Picker.classList.remove('dimmed');
    if(netMode === 'host'){
      p1Picker.style.display = '';
      p2Picker.style.display = 'none';
    } else if(netMode === 'guest'){
      p1Picker.style.display = 'none';
      p2Picker.style.display = '';
    } else if(twoPlayer){
      p1Picker.style.display = '';
      p2Picker.style.display = '';
    } else {
      // 1 Player: Player 2 is the AI opponent — hide its skin picker entirely.
      p1Picker.style.display = '';
      p2Picker.style.display = 'none';
    }
  }
  // =================== END SKIN PICKER ===================

  // ===================== IN-GAME MENU =====================
  // A gear pinned to the court's bottom-left opens a pop-up holding all the game
  // options. The existing control groups are physically MOVED into it (their
  // event listeners ride along with the nodes), so the whole game is
  // self-contained on the game screen for the Google Play build. Chat stays in
  // the side panel; the menu's Chat item links to it.
  (function(){
    var btn   = document.getElementById('menu-btn');
    var bar   = document.getElementById('menu-bar');
    var panel = document.getElementById('menu-panel');
    var court = document.getElementById('court');
    if(!btn || !bar || !panel) return;
    // Distribute the controls into per-category panes (listeners ride along with
    // the moved nodes — they bind by id regardless of DOM position).
    function moveInto(catId, ids){
      var cat = document.getElementById(catId); if(!cat) return;
      ids.forEach(function(id){ var el = document.getElementById(id); if(el) cat.appendChild(el); });
    }
    moveInto('cat-online', ['onlinebtn','lobby','leavebtn']);
    moveInto('cat-mode',   ['modebtn','oppbtn','gamemodebtn','winmodebtn','resetbtn','controlhint','powerhint']);
    moveInto('cat-skins',  ['skin-grid']);
    // Each of these reads as a label to the LEFT of its button (the button shows
    // just the value). Hiding a control hides its whole field (see fieldOf).
    (function(){
      function labelField(id, text){
        var b = document.getElementById(id);
        if(!b || !b.parentNode || b.closest('.menu-field')) return;
        var field = document.createElement('div'); field.className = 'menu-field';
        var lab = document.createElement('span'); lab.className = 'menu-field-label'; lab.textContent = text;
        b.parentNode.insertBefore(field, b);
        field.appendChild(lab); field.appendChild(b);
      }
      labelField('modebtn', 'Mode');
      labelField('oppbtn', 'Opponent');
      labelField('gamemodebtn', 'Rules');
      labelField('themebtn', 'Stage');
      labelField('filterbtn', 'Filter');
      labelField('resetbtn', 'Game');
    })();
    // Stage + Filter get their own category, moved out of the Skins pane.
    (function(){
      var cs = document.getElementById('cat-stage');
      var tfr = document.getElementById('theme-filter-row');
      if(cs && tfr) cs.appendChild(tfr);
    })();
    // Music icon moves out to the court's bottom-right (mirror of the gear); the
    // now-empty control wrappers are hidden.
    var music = document.getElementById('musicbtn');
    if(music && court) court.appendChild(music);
    ['controls','skinpickers'].forEach(function(id){ var el = document.getElementById(id); if(el) el.style.display = 'none'; });
    // The Online category opens the lobby directly, so the in-pane "Online" toggle
    // and the lobby's own Close button are redundant inside the menu.
    var _ob = document.getElementById('onlinebtn'); if(_ob) _ob.style.display = 'none';
    var _lc = document.getElementById('lobbyclose'); if(_lc) _lc.style.display = 'none';
    // Put Leave in the Create row so it can replace Create when connected.
    var _cb0 = document.getElementById('createbtn'), _lb0 = document.getElementById('leavebtn');
    if(_cb0 && _lb0 && _cb0.parentNode) _cb0.parentNode.appendChild(_lb0);
    // TEMP: a row below the game holding the category bar (left) + sound button (right).
    var _stg = document.getElementById('stage');
    if(bar && _stg && _stg.parentNode){
      var _row = document.createElement('div'); _row.id = 'menu-row';
      _stg.parentNode.insertBefore(_row, _stg.nextSibling);
      _row.appendChild(bar); bar.classList.add('below-game');
      var _mus = document.getElementById('musicbtn'); if(_mus) _row.appendChild(_mus);
    }
    // Stage pane: clicking Stage/Filter dims the panel briefly so the new stage
    // shows through (resets on each click so you can cycle).
    [['themebtn','preview-stage'],['filterbtn','preview-filter']].forEach(function(pair){
      var _b = document.getElementById(pair[0]), _cls = pair[1];
      if(_b && panel){
        _b.addEventListener('click', function(){ panel.classList.add('preview', _cls); });
        _b.addEventListener('mouseleave', function(){ panel.classList.remove('preview', _cls); }); // restore only when the mouse leaves the button
      }
    });

    var activeCat = null;
    function setCat(cat){
      activeCat = cat;
      var panes = panel.querySelectorAll('.menu-pane');
      for(var i=0;i<panes.length;i++) panes[i].classList.toggle('active', panes[i].id === ('cat-' + cat));
      var cats = bar.querySelectorAll('.menu-cat');
      for(var j=0;j<cats.length;j++) cats[j].classList.toggle('active', cats[j].getAttribute('data-cat') === cat);
      panel.classList.toggle('open', !!cat);
      panel.setAttribute('aria-hidden', cat ? 'false' : 'true');
      // Opening Online jumps straight to the lobby (create/join), skipping the
      // redundant "Online" button — unless a match is already running.
      if(cat === 'online'){
        var lob = document.getElementById('lobby');
        if(lob){
          lob.style.display = 'block';
          if(hosting || netMode){ setLobbyCreating(true); }      // connected: keep Leave
          else { setLobbyCreating(false); lobbyStatus(''); }     // fresh: Create / Join
        }
      }
    }
    function closeAll(){
      bar.classList.remove('open'); bar.setAttribute('aria-hidden','true');
      btn.setAttribute('aria-expanded','false'); setCat(null);
    }
    btn.addEventListener('click', function(e){
      e.stopPropagation();
      if(bar.classList.contains('open')){ closeAll(); }
      else { bar.classList.add('open'); bar.setAttribute('aria-hidden','false'); btn.setAttribute('aria-expanded','true'); }
    });
    bar.addEventListener('click', function(e){
      var b = e.target.closest ? e.target.closest('.menu-cat') : null;
      if(!b) return;
      var cat = b.getAttribute('data-cat');
      setCat(activeCat === cat ? null : cat); // click the active category again to close its panel
    });
    // Outside click / Escape closes the whole menu.
    document.addEventListener('click', function(e){
      if(!panel.classList.contains('open')) return;        // only when a category panel is showing
      if(panel.contains(e.target) || bar.contains(e.target)) return; // ignore clicks inside the menu
      setCat(null);          // a click anywhere else (incl. the game screen) closes the menu
      e.stopPropagation();   // ...without also pausing/serving from the canvas tap
    }, true);
    document.addEventListener('keydown', function(e){ if(e.key === 'Escape') closeAll(); });
    // Chat button (bottom-centre) reveals + focuses the side-panel chat.
    var chatBtn = document.getElementById('chat-btn');
    if(chatBtn) chatBtn.addEventListener('click', function(){
      var chat = document.getElementById('chat');
      var input = document.getElementById('chat-input');
      if(chat){
        try{ chat.scrollIntoView({behavior:'smooth', block:'nearest'}); }catch(e){}
        chat.classList.add('flash'); setTimeout(function(){ chat.classList.remove('flash'); }, 900);
      }
      if(input && !input.disabled){ input.focus(); }
    });
  })();
  // =================== END IN-GAME MENU ===================

  buildSwatches();
  buildDots();
  init();
  updateSkinPickerVisibility();
  setMsg('SLIME<br>VOLLEYBALL 2', 'PRESS SPACE OR TAP');

  // Cap the fixed chat side-panel's height to the game column (#app). CSS can't
  // read another element's height, so mirror it here; only in the desktop
  // side-panel layout (cleared otherwise so the in-flow bottom panel is free).
  (function(){
    var chatEl = document.getElementById('chat');
    var appEl  = document.getElementById('app');
    if(!chatEl || !appEl) return;
    var sideMQ = window.matchMedia('(min-width:1100px)');
    function syncChatHeight(){
      if(sideMQ.matches){ chatEl.style.maxHeight = (appEl.getBoundingClientRect().height - 65.48) + 'px'; }
      else { chatEl.style.maxHeight = ''; }
    }
    syncChatHeight();
    window.addEventListener('resize', syncChatHeight);
    if(sideMQ.addEventListener) sideMQ.addEventListener('change', syncChatHeight);
    if(window.ResizeObserver) new ResizeObserver(syncChatHeight).observe(appEl);
  })();

  requestAnimationFrame(loop);

  // If we were in an online room before a refresh, transparently rejoin it.
  (function tryRejoinSavedRoom(){
    var saved = loadRoom();
    if(!saved || !saved.code || !saved.role) return;
    setMsg('RECONNECTING', 'REJOINING ' + saved.code + '...');
    netRejoin(saved.code, saved.role);
  })();
})();
