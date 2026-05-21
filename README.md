# Slime Volleyball — Multiplayer

A pixel-art Slime Volleyball game with three modes: vs CPU, local 2-player, and
**online multiplayer** over a WebSocket relay.

```
slime-mp-project/
├── server.js        # serves the game + runs the WebSocket relay
├── package.json
└── public/
    └── index.html   # the game (all HTML/CSS/JS in one file)
```

---

## Run it locally (test in your browser)

You need Node.js 18+ installed (https://nodejs.org).

```bash
cd slime-mp-project
npm install      # installs the one dependency (ws)
npm start        # starts the server
```

Then open **http://localhost:8080** in your browser.

### Testing online play on one machine

1. Open http://localhost:8080 in a normal window. Click **Online → Create game**.
   You'll get a 4-letter code.
2. Open http://localhost:8080 in a **second** window (or an incognito window).
   Click **Online → Join**, type the code, hit Join.
3. The match starts: the window that created the game is **BLUE** (left), the one
   that joined is **PINK** (right). Both use A / W / D or arrow keys.

> Locally, the game auto-connects to the same localhost server that served the
> page — no configuration needed.

---

## How online play works (the short version)

- The **host** (the player who created the game) runs all the physics and
  broadcasts the game state ~60x/sec.
- The **guest** sends only its key presses and renders whatever the host sends.
- `server.js` is a "dumb relay" — it just pairs the two players by code and
  forwards messages. It runs no game logic.

This keeps almost all the code in the frontend. The tradeoff is the guest may see
a little lag; that's normal for a relay model.

---

## Deploying online (so friends on other computers can play)

### 1. Put this whole folder in a GitHub repo
Drag the files into a new repo (or use git).

### 2. Deploy the server to Render (free)
- https://render.com → New + → Web Service → connect your repo.
- Build command: `npm install`   Start command: `npm start`   Instance: Free.
- Render gives you a URL like `https://slime-xxxx.onrender.com`.

Because `server.js` also serves the game, **you can just use that Render URL to
play** — open it, and online mode connects automatically. That's the simplest
setup: one deploy, done.

> Render's free instance sleeps after ~15 min idle and takes ~30s to wake on the
> next visit. Fine for casual play.

### 3. (Optional) Host the game on Vercel/GitHub Pages instead
If you'd rather serve the game from Vercel or GitHub Pages and only use Render for
the relay, open `public/index.html`, find this near the top of the `<script>`:

```js
SERVER_URL = 'wss://YOUR-APP-NAME.onrender.com';
```

Replace it with your Render URL but using `wss://` (not `https://`). Then deploy
`public/index.html` to Vercel or GitHub Pages as a static file.

---

## Notes / limitations
- "Reset" during an online game reloads the page (simplest reliable reset).
- If the opponent disconnects, you'll see "OPPONENT LEFT" — reload to play again.
- vs CPU and local 2-player work fully offline and don't touch the server.
