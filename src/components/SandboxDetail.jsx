import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';

const LANG_META = {
  python: { icon: '🐍', color: '#3776AB', label: 'Python' },
  javascript: { icon: '⚡', color: '#F7DF1E', label: 'JavaScript' },
  rust: { icon: '🦀', color: '#CE422B', label: 'Rust' },
  go: { icon: '🐹', color: '#00ADD8', label: 'Go' },
  typescript: { icon: '🔷', color: '#3178C6', label: 'TypeScript' },
  react: { icon: '⚛️', color: '#61DAFB', label: 'React' },
};

const TEMPLATE_META = {
  blank: '📄 Blank', api: '🔌 REST API', fullstack: '🏗️ Full Stack',
  ml: '🧠 ML Notebook', game: '🎮 Game Jam', cli: '⌨️ CLI Tool',
};

function timeLeft(expiresAt) {
  if (!expiresAt) return 'permanent';
  const diff = new Date(expiresAt) - new Date();
  if (diff <= 0) return 'expired';
  const hrs = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const mono = { fontFamily: "'JetBrains Mono', monospace" };

// ---- File icon by extension ----
function fileIcon(filename) {
  const ext = filename.split('.').pop()?.toLowerCase();
  const icons = {
    py: '🐍', js: '⚡', ts: '🔷', jsx: '⚛️', tsx: '⚛️', rs: '🦀', go: '🐹',
    html: '🌐', css: '🎨', json: '📋', md: '📝', txt: '📄', yml: '⚙️', yaml: '⚙️',
    toml: '⚙️', sh: '💻', sql: '🗄️', env: '🔐',
  };
  return icons[ext] || '📄';
}

// ============================================================
// FILES TAB
// ============================================================
function FilesTab({ sandbox, setSandbox }) {
  const {
    user, createSandboxFile, updateSandboxFile, renameSandboxFile,
    deleteSandboxFile, sendFileEdit, onFileEvent, toast, getSandboxDetail,
  } = useApp();

  const [activeFileId, setActiveFileId] = useState(null);
  const [editorContent, setEditorContent] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [showNewFile, setShowNewFile] = useState(false);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [deletingId, setDeletingId] = useState(null);
  const saveTimerRef = useRef(null);
  const editorRef = useRef(null);

  const files = sandbox.files || [];
  const activeFile = files.find(f => f.id === activeFileId);

  // Auto-select first file
  useEffect(() => {
    if (!activeFileId && files.length > 0) {
      selectFile(files[0]);
    }
  }, [files.length]);

  // Listen for real-time file updates from other users
  useEffect(() => {
    const unsub = onFileEvent('detail', (msg) => {
      if (msg.sandboxId !== sandbox.id) return;
      if (msg.type === 'file_edit' && msg.fileId === activeFileId && msg.user?.id !== user?.id) {
        setEditorContent(msg.content);
      }
      // Refresh sandbox data for file list changes
      if (['file_created', 'file_deleted', 'file_renamed'].includes(msg.type)) {
        getSandboxDetail(sandbox.id).then(s => setSandbox(s));
      }
    });
    return unsub;
  }, [sandbox.id, activeFileId, user?.id]);

  function selectFile(file) {
    if (dirty && activeFileId) saveFile();
    setActiveFileId(file.id);
    setEditorContent(file.content || '');
    setDirty(false);
  }

  function handleEditorChange(value) {
    setEditorContent(value);
    setDirty(true);
    // Debounced auto-save
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveFileContent(activeFileId, value), 2000);
    // Broadcast live edit via WS
    sendFileEdit(sandbox.id, activeFileId, value);
  }

  async function saveFile() {
    if (!activeFileId || !dirty) return;
    await saveFileContent(activeFileId, editorContent);
  }

  async function saveFileContent(fileId, content) {
    setSaving(true);
    try {
      await updateSandboxFile(sandbox.id, fileId, content);
      setDirty(false);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateFile() {
    if (!newFileName.trim()) return;
    try {
      const file = await createSandboxFile(sandbox.id, newFileName.trim(), '', newFileName.split('.').pop());
      const updated = await getSandboxDetail(sandbox.id);
      setSandbox(updated);
      selectFile(file);
      setNewFileName('');
      setShowNewFile(false);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function handleRename(fileId) {
    if (!renameValue.trim()) return;
    try {
      await renameSandboxFile(sandbox.id, fileId, renameValue.trim());
      const updated = await getSandboxDetail(sandbox.id);
      setSandbox(updated);
      setRenamingId(null);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function handleDelete(fileId) {
    try {
      await deleteSandboxFile(sandbox.id, fileId);
      if (activeFileId === fileId) {
        setActiveFileId(null);
        setEditorContent('');
      }
      const updated = await getSandboxDetail(sandbox.id);
      setSandbox(updated);
      setDeletingId(null);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const lineCount = editorContent.split('\n').length;

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 400 }}>
      {/* File sidebar */}
      <div style={{
        width: 180, borderRight: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', flexDirection: 'column', flexShrink: 0,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.04)',
        }}>
          <span style={{ ...mono, fontSize: 9, color: '#3a5a4a', textTransform: 'uppercase', letterSpacing: '1px' }}>
            Files
          </span>
          <button onClick={() => setShowNewFile(!showNewFile)} style={{
            background: 'rgba(0,255,170,0.1)', border: 'none',
            color: '#00ffaa', fontSize: 14, width: 22, height: 22,
            borderRadius: 4, cursor: 'pointer', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
          }}>+</button>
        </div>

        {showNewFile && (
          <div style={{ padding: '6px 8px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <input
              value={newFileName}
              onChange={e => setNewFileName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreateFile()}
              placeholder="filename.ext"
              autoFocus
              style={{
                width: '100%', background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(0,255,170,0.2)',
                borderRadius: 4, padding: '5px 8px',
                ...mono, fontSize: 11, color: '#e0e8f0',
              }}
            />
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {files.map(f => (
            <div key={f.id}>
              {renamingId === f.id ? (
                <div style={{ padding: '4px 8px' }}>
                  <input
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleRename(f.id);
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    onBlur={() => setRenamingId(null)}
                    autoFocus
                    style={{
                      width: '100%', background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(0,255,170,0.2)',
                      borderRadius: 3, padding: '3px 6px',
                      ...mono, fontSize: 11, color: '#e0e8f0',
                    }}
                  />
                </div>
              ) : (
                <div
                  onClick={() => selectFile(f)}
                  onDoubleClick={() => { setRenamingId(f.id); setRenameValue(f.filename); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '6px 10px', cursor: 'pointer',
                    background: activeFileId === f.id ? 'rgba(0,255,170,0.06)' : 'transparent',
                    borderLeft: activeFileId === f.id ? '2px solid #00ffaa' : '2px solid transparent',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { if (activeFileId !== f.id) e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
                  onMouseLeave={e => { if (activeFileId !== f.id) e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{ fontSize: 13, flexShrink: 0 }}>{fileIcon(f.filename)}</span>
                  <span style={{ ...mono, fontSize: 11, color: activeFileId === f.id ? '#e0e8f0' : '#6a8a7a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {f.filename}
                  </span>
                  {deletingId === f.id ? (
                    <button onClick={e => { e.stopPropagation(); handleDelete(f.id); }} style={{
                      background: 'rgba(255,68,102,0.2)', border: 'none',
                      color: '#ff4466', fontSize: 9, padding: '2px 4px',
                      borderRadius: 3, cursor: 'pointer', ...mono,
                    }}>del?</button>
                  ) : (
                    <button onClick={e => { e.stopPropagation(); setDeletingId(f.id); setTimeout(() => setDeletingId(null), 3000); }} style={{
                      background: 'transparent', border: 'none',
                      color: '#3a4a4a', fontSize: 11, cursor: 'pointer',
                      opacity: 0.4, padding: '0 2px',
                    }}>×</button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Editor */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {activeFile ? (
          <>
            {/* Editor toolbar */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '6px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)',
              background: 'rgba(255,255,255,0.01)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13 }}>{fileIcon(activeFile.filename)}</span>
                <span style={{ ...mono, fontSize: 12, color: '#8aa09a' }}>{activeFile.filename}</span>
                {dirty && <span style={{ ...mono, fontSize: 9, color: '#ffcc00' }}>● unsaved</span>}
                {saving && <span style={{ ...mono, fontSize: 9, color: '#00ffaa', animation: 'pulse 1s ease infinite' }}>saving...</span>}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <span style={{ ...mono, fontSize: 9, color: '#3a4a4a' }}>
                  {lineCount} lines
                </span>
                <button onClick={saveFile} disabled={!dirty} style={{
                  background: dirty ? 'rgba(0,255,170,0.1)' : 'transparent',
                  border: dirty ? '1px solid rgba(0,255,170,0.2)' : '1px solid transparent',
                  color: dirty ? '#00ffaa' : '#2a3a3a',
                  ...mono, fontSize: 10, padding: '3px 10px', borderRadius: 4,
                  cursor: dirty ? 'pointer' : 'default',
                }}>Save</button>
              </div>
            </div>

            {/* Code editor area */}
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              <div style={{ display: 'flex', height: '100%' }}>
                {/* Line numbers */}
                <div style={{
                  width: 44, padding: '10px 0', overflowY: 'hidden',
                  background: 'rgba(0,0,0,0.15)',
                  textAlign: 'right',
                  userSelect: 'none',
                }}>
                  {Array.from({ length: lineCount }, (_, i) => (
                    <div key={i} style={{
                      ...mono, fontSize: 12, lineHeight: '20px',
                      color: '#2a3a3a', paddingRight: 8,
                    }}>{i + 1}</div>
                  ))}
                </div>

                {/* Textarea */}
                <textarea
                  ref={editorRef}
                  value={editorContent}
                  onChange={e => handleEditorChange(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Tab') {
                      e.preventDefault();
                      const start = e.target.selectionStart;
                      const end = e.target.selectionEnd;
                      const val = editorContent;
                      const newVal = val.substring(0, start) + '  ' + val.substring(end);
                      setEditorContent(newVal);
                      setDirty(true);
                      requestAnimationFrame(() => {
                        e.target.selectionStart = e.target.selectionEnd = start + 2;
                      });
                    }
                    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                      e.preventDefault();
                      saveFile();
                    }
                  }}
                  spellCheck={false}
                  style={{
                    flex: 1, resize: 'none', border: 'none', outline: 'none',
                    background: 'transparent', color: '#c8d8e4',
                    ...mono, fontSize: 12, lineHeight: '20px',
                    padding: '10px 12px',
                    tabSize: 2,
                  }}
                />
              </div>
            </div>
          </>
        ) : (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: 8,
          }}>
            <div style={{ fontSize: 36 }}>📄</div>
            <div style={{ ...mono, fontSize: 12, color: '#3a5a4a' }}>
              {files.length === 0 ? 'No files yet — create one' : 'Select a file to edit'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// SETTINGS TAB
// ============================================================
function SettingsTab({ sandbox, setSandbox }) {
  const { user, setVisibility, inviteUser, revokeUser, setPublicSite, approveJoinRequest: approveReq, denyJoinRequest: denyReq, toast } = useApp();
  const [inviteInput, setInviteInput] = useState('');
  const [inviting, setInviting] = useState(false);
  const isOwner = sandbox.owner_id === user?.id;

  async function handleToggleVisibility() {
    if (!isOwner) return;
    const newVis = sandbox.visibility === 'public' ? 'private' : 'public';
    try {
      const updated = await setVisibility(sandbox.id, newVis);
      setSandbox(updated);
    } catch (err) { toast(err.message, 'error'); }
  }

  async function handleTogglePublicSite() {
    if (!isOwner) return;
    try {
      const updated = await setPublicSite(sandbox.id, !sandbox.public_site);
      setSandbox(updated);
    } catch (err) { toast(err.message, 'error'); }
  }

  async function handleInvite() {
    if (!inviteInput.trim() || inviting) return;
    setInviting(true);
    try {
      const updated = await inviteUser(sandbox.id, inviteInput.trim().toLowerCase());
      setSandbox(updated);
      setInviteInput('');
    } catch (err) { toast(err.message, 'error'); }
    finally { setInviting(false); }
  }

  async function handleRevoke(username) {
    try {
      const updated = await revokeUser(sandbox.id, username);
      setSandbox(updated);
    } catch (err) { toast(err.message, 'error'); }
  }

  async function handleApprove(requestId) {
    try { const updated = await approveReq(sandbox.id, requestId); setSandbox(updated); }
    catch (err) { toast(err.message, 'error'); }
  }

  async function handleDeny(requestId) {
    try { const updated = await denyReq(sandbox.id, requestId); setSandbox(updated); }
    catch (err) { toast(err.message, 'error'); }
  }

  if (!isOwner) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 0', ...mono, fontSize: 12, color: '#4a5a5a' }}>
        Only the sandbox owner can manage settings
      </div>
    );
  }

  const pendingRequests = sandbox.join_requests || [];
  const hasIndex = (sandbox.files || []).some(f =>
    ['index.html', 'index.jsx', 'App.jsx', 'app.jsx'].includes(f.filename)
  );

  return (
    <div>
      {/* Space Visibility */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ ...mono, fontSize: 10, color: '#3a5a4a', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 10 }}>
          Space Visibility
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 14,
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 10, padding: '14px 18px',
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ ...mono, fontSize: 13, fontWeight: 600, marginBottom: 3, color: '#c0d0dd' }}>
              {sandbox.visibility === 'public' ? '🌐 Public Space' : '🔒 Private Space'}
            </div>
            <div style={{ fontSize: 11, color: '#4a5a5a', lineHeight: 1.4 }}>
              {sandbox.visibility === 'public'
                ? 'Visible in Explore. Anyone can view files (read-only). They must request to join to edit.'
                : 'Only you and invited users can see or access this space.'}
            </div>
          </div>
          <button onClick={handleToggleVisibility} style={{
            background: sandbox.visibility === 'public' ? 'rgba(255,255,255,0.05)' : 'rgba(0,255,170,0.1)',
            border: `1px solid ${sandbox.visibility === 'public' ? 'rgba(255,255,255,0.08)' : 'rgba(0,255,170,0.2)'}`,
            color: sandbox.visibility === 'public' ? '#6a8a7a' : '#00ffaa',
            ...mono, fontSize: 11, fontWeight: 600,
            padding: '8px 16px', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap',
          }}>
            {sandbox.visibility === 'public' ? 'Make Private' : 'Make Public'}
          </button>
        </div>
      </div>

      {/* Public Site Toggle */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ ...mono, fontSize: 10, color: '#3a5a4a', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 10 }}>
          Public Website
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 14,
          background: sandbox.public_site ? 'rgba(0,170,255,0.04)' : 'rgba(255,255,255,0.02)',
          border: `1px solid ${sandbox.public_site ? 'rgba(0,170,255,0.12)' : 'rgba(255,255,255,0.06)'}`,
          borderRadius: 10, padding: '14px 18px',
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ ...mono, fontSize: 13, fontWeight: 600, marginBottom: 3, color: '#c0d0dd' }}>
              {sandbox.public_site ? '🌐 Site is Public' : '🔒 Site is Private'}
            </div>
            <div style={{ fontSize: 11, color: '#4a5a5a', lineHeight: 1.4 }}>
              {sandbox.public_site
                ? 'Anyone can view the live website even if the space is private. They cannot see or edit source files.'
                : 'Only space members can view the live site. Enable to share the website publicly while keeping source private.'}
            </div>
            {!hasIndex && (
              <div style={{ fontSize: 10, color: '#6a6a3a', marginTop: 4 }}>
                💡 Add an index.html or index.jsx first to serve a site
              </div>
            )}
          </div>
          <button onClick={handleTogglePublicSite} style={{
            background: sandbox.public_site ? 'rgba(255,255,255,0.05)' : 'rgba(0,170,255,0.1)',
            border: `1px solid ${sandbox.public_site ? 'rgba(255,255,255,0.08)' : 'rgba(0,170,255,0.2)'}`,
            color: sandbox.public_site ? '#6a8a7a' : '#00aaff',
            ...mono, fontSize: 11, fontWeight: 600,
            padding: '8px 16px', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap',
          }}>
            {sandbox.public_site ? 'Disable' : 'Enable'}
          </button>
        </div>
      </div>

      {/* Join Requests */}
      {pendingRequests.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ ...mono, fontSize: 10, color: '#ffcc00', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 10 }}>
            Join Requests ({pendingRequests.length})
          </div>
          <div style={{
            background: 'rgba(255,204,0,0.03)',
            border: '1px solid rgba(255,204,0,0.1)',
            borderRadius: 8, overflow: 'hidden',
          }}>
            {pendingRequests.map(req => (
              <div key={req.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.03)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: '50%',
                    background: req.avatar_color || '#ffcc00',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 800, color: '#0a0e14',
                  }}>
                    {(req.display_name || req.username || '?')[0].toUpperCase()}
                  </div>
                  <div>
                    <span style={{ ...mono, fontSize: 12, color: '#c0d0dd' }}>@{req.username}</span>
                    {req.message && <div style={{ fontSize: 10, color: '#5a6a5a', marginTop: 1 }}>"{req.message}"</div>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => handleApprove(req.id)} style={{
                    background: 'rgba(0,255,170,0.1)', border: '1px solid rgba(0,255,170,0.2)',
                    color: '#00ffaa', ...mono, fontSize: 10, padding: '5px 12px', borderRadius: 5, cursor: 'pointer',
                  }}>✓ Approve</button>
                  <button onClick={() => handleDeny(req.id)} style={{
                    background: 'rgba(255,68,102,0.08)', border: '1px solid rgba(255,68,102,0.15)',
                    color: '#ff4466', ...mono, fontSize: 10, padding: '5px 12px', borderRadius: 5, cursor: 'pointer',
                  }}>✗ Deny</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Invite Users */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ ...mono, fontSize: 10, color: '#3a5a4a', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 10 }}>
          Invite Users
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            value={inviteInput}
            onChange={e => setInviteInput(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
            onKeyDown={e => e.key === 'Enter' && handleInvite()}
            placeholder="username"
            style={{
              flex: 1, background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 8, padding: '10px 14px',
              ...mono, fontSize: 12, color: '#e0e8f0',
            }}
          />
          <button onClick={handleInvite} disabled={!inviteInput.trim() || inviting} style={{
            background: inviteInput.trim() ? 'rgba(0,255,170,0.12)' : 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(0,255,170,0.2)',
            color: '#00ffaa', ...mono, fontSize: 11, fontWeight: 600,
            padding: '10px 16px', borderRadius: 8,
            cursor: inviteInput.trim() ? 'pointer' : 'default',
            opacity: inviting ? 0.6 : 1,
          }}>
            {inviting ? '...' : 'Invite'}
          </button>
        </div>

        {/* Allowed users list */}
        {(sandbox.allowed_users || []).length > 0 && (
          <div style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.05)',
            borderRadius: 8, overflow: 'hidden',
          }}>
            {sandbox.allowed_users.map(username => (
              <div key={username} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 14px',
                borderBottom: '1px solid rgba(255,255,255,0.03)',
              }}>
                <span style={{ ...mono, fontSize: 12, color: '#8aa09a' }}>@{username}</span>
                <button onClick={() => handleRevoke(username)} style={{
                  background: 'rgba(255,68,102,0.08)',
                  border: '1px solid rgba(255,68,102,0.15)',
                  color: '#ff4466', ...mono, fontSize: 10,
                  padding: '4px 10px', borderRadius: 5, cursor: 'pointer',
                }}>Revoke</button>
              </div>
            ))}
          </div>
        )}

        {(sandbox.allowed_users || []).length === 0 && (
          <div style={{ ...mono, fontSize: 11, color: '#2a3a3a', fontStyle: 'italic' }}>
            No users invited yet
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// MAIN SANDBOX DETAIL
// ============================================================
export default function SandboxDetail({ sandboxId, onClose }) {
  const {
    user, getSandboxDetail, promoteSandbox, destroySandbox,
    joinSandboxById, leaveSandboxById, messages, sendChat, toast,
    requestJoin, approveJoinRequest, denyJoinRequest, setPublicSite,
    setVisibility, inviteUser, revokeUser,
  } = useApp();

  const [sandbox, setSandbox] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('files');
  const [chatInput, setChatInput] = useState('');
  const [confirmDestroy, setConfirmDestroy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [requestSent, setRequestSent] = useState(false);
  const chatEndRef = useRef(null);

  const chatMessages = messages[sandboxId] || [];

  useEffect(() => {
    (async () => {
      try {
        const data = await getSandboxDetail(sandboxId);
        setSandbox(data);
      } catch (err) {
        toast('Could not load sandbox', 'error');
        onClose();
      } finally {
        setLoading(false);
      }
    })();
  }, [sandboxId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  function handleSendChat() {
    if (!chatInput.trim()) return;
    sendChat(sandboxId, chatInput.trim());
    setChatInput('');
  }

  async function handlePromote() {
    try {
      const updated = await promoteSandbox(sandboxId);
      setSandbox(updated);
    } catch (err) { toast(err.message, 'error'); }
  }

  async function handleDestroy() {
    try {
      await destroySandbox(sandboxId);
      onClose();
    } catch (err) { toast(err.message, 'error'); }
  }

  async function handleJoin() {
    try {
      const updated = await joinSandboxById(sandboxId);
      setSandbox(updated);
    } catch (err) { toast(err.message, 'error'); }
  }

  async function handleRequestJoin() {
    try {
      const result = await requestJoin(sandboxId);
      if (result.joined) {
        setSandbox(result.sandbox);
      } else {
        setRequestSent(true);
      }
    } catch (err) { toast(err.message, 'error'); }
  }

  async function handleLeave() {
    try {
      await leaveSandboxById(sandboxId);
      const updated = await getSandboxDetail(sandboxId);
      setSandbox(updated);
    } catch (err) { toast(err.message, 'error'); }
  }

  if (loading || !sandbox) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(10px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ ...mono, color: '#00ffaa', animation: 'pulse 1.5s ease infinite' }}>Loading...</div>
      </div>
    );
  }

  const lang = LANG_META[sandbox.language] || {};
  const isOwner = sandbox.owner_id === user?.id;
  const isMember = sandbox.collaborators?.some(c => c.user_id === user?.id);
  const canEdit = sandbox._canEdit || isOwner || isMember;
  const tl = timeLeft(sandbox.expires_at);
  const TABS = canEdit ? ['files', 'info', 'chat', 'activity'] : ['info', 'chat', 'activity'];
  if (isOwner) TABS.push('settings');

  if (loading || !sandbox) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(10px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ ...mono, color: '#00ffaa', animation: 'pulse 1.5s ease infinite' }}>Loading...</div>
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(10px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16, animation: 'fadeIn 0.2s ease',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#0d1117',
        border: '1px solid rgba(0,255,170,0.12)',
        borderRadius: 16, padding: 0,
        width: '100%', maxWidth: 900, height: '88vh',
        boxShadow: '0 0 60px rgba(0,255,170,0.06)',
        animation: 'slideUp 0.3s ease',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <div style={{
                  width: 10, height: 10, borderRadius: '50%',
                  background: sandbox.status === 'live' ? '#00ffaa' : sandbox.status === 'promoted' ? '#00aaff' : '#ff4466',
                  boxShadow: sandbox.status === 'live' ? '0 0 10px #00ffaa' : sandbox.status === 'promoted' ? '0 0 10px #00aaff' : 'none',
                }} />
                <span style={{ ...mono, fontWeight: 700, fontSize: 18 }}>{sandbox.name}</span>
                <span style={{
                  ...mono, fontSize: 9, padding: '2px 6px', borderRadius: 4,
                  background: sandbox.visibility === 'public' ? 'rgba(0,255,170,0.08)' : 'rgba(255,255,255,0.04)',
                  color: sandbox.visibility === 'public' ? '#00ffaa' : '#4a5a5a',
                  border: `1px solid ${sandbox.visibility === 'public' ? 'rgba(0,255,170,0.15)' : 'rgba(255,255,255,0.06)'}`,
                }}>
                  {sandbox.visibility === 'public' ? '🌐 public' : '🔒 private'}
                </span>
                {sandbox.status === 'promoted' && (
                  <span style={{
                    ...mono, fontSize: 9, padding: '2px 6px', borderRadius: 4,
                    background: 'rgba(0,170,255,0.1)',
                    color: '#00aaff',
                    border: '1px solid rgba(0,170,255,0.2)',
                  }}>🚀 promoted</span>
                )}
              </div>
              <div style={{ ...mono, fontSize: 10, color: '#3a5a4a' }}>
                by @{sandbox.owner_username} · {lang.icon} {lang.label} · ⏱ {tl}
              </div>
            </div>
            <button onClick={onClose} style={{
              background: 'rgba(255,255,255,0.05)', border: 'none',
              color: '#5a7a6a', fontSize: 18, width: 32, height: 32,
              borderRadius: 8, cursor: 'pointer', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
            }}>×</button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)',
          padding: '0 20px', flexShrink: 0,
        }}>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              background: 'transparent', border: 'none',
              borderBottom: tab === t ? '2px solid #00ffaa' : '2px solid transparent',
              color: tab === t ? '#00ffaa' : '#4a6a5a',
              ...mono, fontSize: 11, padding: '9px 14px',
              cursor: 'pointer', textTransform: 'capitalize', letterSpacing: '0.5px',
              transition: 'all 0.15s',
            }}>
              {t}{t === 'chat' && chatMessages.length > 0 ? ` (${chatMessages.length})` : ''}
              {t === 'files' ? ` (${(sandbox.files || []).length})` : ''}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: tab === 'files' ? 'hidden' : 'auto', display: 'flex', flexDirection: 'column' }}>
          {tab === 'files' && (
            <FilesTab sandbox={sandbox} setSandbox={setSandbox} />
          )}

          {tab === 'info' && (
            <div style={{ padding: '16px 20px' }}>
              {/* Live site link */}
              {(() => {
                const liveUrl = `${window.location.origin}/s/${sandbox.id.slice(0, 8)}`;
                const hasIndex = (sandbox.files || []).some(f => ['index.html','index.jsx','App.jsx','app.jsx'].includes(f.filename));
                return (
                  <div style={{
                    background: 'rgba(0,255,170,0.04)',
                    border: '1px solid rgba(0,255,170,0.12)',
                    borderRadius: 10, padding: '14px 18px', marginBottom: 16,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: 12,
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ ...mono, fontSize: 9, color: '#00ffaa', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 4 }}>
                        Live Site
                      </div>
                      <div style={{ ...mono, fontSize: 12, color: '#00ccff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {liveUrl}
                      </div>
                      {!hasIndex && (
                        <div style={{ ...mono, fontSize: 10, color: '#6a6a3a', marginTop: 4 }}>
                          💡 Add an index.html or index.jsx to serve a website at this URL
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button
                        onClick={() => { navigator.clipboard.writeText(liveUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                        style={{
                          background: copied ? 'rgba(0,255,170,0.15)' : 'rgba(255,255,255,0.06)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          color: copied ? '#00ffaa' : '#6a8a7a',
                          ...mono, fontSize: 10, padding: '7px 12px', borderRadius: 6, cursor: 'pointer',
                        }}
                      >{copied ? '✓ copied' : '📋 Copy'}</button>
                      <a href={liveUrl} target="_blank" rel="noopener noreferrer" style={{
                        background: 'linear-gradient(135deg, #00ffaa, #00ccdd)',
                        border: 'none', color: '#0a0e14', textDecoration: 'none',
                        ...mono, fontSize: 10, fontWeight: 700, padding: '7px 14px',
                        borderRadius: 6, display: 'flex', alignItems: 'center', gap: 4,
                        boxShadow: '0 0 12px rgba(0,255,170,0.15)',
                      }}>🌐 Open</a>
                    </div>
                  </div>
                );
              })()}

              {/* Terminal preview */}
              <div style={{
                background: '#080c10', border: '1px solid rgba(255,255,255,0.05)',
                borderRadius: 10, padding: 14, marginBottom: 16,
                ...mono, fontSize: 11, lineHeight: 1.8,
              }}>
                <div style={{ color: '#3a5a4a' }}>$ t-hackle status {sandbox.name}</div>
                <div style={{ color: (sandbox.status === 'live' || sandbox.status === 'promoted') ? '#00ffaa' : '#ff4466' }}>
                  {(sandbox.status === 'live' || sandbox.status === 'promoted') ? '✓' : '✗'} sandbox {sandbox.status}{sandbox.status === 'promoted' ? ' (permanent)' : ''}
                </div>
                <div style={{ color: '#5a7a6a' }}> </div>
                <div style={{ color: '#8ab0a0' }}>  live site:</div>
                <div style={{ color: '#00ccff' }}>    {window.location.origin}/s/{sandbox.id.slice(0, 8)}</div>
                <div style={{ color: '#5a7a6a' }}> </div>
                <div style={{ color: '#5a7a6a' }}>  serves index.html or index.jsx at root</div>
                <div style={{ color: '#5a7a6a' }}>  e.g. .../s/{sandbox.id.slice(0, 8)}/style.css</div>
                <div style={{ color: '#5a7a6a' }}>       .../s/{sandbox.id.slice(0, 8)}/app.js</div>
                <div style={{ color: '#5a7a6a' }}> </div>
                <div style={{ color: '#5a7a6a' }}>  visibility: {sandbox.visibility}</div>
                <div style={{ color: tl === 'permanent' ? '#00aaff' : '#ffcc00' }}>  {tl === 'permanent' ? 'permanent (promoted)' : `self-destruct: ${tl}`}</div>
              </div>

              {/* Stats grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
                {[
                  { label: 'Template', value: TEMPLATE_META[sandbox.template] || sandbox.template },
                  { label: 'Files', value: (sandbox.files || []).length },
                  { label: 'Time Left', value: tl === 'permanent' ? '∞ permanent' : tl, color: tl === 'expired' ? '#ff4466' : tl === 'permanent' ? '#00aaff' : '#00ffaa' },
                ].map((item, i) => (
                  <div key={i} style={{
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.05)',
                    borderRadius: 8, padding: 12,
                  }}>
                    <div style={{ ...mono, fontSize: 9, color: '#3a5a4a', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 3 }}>
                      {item.label}
                    </div>
                    <div style={{ ...mono, fontSize: 14, fontWeight: 600, color: item.color || '#b0c0cc' }}>
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>

              {/* Collaborators */}
              <div style={{ ...mono, fontSize: 10, color: '#3a5a4a', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 8 }}>
                Collaborators ({sandbox.collaborators?.length || 0})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 }}>
                {(sandbox.collaborators || []).map(c => (
                  <div key={c.user_id} style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 20, padding: '5px 12px 5px 6px',
                  }}>
                    <div style={{
                      width: 22, height: 22, borderRadius: '50%',
                      background: c.avatar_color || '#00ffaa',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 800, color: '#0a0e14',
                    }}>
                      {(c.display_name || c.username)[0].toUpperCase()}
                    </div>
                    <span style={{ ...mono, fontSize: 11, color: '#8aa09a' }}>
                      {c.display_name || c.username}
                    </span>
                    {c.role === 'owner' && (
                      <span style={{ ...mono, fontSize: 8, color: '#ffcc00', textTransform: 'uppercase' }}>owner</span>
                    )}
                  </div>
                ))}
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {/* Invited/allowed user who hasn't joined yet — join directly */}
                {!isMember && canEdit && (sandbox.status === 'live' || sandbox.status === 'promoted') && (
                  <button onClick={handleJoin} style={{
                    background: 'rgba(0,255,170,0.1)', border: '1px solid rgba(0,255,170,0.2)',
                    color: '#00ffaa', ...mono, fontSize: 11, fontWeight: 600,
                    padding: '10px 18px', borderRadius: 8, cursor: 'pointer',
                  }}>👥 Join Sandbox</button>
                )}
                {/* Public viewer without edit access — request to join */}
                {!isMember && !canEdit && (sandbox.status === 'live' || sandbox.status === 'promoted') && (
                  requestSent ? (
                    <div style={{
                      background: 'rgba(255,204,0,0.08)', border: '1px solid rgba(255,204,0,0.2)',
                      borderRadius: 8, padding: '10px 18px',
                      ...mono, fontSize: 11, color: '#ccaa44',
                    }}>📨 Request sent — waiting for owner approval</div>
                  ) : (
                    <button onClick={handleRequestJoin} style={{
                      background: 'rgba(255,204,0,0.1)', border: '1px solid rgba(255,204,0,0.2)',
                      color: '#ffcc00', ...mono, fontSize: 11, fontWeight: 600,
                      padding: '10px 18px', borderRadius: 8, cursor: 'pointer',
                    }}>📨 Request to Join</button>
                  )
                )}
                {isMember && !isOwner && (
                  <button onClick={handleLeave} style={{
                    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
                    color: '#6a8a7a', ...mono, fontSize: 11, padding: '10px 18px',
                    borderRadius: 8, cursor: 'pointer',
                  }}>Leave</button>
                )}
                {isOwner && sandbox.status === 'live' && (
                  <button onClick={handlePromote} style={{
                    background: 'linear-gradient(135deg, #00ffaa, #00ccdd)',
                    border: 'none', color: '#0a0e14', ...mono, fontSize: 11, fontWeight: 700,
                    padding: '10px 18px', borderRadius: 8, cursor: 'pointer',
                    boxShadow: '0 0 16px rgba(0,255,170,0.15)',
                  }}>🚀 Promote to Render</button>
                )}
                {isOwner && (
                  confirmDestroy ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ ...mono, fontSize: 10, color: '#ff4466' }}>Are you sure?</span>
                      <button onClick={handleDestroy} style={{
                        background: 'rgba(255,68,102,0.15)', border: '1px solid rgba(255,68,102,0.3)',
                        color: '#ff4466', ...mono, fontSize: 11, padding: '8px 14px',
                        borderRadius: 6, cursor: 'pointer',
                      }}>Yes, destroy</button>
                      <button onClick={() => setConfirmDestroy(false)} style={{
                        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                        color: '#6a8a7a', ...mono, fontSize: 11, padding: '8px 14px',
                        borderRadius: 6, cursor: 'pointer',
                      }}>Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDestroy(true)} style={{
                      background: 'rgba(255,68,102,0.08)', border: '1px solid rgba(255,68,102,0.15)',
                      color: '#ff4466', ...mono, fontSize: 11, padding: '10px 18px',
                      borderRadius: 8, cursor: 'pointer',
                    }}>🗑 Destroy</button>
                  )
                )}
                {/* Read-only notice for viewers */}
                {!canEdit && (
                  <div style={{
                    ...mono, fontSize: 10, color: '#4a5a5a', padding: '10px 0',
                    fontStyle: 'italic',
                  }}>👁 You have read-only access to this space</div>
                )}
              </div>
            </div>
          )}

          {tab === 'chat' && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '12px 20px 16px' }}>
              <div style={{ flex: 1, overflowY: 'auto', marginBottom: 12 }}>
                {chatMessages.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px 0', color: '#3a5a4a', ...mono, fontSize: 12 }}>
                    No messages yet — start the conversation
                  </div>
                ) : (
                  chatMessages.map((msg, i) => {
                    const isMe = msg.user?.id === user?.id;
                    return (
                      <div key={i} style={{
                        marginBottom: 10, display: 'flex', flexDirection: 'column',
                        alignItems: isMe ? 'flex-end' : 'flex-start',
                      }}>
                        <div style={{ ...mono, fontSize: 9, color: '#3a5a4a', marginBottom: 2, display: 'flex', gap: 6 }}>
                          <span style={{ color: msg.user?.avatar_color || '#5a7a6a' }}>@{msg.user?.username}</span>
                          <span>{formatTime(msg.timestamp)}</span>
                        </div>
                        <div style={{
                          background: isMe ? 'rgba(0,255,170,0.08)' : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${isMe ? 'rgba(0,255,170,0.15)' : 'rgba(255,255,255,0.06)'}`,
                          borderRadius: 10, padding: '8px 12px',
                          maxWidth: '80%', fontSize: 13, lineHeight: 1.5, color: '#c0d0dd',
                        }}>{msg.text}</div>
                      </div>
                    );
                  })
                )}
                <div ref={chatEndRef} />
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <input
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSendChat()}
                  placeholder="Type a message..."
                  style={{
                    flex: 1, background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 8, padding: '10px 14px',
                    ...mono, fontSize: 12, color: '#e0e8f0',
                  }}
                />
                <button onClick={handleSendChat} style={{
                  background: chatInput.trim() ? 'rgba(0,255,170,0.15)' : 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(0,255,170,0.2)',
                  color: '#00ffaa', ...mono, fontSize: 12, fontWeight: 600,
                  padding: '10px 16px', borderRadius: 8,
                  cursor: chatInput.trim() ? 'pointer' : 'default',
                }}>Send</button>
              </div>
            </div>
          )}

          {tab === 'activity' && (
            <div style={{ padding: '12px 20px' }}>
              {(!sandbox.recent_activity || sandbox.recent_activity.length === 0) ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: '#3a5a4a', ...mono, fontSize: 12 }}>
                  No activity yet
                </div>
              ) : (
                sandbox.recent_activity.map((a, i) => (
                  <div key={i} style={{
                    display: 'flex', gap: 10, padding: '8px 0',
                    borderBottom: '1px solid rgba(255,255,255,0.03)',
                  }}>
                    <div style={{
                      width: 6, height: 6, borderRadius: '50%', marginTop: 6, flexShrink: 0,
                      background:
                        a.action === 'created' ? '#00ffaa' :
                        a.action === 'joined' ? '#00ccff' :
                        a.action === 'promoted' ? '#ffcc00' :
                        a.action.startsWith('file') ? '#aa66ff' :
                        a.action === 'visibility' ? '#ff8844' :
                        a.action === 'invited' ? '#00ddff' :
                        '#5a7a6a',
                    }} />
                    <div>
                      <div style={{ fontSize: 12, color: '#a0b0bb' }}>
                        <span style={{ ...mono, fontWeight: 600, color: '#c0d0dd' }}>@{a.username}</span>{' '}
                        {a.detail || a.action}
                      </div>
                      <div style={{ ...mono, fontSize: 9, color: '#3a5a4a', marginTop: 2 }}>
                        {new Date(a.created_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'settings' && (
            <div style={{ padding: '16px 20px' }}>
              <SettingsTab sandbox={sandbox} setSandbox={setSandbox} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
