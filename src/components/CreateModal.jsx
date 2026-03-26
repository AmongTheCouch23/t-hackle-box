import React, { useState } from 'react';
import { useApp } from '../context/AppContext';

const LANGUAGES = [
  { id: 'python', label: 'Python', icon: '🐍', color: '#3776AB' },
  { id: 'javascript', label: 'JavaScript', icon: '⚡', color: '#F7DF1E' },
  { id: 'rust', label: 'Rust', icon: '🦀', color: '#CE422B' },
  { id: 'go', label: 'Go', icon: '🐹', color: '#00ADD8' },
  { id: 'typescript', label: 'TypeScript', icon: '🔷', color: '#3178C6' },
  { id: 'react', label: 'React', icon: '⚛️', color: '#61DAFB' },
];

const TEMPLATES = [
  { id: 'blank', label: 'Blank Canvas', icon: '📄', desc: 'Start from scratch' },
  { id: 'api', label: 'REST API', icon: '🔌', desc: 'Express/Flask starter' },
  { id: 'fullstack', label: 'Full Stack', icon: '🏗️', desc: 'Frontend + Backend' },
  { id: 'ml', label: 'ML Notebook', icon: '🧠', desc: 'Jupyter-style sandbox' },
  { id: 'game', label: 'Game Jam', icon: '🎮', desc: 'Canvas + game loop' },
  { id: 'cli', label: 'CLI Tool', icon: '⌨️', desc: 'Command-line app' },
];

const DURATIONS = [
  { value: 1, label: '1 hr', tag: 'Quick cast' },
  { value: 4, label: '4 hrs', tag: 'Half day' },
  { value: 12, label: '12 hrs', tag: 'Deep dive' },
  { value: 24, label: '24 hrs', tag: 'Full haul' },
  { value: 48, label: '48 hrs', tag: 'Hackathon' },
];

