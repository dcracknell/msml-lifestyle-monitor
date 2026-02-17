import { API_BASE_URL } from '../config/env';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export class ApiError extends Error {
  status?: number;
  data?: unknown;
  isNetworkError: boolean;

  constructor(message: string, options: { status?: number; data?: unknown; isNetworkError?: boolean } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = options.status;
    this.data = options.data;
    this.isNetworkError = Boolean(options.isNetworkError);
  }
}

export type RequestConfig = Omit<RequestInit, 'body'> & {
  method?: HttpMethod;
  authToken?: string | null;
  body?: BodyInit | Record<string, unknown> | null;
};

class ApiClient {
  private baseUrl: string;

  private token: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  setAuthToken(token: string | null) {
    this.token = token;
  }

  setBaseUrl(url: string) {
    this.baseUrl = url.replace(/\/$/, '');
  }

  private buildUrl(path: string) {
    if (/^https?:/i.test(path)) {
      return path;
    }
    const normalized = path.startsWith('/') ? path : `/${path}`;
    return `${this.baseUrl}${normalized}`;
  }

  async request<T = unknown>(path: string, config: RequestConfig = {}): Promise<T> {
    const url = this.buildUrl(path);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...((config.headers as Record<string, string>) || {}),
    };

    const method = config.method || 'GET';
    let body: BodyInit | undefined;

    if (config.body && typeof config.body === 'object' && !(config.body instanceof FormData)) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      body = JSON.stringify(config.body);
    } else if (config.body) {
      body = config.body as BodyInit;
    }

    const token = config.authToken ?? this.token;
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, {
        method,
        ...config,
        headers,
        body,
      });

      if (!response.ok) {
        let errorPayload: unknown = null;
        try {
          errorPayload = await response.json();
        } catch (error) {
          // ignore non-json errors
        }
        const message =
          (errorPayload && typeof errorPayload === 'object' && 'message' in errorPayload
            ? String((errorPayload as Record<string, unknown>).message)
            : null) || response.statusText || 'Request failed';
        throw new ApiError(message, { status: response.status, data: errorPayload });
      }

      if (response.status === 204) {
        return undefined as T;
      }

      const text = await response.text();
      if (!text) {
        return undefined as T;
      }
      try {
        return JSON.parse(text) as T;
      } catch (error) {
        return text as unknown as T;
      }
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError('Network request failed', { isNetworkError: true });
    }
  }

  get<T = unknown>(path: string, config?: RequestConfig) {
    return this.request<T>(path, { ...config, method: 'GET' });
  }

  post<T = unknown>(path: string, body?: RequestConfig['body'], config?: RequestConfig) {
    return this.request<T>(path, { ...config, method: 'POST', body });
  }

  put<T = unknown>(path: string, body?: RequestConfig['body'], config?: RequestConfig) {
    return this.request<T>(path, { ...config, method: 'PUT', body });
  }

  delete<T = unknown>(path: string, config?: RequestConfig) {
    return this.request<T>(path, { ...config, method: 'DELETE' });
  }
}

const apiClient = new ApiClient(API_BASE_URL);

export default apiClient;
