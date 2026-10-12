import { z } from "zod";
import { districtAt, regionAt } from "./world.js";

/** Friends and private messages between friends. Messages pass the same word filter as street chat. */
export const SOCIAL = {
  maxFriends: 300,
  messageMaxLength: 500,
  /** Messages shown when a conversation opens (the most recent). */
  pageSize: 60,
  /** At most this many private messages per sender in a minute. */
  messagesPerMinute: 20,
  retentionDays: 90,
} as const;

export const friendRequestSchema = z.object({ userName: z.string().trim().min(2).max(40) });
export const friendRespondSchema = z.object({ userId: z.string().min(1).max(100), accept: z.boolean() });
export const directMessageSendSchema = z.object({ to: z.string().min(1).max(100), text: z.string().trim().min(1).max(SOCIAL.messageMaxLength) });

export type Friend = {
  userId: string;
  userName: string;
  online: boolean;
  /** Which part of town they're in right now (only while online), e.g. "Lekki Phase 1" or "Indoors". */
  where: string | null;
  /** Metres away, when you're both out on the street. */
  distance: number | null;
  unread: number;
  since: string;
};
export type FriendRequest = { userId: string; userName: string; at: string };
export type FriendsStatus = { friends: Friend[]; incoming: FriendRequest[]; outgoing: FriendRequest[] };
export type DirectMessage = { id: string; from: string; fromName: string; to: string; text: string; at: string; mine: boolean };

/**
 * Which game room a resident joins: everyone starting in the same district shares a room (until it is full), so
 * people near each other actually see each other instead of being spread across rooms at random.
 */
export function roomArea(x: number, z: number) {
  if (regionAt(x, z) === "dubai") return "dubai";
  return districtAt(x, z)?.id ?? "lagos";
}
