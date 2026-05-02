import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Zap, Eye, EyeOff, Loader } from 'lucide-react';

export default function Login() {
  const { login, register } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [form, setForm] = useState({ username: '', email: '', password: '' });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (isRegister) {
        await register(form.username, form.email, form.password);
      } else {
        await login(form.username, form.password);
      }
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message);
    }
    setLoading(false);
  };

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-bg-primary relative overflow-hidden">
      {/* Background effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-accent/8 rounded-full blur-3xl" />
        <div className="absolute bottom-1/3 right-1/4 w-80 h-80 bg-purple-500/6 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md px-6">
        {/* Logo */}
        <div className="flex flex-col items-center mb-10">
          <div className="w-14 h-14 bg-gradient-to-br from-accent to-purple-500 rounded-2xl flex items-center justify-center text-white shadow-[0_0_40px_var(--color-accent-glow)] mb-4">
            <Zap size={28} />
          </div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-accent-hover to-purple-400 bg-clip-text text-transparent">
            SAGE
          </h1>
          <p className="text-sm text-sage-muted mt-1">Situational Awareness & Guidance Engine</p>
        </div>

        {/* Form */}
        <form onSubmit={submit} className="bg-bg-card border border-border-subtle rounded-2xl p-8 space-y-5 shadow-2xl shadow-black/30">
          <h2 className="text-lg font-semibold text-sage-primary text-center">
            {isRegister ? 'Create Account' : 'Sign In'}
          </h2>

          <div>
            <label className="block text-xs font-semibold text-sage-muted uppercase tracking-wider mb-1.5">Username</label>
            <input value={form.username} onChange={set('username')} autoFocus
              className="w-full px-3.5 py-2.5 bg-bg-secondary border border-border-default rounded-lg text-sm text-sage-primary placeholder:text-sage-muted outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-subtle)] transition-all"
              placeholder="e.g. vansh" />
          </div>

          {isRegister && (
            <div className="animate-[fadeIn_0.2s_ease]">
              <label className="block text-xs font-semibold text-sage-muted uppercase tracking-wider mb-1.5">Email</label>
              <input value={form.email} onChange={set('email')} type="email"
                className="w-full px-3.5 py-2.5 bg-bg-secondary border border-border-default rounded-lg text-sm text-sage-primary placeholder:text-sage-muted outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-subtle)] transition-all"
                placeholder="vansh@example.com" />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-sage-muted uppercase tracking-wider mb-1.5">Password</label>
            <div className="relative">
              <input value={form.password} onChange={set('password')} type={showPw ? 'text' : 'password'}
                className="w-full px-3.5 py-2.5 pr-10 bg-bg-secondary border border-border-default rounded-lg text-sm text-sage-primary placeholder:text-sage-muted outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-subtle)] transition-all"
                placeholder="••••••••" />
              <button type="button" onClick={() => setShowPw(!showPw)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-sage-muted hover:text-sage-primary transition-colors cursor-pointer">
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-500/8 border border-red-500/20 rounded-lg px-4 py-2.5">{error}</p>
          )}

          <button type="submit" disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-3 bg-accent hover:bg-accent-hover disabled:opacity-45 text-white font-semibold rounded-lg transition-all duration-200 hover:shadow-[0_0_24px_var(--color-accent-glow)] cursor-pointer">
            {loading && <Loader size={16} className="animate-spin" />}
            {isRegister ? 'Create Account' : 'Sign In'}
          </button>

          <p className="text-center text-sm text-sage-muted">
            {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button type="button" onClick={() => { setIsRegister(!isRegister); setError(null); }}
              className="text-accent-hover hover:underline cursor-pointer">
              {isRegister ? 'Sign In' : 'Create one'}
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}
