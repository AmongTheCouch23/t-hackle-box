import React, { useState } from 'react';
import { useApp } from '../context/AppContext';

export default function Login() {
  const { login, register } = useApp();
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login(username, password);
      } else {
        await register(username, displayName || username, password);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const mono = { fontFamily: "'JetBrains Mono', monospace" };

  return (
    <div style={{
      minHeight: '100vh', background: '#0a0e14',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      {/* Background grid */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none',
        backgroundImage: `
          linear-gradient(rgba(0,255,170,0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(0,255,170,0.03) 1px, transparent 1px)
        `,
        backgroundSize: '60px 60px',
      }} />

      <div style={{
        width: '100%', maxWidth: 420, position: 'relative', zIndex: 1,
        animation: 'slideUp 0.5s ease',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{
            fontSize: 56, lineHeight: 1, marginBottom: 12,
            filter: 'drop-shadow(0 0 20px rgba(0,255,170,0.3))',
          }}>🎣</div>
          <div style={{
            ...mono, fontWeight: 700, fontSize: 28,
            background: 'linear-gradient(135deg, #00ffaa, #00ccff)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            letterSpacing: '-0.5px',
          }}>T-HACKLE BOX</div>
          <div style={{
            ...mono, fontSize: 11, color: '#3a5a4a', letterSpacing: '3px',
            textTransform: 'uppercase', marginTop: 4,
          }}>collaborative sandboxes</div>
        </div>

        {/* Card */}
        <div style={{
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(0,255,170,0.1)',
          borderRadius: 16, padding: 32,
          boxShadow: '0 0 60px rgba(0,255,170,0.04)',
        }}>
          {/* Tabs */}
          <div style={{ display: 'flex', marginBottom: 28, borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)' }}>
            {['login', 'register'].map(m => (
              <button key={m} onClick={() => { setMode(m); setError(''); }} style={{
                flex: 1, padding: '10px 0', border: 'none', cursor: 'pointer',
                background: mode === m ? 'rgba(0,255,170,0.08)' : 'transparent',
                color: mode === m ? '#00ffaa' : '#4a6a5a',
                ...mono, fontSize: 11, fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: '1.5px',
                transition: 'all 0.2s',
              }}>{m === 'login' ? 'Sign In' : 'Create Account'}</button>
            ))}
          </div>

          <div>
            {/* Username */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ ...mono, fontSize: 10, color: '#4a6a5a', textTransform: 'uppercase', letterSpacing: '1.5px', display: 'block', marginBottom: 6 }}>
                Username
              </label>
              <input
                value={username}
                onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                placeholder="hackerman"
                maxLength={24}
                style={{
                  width: '100%', background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 8, padding: '12px 14px',
                  ...mono, fontSize: 14, color: '#e0e8f0',
                }}
              />
            </div>

            {/* Display name (register only) */}
            {mode === 'register' && (
              <div style={{ marginBottom: 16, animation: 'slideUp 0.3s ease' }}>
                <label style={{ ...mono, fontSize: 10, color: '#4a6a5a', textTransform: 'uppercase', letterSpacing: '1.5px', display: 'block', marginBottom: 6 }}>
                  Display Name
                </label>
                <input
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  placeholder="The Hackerman"
                  maxLength={32}
                  style={{
                    width: '100%', background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 8, padding: '12px 14px',
                    ...mono, fontSize: 14, color: '#e0e8f0',
                  }}
                />
              </div>
            )}

            {/* Password */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ ...mono, fontSize: 10, color: '#4a6a5a', textTransform: 'uppercase', letterSpacing: '1.5px', display: 'block', marginBottom: 6 }}>
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                style={{
                  width: '100%', background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 8, padding: '12px 14px',
                  ...mono, fontSize: 14, color: '#e0e8f0',
                }}
              />
            </div>

            {error && (
              <div style={{
                background: 'rgba(255,68,102,0.08)',
                border: '1px solid rgba(255,68,102,0.2)',
                borderRadius: 8, padding: '10px 14px', marginBottom: 16,
                ...mono, fontSize: 12, color: '#ff4466',
              }}>{error}</div>
            )}

            <button
              onClick={handleSubmit}
              disabled={submitting || !username || !password}
              style={{
                width: '100%',
                background: (!username || !password) ? 'rgba(0,255,170,0.08)' : 'linear-gradient(135deg, #00ffaa, #00ccdd)',
                border: 'none',
                color: (!username || !password) ? '#3a5a4a' : '#0a0e14',
                ...mono, fontSize: 13, fontWeight: 700,
                padding: '14px', borderRadius: 10,
                cursor: (!username || !password) ? 'not-allowed' : 'pointer',
                boxShadow: (!username || !password) ? 'none' : '0 0 30px rgba(0,255,170,0.15)',
                transition: 'all 0.3s',
                opacity: submitting ? 0.7 : 1,
              }}
            >
              {submitting ? '...' : mode === 'login' ? '🎣 CAST YOUR LINE' : '🎣 CREATE ACCOUNT'}
            </button>
          </div>
        </div>

        <div style={{ textAlign: 'center', marginTop: 20, ...mono, fontSize: 10, color: '#2a4a3a' }}>
          Powered by Render.com — sandboxes that self-destruct
        </div>
      </div>
    </div>
  );
}