export default function CreateModal({ onClose }) {
  const { createNewSandbox, toast } = useApp();
  const [name, setName] = useState('');
  const [lang, setLang] = useState(null);
  const [template, setTemplate] = useState(null);
  const [duration, setDuration] = useState(4);
  const [creating, setCreating] = useState(false);
  const mono = { fontFamily: "'JetBrains Mono', monospace" };

  const canCreate = name.length >= 2 && lang && template;

  async function handleCreate() {
    if (!canCreate || creating) return;
    setCreating(true);
    try {
      await createNewSandbox(name, lang, template, duration);
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(10px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24, animation: 'fadeIn 0.2s ease',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#0d1117',
        border: '1px solid rgba(0,255,170,0.12)',
        borderRadius: 16, padding: 28,
        width: '100%', maxWidth: 560,
        maxHeight: '85vh', overflowY: 'auto',
        boxShadow: '0 0 60px rgba(0,255,170,0.06)',
        animation: 'slideUp 0.3s ease',
      }}>
        <div style={{ ...mono, fontSize: 10, color: '#00ffaa', textTransform: 'uppercase', letterSpacing: '3px', marginBottom: 4 }}>
          New Sandbox
        </div>
        <div style={{
          fontWeight: 800, fontSize: 24, marginBottom: 24,
          background: 'linear-gradient(135deg, #e0e8f0, #8aacaa)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>Open your tackle box</div>

        {/* Name */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ ...mono, fontSize: 10, color: '#4a6a5a', textTransform: 'uppercase', letterSpacing: '1.5px', display: 'block', marginBottom: 6 }}>
            Sandbox Name
          </label>
          <input
            value={name}
            onChange={e => setName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
            placeholder="my-cool-project"
            maxLength={40}
            style={{
              width: '100%', background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 8, padding: '11px 14px',
              ...mono, fontSize: 14, color: '#e0e8f0',
            }}
          />
        </div>

        {/* Language */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ ...mono, fontSize: 10, color: '#4a6a5a', textTransform: 'uppercase', letterSpacing: '1.5px', display: 'block', marginBottom: 6 }}>
            Language
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {LANGUAGES.map(l => (
              <button key={l.id} onClick={() => setLang(l.id)} style={{
                background: lang === l.id ? `${l.color}15` : 'rgba(255,255,255,0.02)',
                border: lang === l.id ? `1px solid ${l.color}40` : '1px solid rgba(255,255,255,0.05)',
                borderRadius: 8, padding: '9px 10px',
                display: 'flex', alignItems: 'center', gap: 7,
                cursor: 'pointer', transition: 'all 0.15s',
                color: lang === l.id ? l.color : '#5a7a6a',
                ...mono, fontSize: 11,
              }}>
                <span style={{ fontSize: 16 }}>{l.icon}</span>{l.label}
              </button>
            ))}
          </div>
        </div>

        {/* Template */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ ...mono, fontSize: 10, color: '#4a6a5a', textTransform: 'uppercase', letterSpacing: '1.5px', display: 'block', marginBottom: 6 }}>
            Template
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {TEMPLATES.map(t => (
              <button key={t.id} onClick={() => setTemplate(t.id)} style={{
                background: template === t.id ? 'rgba(0,255,170,0.06)' : 'rgba(255,255,255,0.02)',
                border: template === t.id ? '1px solid rgba(0,255,170,0.25)' : '1px solid rgba(255,255,255,0.05)',
                borderRadius: 8, padding: '10px', cursor: 'pointer', transition: 'all 0.15s', textAlign: 'left',
              }}>
                <div style={{ fontSize: 18, marginBottom: 3 }}>{t.icon}</div>
                <div style={{ ...mono, fontSize: 10, fontWeight: 600, color: template === t.id ? '#00ffaa' : '#7a9a8a' }}>{t.label}</div>
                <div style={{ fontSize: 9, color: '#3a5a4a', marginTop: 1 }}>{t.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Duration */}
        <div style={{ marginBottom: 28 }}>
          <label style={{ ...mono, fontSize: 10, color: '#4a6a5a', textTransform: 'uppercase', letterSpacing: '1.5px', display: 'block', marginBottom: 6 }}>
            Self-Destruct Timer
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            {DURATIONS.map(d => (
              <button key={d.value} onClick={() => setDuration(d.value)} style={{
                flex: 1,
                background: duration === d.value ? 'rgba(0,255,170,0.06)' : 'rgba(255,255,255,0.02)',
                border: duration === d.value ? '1px solid rgba(0,255,170,0.25)' : '1px solid rgba(255,255,255,0.05)',
                borderRadius: 8, padding: '8px 4px',
                cursor: 'pointer', transition: 'all 0.15s', textAlign: 'center',
              }}>
                <div style={{ ...mono, fontSize: 13, fontWeight: 700, color: duration === d.value ? '#00ffaa' : '#7a9a8a' }}>{d.label}</div>
                <div style={{ fontSize: 8, color: '#3a5a4a', marginTop: 1 }}>{d.tag}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{
            flex: 1, background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.06)',
            color: '#5a7a6a', ...mono, fontSize: 12, fontWeight: 600,
            padding: '13px', borderRadius: 10, cursor: 'pointer',
          }}>CANCEL</button>
          <button onClick={handleCreate} disabled={!canCreate || creating} style={{
            flex: 2,
            background: canCreate ? 'linear-gradient(135deg, #00ffaa, #00ccdd)' : 'rgba(0,255,170,0.06)',
            border: 'none',
            color: canCreate ? '#0a0e14' : '#3a5a4a',
            ...mono, fontSize: 12, fontWeight: 700, padding: '13px',
            borderRadius: 10,
            cursor: canCreate ? 'pointer' : 'not-allowed',
            boxShadow: canCreate ? '0 0 24px rgba(0,255,170,0.15)' : 'none',
            opacity: creating ? 0.7 : 1,
            transition: 'all 0.3s',
          }}>
            {creating ? 'CREATING...' : '🎣 CAST NEW SANDBOX'}
          </button>
        </div>
      </div>
    </div>
  );
}
