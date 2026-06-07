import { z } from 'zod';
import {
  DevicePairResultSchema,
  DeviceSelfSchema,
  type DevicePairResult,
  type DeviceSelf,
} from '@practiceroom/shared';

const TOKEN_KEY = 'pr_device_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...init,
  });

  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message =
      data && typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `Er ging iets mis (${res.status})`;
    throw new ApiError(res.status, message);
  }

  return schema.parse(data);
}

export const cameraApi = {
  pair: (pairingCode: string): Promise<DevicePairResult> =>
    request('/api/devices/pair', DevicePairResultSchema, {
      method: 'POST',
      body: JSON.stringify({ pairingCode }),
    }),
  me: (): Promise<DeviceSelf> => request('/api/devices/me', DeviceSelfSchema),
};
