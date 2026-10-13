import type { CabinClass, CharacterAppearance, OutfitId, HotelBookingState, RoomType, TicketState, TravelStatus, VisaPlan, VisaState } from "@lagos-living/shared";
import type { BottleItem, Citation, PoliceCase, StreetIncident, RobberyRecord, SecurityPlanId, SecurityStatus, ClubMenuItem, ClubStatus, ClubTable, HouseDesign, CommunityStatus, ModerationActionKind, OwnedVehicle, PlayerSettings, ReportReason, SafetyStatus, StaffRole } from "@lagos-living/shared";
import type { BusinessStatus, BusinessTypeId, CourseId, ExerciseId, GymStatus, RestResult, ViewingStatus } from "@lagos-living/shared";
import type { FloorFinishId, FoodParcel, HomeFinish, HomeStaffRole, HomeStaffState, HomeTier } from "@lagos-living/shared";
import type { ActiveGig, BettingStatus, DailyStatus, GigStatus, MarketStatus, Pick, RepairAction } from "@lagos-living/shared";
import type { AccountSummary, ClaimAccount, LifeGoals } from "@lagos-living/shared";
import type { DirectMessage, FriendsStatus, RankingBoard, RankingState, ReferralStatus } from "@lagos-living/shared";
import type { ClubSong } from "@lagos-living/shared";
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
  listingType: "rental" | "sale" | "rental_or_sale" | "built";
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
  /** True unless you already hold this home: every resident can have their own copy of a mapped listing. */
  available: boolean;
  /** The mapped listing; differs from `id` when `id` is your private copy of it. */
  listingId: string;
  /** Residents holding this listing or a copy of it, you included. */
  residents: number;
  nextPaymentAt: string | null;
  accessEndsAt: string | null;
  hasGuestAccess: boolean;
  door: [number, number];
  /** The mapped building whose door and board this unit shares. */
  placeId: string | null;
  isHome: boolean;
  overdue: boolean;
};
export type PlotState = {
  id: string;
  status: "available" | "mine" | "taken";
  /** Gateman and house guard on duty at a built house, visible to everyone. */
  staff?: HomeStaffRole[];
  tenureType: "leased" | "owned" | null;
  nextPaymentAt: string | null;
  accessEndsAt: string | null;
  overdue: boolean;
  construction: null | {
    designId: HouseDesign["id"];
    stagesPaid: number;
    stageStartedAt: string;
    stageReadyAt: string;
    completed: boolean;
    homeId: string | null;
    /** Outside paint the owner chose (see EXTERIOR_PAINTS). */
    exterior?: string | null;
  };
  /** A business trading from a shopfront on this plot. */
  business?: null | { type: BusinessTypeId; name: string };
};
export type InteriorState = {
  id: string;
  name: string;
  storageSlots: number;
  tier?: HomeTier;
  finish?: HomeFinish;
  tenureType: string | null;
  nextPaymentAt: string | null;
  /** `x`/`z`: room-local metres from the middle of the room. */
  furniture: Array<{ id: string; itemId: string; name: string; gridX: number; gridZ: number; rotation: number; x: number; z: number; level?: number | null }>;
  access: { owner: boolean; guest: boolean };
  guests: string[];
  availableFurniture: Array<{ itemId: string; name: string; available: number }>;
  carried: Array<{ itemId: string; name: string; category: string; available: number }>;
  storage: Array<{ itemId: string; name: string; quantity: number }>;
  staff?: HomeStaffState;
  partyUntil?: string | null;
  home: { hunger: number; energy: number; cleanliness: number };
};

