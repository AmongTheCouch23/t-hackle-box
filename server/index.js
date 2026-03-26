import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { v4 as uuid } from 'uuid';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  createUser, getUserByUsername, getUserById, updateLastSeen,
  createSandbox, getSandboxById, getSandboxesForUser, getAllPublicSandboxes,
  updateSandboxStatus, updateSandboxVisibility, updatePublicSite,
  addAllowedUser, removeAllowedUser,
  deleteSandbox, joinSandbox, leaveSandbox,
  canAccessSandbox, canEditSandbox, canViewSandbox, canViewSite,
  resolveShortId,
  createFile, updateFile, renameFile, deleteFile, getFileById,
  createJoinRequest, approveJoinRequest, denyJoinRequest,
  logActivity, expireOldSandboxes, getGlobalStats,
} from './db.js';
import { signToken, verifyToken, authMiddleware } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(cookieParser());
app.use(express.json({ limit: '5mb' }));

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '..', 'dist')));
}

// Helper: require view access (read-only ok)
function requireViewAccess(req, res) {
  const sandbox = getSandboxById(req.params.id);
  if (!sandbox) { res.status(404).json({ error: 'Sandbox not found' }); return null; }
  if (!canViewSandbox(req.params.id, req.user.id)) {
    res.status(403).json({ error: 'You do not have access to this sandbox' }); return null;
  }
  return sandbox;
}

// Helper: require edit access (owner, collaborator, invited)
function requireEditAccess(req, res) {
  const sandbox = getSandboxById(req.params.id);
  if (!sandbox) { res.status(404).json({ error: 'Sandbox not found' }); return null; }
  if (!canEditSandbox(req.params.id, req.user.id)) {
    res.status(403).json({ error: 'You do not have edit access to this sandbox' }); return null;
  }
  return sandbox;
}

// ===================== AUTH ROUTES =====================

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, displayName, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    if (username.length < 3 || username.length > 24) return res.status(400).json({ error: 'Username must be 3-24 characters' });
    if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) return res.status(400).json({ error: 'Username: letters, numbers, _ and - only' });

    const existing = getUserByUsername(username.toLowerCase());
    if (existing) return res.status(409).json({ error: 'Username already taken' });

    const id = uuid();
    const hash = await bcrypt.hash(password, 10);
    createUser(id, username.toLowerCase(), displayName || username, hash);

    const user = getUserById(id);
    const token = signToken(user);
    res.cookie('thb_token', token, { httpOnly: false, maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'lax', path: '/' });
    res.json({ token, user });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const user = getUserByUsername(username.toLowerCase());
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    updateLastSeen(user.id);
    const token = signToken(user);
    const { password_hash, ...safeUser } = user;
    res.cookie('thb_token', token, { httpOnly: false, maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'lax', path: '/' });
    res.json({ token, user: safeUser });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = getUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  updateLastSeen(user.id);
  res.json({ user });
});

// ===================== SANDBOX ROUTES =====================

app.get('/api/sandboxes', authMiddleware, (req, res) => {
  expireOldSandboxes();
  const sandboxes = getSandboxesForUser(req.user.id);
  res.json({ sandboxes });
});

app.get('/api/sandboxes/public', (req, res) => {
  expireOldSandboxes();
  const sandboxes = getAllPublicSandboxes();
  res.json({ sandboxes });
});

app.get('/api/sandboxes/:id', authMiddleware, (req, res) => {
  const sandbox = requireViewAccess(req, res);
  if (!sandbox) return;
  // Tell the frontend whether this user can edit
  sandbox._canEdit = canEditSandbox(req.params.id, req.user.id);
  res.json({ sandbox });
});

