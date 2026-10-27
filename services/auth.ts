// Autenticación con Google (Google Identity Services), restringida por dominio.
// El navegador obtiene el ID token de Google y el servidor lo valida y devuelve
// una sesión firmada que se manda como Bearer en cada llamada a la API.

export interface AuthSession {
  email: string;
  name: string;
  picture: string;
  exp: number; // epoch en segundos
  provider?: 'google' | 'guest';
  token?: string; // sesión firmada por el servidor (Authorization: Bearer)
}

const SESSION_KEY = 'ZEBRA_AUTH';

// Client ID de Google. En build se deja un placeholder que el docker-entrypoint
// sustituye con GOOGLE_CLIENT_ID del entorno; si no, cae a localStorage.
export const getGoogleClientId = (): string => {
  const fromEnv = process.env.GOOGLE_CLIENT_ID;
  const envId = fromEnv && !fromEnv.includes('__RUNTIME') ? fromEnv : null;
  return (
    envId ||
    (typeof window !== 'undefined' ? localStorage.getItem('GOOGLE_CLIENT_ID') : null) ||
    ''
  );
};

// Dominio permitido (solo para mostrarlo; la validación real ocurre en el servidor).
export const allowedDomain = (): string => 'zebradigital.marketing';

// Llama a un endpoint de login del servidor y devuelve la sesión firmada.
const login = async (path: string, body: any): Promise<AuthSession> => {
  let r: Response;
  try {
    r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error('No pudimos conectar con el servidor. Inténtalo de nuevo.');
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'No se pudo iniciar sesión.');
  return { ...data.session, token: data.token };
};

// Valida el ID token de Google en el servidor (firma, audiencia y dominio).
export const verifyCredential = (credential: string): Promise<AuthSession> =>
  login('/api/auth/google', { credential });

// ---- Acceso como invitado (correo + contraseña, validado en el servidor) ----
export const verifyGuest = (email: string, password: string): Promise<AuthSession> => {
  const e = email.trim().toLowerCase();
  if (!e || !password) return Promise.reject(new Error('Ingresa correo y contraseña.'));
  return login('/api/auth/guest', { email: e, password });
};

export const getSession = (): AuthSession | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as AuthSession;
    // Sesiones previas al backend no traen token: se pide volver a entrar.
    if (!s.token || !s.exp || s.exp * 1000 <= Date.now()) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
};

export const saveSession = (s: AuthSession): void => {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    /* almacenamiento no disponible */
  }
};

export const clearSession = (): void => {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* noop */
  }
};
