const API = import.meta.env.VITE_API_URL;
const APP = import.meta.env.VITE_APP_ID;

const TOKEN_KEY = 'warmpath.token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

/** Thrown for any non-2xx so callers can branch on `status` (notably 402). */
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error ?? `request failed (${status})`);
    this.status = status;
    this.body = body;
  }
}

async function request(path, { method = 'POST', body, auth = true } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(auth && getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = JSON.parse(await res.text());
  } catch {
    /* empty body */
  }
  if (!res.ok) throw new ApiError(res.status, json);
  return json;
}

const fn = (name, body, method = 'POST') => request(`/v1/${APP}/fn/${name}`, { method, body });

export const auth = {
  signup: (email, password) => request(`/auth/${APP}/signup`, { body: { email, password }, auth: false }),
  login: async (email, password) => {
    const r = await request(`/auth/${APP}/login`, { body: { email, password }, auth: false });
    setToken(r.access_token);
    return r;
  },
  logout: clearToken,
};

export const me = () => fn('me', null, 'GET');
export const setIdentity = (personId) => fn('me', { personId });
export const search = (question) => fn('search', { question });
export const explain = (searchId) => fn('explain', { searchId });

export const intros = {
  list: () => fn('intro', null, 'GET'),
  create: (expertPersonId, path, note) => fn('intro', { action: 'create', expertPersonId, path, note }),
  respond: (id, decision, skill) => fn('intro', { action: 'respond', id, decision, skill }),
  contact: (id) => fn('intro', { action: 'contact', id }),
};

export const billing = {
  status: () => fn('billing', null, 'GET'),
  checkout: () => fn('billing', { action: 'checkout' }),
  confirm: (sessionId) => fn('billing', { action: 'confirm', sessionId }),
};
