import { describe, expect, it, vi } from "vitest";
import { FOOTBALL, fromPitch, STREET_PITCHES, type FootballState } from "@lagos-living/shared";
import { StreetFootball, type Footballer } from "./street-football.js";

const pitch = STREET_PITCHES[0]!;

function setup() {
  const people: Footballer[] = [];
  const sent = new Map<string, FootballState>();
  const notices: string[] = [];
  const stake = vi.fn(async () => 0);
  const payOut = vi.fn(async () => 0);
  const football = new StreetFootball({
    people: () => people,
    send: (sessionId, state) => sent.set(sessionId, state),
    notify: (_sessionId, notice) => notices.push(notice.text),
    stake,
    payOut,
    random: () => 0.5,
  });
  const add = (sessionId: string, along: number, across = 0, yaw = pitch.yaw) => {
    const [x, z] = fromPitch(pitch, along, across);
    const person = { sessionId, userId: `user-${sessionId}`, name: sessionId, x, z, yaw, free: true };
    people.push(person);
    return person;
  };
  const move = (person: Footballer, along: number, across = 0) => ([person.x, person.z] = fromPitch(pitch, along, across));
  return { football, people, sent, notices, stake, payOut, add, move };
}

describe("street football", () => {
  it("takes one stake per player and pays the whole pot to the side that scores five", async () => {
    const { football, sent, stake, payOut, add, move } = setup();
    const ade = add("ade", -2);
    add("bola", -10);
    await football.join("ade", { pitchId: pitch.id, team: "green", stake: 10_000 });
    await football.join("bola", { pitchId: pitch.id, team: "gold", stake: 0 });
    expect(stake).toHaveBeenCalledTimes(2);
    expect(stake.mock.calls.map((call) => (call as unknown[])[2])).toEqual([10_000, 10_000]);
    football.kickoff("ade");
    const now = Date.now();
    for (let goal = 0; goal < FOOTBALL.goalsToWin; goal++) {
      move(ade, -0.5);
      for (let i = 0; i < 4; i++) football.tick(50, now + goal * 10_000 + i * 50);
      expect(sent.get("ade")!.holder).toBe("ade");
      move(ade, pitch.length / 2 - 8);
      football.tick(50, now + goal * 10_000 + 300);
      football.kick("ade", { kind: "shoot", yaw: pitch.yaw }, now + goal * 10_000 + 300);
      for (let i = 0; i < 40; i++) football.tick(50, now + goal * 10_000 + 350 + i * 50);
      football.tick(50, now + goal * 10_000 + 350 + FOOTBALL.restartMs + 2_100);
    }
    const final = sent.get("ade")!;
    expect(final.phase).toBe("finished");
    expect(final.score.green).toBe(FOOTBALL.goalsToWin);
    await vi.waitFor(() => expect(payOut).toHaveBeenCalledWith("user-ade", expect.any(String), 20_000, "match_win", expect.any(String)));
  });

  it("refunds a stake for walking away before kick-off, and keeps it in the pot afterwards", async () => {
    const { football, payOut, add, move, sent } = setup();
    const ade = add("ade", 0);
    add("bola", 5);
    const chi = add("chi", 3);
    await football.join("ade", { pitchId: pitch.id, team: "green", stake: 2_000 });
    await football.join("bola", { pitchId: pitch.id, team: "gold", stake: 2_000 });
    await football.join("chi", { pitchId: pitch.id, team: "green", stake: 2_000 });
    move(chi, 0, 200);
    football.tick(50);
    await vi.waitFor(() => expect(payOut).toHaveBeenCalledWith("user-chi", expect.any(String), 2_000, "match_refund", expect.any(String)));
    football.kickoff("ade");
    move(ade, 0, 200);
    football.tick(50);
    await vi.waitFor(() => expect(sent.get("bola")!.phase).toBe("finished"));
    expect(sent.get("bola")!.winner).toBe("gold");
    await vi.waitFor(() => expect(payOut).toHaveBeenCalledWith("user-bola", expect.any(String), 4_000, "match_win", expect.any(String)));
  });

  it("lets a defender win the ball with a tackle and the keeper catch in the box", async () => {
    const { football, add, sent } = setup();
    add("ade", 0);
    add("bola", 1.2);
    add("keeper", pitch.length / 2 - 1.5, 0);
    await football.join("keeper", { pitchId: pitch.id, team: "gold", stake: 0 });
    await football.join("ade", { pitchId: pitch.id, team: "green", stake: 0 });
    await football.join("bola", { pitchId: pitch.id, team: "gold", stake: 0 });
    expect(sent.get("ade")!.players.find((player) => player.sessionId === "keeper")!.keeper).toBe(true);
    football.kickoff("ade");
    football.tick(50);
    football.tick(50);
    expect(sent.get("ade")!.holder).toBe("ade");
    football.tackle("bola");
    football.tick(50);
    football.tick(50);
    expect(sent.get("ade")!.holder).toBe("bola");
    expect(sent.get("ade")!.event?.kind).toBe("tackle");

    const second = setup();
    const striker = second.add("ade", 0);
    second.add("keeper", pitch.length / 2 - 1.5, 0);
    await second.football.join("ade", { pitchId: pitch.id, team: "green", stake: 0 });
    await second.football.join("keeper", { pitchId: pitch.id, team: "gold", stake: 0 });
    second.football.kickoff("ade");
    second.football.tick(50);
    second.move(striker, pitch.length / 2 - 10);
    second.football.tick(50);
    second.football.kick("ade", { kind: "pass", yaw: pitch.yaw });
    for (let i = 0; i < 30; i++) second.football.tick(50);
    second.football.sync("ade", pitch.id);
    const state = second.sent.get("ade")!;
    expect(state.holder).toBe("keeper");
    expect(state.event?.kind).toBe("save");
    expect(state.score.green).toBe(0);
  });
});
