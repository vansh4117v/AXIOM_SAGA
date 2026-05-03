import axios from 'axios';

const GATEWAY = import.meta.env.VITE_GATEWAY_URL || 'https://sage-gateway-1508.azurewebsites.net';
const AI_ENGINE = import.meta.env.VITE_AI_ENGINE_URL || 'https://sage-agent-1508.azurewebsites.net';

// ─── Auth state ─────────────────────────────────────────────
let accessToken = localStorage.getItem('sage_access_token');
let refreshToken = localStorage.getItem('sage_refresh_token');

export function setTokens(access, refresh) {
  accessToken = access;
  refreshToken = refresh;
  if (access) localStorage.setItem('sage_access_token', access);
  else localStorage.removeItem('sage_access_token');
  if (refresh) localStorage.setItem('sage_refresh_token', refresh);
  else localStorage.removeItem('sage_refresh_token');
}

export function getAccessToken() { return accessToken; }
export function clearTokens() { setTokens(null, null); }

// ─── Axios instances ────────────────────────────────────────
const gateway = axios.create({ baseURL: GATEWAY, timeout: 15000 });
const engine = axios.create({ baseURL: AI_ENGINE, timeout: 30000 });

// Attach JWT to gateway requests
gateway.interceptors.request.use(config => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

// Auto-refresh on 401
gateway.interceptors.response.use(
  res => res,
  async err => {
    const original = err.config;
    if (err.response?.status === 401 && !original._retry && refreshToken) {
      original._retry = true;
      try {
        const { data } = await axios.post(`${GATEWAY}/auth/refresh`, { refreshToken });
        setTokens(data.accessToken, data.refreshToken);
        original.headers.Authorization = `Bearer ${data.accessToken}`;
        return gateway(original);
      } catch {
        clearTokens();
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

// ─── API methods ────────────────────────────────────────────
export const api = {
  // Auth (gateway)
  register: (data) => gateway.post('/auth/register', data),
  login: (data) => gateway.post('/auth/login', data),
  logout: () => gateway.post('/auth/logout', { refreshToken }),
  me: () => gateway.get('/auth/me'),
  googleAuthUrl: () => `${GATEWAY}/auth/google`,

  // Tickets (gateway — authed)
  getTickets: (params) => gateway.get('/tickets', { params }),
  getTicket: (key) => gateway.get(`/tickets/${key}`),
  submitTicket: (dto) => gateway.post('/tickets', dto),

  // AI Engine — direct
  analyse: (dto) => engine.post('/analyse', dto),
  health: () => engine.get('/health'),

  // Prompts (gateway — authed)
  getPrompts: () => gateway.get('/prompts'),
  getPrompt: (agent) => gateway.get(`/prompts/${agent}`),
  updatePrompt: (agent, prompt) => gateway.put(`/prompts/${agent}`, { system_prompt: prompt }),

  // Gateway health
  gatewayHealth: () => gateway.get('/health'),

  // SSE base URL for EventSource
  streamUrl: (runId) => `${AI_ENGINE}/stream/${runId}`,
};

export { GATEWAY, AI_ENGINE };
