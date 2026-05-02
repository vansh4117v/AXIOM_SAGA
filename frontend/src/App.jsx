import { useState } from 'react';
import { AuthProvider, useAuth } from './hooks/useAuth';
import Dashboard from './pages/Dashboard';
import Compare from './pages/Compare';
import Login from './pages/Login';
import PromptStudio from './components/prompts/PromptStudio';
import { Loader } from 'lucide-react';

function AppContent() {
  const { user, loading } = useAuth();
  const [page, setPage] = useState('dashboard');

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-bg-primary">
        <div className="flex flex-col items-center gap-3">
          <Loader size={24} className="animate-spin text-accent" />
          <span className="text-sm text-sage-muted">Loading SAGE...</span>
        </div>
      </div>
    );
  }

  if (!user) return <Login />;

  return (
    <div className="h-screen bg-bg-primary">
      {page === 'dashboard' && <Dashboard onNavigate={setPage} />}
      {page === 'compare' && <Compare onNavigate={setPage} />}
      {page === 'prompts' && <PromptStudio onBack={() => setPage('dashboard')} />}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
