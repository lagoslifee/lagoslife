import { describe, expect, it } from "vitest";
import { filterChat, moderationActionSchema } from "./index";

describe("chat filter", () => {
  it("leaves ordinary Lagos chat alone", () => {
    for (const text of ["Abeg where the danfo dey?", "Meet me at Falomo by 6", "₦1,500 for the shift, nice", "Admiralty Way is busy o"]) {
      expect(filterChat(text)).toEqual({ text, filtered: false });
    }
  });

  it("masks blocked words, including letter swaps and stretched spellings", () => {
    for (const word of ["fuck", "FUCK!", "fuuuuck", "sh1t", "$hit,", "b!tch"]) {
      const result = filterChat(`you ${word} man`);
      expect(result.filtered, word).toBe(true);
      expect(result.text).toMatch(/^you •+ man$/);
    }
  });

  it("masks links, emails and phone numbers so players are not pulled off the game", () => {
    expect(filterChat("join https://example.com/x now").text).not.toContain("example");
    expect(filterChat("dm me on bad-site.gg").text).not.toContain("bad-site");
    expect(filterChat("mail me a.b@c.com").text).not.toContain("@");
    const phone = filterChat("call 0803 123 4567 abeg");
    expect(phone.filtered).toBe(true);
    expect(phone.text).not.toMatch(/\d{3}/);
  });

  it("collapses whitespace", () => {
    expect(filterChat("  hello    there  ").text).toBe("hello there");
  });
});

describe("moderation actions", () => {
  it("requires a duration for mutes but not for indefinite suspensions", () => {
    expect(moderationActionSchema.safeParse({ targetUserId: "u", action: "mute", reason: "spam" }).success).toBe(false);
    expect(moderationActionSchema.safeParse({ targetUserId: "u", action: "mute", reason: "spam", durationHours: 2 }).success).toBe(true);
    expect(moderationActionSchema.safeParse({ targetUserId: "u", action: "suspend", reason: "repeated hate" }).success).toBe(true);
  });
});

describe("snapshot wire format", () => {
  it("fills omitted player fields with their defaults", async () => {
    const { networkPlayerSchema } = await import("./index");
    expect(networkPlayerSchema.parse({ sessionId: "s1", name: "Ada", x: 1, z: 2, yaw: 0, motion: "jog" })).toEqual({
      sessionId: "s1", name: "Ada", x: 1, z: 2, yaw: 0, motion: "jog",
      location: "street", busId: null, seat: null, carrying: false, connected: true, vehicleId: null,
    });
  });
});
