import { useState, useEffect, createContext, useContext } from 'react';
import { api, setTokens, clearTokens, getAccessToken } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getAccessToken();
    if (token) {
      api.me()
        .then(res => setUser(res.data.user))
        .catch(() => { clearTokens(); setUser(null); })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (username, password) => {
    const { data } = await api.login({ username, password });
    setTokens(data.accessToken, data.refreshToken);
    setUser(data.user);
    return data;
  };

  const register = async (username, email, password) => {
    const { data } = await api.register({ username, email, password });
    setTokens(data.accessToken, data.refreshToken);
    setUser(data.user);
    return data;
  };

  const logout = async () => {
    try { await api.logout(); } catch { /* ignore */ }
    clearTokens();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
