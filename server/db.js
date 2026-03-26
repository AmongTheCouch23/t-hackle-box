import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'db.json');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

function load() {
  try {
    if (fs.existsSync(DB_PATH)) return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {}
  return { users: [], sandboxes: [], collaborators: [], activity: [], files: [], join_requests: [] };
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

let db = load();
if (!db.files) db.files = [];
if (!db.join_requests) db.join_requests = [];

// --- User operations ---
export function createUser(id, username, displayName, passwordHash) {
  const colors = ['#00ffaa', '#00ccff', '#ff66aa', '#ffcc00', '#aa66ff', '#ff8844'];
  const user = {
    id, username, display_name: displayName, password_hash: passwordHash,
    avatar_color: colors[Math.floor(Math.random() * colors.length)],
    created_at: new Date().toISOString(),
    last_seen: new Date().toISOString(),
  };
  db.users.push(user);
  save(db);
  return user;
}

export function getUserByUsername(username) {
  return db.users.find(u => u.username === username) || null;
}

export function getUserById(id) {
  const u = db.users.find(u => u.id === id);
  if (!u) return null;
  const { password_hash, ...safe } = u;
  return safe;
}

export function updateLastSeen(userId) {
  const u = db.users.find(u => u.id === userId);
  if (u) { u.last_seen = new Date().toISOString(); save(db); }
}

// --- Access control ---
// canEdit = owner, collaborator, or invited user. These can modify files.
export function canEditSandbox(sandboxId, userId) {
  const s = db.sandboxes.find(s => s.id === sandboxId);
  if (!s) return false;
  if (s.owner_id === userId) return true;
  if (db.collaborators.some(c => c.sandbox_id === sandboxId && c.user_id === userId)) return true;
  const user = db.users.find(u => u.id === userId);
  if (user && (s.allowed_users || []).includes(user.username)) return true;
  return false;
}

// canView = canEdit OR the space is public. Read-only access to see files but not edit.
export function canViewSandbox(sandboxId, userId) {
  const s = db.sandboxes.find(s => s.id === sandboxId);
  if (!s) return false;
  if (s.visibility === 'public') return true;
  return canEditSandbox(sandboxId, userId);
}

// canViewSite = canView OR public_site is enabled (site is public even if space is private)
export function canViewSite(sandboxId, userId) {
  const s = db.sandboxes.find(s => s.id === sandboxId);
  if (!s) return false;
  if (s.public_site) return true;
  if (s.visibility === 'public') return true;
  return canEditSandbox(sandboxId, userId);
}

// Legacy alias for WS broadcasts
export function canAccessSandbox(sandboxId, userId) {
  return canViewSandbox(sandboxId, userId);
}

// --- Sandbox operations ---
export function createSandbox(id, name, ownerId, language, template, durationHours) {
  const now = new Date();
  const sandbox = {
    id, name, owner_id: ownerId, language, template,
    duration_hours: durationHours,
    status: 'live',
    visibility: 'private',
    public_site: false,
    allowed_users: [],
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + durationHours * 3600000).toISOString(),
    promoted_at: null,
  };
  db.sandboxes.push(sandbox);
  db.collaborators.push({ sandbox_id: id, user_id: ownerId, role: 'owner', joined_at: now.toISOString() });
  db.activity.push({
    id: db.activity.length + 1, sandbox_id: id, user_id: ownerId,
    action: 'created', detail: `Sandbox "${name}" created`,
    created_at: now.toISOString(),
  });
  save(db);
  return getSandboxById(id);
}

export function getSandboxById(id) {
  const s = db.sandboxes.find(s => s.id === id);
  if (!s) return null;
  const owner = db.users.find(u => u.id === s.owner_id);
  const collabs = db.collaborators
    .filter(c => c.sandbox_id === id)
    .map(c => {
      const u = db.users.find(u => u.id === c.user_id);
      return { ...c, username: u?.username, display_name: u?.display_name, avatar_color: u?.avatar_color };
    });
  const recent_activity = db.activity
    .filter(a => a.sandbox_id === id)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 20)
    .map(a => {
      const u = db.users.find(u => u.id === a.user_id);
      return { ...a, username: u?.username, display_name: u?.display_name };
    });
  const files = db.files.filter(f => f.sandbox_id === id && !f.deleted);
  const requests = db.join_requests
    .filter(r => r.sandbox_id === id && r.status === 'pending')
    .map(r => {
      const u = db.users.find(u => u.id === r.user_id);
      return { ...r, username: u?.username, display_name: u?.display_name, avatar_color: u?.avatar_color };
    });

  return {
    ...s,
    public_site: s.public_site || false,
    owner_username: owner?.username,
    owner_display_name: owner?.display_name,
    owner_color: owner?.avatar_color,
    collaborators: collabs,
    recent_activity,
    files,
    join_requests: requests,
  };
}

