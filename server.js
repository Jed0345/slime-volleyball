// Slime Volleyball 2 - WebSocket relay + static file server.
//
// Locally this serves BOTH the game (from /public) AND the WebSocket relay,
// so you only run one command and open one URL. In production on Render it
// works the same way (it'll happily serve the game too), though you can also
// host the game separately on Vercel/GitHub Pages if you prefer.
//
// The relay is "dumb": it pairs two players by a 4-letter code and forwards
// messages between them. The HOST browser runs the physics; the GUEST browser
// sends inputs and renders what it receives.

const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 8080;
// Serves the Vite build output. Run `npm run build` first; for local dev with
// hot reload use `npm run dev` (Vite) instead and this server just as the relay.
const PUBLIC_DIR = path.join(__dirname, "dist");

// roomCode -> { host: ws|null, guest: ws|null }
const rooms = new Map();

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".json": "application/json",
  ".ico": "image/x-icon",
};

// --- Static file server (serves the game from /public) ---
const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";

  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  // Prevent path traversal outside /public
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
});

// --- WebSocket relay ---
// perMessageDeflate is off: these messages are tiny (input flags / a position
// snapshot) and per-frame compression would only add CPU and latency.
const wss = new WebSocketServer({ server, perMessageDeflate: false });

// Disable Nagle's algorithm on every TCP connection. The relay sends many
// tiny messages (~60/sec each way); Nagle would buffer them for up to ~40ms
// trying to coalesce, which shows up directly as input lag in online play.
server.on("connection", (socket) => { socket.setNoDelay(true); });

function send(ws, obj) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}
function closeSpectators(room) {
  if (room && room.spectators) {
    room.spectators.forEach((s) => send(s, { type: "spec-ended" }));
    room.spectators = [];
  }
}
function otherPeer(room, ws) {
  if (!room) return null;
  return room.host === ws ? room.guest : room.host;
}

wss.on("connection", (ws) => {
  ws.roomCode = null;
  ws.role = null;

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (e) {
      return;
    }

    // Latency probe: bounce the client's timestamp straight back so it can
    // measure its round-trip time to the relay. Handled here so it never gets
    // forwarded to the peer.
    if (msg.type === "ping") {
      send(ws, { type: "pong", t: msg.t });
      return;
    }

    if (msg.type === "create") {
      const code = msg.code;
      const existing = rooms.get(code);
      if (existing && (existing.host || existing.guest)) {
        send(ws, { type: "error", reason: "Room code already in use." });
        return;
      }
      rooms.set(code, { host: ws, guest: null, graceTimer: null, spectators: [] });
      ws.roomCode = code;
      ws.role = "host";
      send(ws, { type: "created", code });
      return;
    }

    // Reclaim a slot in an existing room after a refresh/brief disconnect.
    if (msg.type === "rejoin") {
      const room = rooms.get(msg.code);
      const slot = msg.role === "host" ? "host" : "guest";
      if (!room || room[slot]) {
        send(ws, { type: "rejoin-failed" });
        return;
      }
      room[slot] = ws;
      ws.roomCode = msg.code;
      ws.role = slot;
      if (room.graceTimer) { clearTimeout(room.graceTimer); room.graceTimer = null; }
      send(ws, { type: "rejoined", code: msg.code, role: slot });
      const peer = otherPeer(room, ws);
      if (peer) send(peer, { type: "peer-rejoined" });
      return;
    }

    // Explicit leave: tear the room down immediately (no grace period).
    if (msg.type === "leave") {
      const room = rooms.get(ws.roomCode);
      if (room) {
        const peer = otherPeer(room, ws);
        if (peer) send(peer, { type: "peer-left" });
        if (room.graceTimer) clearTimeout(room.graceTimer);
        closeSpectators(room);
        rooms.delete(ws.roomCode);
      }
      ws.roomCode = null;
      ws.role = null;
      return;
    }

    if (msg.type === "join") {
      const code = msg.code;
      const room = rooms.get(code);
      if (!room || !room.host) {
        send(ws, { type: "error", reason: "No game found with that code." });
        return;
      }
      if (room.guest) {
        send(ws, { type: "error", reason: "That game is already full." });
        return;
      }
      room.guest = ws;
      ws.roomCode = code;
      ws.role = "guest";
      if (room.graceTimer) { clearTimeout(room.graceTimer); room.graceTimer = null; }
      send(ws, { type: "joined", code });
      send(room.host, { type: "peer-joined" });
      send(room.guest, { type: "start" });
      return;
    }

    // Spectate: watch an existing room without taking a player slot.
    if (msg.type === "spectate") {
      const room = rooms.get(msg.code);
      if (!room || !room.host) { send(ws, { type: "error", reason: "No game found with that code." }); return; }
      room.spectators = room.spectators || [];
      room.spectators.push(ws);
      ws.roomCode = msg.code;
      ws.role = "spectator";
      send(ws, { type: "spectating", code: msg.code });
      send(room.host, { type: "spec-count", n: room.spectators.length });
      return;
    }

    // In-game relay: forward everything else to the other peer.
    const room = rooms.get(ws.roomCode);
    if (msg.type === "spec-state") {
      if (room && room.spectators) room.spectators.forEach((sp) => send(sp, msg));
      return;
    }
    const peer = otherPeer(room, ws);
    if (peer) send(peer, msg);
  });

  ws.on("close", () => {
    const code = ws.roomCode;
    const room = rooms.get(code);
    if (!room) return;
    if (ws.role === "spectator") {
      room.spectators = (room.spectators || []).filter((sp) => sp !== ws);
      if (room.host) send(room.host, { type: "spec-count", n: room.spectators.length });
      return;
    }
    const peer = otherPeer(room, ws);
    // Free this player's slot but keep the room briefly so they can rejoin
    // after a refresh without kicking the opponent out.
    if (room.host === ws) room.host = null;
    else if (room.guest === ws) room.guest = null;
    if (!room.host && !room.guest) {
      if (room.graceTimer) clearTimeout(room.graceTimer);
      closeSpectators(room);
      rooms.delete(code);
      return;
    }
    if (peer) send(peer, { type: "peer-dropped" });
    if (room.graceTimer) clearTimeout(room.graceTimer);
    room.graceTimer = setTimeout(() => {
      const r = rooms.get(code);
      if (!r) return;
      const remaining = r.host || r.guest;
      if (remaining) send(remaining, { type: "peer-left" });
      clearTimeout(r.graceTimer);
      closeSpectators(r);
      rooms.delete(code);
    }, 15000);
  });
});

server.listen(PORT, () => {
  console.log("Slime Volleyball 2 running at http://localhost:" + PORT);
  console.log("Open that URL in two browser tabs/windows to test multiplayer.");
});
