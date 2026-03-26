import React, { useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import Login from './components/Login';
import Header from './components/Header';
import Dashboard from './components/Dashboard';
import CreateModal from './components/CreateModal';
import SandboxDetail from './components/SandboxDetail';

const GLOBAL_STYLES = `
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Outfit:wght@300;400;500;600;700;800;900&display=swap');

* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  background: #0a0e14;
  font-family: 'Outfit', sans-serif;
  color: #e0e8f0;
  min-height: 100vh;
}
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(0,255,170,0.2); border-radius: 3px; }
input:focus, textarea:focus { outline: none; }

@keyframes slideUp {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes pulse {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}
`;

function ToastContainer() {
  const { toasts } = useApp();
  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          background: t.type === 'success' ? 'rgba(0,255,170,0.15)' : t.type === 'error' ? 'rgba(255,68,102,0.15)' : 'rgba(255,255,255,0.08)',
          border: `1px solid ${t.type === 'success' ? 'rgba(0,255,170,0.3)' : t.type === 'error' ? 'rgba(255,68,102,0.3)' : 'rgba(255,255,255,0.12)'}`,
          borderRadius: 10, padding: '12px 20px',
          fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
          color: t.type === 'success' ? '#00ffaa' : t.type === 'error' ? '#ff4466' : '#c0d0dd',
          backdropFilter: 'blur(12px)',
          animation: 'slideUp 0.3s ease',
          maxWidth: 340,
        }}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

function AppInner() {
  const { user, loading } = useApp();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedSandbox, setSelectedSandbox] = useState(null);
  const [view, setView] = useState('dashboard');

  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: '#0a0e14',
      }}>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          color: '#00ffaa', fontSize: 16,
          animation: 'pulse 1.5s ease infinite',
        }}>
          🎣 Loading T-hackle Box...
        </div>
      </div>
    );
  }

  if (!user) return <Login />;

  return (
    <div style={{ minHeight: '100vh', background: '#0a0e14' }}>
      {/* Scanlines */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 100,
        background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,170,0.006) 2px, rgba(0,255,170,0.006) 4px)',
      }} />

      <Header view={view} setView={setView} onNewSandbox={() => setShowCreate(true)} />

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 24px 64px' }}>
        <Dashboard
          view={view}
          onSelectSandbox={setSelectedSandbox}
          onNewSandbox={() => setShowCreate(true)}
        />
      </main>

      {showCreate && <CreateModal onClose={() => setShowCreate(false)} />}
      {selectedSandbox && (
        <SandboxDetail
          sandboxId={selectedSandbox}
          onClose={() => setSelectedSandbox(null)}
        />
      )}
      <ToastContainer />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <style>{GLOBAL_STYLES}</style>
      <AppInner />
    </AppProvider>
  );
}