export function getSandboxesForUser(userId) {
  const myIds = new Set(
    db.collaborators.filter(c => c.user_id === userId).map(c => c.sandbox_id)
  );
  db.sandboxes.filter(s => s.owner_id === userId).forEach(s => myIds.add(s.id));
  const user = db.users.find(u => u.id === userId);
  if (user) {
    db.sandboxes.forEach(s => {
      if ((s.allowed_users || []).includes(user.username)) myIds.add(s.id);
    });
  }

  const hourAgo = new Date(Date.now() - 3600000).toISOString();

  return [...myIds].map(id => {
    const s = db.sandboxes.find(sb => sb.id === id);
    if (!s) return null;
    const owner = db.users.find(u => u.id === s.owner_id);
    const collab_count = db.collaborators.filter(c => c.sandbox_id === id).length;
    const recent_actions = db.activity.filter(a => a.sandbox_id === id && a.created_at > hourAgo).length;
    const file_count = db.files.filter(f => f.sandbox_id === id && !f.deleted).length;
    return {
      ...s,
      public_site: s.public_site || false,
      owner_username: owner?.username,
      owner_display_name: owner?.display_name,
      owner_color: owner?.avatar_color,
      collab_count, recent_actions, file_count,
    };
  }).filter(Boolean).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

export function getAllPublicSandboxes() {
  const hourAgo = new Date(Date.now() - 3600000).toISOString();
  return db.sandboxes
    .filter(s => (s.status === 'live' || s.status === 'promoted') && s.visibility === 'public')
    .map(s => {
      const owner = db.users.find(u => u.id === s.owner_id);
      return {
        ...s,
        public_site: s.public_site || false,
        owner_username: owner?.username,
        owner_display_name: owner?.display_name,
        owner_color: owner?.avatar_color,
        collab_count: db.collaborators.filter(c => c.sandbox_id === s.id).length,
        recent_actions: db.activity.filter(a => a.sandbox_id === s.id && a.created_at > hourAgo).length,
        file_count: db.files.filter(f => f.sandbox_id === s.id && !f.deleted).length,
      };
    })
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

export function updateSandboxStatus(id, status) {
  const s = db.sandboxes.find(s => s.id === id);
  if (s) {
    s.status = status;
    if (status === 'promoted') {
      s.promoted_at = new Date().toISOString();
      s.expires_at = null;
    }
    save(db);
  }
}

export function updateSandboxVisibility(id, visibility) {
  const s = db.sandboxes.find(s => s.id === id);
  if (s) { s.visibility = visibility; save(db); }
}

export function updatePublicSite(id, publicSite) {
  const s = db.sandboxes.find(s => s.id === id);
  if (s) { s.public_site = !!publicSite; save(db); }
}

export function addAllowedUser(sandboxId, username) {
  const s = db.sandboxes.find(s => s.id === sandboxId);
  if (!s) return false;
  if (!s.allowed_users) s.allowed_users = [];
  const target = db.users.find(u => u.username === username.toLowerCase());
  if (!target) return false;
  if (s.allowed_users.includes(username.toLowerCase())) return true;
  s.allowed_users.push(username.toLowerCase());
  save(db);
  return true;
}

export function removeAllowedUser(sandboxId, username) {
  const s = db.sandboxes.find(s => s.id === sandboxId);
  if (!s) return;
  s.allowed_users = (s.allowed_users || []).filter(u => u !== username.toLowerCase());
  save(db);
}

export function deleteSandbox(id) {
  db.sandboxes = db.sandboxes.filter(s => s.id !== id);
  db.collaborators = db.collaborators.filter(c => c.sandbox_id !== id);
  db.activity = db.activity.filter(a => a.sandbox_id !== id);
  db.files = db.files.filter(f => f.sandbox_id !== id);
  db.join_requests = db.join_requests.filter(r => r.sandbox_id !== id);
  save(db);
}

export function joinSandbox(sandboxId, userId) {
  const existing = db.collaborators.find(c => c.sandbox_id === sandboxId && c.user_id === userId);
  if (existing) return existing;
  const entry = { sandbox_id: sandboxId, user_id: userId, role: 'editor', joined_at: new Date().toISOString() };
  db.collaborators.push(entry);
  db.activity.push({
    id: db.activity.length + 1, sandbox_id: sandboxId, user_id: userId,
    action: 'joined', detail: 'Joined the sandbox',
    created_at: new Date().toISOString(),
  });
  // Remove any pending request from this user
  db.join_requests = db.join_requests.filter(r => !(r.sandbox_id === sandboxId && r.user_id === userId));
  save(db);
  return entry;
}

export function leaveSandbox(sandboxId, userId) {
  db.collaborators = db.collaborators.filter(c => !(c.sandbox_id === sandboxId && c.user_id === userId && c.role !== 'owner'));
  db.activity.push({
    id: db.activity.length + 1, sandbox_id: sandboxId, user_id: userId,
    action: 'left', detail: 'Left the sandbox',
    created_at: new Date().toISOString(),
  });
  save(db);
}

// --- Join Requests ---
export function createJoinRequest(sandboxId, userId, message) {
  const existing = db.join_requests.find(r => r.sandbox_id === sandboxId && r.user_id === userId && r.status === 'pending');
  if (existing) return existing;
  // Already a member?
  if (db.collaborators.some(c => c.sandbox_id === sandboxId && c.user_id === userId)) return null;
  const req = {
    id: `jr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    sandbox_id: sandboxId,
    user_id: userId,
    message: message || '',
    status: 'pending',
    created_at: new Date().toISOString(),
  };
  db.join_requests.push(req);
  save(db);
  return req;
}

export function approveJoinRequest(requestId, ownerId) {
  const req = db.join_requests.find(r => r.id === requestId && r.status === 'pending');
  if (!req) return null;
  req.status = 'approved';
  req.resolved_at = new Date().toISOString();
  req.resolved_by = ownerId;
  // Add as collaborator
  joinSandbox(req.sandbox_id, req.user_id);
  const user = db.users.find(u => u.id === req.user_id);
  db.activity.push({
    id: db.activity.length + 1, sandbox_id: req.sandbox_id, user_id: ownerId,
    action: 'request_approved', detail: `Approved join request from @${user?.username || 'unknown'}`,
    created_at: new Date().toISOString(),
  });
  save(db);
  return req;
}

export function denyJoinRequest(requestId, ownerId) {
  const req = db.join_requests.find(r => r.id === requestId && r.status === 'pending');
  if (!req) return null;
  req.status = 'denied';
  req.resolved_at = new Date().toISOString();
  req.resolved_by = ownerId;
  const user = db.users.find(u => u.id === req.user_id);
  db.activity.push({
    id: db.activity.length + 1, sandbox_id: req.sandbox_id, user_id: ownerId,
    action: 'request_denied', detail: `Denied join request from @${user?.username || 'unknown'}`,
    created_at: new Date().toISOString(),
  });
  save(db);
  return req;
}

export function getJoinRequestsForUser(userId) {
  return db.join_requests
    .filter(r => r.user_id === userId)
    .map(r => {
      const s = db.sandboxes.find(s => s.id === r.sandbox_id);
      return { ...r, sandbox_name: s?.name };
    });
}

// --- Short ID resolver ---
export function resolveShortId(shortId) {
  if (!shortId) return null;
  const cleaned = shortId.toLowerCase().trim();
  const exact = db.sandboxes.find(s => s.id === cleaned);
  if (exact) return exact.id;
  const match = db.sandboxes.find(s => s.id.startsWith(cleaned));
  if (match) return match.id;
  return null;
}

// --- Files ---
export function createFile(id, sandboxId, userId, filename, content, fileType) {
  const file = {
    id, sandbox_id: sandboxId, created_by: userId,
    filename, content: content || '', file_type: fileType || 'text',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted: false,
  };
  db.files.push(file);
  db.activity.push({
    id: db.activity.length + 1, sandbox_id: sandboxId, user_id: userId,
    action: 'file_created', detail: `Created "${filename}"`,
    created_at: new Date().toISOString(),
  });
  save(db);
  return file;
}

export function updateFile(fileId, userId, content) {
  const f = db.files.find(f => f.id === fileId && !f.deleted);
  if (!f) return null;
  f.content = content;
  f.updated_at = new Date().toISOString();
  f.last_edited_by = userId;
  save(db);
  return f;
}

export function renameFile(fileId, userId, newName) {
  const f = db.files.find(f => f.id === fileId && !f.deleted);
  if (!f) return null;
  const oldName = f.filename;
  f.filename = newName;
  f.updated_at = new Date().toISOString();
  db.activity.push({
    id: db.activity.length + 1, sandbox_id: f.sandbox_id, user_id: userId,
    action: 'file_renamed', detail: `Renamed "${oldName}" → "${newName}"`,
    created_at: new Date().toISOString(),
  });
  save(db);
  return f;
}

export function deleteFile(fileId, userId) {
  const f = db.files.find(f => f.id === fileId);
  if (!f) return;
  f.deleted = true;
  f.updated_at = new Date().toISOString();
  db.activity.push({
    id: db.activity.length + 1, sandbox_id: f.sandbox_id, user_id: userId,
    action: 'file_deleted', detail: `Deleted "${f.filename}"`,
    created_at: new Date().toISOString(),
  });
  save(db);
}

export function getFilesForSandbox(sandboxId) {
  return db.files.filter(f => f.sandbox_id === sandboxId && !f.deleted);
}

export function getFileById(fileId) {
  return db.files.find(f => f.id === fileId && !f.deleted) || null;
}

// --- Activity ---
export function logActivity(sandboxId, userId, action, detail) {
  db.activity.push({
    id: db.activity.length + 1,
    sandbox_id: sandboxId, user_id: userId,
    action, detail,
    created_at: new Date().toISOString(),
  });
  save(db);
}

// --- Expiry ---
export function expireOldSandboxes() {
  const now = new Date().toISOString();
  let changed = 0;
  db.sandboxes.forEach(s => {
    if (s.status === 'live' && s.expires_at && s.expires_at < now) {
      s.status = 'expired';
      changed++;
    }
  });
  if (changed > 0) save(db);
  return changed;
}

// --- Stats ---
export function getGlobalStats() {
  return {
    liveSandboxes: db.sandboxes.filter(s => s.status === 'live' || s.status === 'promoted').length,
    publicSandboxes: db.sandboxes.filter(s => (s.status === 'live' || s.status === 'promoted') && s.visibility === 'public').length,
    totalSandboxes: db.sandboxes.length,
  };
}

export default db;
