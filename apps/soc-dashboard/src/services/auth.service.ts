import { apiClient } from './api-client';

export type UserRole = 'ADMIN' | 'SECURITY_ANALYST' | 'IT_TECHNICIAN' | 'EMPLOYEE';

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  isActive: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface SignupInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export interface ForgotPasswordResponse {
  message: string;
}

export const authService = {
  async login(email: string, password: string): Promise<AuthTokens> {
    const { data } = await apiClient.post<AuthTokens>('/auth/login', { email, password });
    return data;
  },

  /** No longer auto-signs the account in — new self-signups require admin approval before login. */
  async signup(input: SignupInput): Promise<{ message: string }> {
    const { data } = await apiClient.post<{ message: string }>('/auth/signup', input);
    return data;
  },

  async forgotPassword(email: string): Promise<ForgotPasswordResponse> {
    const { data } = await apiClient.post<ForgotPasswordResponse>('/auth/forgot-password', {
      email,
    });
    return data;
  },

  async resetPassword(
    token: string,
    newPassword: string,
    confirmPassword: string,
  ): Promise<{ message: string }> {
    const { data } = await apiClient.post<{ message: string }>('/auth/reset-password', {
      token,
      newPassword,
      confirmPassword,
    });
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
