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

app.get('/api/sandboxes/public', authMiddleware, (req, res) => {
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
    const starterContent = getStarterContent(language, template, name);
    createFile(uuid(), id, req.user.id, `main.${ext}`, starterContent, ext);

    if (['fullstack', 'game', 'react'].includes(template)) {
      createFile(uuid(), id, req.user.id, 'index.html', getStarterHTML(name), 'html');
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

app.get('/api/stats', authMiddleware, (req, res) => {
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
  const starters = {
    python: {
      blank: `# ${name}\n# Start building here\n\ndef main():\n    print("Hello from ${name}!")\n\nif __name__ == "__main__":\n    main()\n`,
      api: `# ${name} — REST API\nfrom flask import Flask, jsonify, request\n\napp = Flask(__name__)\nitems = []\n\n@app.route("/api/items", methods=["GET"])\ndef get_items():\n    return jsonify(items)\n\n@app.route("/api/items", methods=["POST"])\ndef add_item():\n    item = request.json\n    items.append(item)\n    return jsonify(item), 201\n\nif __name__ == "__main__":\n    app.run(debug=True, port=5000)\n`,
      ml: `# ${name} — ML Notebook\nimport numpy as np\n\n# Generate sample data\nX = np.random.randn(100, 2)\ny = (X[:, 0] + X[:, 1] > 0).astype(int)\n\nprint(f"Dataset: {X.shape[0]} samples, {X.shape[1]} features")\nprint(f"Class distribution: {np.bincount(y)}")\n`,
      default: `# ${name}\nprint("Hello from ${name}!")\n`,
    },
    javascript: {
      blank: `// ${name}\n// Start building here\n\nconsole.log("Hello from ${name}!");\n`,
      api: `// ${name} — REST API\nconst express = require('express');\nconst app = express();\napp.use(express.json());\n\nconst items = [];\n\napp.get('/api/items', (req, res) => res.json(items));\n\napp.post('/api/items', (req, res) => {\n  items.push(req.body);\n  res.status(201).json(req.body);\n});\n\napp.listen(3000, () => console.log('API running on :3000'));\n`,
      game: `// ${name} — Game\nconst canvas = document.getElementById('game');\nconst ctx = canvas.getContext('2d');\n\nlet x = 100, y = 100, dx = 2, dy = 2;\n\nfunction draw() {\n  ctx.clearRect(0, 0, canvas.width, canvas.height);\n  ctx.beginPath();\n  ctx.arc(x, y, 20, 0, Math.PI * 2);\n  ctx.fillStyle = '#00ffaa';\n  ctx.fill();\n  x += dx; y += dy;\n  if (x > canvas.width - 20 || x < 20) dx = -dx;\n  if (y > canvas.height - 20 || y < 20) dy = -dy;\n  requestAnimationFrame(draw);\n}\n\ndraw();\n`,
      default: `// ${name}\nconsole.log("Hello from ${name}!");\n`,
    },
  };

  const langStarters = starters[lang] || {};
  return langStarters[template] || langStarters.default || `// ${name}\n// Start building here\n`;
}

function getStarterHTML(name) {
  return `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>${name}</title>\n  <style>\n    body { margin: 0; font-family: system-ui, sans-serif; background: #0a0e14; color: #e0e8f0; }\n    #app { max-width: 800px; margin: 40px auto; padding: 20px; }\n    h1 { color: #00ffaa; }\n  </style>\n</head>\n<body>\n  <div id="app">\n    <h1>${name}</h1>\n    <p>Edit this file to build your frontend.</p>\n  </div>\n</body>\n</html>\n`;
}
