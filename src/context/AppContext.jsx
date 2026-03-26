import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

const API = '/api';

async function apiFetch(path, options = {}) {
  const token = localStorage.getItem('thb_token');
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sandboxes, setSandboxes] = useState([]);
  const [stats, setStats] = useState({ liveSandboxes: 0, publicSandboxes: 0, totalSandboxes: 0 });
  const [messages, setMessages] = useState({});
  const [toasts, setToasts] = useState([]);
  const wsRef = useRef(null);
  const reconnectRef = useRef(null);
  const fileListenersRef = useRef(new Map());

  function toast(text, type = 'info') {
    const id = Date.now();
    setToasts(prev => [...prev, { id, text, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }

  // --- Auth ---
  async function login(username, password) {
    const data = await apiFetch('/auth/login', { method: 'POST', body: { username, password } });
    localStorage.setItem('thb_token', data.token);
    document.cookie = `thb_token=${data.token}; path=/; max-age=${7*24*60*60}; samesite=lax`;
    setUser(data.user);
    connectWS(data.token);
    toast(`Welcome back, ${data.user.display_name}!`, 'success');
    return data;
  }

  async function register(username, displayName, password) {
    const data = await apiFetch('/auth/register', { method: 'POST', body: { username, displayName, password } });
    localStorage.setItem('thb_token', data.token);
    document.cookie = `thb_token=${data.token}; path=/; max-age=${7*24*60*60}; samesite=lax`;
    setUser(data.user);
    connectWS(data.token);
    toast(`Account created! Welcome, ${data.user.display_name}!`, 'success');
    return data;
  }

  function logout() {
    localStorage.removeItem('thb_token');
    document.cookie = 'thb_token=; path=/; max-age=0';
    setUser(null);
    setSandboxes([]);
    if (wsRef.current) wsRef.current.close();
    toast('Signed out', 'info');
  }

  async function checkAuth() {
    try {
      const token = localStorage.getItem('thb_token');
      if (!token) { setLoading(false); return; }
      // Ensure cookie is set for live site access (/s/ routes)
      document.cookie = `thb_token=${token}; path=/; max-age=${7*24*60*60}; samesite=lax`;
      const data = await apiFetch('/auth/me');
      setUser(data.user);
      connectWS(token);
    } catch {
      localStorage.removeItem('thb_token');
      document.cookie = 'thb_token=; path=/; max-age=0';
    } finally {
      setLoading(false);
    }
  }

  // --- WebSocket ---
  function connectWS(token) {
    if (wsRef.current && wsRef.current.readyState < 2) return;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', token }));
      if (reconnectRef.current) clearInterval(reconnectRef.current);
    };

    ws.onmessage = (evt) => {
      try { handleWSMessage(JSON.parse(evt.data)); } catch {}
    };

    ws.onclose = () => {
      reconnectRef.current = setTimeout(() => {
        const t = localStorage.getItem('thb_token');
        if (t) connectWS(t);
      }, 3000);
    };
  }

  function handleWSMessage(msg) {
    switch (msg.type) {
      case 'sandbox_created':
        setSandboxes(prev => [msg.sandbox, ...prev.filter(s => s.id !== msg.sandbox.id)]);
        break;
      case 'sandbox_updated':
        setSandboxes(prev => prev.map(s => s.id === msg.sandbox.id ? { ...s, ...msg.sandbox } : s));
        break;
      case 'sandbox_deleted':
        setSandboxes(prev => prev.filter(s => s.id !== msg.sandboxId));
        break;
      case 'sandboxes_expired':
        loadSandboxes();
        break;
      case 'chat':
        setMessages(prev => ({
          ...prev,
          [msg.sandboxId]: [...(prev[msg.sandboxId] || []), msg],
        }));
        break;
      case 'sandbox_activity':
        setSandboxes(prev => prev.map(s =>
          s.id === msg.sandboxId ? { ...s, recent_actions: (s.recent_actions || 0) + 1 } : s
        ));
        break;
      case 'file_created':
      case 'file_updated':
      case 'file_renamed':
      case 'file_deleted':
      case 'file_edit':
        // Notify file listeners
        for (const [, cb] of fileListenersRef.current) cb(msg);
        break;
    }
  }

  function sendWSMessage(msg) {
    if (wsRef.current && wsRef.current.readyState === 1) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }

  function onFileEvent(id, callback) {
    fileListenersRef.current.set(id, callback);
    return () => fileListenersRef.current.delete(id);
  }

  // --- Sandboxes ---
  const loadSandboxes = useCallback(async () => {
    try {
      const data = await apiFetch('/sandboxes');
      setSandboxes(data.sandboxes);
    } catch {}
  }, []);

  async function createNewSandbox(name, language, template, durationHours) {
    const data = await apiFetch('/sandboxes', {
      method: 'POST', body: { name, language, template, durationHours },
    });
    toast(`Sandbox "${name}" is live!`, 'success');
    return data.sandbox;
  }

  async function joinSandboxById(id) {
    const data = await apiFetch(`/sandboxes/${id}/join`, { method: 'POST' });
    toast('Joined sandbox!', 'success');
    return data.sandbox;
  }

  async function leaveSandboxById(id) {
    await apiFetch(`/sandboxes/${id}/leave`, { method: 'POST' });
    toast('Left sandbox', 'info');
  }

  async function promoteSandbox(id) {
    const data = await apiFetch(`/sandboxes/${id}/promote`, { method: 'POST' });
    toast('Sandbox promoted to permanent deployment!', 'success');
    return data.sandbox;
  }

  async function destroySandbox(id) {
    await apiFetch(`/sandboxes/${id}`, { method: 'DELETE' });
    toast('Sandbox destroyed', 'info');
  }

  async function getSandboxDetail(id) {
    const data = await apiFetch(`/sandboxes/${id}`);
    return data.sandbox;
  }

  async function resolveSpaceUrl(shortId) {
    const data = await apiFetch(`/resolve/${shortId}`);
    return data.sandbox;
  }

  async function getPublicSandboxes() {
    const data = await apiFetch('/sandboxes/public');
    return data.sandboxes;
  }

  // --- Visibility & Access ---
  async function setVisibility(sandboxId, visibility) {
    const data = await apiFetch(`/sandboxes/${sandboxId}/visibility`, {
      method: 'POST', body: { visibility },
    });
    toast(`Sandbox is now ${visibility}`, 'success');
    await loadSandboxes();
    return data.sandbox;
  }

  async function inviteUser(sandboxId, username) {
    const data = await apiFetch(`/sandboxes/${sandboxId}/invite`, {
      method: 'POST', body: { username },
    });
    toast(`Invited @${username}`, 'success');
    return data.sandbox;
  }

  async function revokeUser(sandboxId, username) {
    const data = await apiFetch(`/sandboxes/${sandboxId}/revoke`, {
      method: 'POST', body: { username },
    });
    toast(`Revoked access for @${username}`, 'info');
    return data.sandbox;
  }

  // --- Files ---
  async function createSandboxFile(sandboxId, filename, content, fileType) {
    const data = await apiFetch(`/sandboxes/${sandboxId}/files`, {
      method: 'POST', body: { filename, content, fileType },
    });
    return data.file;
  }

  async function updateSandboxFile(sandboxId, fileId, content) {
    const data = await apiFetch(`/sandboxes/${sandboxId}/files/${fileId}`, {
      method: 'PUT', body: { content },
    });
    return data.file;
  }

  async function renameSandboxFile(sandboxId, fileId, filename) {
    const data = await apiFetch(`/sandboxes/${sandboxId}/files/${fileId}/rename`, {
      method: 'PUT', body: { filename },
    });
    return data.file;
  }

  async function deleteSandboxFile(sandboxId, fileId) {
    await apiFetch(`/sandboxes/${sandboxId}/files/${fileId}`, { method: 'DELETE' });
  }

  function sendChat(sandboxId, text) {
    sendWSMessage({ type: 'chat', sandboxId, text });
  }

  function sendFileEdit(sandboxId, fileId, content, cursor) {
    sendWSMessage({ type: 'file_edit', sandboxId, fileId, content, cursor });
  }

  async function loadStats() {
    try {
      const data = await apiFetch('/stats');
      setStats(data);
    } catch {}
  }

  useEffect(() => { checkAuth(); }, []);
  useEffect(() => {
    if (user) { loadSandboxes(); loadStats(); }
  }, [user, loadSandboxes]);
  useEffect(() => {
    if (!user) return;
    const iv = setInterval(() => { loadStats(); }, 30000);
    return () => clearInterval(iv);
  }, [user]);

  return (
    <AppContext.Provider value={{
      user, loading, sandboxes, stats, messages, toasts,
      login, register, logout,
      createNewSandbox, joinSandboxById, leaveSandboxById, promoteSandbox, destroySandbox,
      loadSandboxes, loadStats, getSandboxDetail, resolveSpaceUrl, getPublicSandboxes, sendChat, toast,
      setVisibility, inviteUser, revokeUser,
      createSandboxFile, updateSandboxFile, renameSandboxFile, deleteSandboxFile,
      sendFileEdit, onFileEvent,
    }}>
      {children}
    </AppContext.Provider>
  );
}
