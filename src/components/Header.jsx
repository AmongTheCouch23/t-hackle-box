import React, { useState } from 'react';
import { useApp } from '../context/AppContext';

export default function Header({ view, setView, onNewSandbox }) {
  const { user, logout } = useApp();
  const [showMenu, setShowMenu] = useState(false);
  const mono = { fontFamily: "'JetBrains Mono', monospace" };

  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 50,
      background: 'rgba(10,14,20,0.88)', backdropFilter: 'blur(20px)',
      borderBottom: '1px solid rgba(0,255,170,0.08)',
    }}>
      <div style={{
        maxWidth: 1200, margin: '0 auto', padding: '0 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        height: 60,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 24, filter: 'drop-shadow(0 0 8px rgba(0,255,170,0.4))' }}>🎣</span>
          <div style={{
            ...mono, fontWeight: 700, fontSize: 16,
            background: 'linear-gradient(135deg, #00ffaa, #00ccff)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>T-HACKLE BOX</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {['dashboard', 'explore'].map(v => (
            <button key={v} onClick={() => setView(v)} style={{
              background: view === v ? 'rgba(0,255,170,0.08)' : 'transparent',
              border: view === v ? '1px solid rgba(0,255,170,0.2)' : '1px solid transparent',
              color: view === v ? '#00ffaa' : '#4a6a5a',
              ...mono, fontSize: 11, padding: '6px 12px', borderRadius: 6,
              cursor: 'pointer', textTransform: 'capitalize', transition: 'all 0.2s',
            }}>{v}</button>
          ))}

          <button onClick={onNewSandbox} style={{
            background: 'linear-gradient(135deg, #00ffaa, #00ccdd)',
            border: 'none', color: '#0a0e14',
            ...mono, fontWeight: 700, fontSize: 11,
            padding: '7px 14px', borderRadius: 7,
            cursor: 'pointer', marginLeft: 6,
            boxShadow: '0 0 16px rgba(0,255,170,0.15)',
          }}>+ NEW</button>

          <div style={{ position: 'relative', marginLeft: 8 }}>
            <button onClick={() => setShowMenu(!showMenu)} style={{
              width: 34, height: 34, borderRadius: '50%',
              background: user?.avatar_color || '#00ffaa',
              border: '2px solid rgba(255,255,255,0.1)',
              color: '#0a0e14', fontWeight: 800, fontSize: 14,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: "'Outfit', sans-serif",
            }}>
              {(user?.display_name || user?.username || '?')[0].toUpperCase()}
            </button>

            {showMenu && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 1 }} onClick={() => setShowMenu(false)} />
                <div style={{
                  position: 'absolute', top: '100%', right: 0, marginTop: 8, zIndex: 2,
                  background: '#0d1117', border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 10, padding: 8, minWidth: 180,
                  boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
                  animation: 'slideUp 0.2s ease',
                }}>
                  <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ ...mono, fontSize: 13, fontWeight: 600, color: '#e0e8f0' }}>
                      {user?.display_name}
                    </div>
                    <div style={{ ...mono, fontSize: 10, color: '#4a6a5a' }}>@{user?.username}</div>
                  </div>
                  <button onClick={() => { logout(); setShowMenu(false); }} style={{
                    width: '100%', textAlign: 'left', background: 'transparent',
                    border: 'none', color: '#ff4466', ...mono, fontSize: 11,
                    padding: '10px 12px', cursor: 'pointer', borderRadius: 6,
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,68,102,0.08)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >Sign Out</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
