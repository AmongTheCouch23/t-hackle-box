import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';

const LANG_META = {
  python: { icon: '🐍', color: '#3776AB', label: 'Python' },
  javascript: { icon: '⚡', color: '#F7DF1E', label: 'JavaScript' },
  rust: { icon: '🦀', color: '#CE422B', label: 'Rust' },
  go: { icon: '🐹', color: '#00ADD8', label: 'Go' },
  typescript: { icon: '🔷', color: '#3178C6', label: 'TypeScript' },
  react: { icon: '⚛️', color: '#61DAFB', label: 'React' },
};

function timeLeft(expiresAt) {
  if (!expiresAt) return 'permanent';
  const diff = new Date(expiresAt) - new Date();
  if (diff <= 0) return 'expired';
  const hrs = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
}

function StatusDot({ status }) {
  const color = status === 'live' ? '#00ffaa' : status === 'promoted' ? '#00aaff' : '#ff4466';
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: color, boxShadow: (status === 'live' || status === 'promoted') ? `0 0 8px ${color}` : 'none',
      marginRight: 6, flexShrink: 0,
    }} />
  );
}

function VisibilityBadge({ visibility }) {
  const isPublic = visibility === 'public';
  return (
    <span style={{
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.5px',
      padding: '2px 6px', borderRadius: 4,
      background: isPublic ? 'rgba(0,255,170,0.08)' : 'rgba(255,255,255,0.04)',
      color: isPublic ? '#00ffaa' : '#4a5a5a',
      border: `1px solid ${isPublic ? 'rgba(0,255,170,0.15)' : 'rgba(255,255,255,0.06)'}`,
    }}>
      {isPublic ? '🌐 public' : '🔒 private'}
    </span>
  );
}

function SandboxCard({ sandbox, onClick }) {
  const lang = LANG_META[sandbox.language] || {};
  const tl = timeLeft(sandbox.expires_at);
  const mono = { fontFamily: "'JetBrains Mono', monospace" };

  return (
    <div onClick={onClick} style={{
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(0,255,170,0.06)',
      borderRadius: 12, padding: 18, cursor: 'pointer',
      transition: 'all 0.2s', position: 'relative', overflow: 'hidden',
    }}
    onMouseEnter={e => {
      e.currentTarget.style.border = '1px solid rgba(0,255,170,0.2)';
      e.currentTarget.style.transform = 'translateY(-2px)';
    }}
    onMouseLeave={e => {
      e.currentTarget.style.border = '1px solid rgba(0,255,170,0.06)';
      e.currentTarget.style.transform = 'none';
    }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        background: `linear-gradient(90deg, transparent, ${lang.color || '#00ffaa'}, transparent)`,
        opacity: 0.4,
      }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <StatusDot status={sandbox.status} />
            <span style={{ ...mono, fontWeight: 600, fontSize: 14 }}>{sandbox.name}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ ...mono, fontSize: 10, color: '#3a5a4a' }}>@{sandbox.owner_username}</span>
            <VisibilityBadge visibility={sandbox.visibility || 'private'} />
          </div>
        </div>
        <span style={{ fontSize: 22 }}>{lang.icon}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 10, ...mono, fontSize: 11, color: '#5a7a6a' }}>
        <span>👥 {sandbox.collab_count || 1}</span>
        <span>📄 {sandbox.file_count || 0}</span>
        <span style={{ color: tl === 'expired' ? '#ff4466' : tl === 'permanent' ? '#00aaff' : '#00ffaa' }}>⏱ {tl}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ ...mono, fontSize: 10, color: lang.color, opacity: 0.6 }}>{lang.label}</span>
      </div>
    </div>
  );
}

