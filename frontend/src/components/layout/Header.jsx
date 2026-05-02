import { Zap, GitCompare, Settings, LogOut } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

export default function Header({ status, onNavigate, currentPage }) {
  const { user, logout } = useAuth();

  const statusMap = {
    idle:       { label: 'Ready',     dot: 'bg-sage-muted' },
    processing: { label: 'Analysing', dot: 'bg-accent animate-pulse-glow' },
    complete:   { label: 'Complete',  dot: 'bg-green-500' },
    failed:     { label: 'Failed',    dot: 'bg-red-500' },
    timeout:    { label: 'Timeout',   dot: 'bg-red-500' },
  };

  const s = statusMap[status] || statusMap.idle;

  return (
    <header className="h-14 bg-bg-secondary border-b border-border-subtle flex items-center justify-between px-5 shrink-0 z-50">
      {/* Logo */}
      <div className="flex items-center gap-2.5 cursor-pointer select-none" onClick={() => onNavigate('dashboard')}>
        <div className="w-8 h-8 bg-gradient-to-br from-accent to-purple-500 rounded-lg flex items-center justify-center text-white shadow-[0_0_16px_var(--color-accent-glow)]">
          <Zap size={18} />
        </div>
        <span className="text-lg font-bold tracking-wide bg-gradient-to-r from-accent-hover to-purple-400 bg-clip-text text-transparent">
          SAGE
        </span>
        <span className="text-[0.65rem] text-sage-muted hidden xl:inline">Situational Awareness Engine</span>
      </div>

      {/* Status */}
      <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 px-3.5 py-1 rounded-full bg-bg-card border border-border-subtle">
        <span className={`w-2 h-2 rounded-full shrink-0 ${s.dot}`} />
        <span className="text-xs font-medium text-sage-secondary">{s.label}</span>
      </div>

      {/* Nav + User */}
      <div className="flex items-center gap-1.5">
        <NavBtn active={currentPage === 'compare'} onClick={() => onNavigate('compare')} icon={<GitCompare size={15} />} label="Compare" />
        <NavBtn active={currentPage === 'prompts'} onClick={() => onNavigate('prompts')} icon={<Settings size={15} />} label="Prompts" />

        {user && (
          <div className="flex items-center gap-2 ml-3 pl-3 border-l border-border-subtle">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-accent to-purple-500 flex items-center justify-center text-xs font-semibold text-white">
              {user.username?.charAt(0).toUpperCase()}
            </div>
            <span className="text-[0.8rem] text-sage-secondary">{user.username}</span>
            <button onClick={logout} className="p-1 rounded text-sage-muted hover:text-red-500 transition-colors" title="Sign out">
              <LogOut size={14} />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

function NavBtn({ active, onClick, icon, label }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[0.8rem] font-medium transition-all duration-200 cursor-pointer
        ${active
          ? 'bg-accent-subtle text-accent-hover'
          : 'text-sage-muted hover:bg-bg-hover hover:text-sage-primary'
        }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
