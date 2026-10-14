
/**
 * @file services/apiClient.ts
 * @description Client API con autenticazione, retry e backoff esponenziale.
 */

export interface ApiClientOptions {
    retries?: number;
    retryDelayMs?: number;
    backoffFactor?: number;
    authStrategy?: 'bearer' | 'none' | ((token: string | null) => HeadersInit);
    tokenProvider?: () => string | null;
}

const defaultTokenProvider = () => (typeof localStorage !== 'undefined' ? localStorage.getItem('authToken') : null);

const resolveAuthHeaders = (strategy: ApiClientOptions['authStrategy'], token: string | null): HeadersInit => {
    if (strategy === 'none') return {};
    if (typeof strategy === 'function') return strategy(token);
    return token ? { Authorization: `Bearer ${token}` } : {};
};

/**
 * Funzione fetch potenziata per interagire con le API dell'applicazione.
 */
export const apiFetch = async <T = unknown>(url: string, options: RequestInit = {}, clientOptions: ApiClientOptions = {}): Promise<T> => {
    const {
        retries = 3,
        retryDelayMs = 500,
        backoffFactor = 2,
        authStrategy = 'bearer',
        tokenProvider = defaultTokenProvider,
    } = clientOptions;

    const token = tokenProvider();
    const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...resolveAuthHeaders(authStrategy, token),
        ...options.headers,
    };

    let attempt = 0;
    let delay = retryDelayMs;

    while (true) {
        try {
            const response = await fetch(url, { ...options, headers });

            if (response.status === 204) return null as T;

            if (!response.ok) {
                const errorBody = await response.json().catch(() => ({}));
                const errorMessage = (errorBody as { error?: string }).error || `API request failed: ${response.status}`;
                const error = new Error(errorMessage) as Error & { isClientError?: boolean; status?: number };
                error.status = response.status;

                if (response.status >= 400 && response.status < 500 && response.status !== 429) {
                    error.isClientError = true;
                    throw error;
                }
                throw error;
            }

            return await response.json();
        } catch (error) {
            const typedError = error as Error & { isClientError?: boolean };
            if (typedError.isClientError || attempt >= retries) throw typedError;
            await new Promise(resolve => setTimeout(resolve, delay));
            attempt += 1;
            delay *= backoffFactor;
        }
    }
};