export type MyVehicle = OwnedVehicle & {
  modelName: string;
  insured: boolean;
  premium: number;
  serviceDue: boolean;
  serviceQuote: { repair: number; fullRepair: number; total: number; dents: number; dentRepair: number };
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
  gym: () => request<GymStatus>("/api/gym"),
  gymJoin: () => post<{ balance: number }>("/api/gym/join", { idempotencyKey: crypto.randomUUID() }),
  gymSet: (exercise: ExerciseId, kg?: number) => post<{ exercise: ExerciseId; kg: number | null; endsAt: string; name: string }>("/api/gym/set", kg ? { exercise, kg } : { exercise }),
  gymFinish: () => post<{ counted: true; fitness: number; energy: number; kg: number | null; coached: boolean } | { counted: false; reason: string }>("/api/gym/finish", {}),
  gymTrainer: () => post<{ charged: boolean; balance: number; trainerUntil: string }>("/api/gym/trainer", { idempotencyKey: crypto.randomUUID() }),
  business: () => request<BusinessStatus>("/api/business"),
  startBusiness: (type: BusinessTypeId, name: string, plotId?: string) => post<{ balance: number }>("/api/business", { type, name, plotId, idempotencyKey: crypto.randomUUID() }),
  upgradeBusiness: (businessId: string) => post<{ balance: number }>(`/api/business/${businessId}/upgrade`, { idempotencyKey: crypto.randomUUID() }),
  collectBusiness: (businessId: string) => post<{ collected: number; balance: number }>(`/api/business/${businessId}/collect`),
  enrol: (course: CourseId) => post<{ balance: number }>("/api/school/enrol", { course, idempotencyKey: crypto.randomUUID() }),
  purchase: (itemId: string) => post<{ balance: number; replayed: boolean }>("/api/shop/purchase", { itemId, idempotencyKey: crypto.randomUUID() }),
  eat: (itemId: string) => post<{ name: string; needs: { hunger: number; energy: number } }>("/api/food/eat", { itemId }),
  sleep: () => post<{ hunger: number; energy: number }>("/api/needs/sleep"),
  rest: () => post<{ started: boolean }>("/api/needs/rest"),
  restFinish: () => post<RestResult>("/api/needs/rest/finish"),
  wardrobe: () => request<{ outfits: OutfitId[] }>("/api/wardrobe"),
  saveAppearance: (appearance: CharacterAppearance) => request<{ appearance: CharacterAppearance }>("/api/character", { method: "PUT", body: JSON.stringify({ appearance }) }),
  startDelivery: () => post<ActiveJob & { resumed: boolean }>("/api/jobs/delivery/start"),
  completeDelivery: (jobId: string) => post<{ balance: number; reward: number; replayed: boolean }>("/api/jobs/delivery/complete", { jobId }),
  cancelDelivery: () => post<{ cancelled: boolean }>("/api/jobs/delivery/cancel"),
  plots: () => request<PlotState[]>("/api/plots"),
  acquirePlot: (plotId: string, tenure: "leased" | "owned", viaAgent = false) => post<{ balance: number }>(`/api/plots/${plotId}/acquire`, { tenure, viaAgent, idempotencyKey: crypto.randomUUID() }),
  renewPlot: (plotId: string) => post<{ balance: number }>(`/api/plots/${plotId}/renew`, { idempotencyKey: crypto.randomUUID() }),
  startBuilding: (plotId: string, designId: HouseDesign["id"]) => post<{ balance: number }>(`/api/plots/${plotId}/build`, { designId, idempotencyKey: crypto.randomUUID() }),
  buyReadyBuilt: (plotId: string, designId: HouseDesign["id"], viaAgent = false) =>
    post<{ balance: number; homeId: string }>(`/api/plots/${plotId}/buy-built`, { designId, viaAgent, idempotencyKey: crypto.randomUUID() }),
  payNextStage: (plotId: string) => post<{ balance: number }>(`/api/plots/${plotId}/next-stage`, { idempotencyKey: crypto.randomUUID() }),
  acquire: (propertyId: string, tenure: "owned" | "rented", viaAgent = false) =>
    post<{ balance: number }>("/api/properties/acquire", { propertyId, tenure, viaAgent, idempotencyKey: crypto.randomUUID() }),
  renew: (propertyId: string) => post<{ balance: number }>(`/api/properties/${propertyId}/renew`, { idempotencyKey: crypto.randomUUID() }),
  cancelTenancy: (propertyId: string) => post<{ cancelled: boolean; refunded: number }>(`/api/properties/${propertyId}/cancel`, { idempotencyKey: crypto.randomUUID() }),
  setHome: (propertyId: string) => post<{ homePropertyId: string }>(`/api/properties/${propertyId}/home`),
  placeFurniture: (propertyId: string, itemId: string, gridX: number, gridZ: number, rotation: 0 | 90 | 180 | 270) =>
    post<{ id: string }>(`/api/properties/${propertyId}/furniture`, { itemId, gridX, gridZ, rotation, idempotencyKey: crypto.randomUUID() }),
  placeFurnitureAt: (propertyId: string, itemId: string, x: number, z: number, rotation: 0 | 90 | 180 | 270, level: 0 | 1 = 0) =>
    post<{ id: string }>(`/api/properties/${propertyId}/furniture`, { itemId, x, z, rotation, level, idempotencyKey: crypto.randomUUID() }),
  /** `level` left out keeps the piece on the storey it is on. */
  moveFurniture: (propertyId: string, placementId: string, x: number, z: number, rotation: 0 | 90 | 180 | 270, level?: 0 | 1) =>
    post<{ id: string }>(`/api/properties/${propertyId}/furniture/move`, { placementId, x, z, rotation, level }),
  inviteGuest: (propertyId: string, username: string) => post<{ invited: boolean }>(`/api/properties/${propertyId}/guests`, { username }),
  removeGuest: (propertyId: string, username: string) => post<{ removed: boolean }>(`/api/properties/${propertyId}/guests/remove`, { username }),
  setFinish: (propertyId: string, parts: { style?: string; floor?: FloorFinishId; exterior?: string }) =>
    post<{ balance: number; cost: number; finish: HomeFinish }>(`/api/properties/${propertyId}/finish`, { ...parts, idempotencyKey: crypto.randomUUID() }),
  removeFurniture: (propertyId: string, placementId: string) => post(`/api/properties/${propertyId}/furniture/remove`, { placementId }),
  storage: (propertyId: string, itemId: string, direction: "store" | "retrieve") => post(`/api/properties/${propertyId}/storage`, { itemId, direction }),
  homeAction: (propertyId: string, action: "sleep" | "cook" | "clean" | "tv") => post(`/api/properties/${propertyId}/action`, { action }),
  settings: () => request<PlayerSettings>("/api/settings"),
  saveSettings: (settings: PlayerSettings) => request<PlayerSettings>("/api/settings", { method: "PUT", body: JSON.stringify(settings) }),
  resetProgress: () => post<{ reset: boolean }>("/api/dev/reset-progress"),
  vehicles: () => request<MyVehicle[]>("/api/vehicles"),
  buyVehicle: (modelId: string, colour: string, idempotencyKey: string) =>
    post<VehicleResult>("/api/vehicles/purchase", { modelId, colour, idempotencyKey }),
  serviceVehicle: (id: string) => post<VehicleResult>(`/api/vehicles/${id}/service`, { idempotencyKey: crypto.randomUUID() }),
  insureVehicle: (id: string) => post<VehicleResult>(`/api/vehicles/${id}/insure`, { idempotencyKey: crypto.randomUUID() }),
  garageVehicle: (id: string, propertyId: string) =>
    post<VehicleResult>(`/api/vehicles/${id}/garage`, { propertyId, idempotencyKey: crypto.randomUUID() }),
  lockVehicle: (id: string, locked: boolean) => post<VehicleResult>(`/api/vehicles/${id}/lock`, { locked }),
  retrieveVehicle: (id: string) => post<VehicleResult>(`/api/vehicles/${id}/retrieve`),
  referral: () => request<ReferralStatus>("/api/referral"),
  rankings: (board: RankingBoard) => request<RankingState>(`/api/rankings/${board}`),
  claimReferral: (code: string) => post<{ referredBy: string; bonus: number }>("/api/referral/claim", { code }),
  friends: () => request<FriendsStatus>("/api/friends"),
  friendRequest: (userName: string) => post<FriendsStatus & { result: string }>("/api/friends/request", { userName }),
  friendRespond: (userId: string, accept: boolean) => post<FriendsStatus>("/api/friends/respond", { userId, accept }),
  friendRemove: (userId: string) => request<FriendsStatus>(`/api/friends/${encodeURIComponent(userId)}`, { method: "DELETE" }),
  messages: (userId: string) =>
    request<{ friend: { userId: string; userName: string; online: boolean; where: string | null }; messages: DirectMessage[] }>(`/api/messages/${encodeURIComponent(userId)}`),
  sendMessage: (to: string, text: string) => post<DirectMessage>("/api/messages", { to, text }),
  community: () => request<CommunityStatus>("/api/community"),
  visitQuietPlace: (placeId: string) => post<QuietVisitResult>("/api/community/visit", { placeId }),
  volunteer: (placeId: string) => post<VolunteerResult>("/api/community/volunteer", { placeId }),
  travel: () => request<TravelStatus>("/api/travel"),
  applyVisa: (plan: VisaPlan) => post<{ visa: VisaState; balance: number; replayed: boolean }>("/api/travel/visa", { plan, idempotencyKey: crypto.randomUUID() }),
  buyTicket: (cabin: CabinClass) => post<{ ticket: TicketState; balance: number; replayed: boolean }>("/api/travel/ticket", { cabin, idempotencyKey: crypto.randomUUID() }),
  cancelTicket: (ticketId: string) => post<{ refund: number; balance: number }>("/api/travel/ticket/cancel", { ticketId }),
  inviteToTrip: (ticketId: string, userName: string) => post<{ id: string; friendName: string }>("/api/travel/invite", { ticketId, userName }),
  answerTripInvite: (inviteId: string, accept: boolean) => post<{ status: string; balance?: number }>("/api/travel/invite/answer", { inviteId, accept, idempotencyKey: crypto.randomUUID() }),
  bookHotel: (hotelId: string, roomType: RoomType, nights: number) =>
    post<{ booking: HotelBookingState; balance: number }>("/api/travel/hotel/book", { hotelId, roomType, nights, idempotencyKey: crypto.randomUUID() }),
  checkInHotel: (bookingId: string) => post<{ keyCode: string }>("/api/travel/hotel/checkin", { bookingId }),
  endHotelStay: (bookingId: string) => post<{ refund: number; balance: number; status: string }>("/api/travel/hotel/end", { bookingId }),
  extendHotelStay: (bookingId: string, nights: number) => post<{ balance: number }>("/api/travel/hotel/extend", { bookingId, nights, idempotencyKey: crypto.randomUUID() }),
  hotelGuest: (bookingId: string, userName: string, invited: boolean) => post<{ name: string }>("/api/travel/hotel/guest", { bookingId, userName, invited }),
  hotelStorage: (bookingId: string, itemId: string, direction: "in" | "out") => post("/api/travel/hotel/storage", { bookingId, itemId, direction }),
  travelOrder: (menu: "room-service" | "rooftop" | "lounge" | "pool", itemId: string, bookingId?: string) =>
    post<{ balance: number; name: string }>("/api/travel/order", { menu, itemId, bookingId, idempotencyKey: crypto.randomUUID() }),
  clubStatus: (placeId: string) => request<ClubStatus>(`/api/clubs/${placeId}`),
  viewingStatus: (placeId: string) => request<ViewingStatus>(`/api/viewing?placeId=${encodeURIComponent(placeId)}`),
  buyViewingPass: (placeId: string) => post<{ charged: number; balance: number; status: ViewingStatus }>("/api/viewing/entry", { placeId }),
  buyWristband: (placeId: string) => post<{ charged: number; balance: number; status: ClubStatus }>(`/api/clubs/${placeId}/wristband`),
  clubOrder: (placeId: string, itemId: string) =>
    post<{ replayed: boolean; item: ClubMenuItem; balance: number; needs: { hunger: number; energy: number } }>(`/api/clubs/${placeId}/order`, { itemId, idempotencyKey: crypto.randomUUID() }),
  clubTables: (placeId: string) => request<ClubTable[]>(`/api/clubs/${placeId}/tables`),
  bookTable: (placeId: string, no: number) => post<{ charged: number; balance?: number; tables: ClubTable[] }>(`/api/clubs/${placeId}/tables/${no}/book`),
  inviteToTable: (placeId: string, no: number, userName: string) => post<{ guest: string; tables: ClubTable[] }>(`/api/clubs/${placeId}/tables/${no}/guests`, { userName }),
  removeFromTable: (placeId: string, no: number, userName: string) => post<{ guest: string; tables: ClubTable[] }>(`/api/clubs/${placeId}/tables/${no}/guests/remove`, { userName }),
  orderBottle: (placeId: string, no: number, itemId: string) =>
    post<{ replayed: boolean; item: BottleItem; balance: number; tables: ClubTable[] }>(`/api/clubs/${placeId}/tables/${no}/bottle`, { itemId, idempotencyKey: crypto.randomUUID() }),
  daily: () => request<DailyStatus>("/api/daily"),
  claimDaily: () => post<{ amount: number; streak: number; balance: number }>("/api/daily/claim"),
  transfer: (userName: string, amount: number, note: string) =>
    post<{ replayed: boolean; balance: number; to: string }>("/api/bank/transfer", { userName, amount, note, idempotencyKey: crypto.randomUUID() }),
  market: () => request<MarketStatus>("/api/market"),
  trade: (assetId: string, side: "buy" | "sell", amount: number | "all") =>
    post<{ replayed: boolean; balance: number; units: number; price: number; naira: number }>("/api/market/trade", { assetId, side, amount, idempotencyKey: crypto.randomUUID() }),
  betting: () => request<BettingStatus>("/api/betting"),
  betSpin: (stake: number) => post<{ replayed: boolean; balance: number; multiplier: number; payout: number; slice: number }>("/api/betting/spin", { stake, idempotencyKey: crypto.randomUUID() }),
  betFootball: (fixtureId: string, pick: Pick, stake: number) =>
    post<{ replayed: boolean; balance: number; odds: number }>("/api/betting/football", { fixtureId, pick, stake, idempotencyKey: crypto.randomUUID() }),
  hireStaff: (propertyId: string, role: HomeStaffRole) => post<{ balance: number }>(`/api/properties/${propertyId}/staff`, { role, idempotencyKey: crypto.randomUUID() }),
  dismissStaff: (propertyId: string, role: HomeStaffRole) => post<{ dismissed: boolean }>(`/api/properties/${propertyId}/staff/dismiss`, { role }),
  party: (propertyId: string, on: boolean) => post<{ partyUntil: string | null; invited?: number }>(`/api/properties/${propertyId}/party`, { on }),
  spray: (amount: number) => post<{ replayed: boolean; balance: number }>("/api/spray", { amount, idempotencyKey: crypto.randomUUID() }),
  orderDelivery: (itemId: string, destination: "here" | "home") =>
    post<{ balance: number; parcel: FoodParcel }>("/api/delivery/order", { itemId, destination, idempotencyKey: crypto.randomUUID() }),
  parcels: () => request<FoodParcel[]>("/api/delivery/parcels"),
  collectParcel: (parcelId: string) => post<{ parcel: FoodParcel; taken: boolean; needs: { hunger: number; energy: number } }>(`/api/delivery/parcels/${parcelId}/collect`),
  eatParcel: (parcelId: string) => post<{ name: string; seated: boolean; needs: { hunger: number; energy: number } }>(`/api/delivery/parcels/${parcelId}/eat`),
  gigs: () => request<GigStatus>("/api/gigs"),
  takeGig: (gigId: string) => post<GigStatus>("/api/gigs/take", { gigId }),
  startGig: () => post<ActiveGig>("/api/gigs/start"),
  repairGig: (action: RepairAction) => post<{ message: string; gig: ActiveGig }>("/api/gigs/repair", { action }),
  completeGig: () => post<{ reward: number; balance: number; title: string }>("/api/gigs/complete"),
  cancelGig: () => post<{ cancelled: boolean }>("/api/gigs/cancel"),
  security: () => request<SecurityStatus>("/api/security"),
  hireSecurity: (plan: SecurityPlanId) =>
    post<{ replayed: boolean; balance: number; status: SecurityStatus }>("/api/security/hire", { plan, idempotencyKey: crypto.randomUUID() }),
  dismissSecurity: () => post<SecurityStatus>("/api/security/dismiss"),
  songs: () => request<ClubSong[]>("/api/songs"),
  songUrl: (songId: string) => `${apiUrl}/api/songs/${encodeURIComponent(songId)}/audio`,
  uploadSong: async (file: File, meta: { title: string; artist: string; seconds: number }) => {
    const query = new URLSearchParams({ title: meta.title, artist: meta.artist, seconds: String(Math.round(meta.seconds)) });
    let response: Response;
    try {
      response = await fetch(`${apiUrl}/api/admin/songs?${query}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": file.type || "application/octet-stream", ...authHeaders() },
        body: file,
      });
    } catch {
      throw new ApiError("The server could not be reached. Check your connection and try again.", 0);
    }
    const body = (await response.json().catch(() => ({}))) as ClubSong & { error?: string };
    if (!response.ok) throw new ApiError(body.error ?? `Upload failed (${response.status})`, response.status);
    return body as ClubSong;
  },
  removeSong: (songId: string) => post<ClubSong[]>(`/api/admin/songs/${encodeURIComponent(songId)}/remove`),
  policeRecords: () => request<{ robberies: RobberyRecord[]; cases: PoliceCase[]; incidents: StreetIncident[] }>("/api/police/records"),
  policeReport: (userName: string, details: string) =>
    post<{ status: "charged" | "no_record"; accused: string; restitution: number; station: string }>("/api/police/report", { userName, details }),
  standing: () => request<{ suspension: Suspension | null }>("/api/account/standing"),
  account: () => request<AccountSummary>("/api/account"),
  claimAccount: (body: ClaimAccount) => post<AccountSummary>("/api/account/claim", body),
  goals: () => request<{ goals: LifeGoals | null }>("/api/goals"),
  saveGoals: (goals: LifeGoals) => request<{ goals: LifeGoals }>("/api/goals", { method: "PUT", body: JSON.stringify(goals) }),
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
