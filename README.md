# 🎣 T-hackle Box

Collaborative coding sandboxes that self-destruct. Built for hackathons, pair programming, and quick experiments.

## Features

- **User Accounts** — Register/login with username & password (JWT auth)
- **Live Sandboxes** — Create temporary coding environments with configurable self-destruct timers (1hr – 48hrs)
- **Real-time Collaboration** — WebSocket-powered presence, live chat, and activity feeds
- **Language & Template Picker** — Python, JavaScript, TypeScript, Rust, Go, React with starter templates (REST API, Full Stack, ML Notebook, Game Jam, CLI Tool)
- **Sandbox Management** — Join/leave sandboxes, promote to permanent Render deployment, or destroy
- **Live Dashboard** — Global stats, online users, activity indicators

## Quick Start

```bash
# Install
npm install

# Development (runs server + Vite dev server)
npm run dev

# Production build
npm run build
npm start
```

The dev server runs on `http://localhost:5173` with API proxy to port `3001`.

## Deploy to Render

1. Push this repo to GitHub
2. Connect your repo on [Render](https://render.com)
3. Use the included `render.yaml` blueprint, or manually configure:
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Environment Variables:**
     - `NODE_ENV` = `production`
     - `JWT_SECRET` = (generate a random string)
     - `PORT` = `3001`

## Tech Stack

- **Frontend:** React 18, Vite, React Router
- **Backend:** Express.js, WebSocket (ws)
- **Auth:** bcrypt + JWT
- **Storage:** JSON file store (swap for Postgres/Redis in production)
- **Hosting:** Render.com

## Project Structure

```
├── server/
│   ├── index.js      # Express + WebSocket server
│   ├── db.js         # JSON file data layer
│   └── auth.js       # JWT auth middleware
├── src/
│   ├── App.jsx       # Main app with auth gating
│   ├── main.jsx      # React entry
│   ├── context/
│   │   └── AppContext.jsx  # Global state, API client, WebSocket
│   └── components/
│       ├── Login.jsx         # Auth screen
│       ├── Header.jsx        # Navbar + user menu
│       ├── Dashboard.jsx     # Stats + sandbox cards
│       ├── CreateModal.jsx   # New sandbox form
│       └── SandboxDetail.jsx # Detail view + chat + activity
├── render.yaml       # Render deployment blueprint
├── vite.config.js
└── package.json
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |
| `JWT_SECRET` | `thacklebox-dev-secret...` | JWT signing secret |
| `DB_PATH` | `./data/db.json` | Data file location |
| `NODE_ENV` | `development` | Set to `production` for built frontend |
