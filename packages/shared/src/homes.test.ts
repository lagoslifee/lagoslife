import { describe, expect, it } from "vitest";
import { homeUnit, listingTemplateId, propertyPlace, propertyTitle } from "./homes.js";

describe("private copies of mapped homes", () => {
  it("resolve to the listing they copy, sharing its door and title", () => {
    expect(listingTemplateId("lekki-adebayo-flat-3~1a2b3c4d")).toBe("lekki-adebayo-flat-3");
    expect(listingTemplateId("lekki-adebayo-flat-3")).toBe("lekki-adebayo-flat-3");
    expect(homeUnit("lekki-adebayo-flat-3~1a2b3c4d")?.unit).toBe("Flat 3");
    expect(propertyPlace("lekki-adebayo-flat-3~1a2b3c4d")?.id).toBe("lekki-adebayo-flat-2");
    expect(propertyTitle("lekki-chief-okoro-house~ffff0000")).toBe(propertyTitle("lekki-chief-okoro-house"));
  });
});
