// Administración de claves de Claude e invitados (solo personal interno).
// Las claves nunca vuelven completas del servidor: solo una pista (sk-ant-…a1b2).
import { request } from './api';

export interface ApiKeyInfo {
  id: number;
  label: string;
  hint: string;
  isDefault: boolean;
  active: boolean;
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
  guests: number;
}

export interface GuestInfo {
  email: string;
  apiKeyId: number | null;
  active: boolean;
  createdBy: string;
  createdAt: string;
}

const json = (method: string, body: any): RequestInit => ({ method, body: JSON.stringify(body) });

export const listKeys = (): Promise<ApiKeyInfo[]> => request('/api/admin/keys');

export const addKey = (label: string, key: string): Promise<ApiKeyInfo[]> =>
  request('/api/admin/keys', json('POST', { label, key }));

export const updateKey = (
  id: number,
  patch: Partial<Pick<ApiKeyInfo, 'label' | 'active' | 'isDefault'>>
): Promise<ApiKeyInfo[]> => request(`/api/admin/keys/${id}`, json('PATCH', patch));

// reassignTo: clave a la que pasan sus invitados (null = usan la predeterminada).
export const deleteKey = (id: number, reassignTo: number | null): Promise<ApiKeyInfo[]> =>
  request(`/api/admin/keys/${id}${reassignTo ? `?reassignTo=${reassignTo}` : ''}`, { method: 'DELETE' });

export const listGuests = (): Promise<GuestInfo[]> => request('/api/admin/guests');

export const addGuest = (email: string, password: string, apiKeyId: number | null): Promise<{ ok: boolean }> =>
  request('/api/admin/guests', json('POST', { email, password, apiKeyId }));

export const updateGuest = (
  email: string,
  patch: { apiKeyId?: number | null; active?: boolean; password?: string }
): Promise<{ ok: boolean }> => request(`/api/admin/guests/${encodeURIComponent(email)}`, json('PATCH', patch));

export const deleteGuest = (email: string): Promise<{ ok: boolean }> =>
  request(`/api/admin/guests/${encodeURIComponent(email)}`, { method: 'DELETE' });
