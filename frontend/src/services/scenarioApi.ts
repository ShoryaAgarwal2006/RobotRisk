/**
 * Scenario API Service
 * ROBOTRISK AI — PHASE 5.5C
 * 
 * Client for POST /api/scenario/generate and POST /api/scenario/validate.
 */

import {
  ScenarioGenerateRequest,
  ScenarioGenerateResponse,
  ScenarioValidateRequest,
  ScenarioValidateResponse,
  GeneratedScenario,
  ScenarioValidationResult,
} from '../types/scenario';

const API_BASE = import.meta.env.VITE_API_URL || '';
const REQUEST_TIMEOUT_MS = 15000;

export class ScenarioApiError extends Error {
  public statusCode?: number;
  public details?: any;

  constructor(message: string, statusCode?: number, details?: any) {
    super(message);
    this.name = 'ScenarioApiError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

async function requestWithFallback<T>(path: string, options: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const fetchOptions: RequestInit = {
    ...options,
    signal: controller.signal,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(options.headers || {}),
    },
  };

  const primaryUrl = `${API_BASE}${path}`;
  try {
    let res = await fetch(primaryUrl, fetchOptions).catch(async (primaryErr) => {
      // If relative URL failed and API_BASE is empty, try direct backend on port 8000
      if (!API_BASE) {
        return await fetch(`http://127.0.0.1:8000${path}`, fetchOptions);
      }
      throw primaryErr;
    });

    clearTimeout(timer);

    if (!res.ok) {
      let errorBody: any = null;
      try {
        errorBody = await res.json();
      } catch {
        errorBody = await res.text();
      }

      let errorMsg = `API request failed with status ${res.status}`;
      if (errorBody && typeof errorBody === 'object') {
        if (typeof errorBody.detail === 'string') {
          errorMsg = errorBody.detail;
        } else if (Array.isArray(errorBody.detail)) {
          errorMsg = errorBody.detail.map((d: any) => d.msg || JSON.stringify(d)).join('; ');
        } else if (errorBody.message) {
          errorMsg = errorBody.message;
        }
      } else if (typeof errorBody === 'string' && errorBody) {
        errorMsg = errorBody;
      }

      throw new ScenarioApiError(errorMsg, res.status, errorBody);
    }

    return (await res.json()) as T;
  } catch (err: any) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new ScenarioApiError(
        `Scenario generation timed out after ${REQUEST_TIMEOUT_MS / 1000}s. Please check backend load or retry.`,
        408
      );
    }
    if (err instanceof ScenarioApiError) {
      throw err;
    }
    throw new ScenarioApiError(
      `Unable to reach scenario service: ${err.message || 'Network error'}. Ensure FastAPI backend is running.`,
      0
    );
  }
}

export async function generateScenario(
  request: ScenarioGenerateRequest
): Promise<ScenarioGenerateResponse> {
  return requestWithFallback<ScenarioGenerateResponse>('/api/scenario/generate', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export async function validateScenario(
  scenario: GeneratedScenario
): Promise<ScenarioValidationResult> {
  const payload: ScenarioValidateRequest = { scenario };
  const response = await requestWithFallback<ScenarioValidateResponse>('/api/scenario/validate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return response.validation;
}