export default function Dashboard({ view, onSelectSandbox, onNewSandbox }) {
  const { sandboxes, stats, getPublicSandboxes } = useApp();
  const [publicSandboxes, setPublicSandboxes] = useState([]);
  const [loadingPublic, setLoadingPublic] = useState(false);
  const mono = { fontFamily: "'JetBrains Mono', monospace" };

  const liveSandboxes = sandboxes.filter(s => s.status === 'live' || s.status === 'promoted');
  const otherSandboxes = sandboxes.filter(s => s.status === 'expired');

  useEffect(() => {
    if (view === 'explore') {
      setLoadingPublic(true);
      getPublicSandboxes().then(s => setPublicSandboxes(s)).finally(() => setLoadingPublic(false));
    }
  }, [view]);

  if (view === 'explore') {
    return (
      <div style={{ animation: 'slideUp 0.4s ease' }}>
        <div style={{ ...mono, fontSize: 11, color: '#4a6a5a', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: 20 }}>
          Public Sandboxes
        </div>

        {loadingPublic ? (
          <div style={{ textAlign: 'center', padding: '60px 0', ...mono, fontSize: 13, color: '#3a5a4a', animation: 'pulse 1.5s ease infinite' }}>
            Loading...
          </div>
        ) : publicSandboxes.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '60px 20px',
            background: 'rgba(255,255,255,0.01)', borderRadius: 16,
            border: '1px solid rgba(255,255,255,0.04)',
          }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🌐</div>
            <div style={{ ...mono, fontSize: 14, color: '#5a7a6a', marginBottom: 8 }}>
              No public sandboxes right now
            </div>
            <div style={{ fontSize: 12, color: '#3a5a4a' }}>
              Create a sandbox and set it to public to share it here
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
            {publicSandboxes.map((s, i) => (
              <div key={s.id} style={{ animation: `slideUp 0.3s ease ${i * 0.05}s both` }}>
                <SandboxCard sandbox={s} onClick={() => onSelectSandbox(s.id)} />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Dashboard view
  return (
    <div style={{ animation: 'slideUp 0.4s ease' }}>
      {/* Stats — only non-sensitive */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 28 }}>
        {[
          { label: 'My Active', value: liveSandboxes.length, color: '#00ffaa', icon: '⚡' },
          { label: 'My Total', value: sandboxes.length, color: '#ffcc00', icon: '📦' },
          { label: 'Public Sandboxes', value: stats.publicSandboxes, color: '#00ccff', icon: '🌐' },
        ].map((stat, i) => (
          <div key={i} style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.05)',
            borderRadius: 12, padding: 18,
            animation: `slideUp 0.35s ease ${i * 0.06}s both`,
            position: 'relative', overflow: 'hidden',
          }}>
            <div style={{
              position: 'absolute', top: -16, right: -6, fontSize: 42, opacity: 0.05,
            }}>{stat.icon}</div>
            <div style={{
              ...mono, fontSize: 9, color: '#3a5a4a', textTransform: 'uppercase',
              letterSpacing: '1.5px', marginBottom: 6,
            }}>{stat.label}</div>
            <div style={{
              fontSize: 32, fontWeight: 800, color: stat.color, lineHeight: 1,
              textShadow: `0 0 24px ${stat.color}30`,
            }}>{stat.value}</div>
          </div>
        ))}
      </div>

      {/* My Sandboxes */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span style={{ ...mono, fontSize: 11, color: '#00ffaa', textTransform: 'uppercase', letterSpacing: '2px' }}>
          My Sandboxes
        </span>
        <div style={{
          width: 80, height: 2, borderRadius: 2,
          background: 'linear-gradient(90deg, transparent, #00ffaa, transparent)',
          opacity: 0.4,
        }} />
      </div>

      {sandboxes.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '60px 20px',
          background: 'rgba(255,255,255,0.01)', borderRadius: 16,
          border: '1px dashed rgba(0,255,170,0.1)',
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🎣</div>
          <div style={{ ...mono, fontSize: 14, color: '#5a7a6a', marginBottom: 4 }}>
            Your tackle box is empty
          </div>
          <div style={{ fontSize: 13, color: '#3a5a4a', marginBottom: 16 }}>
            Create your first sandbox and start hacking
          </div>
          <button onClick={onNewSandbox} style={{
            background: 'linear-gradient(135deg, #00ffaa, #00ccdd)',
            border: 'none', color: '#0a0e14', ...mono, fontWeight: 700,
            fontSize: 12, padding: '12px 24px', borderRadius: 8, cursor: 'pointer',
            boxShadow: '0 0 20px rgba(0,255,170,0.15)',
          }}>+ Cast Your First Sandbox</button>
        </div>
      ) : (
        <>
          {liveSandboxes.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14, marginBottom: 24 }}>
              {liveSandboxes.map((s, i) => (
                <div key={s.id} style={{ animation: `slideUp 0.3s ease ${i * 0.05}s both` }}>
                  <SandboxCard sandbox={s} onClick={() => onSelectSandbox(s.id)} />
                </div>
              ))}
            </div>
          )}

          {otherSandboxes.length > 0 && (
            <>
              <div style={{ ...mono, fontSize: 10, color: '#4a5a5a', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: 10, marginTop: 8 }}>
                Expired
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {otherSandboxes.map(s => {
                  const lang = LANG_META[s.language] || {};
                  return (
                    <div key={s.id} onClick={() => onSelectSandbox(s.id)} style={{
                      background: 'rgba(255,255,255,0.01)',
                      border: '1px solid rgba(255,255,255,0.04)',
                      borderRadius: 10, padding: '12px 16px',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      cursor: 'pointer', opacity: 0.6, transition: 'opacity 0.2s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.opacity = 0.85}
                    onMouseLeave={e => e.currentTarget.style.opacity = 0.6}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <StatusDot status={s.status} />
                        <span style={{ ...mono, fontSize: 13 }}>{s.name}</span>
                        <span style={{ fontSize: 16 }}>{lang.icon}</span>
                        <span style={{
                          ...mono, fontSize: 9, color: '#3a5a4a', textTransform: 'uppercase',
                          padding: '2px 6px', background: 'rgba(255,255,255,0.04)', borderRadius: 4,
                        }}>{s.status}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
