import { api } from '../lib/api';
import type { AuthResponse, User } from '../lib/types';

export interface RegisterBody {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
}

export interface LoginBody {
  email: string;
  password: string;
}

export const authApi = {
  register: (body: RegisterBody) => api<AuthResponse>('/auth/register', { method: 'POST', json: body }),
  login: (body: LoginBody) => api<AuthResponse>('/auth/login', { method: 'POST', json: body }),
  me: () => api<{ user: User }>('/auth/me'),
};
