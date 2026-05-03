import axios, {
  AxiosHeaders,
  AxiosInstance,
  AxiosRequestConfig,
  InternalAxiosRequestConfig,
} from 'axios';
import type { ProjectPreviewData } from '../types/project';

export interface ApiMeta {
  requestId?: string;
  timestamp?: string;
  [key: string]: any;
}

export interface ApiEnvelope<T> {
  data: T;
  meta?: ApiMeta;
}

export interface KhaveeClientConfig {
  apiKey?: string;
  jwtToken?: string;
  baseURL?: string;
}

/**
 * Khavee SDK Client for making authenticated requests
 * Supports both API key and JWT authentication
 */
export class KhaveeClient {
  private client: AxiosInstance;
  private apiKey?: string;
  private jwtToken?: string;

  constructor(config: KhaveeClientConfig) {
    const baseURL = config.baseURL || `https://api.platform.khavee.ai/api/v1`;

    this.apiKey = config.apiKey;
    this.jwtToken = config.jwtToken;

    this.client = axios.create({
      baseURL,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add request interceptor to inject auth headers
    this.client.interceptors.request.use(
      (requestConfig: InternalAxiosRequestConfig) => {
      if (this.apiKey) {
        requestConfig.headers = AxiosHeaders.from(requestConfig.headers);
        requestConfig.headers.set('X-API-Key', this.apiKey);
      } else if (this.jwtToken) {
        requestConfig.headers = AxiosHeaders.from(requestConfig.headers);
        requestConfig.headers.set('Authorization', `Bearer ${this.jwtToken}`);
      }

      return requestConfig;
      },
    );
  }

  /**
   * Make a GET request
   */
  async get<T>(url: string, config?: AxiosRequestConfig): Promise<ApiEnvelope<T>> {
    const response = await this.client.get(url, config);
    return response.data.data;
  }

  /**
   * Make a POST request
   */
  async post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<ApiEnvelope<T>> {
    const response = await this.client.post(url, data, config);
    return response.data.data;
  }

  /**
   * Make a PUT request
   */
  async put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<ApiEnvelope<T>> {
    const response = await this.client.put(url, data, config);
    return response.data.data;
  }

  /**
   * Make a DELETE request
   */
  async delete<T>(url: string, config?: AxiosRequestConfig): Promise<ApiEnvelope<T>> {
    const response = await this.client.delete(url, config);
    return response.data.data;
  }

  /**
   * Fetch the current project's full preview payload using the API key context.
   * This is the same project data used by the web preview page: project metadata,
   * models, personalities, voice profiles, and signed asset URLs.
   */
  async getProjectPreview(): Promise<ApiEnvelope<ProjectPreviewData>> {
    return await this.get<ProjectPreviewData>('/projects/sdk/preview');
  }

  /**
   * Fetch a project by id when you are using JWT auth or explicit project scoping.
   */
  async getProjectById(projectId: string): Promise<ApiEnvelope<ProjectPreviewData>> {
    return await this.get<ProjectPreviewData>(`/projects/${projectId}`);
  }

  /**
   * Get the underlying axios instance for advanced usage
   */
  getAxiosInstance(): AxiosInstance {
    return this.client;
  }

  /**
   * Update the API key
   */
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }

  /**
   * Update the JWT token
   */
  setJwtToken(jwtToken: string): void {
    this.jwtToken = jwtToken;
  }
}

/**
 * Create a new Khavee client instance
 */
export function createKhaveeClient(config: KhaveeClientConfig): KhaveeClient {
  return new KhaveeClient(config);
}
