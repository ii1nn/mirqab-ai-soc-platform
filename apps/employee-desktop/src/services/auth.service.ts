import { apiClient } from './api-client';

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'ADMIN' | 'SECURITY_ANALYST' | 'IT_TECHNICIAN' | 'EMPLOYEE';
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export const authService = {
  async login(email: string, password: string): Promise<AuthTokens> {
    const { data } = await apiClient.post<AuthTokens>('/auth/login', { email, password });
    return data;
  },

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const { data } = await apiClient.post<AuthTokens>('/auth/refresh', { refreshToken });
    return data;
  },

  async logout(refreshToken: string): Promise<void> {
    await apiClient.post('/auth/logout', { refreshToken });
  },

  async me(): Promise<AuthUser> {
    const { data } = await apiClient.get<AuthUser>('/auth/me');
    return data;
  },
};
