import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';

export default function Landing({ onAuth }) {
  const { getPublicSandboxes, loadStats, stats } = useApp();
  const [publicSandboxes, setPublicSandboxes] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const mono = { fontFamily: "'JetBrains Mono', monospace" };

  useEffect(() => {
    getPublicSandboxes().then(s => { setPublicSandboxes(s); setLoaded(true); }).catch(() => setLoaded(true));
    loadStats();
  }, []);

  return (
    <div style={{
      minHeight: '100vh', background: '#0a0e14',
      fontFamily: "'Outfit', sans-serif", color: '#e0e8f0',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Grid background */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none',
        backgroundImage: `
          linear-gradient(rgba(0,255,170,0.02) 1px, transparent 1px),
          linear-gradient(90deg, rgba(0,255,170,0.02) 1px, transparent 1px)
        `,
        backgroundSize: '80px 80px',
      }} />

      {/* Header */}
      <header style={{
        padding: '20px 32px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        maxWidth: 1100, margin: '0 auto', position: 'relative', zIndex: 1,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 28, filter: 'drop-shadow(0 0 12px rgba(0,255,170,0.4))' }}>🎣</span>
          <span style={{
            ...mono, fontWeight: 700, fontSize: 18,
            background: 'linear-gradient(135deg, #00ffaa, #00ccff)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>T-HACKLE BOX</span>
        </div>
        <button onClick={onAuth} style={{
          background: 'linear-gradient(135deg, #00ffaa, #00ccdd)',
          border: 'none', color: '#0a0e14',
          ...mono, fontWeight: 700, fontSize: 12,
          padding: '10px 24px', borderRadius: 8,
          cursor: 'pointer',
          boxShadow: '0 0 20px rgba(0,255,170,0.15)',
        }}>Sign In / Sign Up</button>
      </header>

      {/* Hero */}
      <section style={{
        maxWidth: 800, margin: '0 auto', padding: '80px 24px 60px',
        textAlign: 'center', position: 'relative', zIndex: 1,
      }}>
        <div style={{
          fontSize: 72, marginBottom: 20,
          filter: 'drop-shadow(0 0 30px rgba(0,255,170,0.3))',
        }}>🎣</div>
        <h1 style={{
          fontSize: 48, fontWeight: 900, lineHeight: 1.1, marginBottom: 16,
          background: 'linear-gradient(135deg, #e0e8f0 30%, #00ffaa 70%, #00ccff)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>
          Build, share, and deploy — in one place
        </h1>
        <p style={{
          fontSize: 18, color: '#5a7a6a', maxWidth: 560, margin: '0 auto 32px',
          lineHeight: 1.6,
        }}>
          T-hackle Box is a collaborative sandbox platform where developers create temporary or permanent coding spaces, 
          edit files together in real-time, and serve live websites — all from a single URL.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button onClick={onAuth} style={{
            background: 'linear-gradient(135deg, #00ffaa, #00ccdd)',
            border: 'none', color: '#0a0e14',
            ...mono, fontWeight: 700, fontSize: 14,
            padding: '14px 32px', borderRadius: 10,
            cursor: 'pointer',
            boxShadow: '0 0 30px rgba(0,255,170,0.2)',
          }}>Get Started — Free</button>
        </div>
      </section>

      {/* Features */}
      <section style={{
        maxWidth: 900, margin: '0 auto', padding: '40px 24px 60px',
        position: 'relative', zIndex: 1,
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {[
            { icon: '⚡', title: 'Instant Sandboxes', desc: 'Spin up a coding environment in seconds. Choose your language, pick a template, set a timer.' },
            { icon: '👥', title: 'Real-time Collab', desc: 'Invite teammates by username, edit files together, and chat — all synced live over WebSocket.' },
            { icon: '🌐', title: 'Live Websites', desc: 'Every sandbox gets a live URL. Add an index.html or .jsx and your site is instantly deployed.' },
            { icon: '🔒', title: 'Access Control', desc: 'Private by default. Make spaces public, share just the website, or invite specific users.' },
            { icon: '🚀', title: 'Promote to Permanent', desc: 'Started as a quick experiment? Promote it — the timer stops and your sandbox lives forever.' },
            { icon: '📦', title: 'All Languages', desc: 'Python, JavaScript, TypeScript, Rust, Go, React — with starter templates for APIs, games, ML, and more.' },
          ].map((f, i) => (
            <div key={i} style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.05)',
              borderRadius: 12, padding: 20,
            }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>{f.icon}</div>
              <div style={{ ...mono, fontSize: 13, fontWeight: 700, color: '#c0d0dd', marginBottom: 6 }}>{f.title}</div>
              <div style={{ fontSize: 13, color: '#4a6a5a', lineHeight: 1.5 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Stats bar */}
      <section style={{
        maxWidth: 600, margin: '0 auto', padding: '20px 24px 40px',
        display: 'flex', justifyContent: 'center', gap: 40,
        position: 'relative', zIndex: 1,
      }}>
        {[
          { label: 'Active Spaces', value: stats.liveSandboxes || 0, color: '#00ffaa' },
          { label: 'Public Spaces', value: stats.publicSandboxes || 0, color: '#00ccff' },
        ].map((s, i) => (
          <div key={i} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 32, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ ...mono, fontSize: 10, color: '#3a5a4a', textTransform: 'uppercase', letterSpacing: '1.5px' }}>{s.label}</div>
          </div>
        ))}
      </section>

      {/* Public sandboxes preview */}
      {loaded && publicSandboxes.length > 0 && (
        <section style={{
          maxWidth: 900, margin: '0 auto', padding: '20px 24px 80px',
          position: 'relative', zIndex: 1,
        }}>
          <div style={{ ...mono, fontSize: 11, color: '#4a6a5a', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: 16, textAlign: 'center' }}>
            Public Spaces
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
            {publicSandboxes.slice(0, 6).map(s => {
              const langIcons = { python: '🐍', javascript: '⚡', typescript: '🔷', rust: '🦀', go: '🐹', react: '⚛️' };
              return (
                <a key={s.id} href={`/s/${s.id.slice(0, 8)}`} target="_blank" rel="noopener noreferrer" style={{
                  textDecoration: 'none',
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.05)',
                  borderRadius: 10, padding: 16,
                  display: 'block', transition: 'border-color 0.2s',
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(0,255,170,0.2)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)'}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 18 }}>{langIcons[s.language] || '📦'}</span>
                    <span style={{ ...mono, fontSize: 13, fontWeight: 600, color: '#c0d0dd' }}>{s.name}</span>
                  </div>
                  <div style={{ ...mono, fontSize: 10, color: '#3a5a4a' }}>by @{s.owner_username} · {s.file_count || 0} files</div>
                </a>
              );
            })}
          </div>
        </section>
      )}

      {/* Footer */}
      <footer style={{
        textAlign: 'center', padding: '24px', 
        ...mono, fontSize: 10, color: '#2a3a3a',
        position: 'relative', zIndex: 1,
      }}>
        T-hackle Box — collaborative sandboxes that self-destruct
      </footer>
    </div>
  );
}
