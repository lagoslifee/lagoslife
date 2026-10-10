import type { PlayerSettings } from "@lagos-living/shared";
import { apiUrl } from "./auth-client";

export type CatalogItem = { id: string; name: string; description: string; category: string; price: number; vendorId: string | null };
export type InventoryItem = { itemId: string; name: string; category: string; quantity: number };
export type Transaction = { id: string; kind: string; amount: number; balanceAfter: number; reference: string; createdAt: string };
export type ActiveJob = {
  id: string;
  jobType: string;
  status: string;
  reward: number;
  pickupX: number;
  pickupZ: number;
  destinationX: number;
  destinationZ: number;
  destinationLabel: string | null;
  startedAt: string;
};
export type EconomyState = {
  balance: number;
  catalog: CatalogItem[];
  inventory: InventoryItem[];
  transactions: Transaction[];
  activeJob: ActiveJob | null;
  completedJobs: number;
  progress: Record<string, string>;
  needs: { hunger: number; energy: number };
  homePropertyId: string | null;
};
export type PropertyListing = {
  id: string;
  name: string;
  district: string;
  addressLabel: string;
  street: string | null;
  description: string | null;
  listingType: "rental" | "sale" | "rental_or_sale";
  purchasePrice: number;
  rent: number;
  deposit: number;
  depositPaid: number;
  upfrontRent: number;
  intervalDays: number;
  graceDays: number;
  storageSlots: number;
  tenureType: "owned" | "rented" | null;
  isMine: boolean;
  available: boolean;
  nextPaymentAt: string | null;
  accessEndsAt: string | null;
  hasGuestAccess: boolean;
  door: [number, number];
  isHome: boolean;
  overdue: boolean;
};
export type InteriorState = {
  id: string;
  name: string;
  storageSlots: number;
  tenureType: string | null;
  nextPaymentAt: string | null;
  furniture: Array<{ id: string; itemId: string; name: string; gridX: number; gridZ: number; rotation: number }>;
  availableFurniture: Array<{ itemId: string; name: string; available: number }>;
  carried: Array<{ itemId: string; name: string; category: string; available: number }>;
  storage: Array<{ itemId: string; name: string; quantity: number }>;
  home: { hunger: number; energy: number; cleanliness: number };
};

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      credentials: "include",
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError("The server could not be reached. Check your connection and try again.", 0);
  }
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new ApiError(body.error ?? `Request failed (${response.status})`, response.status);
  return body as T;
}

const post = <T>(path: string, body: unknown = {}) => request<T>(path, { method: "POST", body: JSON.stringify(body) });

export const api = {
  economy: () => request<EconomyState>("/api/economy"),
  properties: () => request<PropertyListing[]>("/api/properties"),
  interior: (id: string) => request<InteriorState>(`/api/properties/${id}/interior`),
  purchase: (itemId: string) => post<{ balance: number; replayed: boolean }>("/api/shop/purchase", { itemId, idempotencyKey: crypto.randomUUID() }),
  eat: (itemId: string) => post<{ name: string; needs: { hunger: number; energy: number } }>("/api/food/eat", { itemId }),
  sleep: () => post<{ hunger: number; energy: number }>("/api/needs/sleep"),
  startDelivery: () => post<ActiveJob & { resumed: boolean }>("/api/jobs/delivery/start"),
  completeDelivery: (jobId: string) => post<{ balance: number; reward: number; replayed: boolean }>("/api/jobs/delivery/complete", { jobId }),
  cancelDelivery: () => post<{ cancelled: boolean }>("/api/jobs/delivery/cancel"),
  acquire: (propertyId: string, tenure: "owned" | "rented") => post<{ balance: number }>("/api/properties/acquire", { propertyId, tenure, idempotencyKey: crypto.randomUUID() }),
  renew: (propertyId: string) => post<{ balance: number }>(`/api/properties/${propertyId}/renew`, { idempotencyKey: crypto.randomUUID() }),
  cancelTenancy: (propertyId: string) => post<{ cancelled: boolean; refunded: number }>(`/api/properties/${propertyId}/cancel`, { idempotencyKey: crypto.randomUUID() }),
  setHome: (propertyId: string) => post<{ homePropertyId: string }>(`/api/properties/${propertyId}/home`),
  placeFurniture: (propertyId: string, itemId: string, gridX: number, gridZ: number, rotation: 0 | 90 | 180 | 270) =>
    post<{ id: string }>(`/api/properties/${propertyId}/furniture`, { itemId, gridX, gridZ, rotation, idempotencyKey: crypto.randomUUID() }),
  removeFurniture: (propertyId: string, placementId: string) => post(`/api/properties/${propertyId}/furniture/remove`, { placementId }),
  storage: (propertyId: string, itemId: string, direction: "store" | "retrieve") => post(`/api/properties/${propertyId}/storage`, { itemId, direction }),
  homeAction: (propertyId: string, action: "sleep" | "cook" | "clean") => post(`/api/properties/${propertyId}/action`, { action }),
  settings: () => request<PlayerSettings>("/api/settings"),
  saveSettings: (settings: PlayerSettings) => request<PlayerSettings>("/api/settings", { method: "PUT", body: JSON.stringify(settings) }),
  resetProgress: () => post<{ reset: boolean }>("/api/dev/reset-progress"),
};

export const naira = (value: number) => `₦${Math.round(value).toLocaleString("en-NG")}`;
