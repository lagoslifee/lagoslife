import type { Citation, CommunityStatus, ModerationActionKind, OwnedVehicle, PlayerSettings, ReportReason, SafetyStatus, StaffRole } from "@lagos-living/shared";
import { apiUrl, authHeaders } from "./auth-client";

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
  /** The mapped building whose door and board this unit shares. */
  placeId: string | null;
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

export type MyVehicle = OwnedVehicle & {
  modelName: string;
  insured: boolean;
  premium: number;
  serviceDue: boolean;
  serviceQuote: { repair: number; fullRepair: number; total: number };
};
type VehicleResult = { vehicle: MyVehicle; balance?: number; replayed?: boolean; charged?: number };

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
      headers: { "content-type": "application/json", ...authHeaders(), ...(init?.headers ?? {}) },
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
  vehicles: () => request<MyVehicle[]>("/api/vehicles"),
  buyVehicle: (modelId: string, colour: string, idempotencyKey: string) =>
    post<VehicleResult>("/api/vehicles/purchase", { modelId, colour, idempotencyKey }),
  serviceVehicle: (id: string) => post<VehicleResult>(`/api/vehicles/${id}/service`, { idempotencyKey: crypto.randomUUID() }),
  insureVehicle: (id: string) => post<VehicleResult>(`/api/vehicles/${id}/insure`, { idempotencyKey: crypto.randomUUID() }),
  towVehicle: (id: string) => post<VehicleResult>(`/api/vehicles/${id}/tow`, { idempotencyKey: crypto.randomUUID() }),
  garageVehicle: (id: string, propertyId: string) =>
    post<VehicleResult>(`/api/vehicles/${id}/garage`, { propertyId, idempotencyKey: crypto.randomUUID() }),
  retrieveVehicle: (id: string) => post<VehicleResult>(`/api/vehicles/${id}/retrieve`),
  community: () => request<CommunityStatus>("/api/community"),
  visitQuietPlace: (placeId: string) => post<QuietVisitResult>("/api/community/visit", { placeId }),
  volunteer: (placeId: string) => post<VolunteerResult>("/api/community/volunteer", { placeId }),
  standing: () => request<{ suspension: Suspension | null }>("/api/account/standing"),
  safety: () => request<SafetyStatus>("/api/safety"),
  block: (userName: string) => post<SafetyStatus>("/api/safety/block", { userName }),
  unblock: (userName: string) => post<SafetyStatus>("/api/safety/unblock", { userName }),
  report: (input: { userName: string; reason: ReportReason; details: string; chatMessageId?: string }) =>
    post<{ reportId: string | null; alreadyOpen: boolean; reported: string }>("/api/safety/report", input),
  acknowledgeWarnings: () => post<SafetyStatus>("/api/safety/warnings/acknowledge"),
  citations: () => request<Citation[]>("/api/justice"),
  payCitation: (id: string) => post<{ citation: Citation; balance: number; replayed: boolean }>(`/api/justice/${id}/pay`, { idempotencyKey: crypto.randomUUID() }),
  appealCitation: (id: string, statement: string) => post<Citation>(`/api/justice/${id}/appeal`, { statement }),
  becomeStaff: (role: StaffRole | null) => post<{ role: StaffRole | null }>("/api/dev/staff", { role }),
  devCitation: () => post<Citation | null>("/api/dev/citation"),
};

export type Suspension = { reason: string; until: string | null };

export type ModReport = {
  id: string;
  reason: ReportReason;
  details: string;
  status: string;
  createdAt: string;
  resolutionNote: string | null;
  reportedId: string;
  reportedName: string;
  reporterName: string;
  messageShown: string | null;
  messageOriginal: string | null;
  messageAt: string | null;
  openAgainst: number;
};
export type ResidentRecord = {
  id: string;
  name: string;
  role: StaffRole | null;
  chat: Array<{ id: string; body: string; shown: string; filtered: boolean; location: string; at: string }>;
  reports: Array<{ id: string; reason: string; details: string; status: string; createdAt: string }>;
  sanctions: Array<{ id: string; kind: string; reason: string; createdAt: string; endsAt: string | null; liftedAt: string | null; active: boolean }>;
  history: Array<{ id: string; actorName: string; action: string; reason: string; createdAt: string }>;
};
export type AuditEntry = { id: string; actorName: string; targetName: string | null; action: string; reason: string; details: Record<string, unknown>; createdAt: string };
export type Appeal = Citation & { userId: string; userName: string };
export type StaffOverview = {
  openReports: number;
  pendingAppeals: number;
  activeSuspensions: number;
  activeMutes: number;
  chatLast24h: number;
  staff: Array<{ userId: string; userName: string; role: StaffRole; grantedAt: string }>;
};

export const modApi = {
  overview: () => request<StaffOverview>("/api/mod/overview"),
  reports: (status: "open" | "actioned" | "dismissed" = "open") => request<ModReport[]>(`/api/mod/reports?status=${status}`),
  resolveReport: (id: string, resolution: "actioned" | "dismissed", note: string) => post(`/api/mod/reports/${id}/resolve`, { resolution, note }),
  resident: (userId: string) => request<ResidentRecord>(`/api/mod/residents/${encodeURIComponent(userId)}`),
  findResident: (name: string) => request<ResidentRecord>(`/api/mod/residents?name=${encodeURIComponent(name)}`),
  act: (input: { targetUserId: string; action: ModerationActionKind; reason: string; durationHours?: number; reportId?: string }) =>
    post<{ action: string; endsAt: string | null }>("/api/mod/actions", input),
  appeals: () => request<Appeal[]>("/api/mod/appeals"),
  decideAppeal: (id: string, outcome: "upheld" | "overturned", note: string) => post<Citation>(`/api/mod/appeals/${id}/decide`, { outcome, note }),
  citationHistory: (id: string) => request<Array<{ event: string; actorName: string; note: string | null; createdAt: string }>>(`/api/mod/citations/${id}/history`),
  audit: () => request<AuditEntry[]>("/api/mod/audit?limit=200"),
  setRole: (userName: string, role: StaffRole | null, reason: string) => post("/api/admin/roles", { userName, role, reason }),
};

type Needs = { hunger: number; energy: number };
export type QuietVisitResult = { rested: boolean; energyGain: number; needs: Needs; status: CommunityStatus };
export type VolunteerResult = { replayed: boolean; wage: number; balance: number; needs: Needs; status: CommunityStatus };

export const naira = (value: number) => `₦${Math.round(value).toLocaleString("en-NG")}`;