app.post('/api/sandboxes', authMiddleware, (req, res) => {
  try {
    const { name, language, template, durationHours } = req.body;
    if (!name || !language || !template) {
      return res.status(400).json({ error: 'Name, language, and template are required' });
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      return res.status(400).json({ error: 'Name: letters, numbers, _ and - only' });
    }

    const id = uuid();
    const sandbox = createSandbox(id, name, req.user.id, language, template, durationHours || 4);

    const ext = { python: 'py', javascript: 'js', typescript: 'ts', rust: 'rs', go: 'go', react: 'jsx' }[language] || 'txt';

    // Generate starter files based on language + template combo
    const mainContent = getStarterContent(language, template, name);
    createFile(uuid(), id, req.user.id, language === 'react' ? 'App.jsx' : `main.${ext}`, mainContent, ext);

    // Add index.html for web-facing templates
    if (['fullstack', 'game'].includes(template) && language !== 'react') {
      const htmlContent = template === 'game' && language === 'javascript'
        ? `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${name}</title>
  <style>
    * { margin: 0; padding: 0; }
    body { background: #0a0e14; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  </style>
</head>
<body>
  <canvas id="game" width="600" height="400"></canvas>
  <script src="main.js"></script>
</body>
</html>`
        : getStarterHTML(name);

      if (template === 'fullstack' && language === 'javascript') {
        // For JS fullstack, HTML loads main.js
        const fsHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${name}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div id="app"></div>
  <script src="main.js"></script>
</body>
</html>`;
        createFile(uuid(), id, req.user.id, 'index.html', fsHtml, 'html');
        createFile(uuid(), id, req.user.id, 'style.css', getStarterCSS(name), 'css');
      } else {
        createFile(uuid(), id, req.user.id, 'index.html', htmlContent, 'html');
      }
    }

    // React templates don't need index.html — the server wraps JSX automatically
    // Blank template for react gets a simple index.html hint
    if (language === 'react' && template === 'blank') {
      // JSX is auto-wrapped, no HTML needed
    }

    const full = getSandboxById(id);
    broadcastToSandbox(id, { type: 'sandbox_created', sandbox: full });
    res.json({ sandbox: full });
  } catch (err) {
    console.error('Create sandbox error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Join — only allowed if user has edit access (invited/allowed). Public viewers must request.
app.post('/api/sandboxes/:id/join', authMiddleware, (req, res) => {
  const sandbox = getSandboxById(req.params.id);
  if (!sandbox) return res.status(404).json({ error: 'Sandbox not found' });
  if (sandbox.status !== 'live' && sandbox.status !== 'promoted') return res.status(400).json({ error: 'Sandbox is not active' });

  // Only let people with edit access join directly (owner, invited, allowed_users)
  if (!canEditSandbox(req.params.id, req.user.id)) {
    return res.status(403).json({ error: 'You need to be invited or have your request approved to join.' });
  }

  joinSandbox(req.params.id, req.user.id);
  const updated = getSandboxById(req.params.id);
  broadcastToSandbox(req.params.id, { type: 'sandbox_updated', sandbox: updated });
  res.json({ sandbox: updated });
});

// Request to join (for public space viewers who don't have edit access)
app.post('/api/sandboxes/:id/request-join', authMiddleware, (req, res) => {
  const sandbox = getSandboxById(req.params.id);
  if (!sandbox) return res.status(404).json({ error: 'Sandbox not found' });
  if (sandbox.status !== 'live' && sandbox.status !== 'promoted') return res.status(400).json({ error: 'Sandbox is not active' });

  // Already a member?
  const isMember = sandbox.collaborators?.some(c => c.user_id === req.user.id);
  if (isMember) return res.status(400).json({ error: 'You are already a member' });

  // Already has edit access (invited)?
  if (canEditSandbox(req.params.id, req.user.id)) {
    // Just join directly
    joinSandbox(req.params.id, req.user.id);
    const updated = getSandboxById(req.params.id);
    broadcastToSandbox(req.params.id, { type: 'sandbox_updated', sandbox: updated });
    return res.json({ sandbox: updated, joined: true });
  }

  const result = createJoinRequest(req.params.id, req.user.id, req.body.message || '');
  if (!result) return res.status(400).json({ error: 'Request already pending or you are already a member' });

  logActivity(req.params.id, req.user.id, 'request_join', `Requested to join`);
  // Notify owner via WS
  broadcastToSandbox(req.params.id, { type: 'join_request', sandboxId: req.params.id, request: result });
  res.json({ request: result });
});

// Approve join request (owner only)
app.post('/api/sandboxes/:id/requests/:requestId/approve', authMiddleware, (req, res) => {
  const sandbox = getSandboxById(req.params.id);
  if (!sandbox) return res.status(404).json({ error: 'Sandbox not found' });
  if (sandbox.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can approve requests' });

  const result = approveJoinRequest(req.params.requestId, req.user.id);
  if (!result) return res.status(404).json({ error: 'Request not found' });

  const updated = getSandboxById(req.params.id);
  broadcastToSandbox(req.params.id, { type: 'sandbox_updated', sandbox: updated });
  res.json({ sandbox: updated });
});

// Deny join request (owner only)
app.post('/api/sandboxes/:id/requests/:requestId/deny', authMiddleware, (req, res) => {
  const sandbox = getSandboxById(req.params.id);
  if (!sandbox) return res.status(404).json({ error: 'Sandbox not found' });
  if (sandbox.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can deny requests' });

  const result = denyJoinRequest(req.params.requestId, req.user.id);
  if (!result) return res.status(404).json({ error: 'Request not found' });

  const updated = getSandboxById(req.params.id);
  res.json({ sandbox: updated });
});

app.post('/api/sandboxes/:id/leave', authMiddleware, (req, res) => {
  leaveSandbox(req.params.id, req.user.id);
  const updated = getSandboxById(req.params.id);
  broadcastToSandbox(req.params.id, { type: 'sandbox_updated', sandbox: updated });
  res.json({ sandbox: updated });
});

app.post('/api/sandboxes/:id/promote', authMiddleware, (req, res) => {
  const sandbox = getSandboxById(req.params.id);
  if (!sandbox) return res.status(404).json({ error: 'Sandbox not found' });
  if (sandbox.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can promote' });

  updateSandboxStatus(req.params.id, 'promoted');
  logActivity(req.params.id, req.user.id, 'promoted', 'Sandbox promoted to permanent deployment');
  const updated = getSandboxById(req.params.id);
  broadcastToSandbox(req.params.id, { type: 'sandbox_updated', sandbox: updated });
  res.json({ sandbox: updated });
});

app.delete('/api/sandboxes/:id', authMiddleware, (req, res) => {
  const sandbox = getSandboxById(req.params.id);
  if (!sandbox) return res.status(404).json({ error: 'Sandbox not found' });
  if (sandbox.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can delete' });

  deleteSandbox(req.params.id);
  broadcast({ type: 'sandbox_deleted', sandboxId: req.params.id });
  res.json({ success: true });
});

// ===================== VISIBILITY & ACCESS =====================

app.post('/api/sandboxes/:id/visibility', authMiddleware, (req, res) => {
  const sandbox = getSandboxById(req.params.id);
  if (!sandbox) return res.status(404).json({ error: 'Sandbox not found' });
  if (sandbox.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can change visibility' });

  const { visibility } = req.body;
  if (!['public', 'private'].includes(visibility)) return res.status(400).json({ error: 'Visibility must be public or private' });

  updateSandboxVisibility(req.params.id, visibility);
  logActivity(req.params.id, req.user.id, 'visibility', `Set sandbox to ${visibility}`);
  const updated = getSandboxById(req.params.id);
  res.json({ sandbox: updated });
});

app.post('/api/sandboxes/:id/public-site', authMiddleware, (req, res) => {
  const sandbox = getSandboxById(req.params.id);
  if (!sandbox) return res.status(404).json({ error: 'Sandbox not found' });
  if (sandbox.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can toggle public site' });

  const { enabled } = req.body;
  updatePublicSite(req.params.id, !!enabled);
  logActivity(req.params.id, req.user.id, 'public_site', `Set public site to ${enabled ? 'on' : 'off'}`);
  const updated = getSandboxById(req.params.id);
  res.json({ sandbox: updated });
});

app.post('/api/sandboxes/:id/invite', authMiddleware, (req, res) => {
  const sandbox = getSandboxById(req.params.id);
  if (!sandbox) return res.status(404).json({ error: 'Sandbox not found' });
  if (sandbox.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can invite users' });

  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Username required' });

  const success = addAllowedUser(req.params.id, username);
  if (!success) return res.status(404).json({ error: 'User not found' });

  logActivity(req.params.id, req.user.id, 'invited', `Invited @${username}`);
  const updated = getSandboxById(req.params.id);
  res.json({ sandbox: updated });
});

app.post('/api/sandboxes/:id/revoke', authMiddleware, (req, res) => {
  const sandbox = getSandboxById(req.params.id);
  if (!sandbox) return res.status(404).json({ error: 'Sandbox not found' });
  if (sandbox.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can revoke access' });

  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Username required' });

  removeAllowedUser(req.params.id, username);
  logActivity(req.params.id, req.user.id, 'revoked', `Revoked access for @${username}`);
  const updated = getSandboxById(req.params.id);
  res.json({ sandbox: updated });
});

// ===================== FILE ROUTES =====================

app.post('/api/sandboxes/:id/files', authMiddleware, (req, res) => {
  const sandbox = requireEditAccess(req, res);
  if (!sandbox) return;

  const { filename, content, fileType } = req.body;
  if (!filename) return res.status(400).json({ error: 'Filename required' });

  const id = uuid();
  const file = createFile(id, req.params.id, req.user.id, filename, content || '', fileType || 'text');
  broadcastToSandbox(req.params.id, { type: 'file_created', sandboxId: req.params.id, file, user: req.user });
  res.json({ file });
});

app.put('/api/sandboxes/:id/files/:fileId', authMiddleware, (req, res) => {
  const sandbox = requireEditAccess(req, res);
  if (!sandbox) return;

  const { content } = req.body;
  const file = updateFile(req.params.fileId, req.user.id, content || '');
  if (!file) return res.status(404).json({ error: 'File not found' });

  broadcastToSandbox(req.params.id, {
    type: 'file_updated', sandboxId: req.params.id, file,
    user: req.user,
  });
  res.json({ file });
});

app.put('/api/sandboxes/:id/files/:fileId/rename', authMiddleware, (req, res) => {
  const sandbox = requireEditAccess(req, res);
  if (!sandbox) return;

  const { filename } = req.body;
  if (!filename) return res.status(400).json({ error: 'Filename required' });

  const file = renameFile(req.params.fileId, req.user.id, filename);
  if (!file) return res.status(404).json({ error: 'File not found' });

  broadcastToSandbox(req.params.id, { type: 'file_renamed', sandboxId: req.params.id, file, user: req.user });
  res.json({ file });
});

app.delete('/api/sandboxes/:id/files/:fileId', authMiddleware, (req, res) => {
  const sandbox = requireEditAccess(req, res);
  if (!sandbox) return;

  deleteFile(req.params.fileId, req.user.id);
  broadcastToSandbox(req.params.id, { type: 'file_deleted', sandboxId: req.params.id, fileId: req.params.fileId, user: req.user });
  res.json({ success: true });
});

// ===================== STATS =====================

app.get('/api/stats', (req, res) => {
  expireOldSandboxes();
  res.json(getGlobalStats());
});

// ===================== SPACE URL RESOLVER (for editor UI) =====================

app.get('/api/resolve/:shortId', authMiddleware, (req, res) => {
  const fullId = resolveShortId(req.params.shortId);
  if (!fullId) return res.status(404).json({ error: 'Space not found' });
  if (!canAccessSandbox(fullId, req.user.id)) {
    return res.status(403).json({ error: 'You do not have access to this space' });
  }
  const sandbox = getSandboxById(fullId);
  res.json({ sandbox });
});

// ===================== LIVE SITE SERVING (/s/:shortId) =====================
// Serves the actual website built from sandbox files.
// index.html or index.jsx at root, other files by filename.

const MIME_TYPES = {
  html: 'text/html', htm: 'text/html',
  css: 'text/css',
  js: 'application/javascript', mjs: 'application/javascript',
  jsx: 'application/javascript', ts: 'application/javascript', tsx: 'application/javascript',
  json: 'application/json',
  svg: 'image/svg+xml',
  xml: 'application/xml',
  txt: 'text/plain', md: 'text/plain', py: 'text/plain', rs: 'text/plain', go: 'text/plain',
  sh: 'text/plain', yml: 'text/yaml', yaml: 'text/yaml', toml: 'text/plain',
  ico: 'image/x-icon', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf',
};

function getContentType(filename) {
  const ext = filename.split('.').pop()?.toLowerCase();
  return MIME_TYPES[ext] || 'text/plain';
}

// Extract user from any available auth source (header, cookie, query, localStorage token via cookie)
function getUserFromRequest(req) {
  // 1. Authorization header
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const user = verifyToken(header.slice(7));
    if (user) return user;
  }
  // 2. Query param ?token=...
  if (req.query.token) {
    const user = verifyToken(req.query.token);
    if (user) return user;
  }
  // 3. Cookie (thb_token)
  if (req.cookies?.thb_token) {
    const user = verifyToken(req.cookies.thb_token);
    if (user) return user;
  }
  return null;
}

// Check access for live site: public_site flag, public visibility, or authenticated member
function checkLiveSiteAccess(sandbox, fullId, req) {
  // public_site = site is public even if space is private
  if (sandbox.public_site) return true;
  if (sandbox.visibility === 'public') return true;
  // Try to identify the user
  const user = getUserFromRequest(req);
  if (!user) return false;
  return canViewSite(fullId, user.id);
}

// Serve a specific file from a sandbox: /s/:shortId/filename.ext
app.get('/s/:shortId/:filename', (req, res) => {
  const fullId = resolveShortId(req.params.shortId);
  if (!fullId) return res.status(404).send('Space not found');

  const sandbox = getSandboxById(fullId);
  if (!sandbox) return res.status(404).send('Space not found');

  if (!checkLiveSiteAccess(sandbox, fullId, req)) {
    return res.status(403).send('This space is private');
  }

  const files = sandbox.files || [];
  const file = files.find(f => f.filename === req.params.filename);
  if (!file) return res.status(404).send('File not found');

  res.setHeader('Content-Type', getContentType(file.filename));
  res.setHeader('Cache-Control', 'no-cache');
  res.send(file.content || '');
});

// Serve index (html or jsx) at /s/:shortId
app.get('/s/:shortId', (req, res) => {
  const fullId = resolveShortId(req.params.shortId);
  if (!fullId) return res.status(404).send(notFoundPage(req.params.shortId));

  const sandbox = getSandboxById(fullId);
  if (!sandbox) return res.status(404).send(notFoundPage(req.params.shortId));

  if (!checkLiveSiteAccess(sandbox, fullId, req)) {
    return res.status(403).send(privatePage(sandbox.name));
  }

  const files = sandbox.files || [];
  const indexHtml = files.find(f => f.filename === 'index.html');
  const indexJsx = files.find(f => f.filename === 'index.jsx' || f.filename === 'App.jsx' || f.filename === 'app.jsx');

  if (indexHtml) {
    // Serve index.html with <base> tag for relative paths
    const baseTag = `<base href="/s/${req.params.shortId}/">`;
    let html = indexHtml.content || '';
    if (html.includes('<head>')) {
      html = html.replace('<head>', `<head>\n${baseTag}`);
    } else if (html.includes('<html')) {
      html = html.replace(/(<html[^>]*>)/, `$1\n<head>${baseTag}</head>`);
    } else {
      html = `<head>${baseTag}</head>\n${html}`;
    }
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(html);
  } else if (indexJsx) {
    // Wrap JSX in an HTML shell with React + Babel loaded from CDN
    let jsxContent = indexJsx.content || '';

    // Strip import statements for react/react-dom — they're loaded as UMD globals
    jsxContent = jsxContent
      .replace(/^\s*import\s+React[\s,].*?from\s+['"]react['"];?\s*$/gm, '// [resolved: React is global]')
      .replace(/^\s*import\s+ReactDOM[\s,].*?from\s+['"]react-dom['"];?\s*$/gm, '// [resolved: ReactDOM is global]')
      .replace(/^\s*import\s+ReactDOM[\s,].*?from\s+['"]react-dom\/client['"];?\s*$/gm, '// [resolved: ReactDOM is global]')
      .replace(/^\s*import\s*\{([^}]+)\}\s*from\s+['"]react['"];?\s*$/gm, (match, imports) => {
        // e.g. import { useState, useEffect } from 'react' → destructure from global React
        const names = imports.split(',').map(s => s.trim()).filter(Boolean);
        return `const { ${names.join(', ')} } = React;`;
      })
      .replace(/^\s*import\s*\{([^}]+)\}\s*from\s+['"]react-dom['"];?\s*$/gm, (match, imports) => {
        const names = imports.split(',').map(s => s.trim()).filter(Boolean);
        return `const { ${names.join(', ')} } = ReactDOM;`;
      })
      .replace(/^\s*import\s*\{([^}]+)\}\s*from\s+['"]react-dom\/client['"];?\s*$/gm, (match, imports) => {
        const names = imports.split(',').map(s => s.trim()).filter(Boolean);
        return `const { ${names.join(', ')} } = ReactDOM;`;
      });

    // Convert `export default function X` or `export default X` to just the declaration
    jsxContent = jsxContent
      .replace(/^\s*export\s+default\s+function\s+(\w+)/gm, 'function $1')
      .replace(/^\s*export\s+default\s+class\s+(\w+)/gm, 'class $1')
      .replace(/^\s*export\s+default\s+/gm, 'const _DefaultExport = ');

    // Collect CSS files to inject
    const cssFiles = files.filter(f => f.filename.endsWith('.css'));
    const cssInject = cssFiles.map(f => `<style>/* ${f.filename} */\n${f.content || ''}</style>`).join('\n');
    // Collect plain .js files
    const jsFiles = files.filter(f =>
      f.filename.endsWith('.js') && f.filename !== 'index.js' && f.id !== indexJsx.id
    );
    const jsInject = jsFiles.map(f => `<script>/* ${f.filename} */\n${f.content || ''}</script>`).join('\n');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${sandbox.name}</title>
  <base href="/s/${req.params.shortId}/">
  <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"><\/script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"><\/script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"><\/script>
  ${cssInject}
  <style>
    body { margin: 0; }
    #root { min-height: 100vh; }
  </style>
</head>
<body>
  <div id="root"></div>
  ${jsInject}
  <script type="text/babel">
${jsxContent}

// Auto-mount
const _Component = typeof App !== 'undefined' ? App
  : typeof _DefaultExport !== 'undefined' ? _DefaultExport
  : null;
if (_Component) {
  const _root = ReactDOM.createRoot(document.getElementById('root'));
  _root.render(React.createElement(_Component));
}
  <\/script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(html);
  } else {
    // No index file — show a file listing page
    res.setHeader('Content-Type', 'text/html');
    res.send(fileListingPage(sandbox, files, req.params.shortId));
  }
});

// ===================== LIVE SITE SERVING — helper pages =====================

function notFoundPage(shortId) {
  return `<!DOCTYPE html><html><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Space Not Found</title>
<style>body{margin:0;background:#0a0e14;color:#e0e8f0;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}
.c{max-width:400px}h1{font-size:64px;margin:0 0 8px}h2{color:#ff4466;font-family:monospace;font-size:14px}p{color:#4a6a5a;font-size:13px;margin-top:12px}
a{color:#00ffaa;text-decoration:none}</style></head>
<body><div class="c"><h1>🎣</h1><h2>Space "${shortId}" not found</h2><p>This space may have expired or been destroyed.</p><p><a href="/">← Back to T-hackle Box</a></p></div></body></html>`;
}

function privatePage(name) {
  return `<!DOCTYPE html><html><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name} — Private Space</title>
<style>body{margin:0;background:#0a0e14;color:#e0e8f0;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}
.c{max-width:400px}h1{font-size:64px;margin:0 0 8px}h2{color:#ffcc00;font-family:monospace;font-size:14px}p{color:#4a6a5a;font-size:13px;margin-top:12px}
a{color:#00ffaa;text-decoration:none}</style></head>
<body><div class="c"><h1>🔒</h1><h2>${name}</h2><p>This space is private. Ask the owner to invite you or make it public.</p><p><a href="/">← Back to T-hackle Box</a></p></div></body></html>`;
}

function fileListingPage(sandbox, files, shortId) {
  const lang = { python:'🐍', javascript:'⚡', typescript:'🔷', rust:'🦀', go:'🐹', react:'⚛️' };
  const fileRows = files.map(f => {
    const ext = f.filename.split('.').pop()?.toLowerCase();
    const icon = { py:'🐍', js:'⚡', ts:'🔷', jsx:'⚛️', html:'🌐', css:'🎨', json:'📋', md:'📝' }[ext] || '📄';
    return `<a href="/s/${shortId}/${f.filename}" class="f"><span class="fi">${icon}</span><span class="fn">${f.filename}</span><span class="fs">${(f.content||'').length} bytes</span></a>`;
  }).join('');

  return `<!DOCTYPE html><html><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${sandbox.name} — T-hackle Box</title>
<style>
body{margin:0;background:#0a0e14;color:#e0e8f0;font-family:'Courier New',monospace;padding:40px 20px}
.w{max-width:600px;margin:0 auto}
.h{display:flex;align-items:center;gap:12px;margin-bottom:24px}
.h .icon{font-size:32px}.h .name{font-size:20px;font-weight:700;color:#00ffaa}
.h .meta{font-size:11px;color:#4a6a5a}
.tip{background:rgba(255,204,0,0.08);border:1px solid rgba(255,204,0,0.2);border-radius:8px;padding:12px 16px;margin-bottom:20px;font-size:12px;color:#ccaa44}
.fl{border:1px solid rgba(255,255,255,0.06);border-radius:10px;overflow:hidden}
.f{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.04);text-decoration:none;color:#c0d0dd;transition:background 0.15s}
.f:hover{background:rgba(0,255,170,0.04)}.f:last-child{border-bottom:none}
.fi{font-size:16px;flex-shrink:0}.fn{flex:1;font-size:13px}.fs{font-size:10px;color:#3a5a4a}
.back{display:inline-block;margin-top:20px;color:#00ffaa;text-decoration:none;font-size:12px}
</style></head>
<body><div class="w">
<div class="h"><span class="icon">${lang[sandbox.language]||'📦'}</span><div><div class="name">${sandbox.name}</div><div class="meta">by @${sandbox.owner_username} · ${files.length} files</div></div></div>
<div class="tip">💡 Add an <strong>index.html</strong> or <strong>index.jsx</strong> file to have this URL serve your site directly.</div>
<div class="fl">${fileRows || '<div style="padding:20px;text-align:center;color:#3a5a4a">No files yet</div>'}</div>
<a href="/" class="back">← Back to T-hackle Box</a>
</div></body></html>`;
}

// ===================== WEBSOCKET =====================

const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Map();

function broadcast(message) {
  const data = JSON.stringify(message);
  for (const [ws] of clients) {
    if (ws.readyState === 1) ws.send(data);
  }
}

function broadcastToSandbox(sandboxId, message) {
  const data = JSON.stringify(message);
  for (const [ws, meta] of clients) {
    if (ws.readyState === 1 && meta.user && canAccessSandbox(sandboxId, meta.user.id)) {
      ws.send(data);
    }
  }
}

wss.on('connection', (ws) => {
  const meta = { user: null, connectedAt: Date.now() };
  clients.set(ws, meta);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);

      if (msg.type === 'auth') {
        const user = verifyToken(msg.token);
        if (user) {
          meta.user = user;
          ws.send(JSON.stringify({ type: 'auth_ok', user }));
        } else {
          ws.send(JSON.stringify({ type: 'auth_error' }));
        }
      }

      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }

      if (msg.type === 'chat' && meta.user && msg.sandboxId && msg.text) {
        if (!canAccessSandbox(msg.sandboxId, meta.user.id)) return;
        logActivity(msg.sandboxId, meta.user.id, 'chat', msg.text);
        broadcastToSandbox(msg.sandboxId, {
          type: 'chat', sandboxId: msg.sandboxId, user: meta.user,
          text: msg.text, timestamp: new Date().toISOString(),
        });
      }

      if (msg.type === 'file_edit' && meta.user && msg.sandboxId && msg.fileId) {
        if (!canAccessSandbox(msg.sandboxId, meta.user.id)) return;
        broadcastToSandbox(msg.sandboxId, {
          type: 'file_edit', sandboxId: msg.sandboxId, fileId: msg.fileId,
          user: meta.user, content: msg.content, cursor: msg.cursor,
        });
      }
    } catch (err) {
      console.error('WS message error:', err);
    }
  });

  ws.on('close', () => { clients.delete(ws); });
});

// Periodic expiry
setInterval(() => {
  const expired = expireOldSandboxes();
  if (expired > 0) broadcast({ type: 'sandboxes_expired', count: expired });
}, 60000);

// Catch-all SPA — MUST come after /s/ routes
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    // Don't catch /s/ routes — those are handled above
    if (req.path.startsWith('/s/')) return res.status(404).send(notFoundPage(req.path));
    res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
  });
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🎣 T-hackle Box server running on port ${PORT}`);
});

// --- Starter content generators ---
function getStarterContent(lang, template, name) {
  const s = STARTERS[lang];
  if (!s) return `// ${name}\n// Start building here\n`;
  return s[template] || s.blank || `// ${name}\n`;
}

function getStarterHTML(name) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${name}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #0a0e14;
      color: #e0e8f0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      max-width: 600px;
      padding: 40px 24px;
      text-align: center;
    }
    h1 {
      font-size: 2rem;
      background: linear-gradient(135deg, #00ffaa, #00ccff);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 12px;
    }
    p { color: #6a8a7a; line-height: 1.6; }
    .btn {
      display: inline-block;
      margin-top: 20px;
      padding: 10px 24px;
      background: #00ffaa;
      color: #0a0e14;
      border: none;
      border-radius: 8px;
      font-weight: 700;
      font-size: 14px;
      cursor: pointer;
    }
    .btn:hover { background: #00ddaa; }
  </style>
</head>
<body>
  <div class="container">
    <h1>${name}</h1>
    <p>Your sandbox is live. Edit this file to build your site.</p>
    <button class="btn" onclick="alert('It works!')">Click Me</button>
  </div>
  <script>
    console.log('${name} is running!');
  </script>
</body>
</html>`;
}

function getStarterCSS(name) {
  return `/* ${name} — styles */
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: system-ui, -apple-system, sans-serif;
  background: #0a0e14;
  color: #e0e8f0;
  min-height: 100vh;
}
.container {
  max-width: 800px;
  margin: 0 auto;
  padding: 40px 20px;
}
h1 { color: #00ffaa; margin-bottom: 16px; }
p { color: #6a8a7a; line-height: 1.6; margin-bottom: 12px; }
button, .btn {
  padding: 8px 20px;
  background: #00ffaa;
  color: #0a0e14;
  border: none;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
}
button:hover, .btn:hover { background: #00ddaa; }
`;
}

const STARTERS = {
  python: {
    blank: `# Start building here

def main():
    print("Hello, world!")

if __name__ == "__main__":
    main()
`,
    api: `"""REST API built with Flask"""
from flask import Flask, jsonify, request
from datetime import datetime

app = Flask(__name__)

# In-memory data store
items = []
next_id = 1

@app.route("/")
def index():
    return jsonify({
        "name": "API",
        "version": "1.0",
        "endpoints": ["/api/items"]
    })

@app.route("/api/items", methods=["GET"])
def get_items():
    return jsonify({"items": items, "count": len(items)})

@app.route("/api/items", methods=["POST"])
def create_item():
    global next_id
    data = request.get_json()
    if not data or "name" not in data:
        return jsonify({"error": "name is required"}), 400
    item = {
        "id": next_id,
        "name": data["name"],
        "description": data.get("description", ""),
        "created_at": datetime.utcnow().isoformat()
    }
    next_id += 1
    items.append(item)
    return jsonify(item), 201

@app.route("/api/items/<int:item_id>", methods=["DELETE"])
def delete_item(item_id):
    global items
    items = [i for i in items if i["id"] != item_id]
    return jsonify({"deleted": True})

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
`,
    fullstack: `"""Backend server for full-stack app"""
from flask import Flask, jsonify, request, send_from_directory
import os

app = Flask(__name__, static_folder=".", static_url_path="")

data = {"counter": 0, "messages": []}

@app.route("/")
def serve_index():
    return send_from_directory(".", "index.html")

@app.route("/api/counter", methods=["GET"])
def get_counter():
    return jsonify(data)

@app.route("/api/counter/increment", methods=["POST"])
def increment():
    data["counter"] += 1
    return jsonify(data)

@app.route("/api/messages", methods=["POST"])
def add_message():
    msg = request.get_json()
    if msg and "text" in msg:
        data["messages"].append(msg["text"])
    return jsonify(data)

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
`,
    ml: `"""Machine Learning sandbox"""
import random
import math

# --- Generate synthetic dataset ---
def generate_data(n=200):
    data = []
    for _ in range(n):
        x1 = random.gauss(0, 1)
        x2 = random.gauss(0, 1)
        label = 1 if (x1 + x2 + random.gauss(0, 0.3)) > 0 else 0
        data.append((x1, x2, label))
    return data

# --- Simple logistic regression from scratch ---
def sigmoid(z):
    return 1.0 / (1.0 + math.exp(-max(-500, min(500, z))))

def train(data, lr=0.1, epochs=100):
    w1, w2, b = 0.0, 0.0, 0.0
    for epoch in range(epochs):
        total_loss = 0
        for x1, x2, y in data:
            pred = sigmoid(w1 * x1 + w2 * x2 + b)
            error = pred - y
            w1 -= lr * error * x1
            w2 -= lr * error * x2
            b -= lr * error
            total_loss += -y * math.log(max(pred, 1e-10)) - (1 - y) * math.log(max(1 - pred, 1e-10))
        if (epoch + 1) % 20 == 0:
            print(f"Epoch {epoch+1:3d} | Loss: {total_loss/len(data):.4f}")
    return w1, w2, b

def predict(w1, w2, b, x1, x2):
    return 1 if sigmoid(w1 * x1 + w2 * x2 + b) > 0.5 else 0

# --- Run ---
print("Generating data...")
dataset = generate_data(300)
train_data = dataset[:240]
test_data = dataset[240:]

print(f"Training on {len(train_data)} samples...\\n")
w1, w2, b = train(train_data)

correct = sum(1 for x1, x2, y in test_data if predict(w1, w2, b, x1, x2) == y)
print(f"\\nTest accuracy: {correct}/{len(test_data)} ({100*correct/len(test_data):.1f}%)")
print(f"Learned weights: w1={w1:.3f}, w2={w2:.3f}, b={b:.3f}")
`,
    game: `"""Simple text-based adventure game"""

rooms = {
    "start": {
        "desc": "You're in a dark room. There's a door to the NORTH and a passage EAST.",
        "north": "hallway",
        "east": "cave"
    },
    "hallway": {
        "desc": "A long hallway. Torches line the walls. Doors SOUTH and WEST.",
        "south": "start",
        "west": "treasure"
    },
    "cave": {
        "desc": "A damp cave. You hear dripping water. You can go WEST.",
        "west": "start"
    },
    "treasure": {
        "desc": "A room full of gold! You win!",
    }
}

def play():
    room = "start"
    print("=== DUNGEON CRAWLER ===\\n")
    while True:
        r = rooms[room]
        print(r["desc"])
        if room == "treasure":
            print("\\nCongratulations!")
            break
        directions = [d for d in ["north", "south", "east", "west"] if d in r]
        print(f"Exits: {', '.join(d.upper() for d in directions)}")
        choice = input("> ").strip().lower()
        if choice in r:
            room = r[choice]
            print()
        else:
            print("You can't go that way.\\n")

if __name__ == "__main__":
    play()
`,
    cli: `"""Command-line tool for managing a task list"""
import json
import sys
from datetime import datetime

TASKS_FILE = "tasks.json"

def load_tasks():
    try:
        with open(TASKS_FILE) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return []

def save_tasks(tasks):
    with open(TASKS_FILE, "w") as f:
        json.dump(tasks, f, indent=2)

def add_task(name):
    tasks = load_tasks()
    task = {"id": len(tasks) + 1, "name": name, "done": False, "created": datetime.now().isoformat()}
    tasks.append(task)
    save_tasks(tasks)
    print(f"Added: {name}")

def list_tasks():
    tasks = load_tasks()
    if not tasks:
        print("No tasks yet. Add one with: add <task name>")
        return
    for t in tasks:
        status = "✓" if t["done"] else "○"
        print(f"  {status} [{t['id']}] {t['name']}")

def complete_task(task_id):
    tasks = load_tasks()
    for t in tasks:
        if t["id"] == task_id:
            t["done"] = True
            save_tasks(tasks)
            print(f"Completed: {t['name']}")
            return
    print(f"Task {task_id} not found")

def main():
    if len(sys.argv) < 2:
        print("Usage: python main.py [list|add|done] [args]")
        print("  list          — show all tasks")
        print("  add <name>    — add a new task")
        print("  done <id>     — mark task complete")
        return

    cmd = sys.argv[1]
    if cmd == "list":
        list_tasks()
    elif cmd == "add" and len(sys.argv) > 2:
        add_task(" ".join(sys.argv[2:]))
    elif cmd == "done" and len(sys.argv) > 2:
        complete_task(int(sys.argv[2]))
    else:
        print(f"Unknown command: {cmd}")

if __name__ == "__main__":
    main()
`,
  },
  javascript: {
    blank: `// Start building here

document.addEventListener('DOMContentLoaded', () => {
  console.log('Ready!');
});
`,
    api: `// REST API with Express
const express = require('express');
const app = express();
app.use(express.json());

const items = [];
let nextId = 1;

app.get('/', (req, res) => {
  res.json({ name: 'API', version: '1.0', endpoints: ['/api/items'] });
});

app.get('/api/items', (req, res) => {
  res.json({ items, count: items.length });
});

app.post('/api/items', (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const item = { id: nextId++, name, description: description || '', created_at: new Date().toISOString() };
  items.push(item);
  res.status(201).json(item);
});

app.delete('/api/items/:id', (req, res) => {
  const idx = items.findIndex(i => i.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  items.splice(idx, 1);
  res.json({ deleted: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(\`API running on :\${PORT}\`));
`,
    fullstack: `// Full-stack app — frontend logic
// This file is loaded by index.html

const app = document.getElementById('app');

let count = 0;
const messages = [];

function render() {
  app.innerHTML = \`
    <div class="container">
      <h1>Full Stack App</h1>
      <div style="margin: 20px 0;">
        <button class="btn" id="counter-btn">Count: \${count}</button>
      </div>
      <div style="margin: 20px 0;">
        <input id="msg-input" placeholder="Type a message..." style="padding: 8px 12px; border-radius: 6px; border: 1px solid #333; background: #1a1e24; color: #e0e8f0; width: 200px;">
        <button class="btn" id="msg-btn" style="margin-left: 8px;">Send</button>
      </div>
      <ul style="list-style: none; text-align: left; max-width: 400px; margin: 0 auto;">
        \${messages.map(m => \`<li style="padding: 6px 0; border-bottom: 1px solid #1a1e24; color: #8aa09a;">\${m}</li>\`).join('')}
      </ul>
    </div>
  \`;

  document.getElementById('counter-btn').addEventListener('click', () => { count++; render(); });
  document.getElementById('msg-btn').addEventListener('click', () => {
    const input = document.getElementById('msg-input');
    if (input.value.trim()) { messages.unshift(input.value.trim()); render(); }
  });
  document.getElementById('msg-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('msg-btn').click();
  });
}

render();
`,
    game: `// Canvas game — bouncing ball with paddle
const canvas = document.getElementById('game') || document.createElement('canvas');
if (!canvas.parentNode) {
  canvas.id = 'game';
  canvas.width = 600;
  canvas.height = 400;
  canvas.style.display = 'block';
  canvas.style.margin = '40px auto';
  canvas.style.background = '#0a0e14';
  canvas.style.borderRadius = '12px';
  canvas.style.border = '1px solid #1a2a2a';
  document.body.appendChild(canvas);
}
const ctx = canvas.getContext('2d');

let ballX = 300, ballY = 200, dx = 3, dy = -3;
let paddleX = 250, paddleW = 100, paddleH = 12;
let score = 0;

document.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  paddleX = Math.max(0, Math.min(canvas.width - paddleW, e.clientX - rect.left - paddleW / 2));
});

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Ball
  ctx.beginPath();
  ctx.arc(ballX, ballY, 10, 0, Math.PI * 2);
  ctx.fillStyle = '#00ffaa';
  ctx.fill();

  // Paddle
  ctx.fillStyle = '#00ccff';
  ctx.fillRect(paddleX, canvas.height - 30, paddleW, paddleH);

  // Score
  ctx.fillStyle = '#4a6a5a';
  ctx.font = '14px monospace';
  ctx.fillText('Score: ' + score, 10, 24);

  // Physics
  ballX += dx;
  ballY += dy;
  if (ballX < 10 || ballX > canvas.width - 10) dx = -dx;
  if (ballY < 10) dy = -dy;

  // Paddle collision
  if (ballY > canvas.height - 42 && ballX > paddleX && ballX < paddleX + paddleW) {
    dy = -Math.abs(dy);
    score++;
    dx *= 1.02;
    dy *= 1.02;
  }

  // Reset if ball falls
  if (ballY > canvas.height + 20) {
    ballX = 300; ballY = 200;
    dx = 3 * (Math.random() > 0.5 ? 1 : -1);
    dy = -3;
    score = 0;
  }

  requestAnimationFrame(draw);
}

draw();
`,
    cli: `// CLI task manager
const tasks = [];
let nextId = 1;

const commands = {
  help() {
    console.log(\`
Commands:
  add <name>    — add a task
  list          — show all tasks
  done <id>     — complete a task
  remove <id>   — delete a task
  help          — show this help
    \`);
  },
  add(name) {
    if (!name) return console.log('Usage: add <task name>');
    tasks.push({ id: nextId++, name, done: false });
    console.log(\`Added: \${name}\`);
  },
  list() {
    if (!tasks.length) return console.log('No tasks. Try: add Buy groceries');
    tasks.forEach(t => {
      console.log(\`  \${t.done ? '✓' : '○'} [\${t.id}] \${t.name}\`);
    });
  },
  done(id) {
    const task = tasks.find(t => t.id === parseInt(id));
    if (!task) return console.log(\`Task \${id} not found\`);
    task.done = true;
    console.log(\`Completed: \${task.name}\`);
  },
  remove(id) {
    const idx = tasks.findIndex(t => t.id === parseInt(id));
    if (idx === -1) return console.log(\`Task \${id} not found\`);
    const removed = tasks.splice(idx, 1)[0];
    console.log(\`Removed: \${removed.name}\`);
  }
};

// Interactive REPL
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log('Task Manager — type "help" for commands');
function prompt() {
  rl.question('> ', (line) => {
    const [cmd, ...args] = line.trim().split(' ');
    if (commands[cmd]) commands[cmd](args.join(' '));
    else if (cmd) console.log(\`Unknown: \${cmd}. Try "help"\`);
    prompt();
  });
}
prompt();
`,
  },
  typescript: {
    blank: `// Start building here

interface AppConfig {
  name: string;
  version: string;
  debug: boolean;
}

const config: AppConfig = {
  name: "My App",
  version: "1.0.0",
  debug: true,
};

function greet(name: string): string {
  return \`Hello, \${name}! Running \${config.name} v\${config.version}\`;
}

console.log(greet("developer"));
`,
    api: `// TypeScript REST API
import express, { Request, Response } from 'express';

interface Item {
  id: number;
  name: string;
  description: string;
  created_at: string;
}

const app = express();
app.use(express.json());

const items: Item[] = [];
let nextId = 1;

app.get('/api/items', (_req: Request, res: Response) => {
  res.json({ items, count: items.length });
});

app.post('/api/items', (req: Request, res: Response) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const item: Item = {
    id: nextId++,
    name,
    description: description || '',
    created_at: new Date().toISOString(),
  };
  items.push(item);
  res.status(201).json(item);
});

app.listen(3000, () => console.log('API on :3000'));
`,
    default: `// TypeScript starter
const message: string = "Hello, TypeScript!";
console.log(message);
`,
  },
  rust: {
    blank: `// Start building here

fn main() {
    println!("Hello, world!");

    let numbers = vec![1, 2, 3, 4, 5];
    let sum: i32 = numbers.iter().sum();
    let avg = sum as f64 / numbers.len() as f64;

    println!("Numbers: {:?}", numbers);
    println!("Sum: {}, Average: {:.1}", sum, avg);
}
`,
    api: `// Rust REST API with Actix-web
use actix_web::{web, App, HttpServer, HttpResponse, middleware};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[derive(Serialize, Deserialize, Clone)]
struct Item {
    id: u32,
    name: String,
    description: String,
}

struct AppState {
    items: Mutex<Vec<Item>>,
    next_id: Mutex<u32>,
}

async fn get_items(data: web::Data<AppState>) -> HttpResponse {
    let items = data.items.lock().unwrap();
    HttpResponse::Ok().json(&*items)
}

async fn create_item(data: web::Data<AppState>, body: web::Json<Item>) -> HttpResponse {
    let mut items = data.items.lock().unwrap();
    let mut next_id = data.next_id.lock().unwrap();
    let item = Item { id: *next_id, name: body.name.clone(), description: body.description.clone() };
    *next_id += 1;
    items.push(item.clone());
    HttpResponse::Created().json(item)
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let state = web::Data::new(AppState {
        items: Mutex::new(Vec::new()),
        next_id: Mutex::new(1),
    });
    println!("Server running on :8080");
    HttpServer::new(move || {
        App::new()
            .app_data(state.clone())
            .route("/api/items", web::get().to(get_items))
            .route("/api/items", web::post().to(create_item))
    })
    .bind("0.0.0.0:8080")?
    .run()
    .await
}
`,
    cli: `// Command-line tool in Rust
use std::env;
use std::io::{self, Write};

fn main() {
    let args: Vec<String> = env::args().collect();

    if args.len() < 2 {
        println!("Usage: {} <command> [args]", args[0]);
        println!("Commands: greet, count, reverse, help");
        return;
    }

    match args[1].as_str() {
        "greet" => {
            let name = args.get(2).map(|s| s.as_str()).unwrap_or("world");
            println!("Hello, {}!", name);
        }
        "count" => {
            let n: u32 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(10);
            for i in 1..=n { print!("{} ", i); }
            println!();
        }
        "reverse" => {
            let text = args[2..].join(" ");
            println!("{}", text.chars().rev().collect::<String>());
        }
        "help" | _ => {
            println!("Commands:");
            println!("  greet [name]   — say hello");
            println!("  count [n]      — count to n");
            println!("  reverse <text> — reverse text");
        }
    }
}
`,
    default: `fn main() {
    println!("Hello from Rust!");
}
`,
  },
  go: {
    blank: `package main

import "fmt"

func main() {
	fmt.Println("Hello, world!")

	numbers := []int{1, 2, 3, 4, 5}
	sum := 0
	for _, n := range numbers {
		sum += n
	}
	fmt.Printf("Sum of %v = %d\\n", numbers, sum)
}
`,
    api: `package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
)

type Item struct {
	ID          int    \`json:"id"\`
	Name        string \`json:"name"\`
	Description string \`json:"description"\`
}

var (
	items  []Item
	nextID = 1
	mu     sync.Mutex
)

func getItems(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"items": items, "count": len(items)})
}

func createItem(w http.ResponseWriter, r *http.Request) {
	var item Item
	if err := json.NewDecoder(r.Body).Decode(&item); err != nil {
		http.Error(w, "bad request", 400)
		return
	}
	mu.Lock()
	item.ID = nextID
	nextID++
	items = append(items, item)
	mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(201)
	json.NewEncoder(w).Encode(item)
}

func main() {
	items = []Item{}
	http.HandleFunc("/api/items", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case "GET":
			getItems(w, r)
		case "POST":
			createItem(w, r)
		default:
			http.Error(w, "method not allowed", 405)
		}
	})
	fmt.Println("API running on :8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}
`,
    cli: `package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

type Task struct {
	ID   int
	Name string
	Done bool
}

var tasks []Task
var nextID = 1

func main() {
	scanner := bufio.NewScanner(os.Stdin)
	fmt.Println("Task Manager — commands: add, list, done, help, quit")

	for {
		fmt.Print("> ")
		if !scanner.Scan() {
			break
		}
		line := strings.TrimSpace(scanner.Text())
		parts := strings.SplitN(line, " ", 2)
		cmd := parts[0]

		switch cmd {
		case "add":
			if len(parts) < 2 {
				fmt.Println("Usage: add <task name>")
				continue
			}
			tasks = append(tasks, Task{ID: nextID, Name: parts[1]})
			fmt.Printf("Added: %s\\n", parts[1])
			nextID++
		case "list":
			if len(tasks) == 0 {
				fmt.Println("No tasks yet")
				continue
			}
			for _, t := range tasks {
				mark := "○"
				if t.Done {
					mark = "✓"
				}
				fmt.Printf("  %s [%d] %s\\n", mark, t.ID, t.Name)
			}
		case "done":
			if len(parts) < 2 {
				fmt.Println("Usage: done <id>")
				continue
			}
			var id int
			fmt.Sscan(parts[1], &id)
			for i := range tasks {
				if tasks[i].ID == id {
					tasks[i].Done = true
					fmt.Printf("Completed: %s\\n", tasks[i].Name)
				}
			}
		case "help":
			fmt.Println("Commands: add <name>, list, done <id>, quit")
		case "quit", "exit":
			fmt.Println("Bye!")
			return
		default:
			fmt.Println("Unknown command. Try: help")
		}
	}
}
`,
    default: `package main

import "fmt"

func main() {
	fmt.Println("Hello from Go!")
}
`,
  },
  react: {
    blank: `import { useState } from 'react';

function App() {
  const [count, setCount] = useState(0);

  return (
    <div style={{ minHeight: '100vh', background: '#0a0e14', color: '#e0e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui' }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: 16 }}>Hello, React!</h1>
        <p style={{ color: '#6a8a7a', marginBottom: 20 }}>Edit this file to get started.</p>
        <button
          onClick={() => setCount(c => c + 1)}
          style={{ padding: '10px 24px', background: '#00ffaa', color: '#0a0e14', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 16, cursor: 'pointer' }}
        >
          Clicked {count} times
        </button>
      </div>
    </div>
  );
}

export default App;
`,
    fullstack: `import { useState, useEffect } from 'react';

function App() {
  const [items, setItems] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  function addItem() {
    if (!input.trim()) return;
    const newItem = { id: Date.now(), name: input.trim(), done: false };
    setItems(prev => [newItem, ...prev]);
    setInput('');
  }

  function toggleItem(id) {
    setItems(prev => prev.map(i => i.id === id ? { ...i, done: !i.done } : i));
  }

  function removeItem(id) {
    setItems(prev => prev.filter(i => i.id !== id));
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0a0e14', color: '#e0e8f0', fontFamily: 'system-ui', padding: 40 }}>
      <div style={{ maxWidth: 500, margin: '0 auto' }}>
        <h1 style={{ color: '#00ffaa', marginBottom: 24 }}>Task Board</h1>
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addItem()}
            placeholder="Add a task..."
            style={{ flex: 1, padding: '10px 14px', borderRadius: 8, border: '1px solid #2a3a3a', background: '#1a1e24', color: '#e0e8f0', fontSize: 14 }}
          />
          <button onClick={addItem} style={{ padding: '10px 20px', background: '#00ffaa', color: '#0a0e14', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>
            Add
          </button>
        </div>
        {items.length === 0 ? (
          <p style={{ color: '#4a5a5a', textAlign: 'center' }}>No tasks yet.</p>
        ) : (
          items.map(item => (
            <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: '1px solid #1a1e24' }}>
              <span onClick={() => toggleItem(item.id)} style={{ cursor: 'pointer', fontSize: 18 }}>
                {item.done ? '✅' : '⬜'}
              </span>
              <span style={{ flex: 1, textDecoration: item.done ? 'line-through' : 'none', color: item.done ? '#4a5a5a' : '#c0d0dd' }}>
                {item.name}
              </span>
              <button onClick={() => removeItem(item.id)} style={{ background: 'transparent', border: 'none', color: '#ff4466', cursor: 'pointer', fontSize: 16 }}>
                ✕
              </button>
            </div>
          ))
        )}
        <p style={{ color: '#3a4a4a', fontSize: 12, marginTop: 16, textAlign: 'center' }}>
          {items.filter(i => !i.done).length} remaining · {items.filter(i => i.done).length} done
        </p>
      </div>
    </div>
  );
}

export default App;
`,
    game: `import { useState, useEffect, useRef } from 'react';

function App() {
  const canvasRef = useRef(null);
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const stateRef = useRef({ snake: [{x:10,y:10}], dir: {x:1,y:0}, food: {x:15,y:15}, score: 0, running: true });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const SIZE = 20;
    const s = stateRef.current;

    function spawnFood() {
      s.food = { x: Math.floor(Math.random() * (canvas.width / SIZE)), y: Math.floor(Math.random() * (canvas.height / SIZE)) };
    }

    function tick() {
      if (!s.running) return;
      const head = { x: s.snake[0].x + s.dir.x, y: s.snake[0].y + s.dir.y };

      if (head.x < 0 || head.x >= canvas.width / SIZE || head.y < 0 || head.y >= canvas.height / SIZE || s.snake.some(seg => seg.x === head.x && seg.y === head.y)) {
        s.running = false;
        setGameOver(true);
        return;
      }

      s.snake.unshift(head);
      if (head.x === s.food.x && head.y === s.food.y) {
        s.score++;
        setScore(s.score);
        spawnFood();
      } else {
        s.snake.pop();
      }

      ctx.fillStyle = '#0a0e14';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#00ffaa';
      s.snake.forEach(seg => ctx.fillRect(seg.x * SIZE + 1, seg.y * SIZE + 1, SIZE - 2, SIZE - 2));
      ctx.fillStyle = '#ff4466';
      ctx.fillRect(s.food.x * SIZE + 2, s.food.y * SIZE + 2, SIZE - 4, SIZE - 4);
    }

    const interval = setInterval(tick, 120);

    function handleKey(e) {
      const dirs = { ArrowUp: {x:0,y:-1}, ArrowDown: {x:0,y:1}, ArrowLeft: {x:-1,y:0}, ArrowRight: {x:1,y:0} };
      if (dirs[e.key] && !(dirs[e.key].x === -s.dir.x && dirs[e.key].y === -s.dir.y)) {
        s.dir = dirs[e.key];
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => { clearInterval(interval); window.removeEventListener('keydown', handleKey); };
  }, []);

  function restart() {
    const s = stateRef.current;
    s.snake = [{x:10,y:10}]; s.dir = {x:1,y:0}; s.food = {x:15,y:15}; s.score = 0; s.running = true;
    setScore(0); setGameOver(false);
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0a0e14', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', color: '#e0e8f0' }}>
      <div style={{ marginBottom: 12, fontSize: 14, color: '#4a6a5a' }}>Score: {score} {gameOver && <span style={{color:'#ff4466'}}> — Game Over</span>}</div>
      <canvas ref={canvasRef} width={400} height={400} style={{ border: '1px solid #1a2a2a', borderRadius: 8 }} />
      {gameOver && <button onClick={restart} style={{ marginTop: 16, padding: '8px 20px', background: '#00ffaa', color: '#0a0e14', border: 'none', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}>Restart</button>}
      <div style={{ marginTop: 12, fontSize: 11, color: '#2a3a3a' }}>Arrow keys to move</div>
    </div>
  );
}

export default App;
`,
    default: `import { useState } from 'react';

function App() {
  return (
    <div style={{ minHeight: '100vh', background: '#0a0e14', color: '#e0e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui' }}>
      <h1>Hello, React!</h1>
    </div>
  );
}

export default App;
`,
  },
};
