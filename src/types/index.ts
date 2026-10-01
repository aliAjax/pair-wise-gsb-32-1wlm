export type CurrencyCode = 'CNY' | 'USD' | 'EUR' | 'JPY';
export interface PersistedPayload<T> { version: string; data: T; updatedAt: string }

