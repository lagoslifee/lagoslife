import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { config } from "./config.js";

const payloadSchema = z.object({
  userId: z.string().min(1),
  name: z.string().min(1).max(20),
  expiresAt: z.number().int(),
});

export type MultiplayerIdentity = z.infer<typeof payloadSchema>;

function signature(payload: string) {
  return createHmac("sha256", config.BETTER_AUTH_SECRET).update(payload).digest("base64url");
}

export function createMultiplayerToken(identity: Omit<MultiplayerIdentity, "expiresAt">) {
  const encoded = Buffer.from(
    JSON.stringify({ ...identity, expiresAt: Date.now() + 60_000 }),
  ).toString("base64url");
  return `${encoded}.${signature(encoded)}`;
}

export function verifyMultiplayerToken(token: unknown): MultiplayerIdentity | null {
  if (typeof token !== "string") return null;
  const [encoded, suppliedSignature, extra] = token.split(".");
  if (!encoded || !suppliedSignature || extra) return null;
  const expected = signature(encoded);
  const suppliedBuffer = Buffer.from(suppliedSignature);
  const expectedBuffer = Buffer.from(expected);
  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    return null;
  }
  try {
    const payload = payloadSchema.parse(JSON.parse(Buffer.from(encoded, "base64url").toString()));
    return payload.expiresAt >= Date.now() ? payload : null;
  } catch {
    return null;
  }
}
