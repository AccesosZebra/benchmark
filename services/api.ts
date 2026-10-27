// Cliente HTTP de la API propia (/api): adjunta la sesión firmada y maneja la expiración.
import { getSession, clearSession } from './auth';

export const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const token = getSession()?.token;
  const r = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) {
    // Sesión vencida o inválida: se vuelve a la pantalla de acceso.
    clearSession();
    window.location.reload();
  }
  if (!r.ok) throw new Error((data as any).error || `Error ${r.status} del servidor`);
  return data as T;
};
