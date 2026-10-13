import { randomUUID } from "node:crypto";
import {
  attackSign,
  FOOTBALL,
  FOOTBALL_KITS,
  FOOTBALL_TEAMS,
  otherTeam,
  pitchDirection,
  restingBall,
  stepBall,
  streetPitchById,
  toPitch,
  type FootballBall,
  type FootballEvent,
  type FootballState,
  type FootballTeam,
  type Notice,
  type StreetPitch,
} from "@lagos-living/shared";

/** A connected resident as the cage sees them. `free` is on foot on the street: not in a car, bus or building. */
export type Footballer = { sessionId: string; userId: string; name: string; x: number; z: number; yaw: number; free: boolean };

export type FootballDeps = {
  people: () => Footballer[];
  send: (sessionId: string, state: FootballState) => void;
  notify: (sessionId: string, notice: Notice) => void;
  stake: (userId: string, matchId: string, amount: number, pitch: string) => Promise<unknown>;
  payOut: (userId: string, matchId: string, amount: number, kind: "match_win" | "match_refund", label: string) => Promise<unknown>;
  random?: () => number;
};

type Entry = { sessionId: string; userId: string; name: string; team: FootballTeam; keeper: boolean; paid: number; tackleAt: number; lostAt: number };
type Match = {
  id: string;
  pitch: StreetPitch;
  phase: FootballState["phase"];
  stake: number;
  pot: number;
  entries: Entry[];
  score: Record<FootballTeam, number>;
  endsAt: number | null;
  restartAt: number | null;
  finishedAt: number;
  ball: FootballBall;
  holder: string | null;
  lastKicker: string | null;
  kickedAt: number;
  winner: FootballState["winner"];
  event: FootballEvent | null;
  joining: Set<string>;
};

/** Everyone within this range of a cage sees the match being played. */
const WATCH_RANGE = 150;

/**
 * Pick-up five-a-side in the street cages. Residents join a side and put the agreed stake in the pot, anyone in the
 * match kicks off once both sides have a player, and the room runs the ball: dribbling, passes and shots, tackles and
 * keepers who catch in their own box. First to five or the better side at full time takes the pot; a draw hands the
 * stakes back. Walking off forfeits a stake once the ball is rolling, and refunds it before kick-off.
 */
export class StreetFootball {
  private matches = new Map<string, Match>();
  private ticks = 0;

  constructor(private readonly deps: FootballDeps) {}

  private get random() {
    return this.deps.random ?? Math.random;
  }

  private person(sessionId: string) {
    return this.deps.people().find((person) => person.sessionId === sessionId);
  }

  private matchOf(sessionId: string) {
    for (const match of this.matches.values()) {
      const entry = match.entries.find((candidate) => candidate.sessionId === sessionId);
      if (entry) return { match, entry };
    }
    return null;
  }

  private fresh(pitch: StreetPitch): Match {
    return {
      id: randomUUID(),
      pitch,
      phase: "lobby",
      stake: 0,
      pot: 0,
      entries: [],
      score: { green: 0, gold: 0 },
      endsAt: null,
      restartAt: null,
      finishedAt: 0,
      ball: restingBall(),
      holder: null,
      lastKicker: null,
      kickedAt: 0,
      winner: null,
      event: null,
      joining: new Set(),
    };
  }

  view(match: Match): FootballState {
    return {
      pitchId: match.pitch.id,
      phase: match.phase,
      stake: match.stake,
      pot: match.pot,
      score: { ...match.score },
      endsAt: match.endsAt,
      restartAt: match.restartAt,
      players: match.entries.map(({ sessionId, name, team, keeper }) => ({ sessionId, name, team, keeper })),
      ball: { ...match.ball },
      holder: match.holder,
      winner: match.winner,
      event: match.event,
    };
  }

  /** The cage's state for one resident walking up to it, even when nobody is playing yet. */
  sync(sessionId: string, pitchId: string) {
    const pitch = streetPitchById.get(pitchId);
    if (!pitch) return;
    this.deps.send(sessionId, this.view(this.matches.get(pitchId) ?? this.fresh(pitch)));
  }

  private publish(match: Match) {
    const state = this.view(match);
    const players = new Set(match.entries.map((entry) => entry.sessionId));
    for (const person of this.deps.people()) {
      const near = Math.hypot(person.x - match.pitch.centre[0], person.z - match.pitch.centre[1]) < WATCH_RANGE;
      if (near || players.has(person.sessionId)) this.deps.send(person.sessionId, state);
    }
  }

  private say(match: Match, kind: FootballEvent["kind"], text: string, now: number, team?: FootballTeam, by?: string) {
    match.event = { kind, text, at: now, ...(team ? { team } : {}), ...(by ? { by } : {}) };
  }

  async join(sessionId: string, input: { pitchId: string; team: FootballTeam; stake: number }, now = Date.now()) {
    const tell = (text: string) => this.deps.notify(sessionId, { tone: "error", text });
    const pitch = streetPitchById.get(input.pitchId);
    const person = this.person(sessionId);
    if (!pitch || !person) return;
    if (!person.free || Math.hypot(person.x - pitch.centre[0], person.z - pitch.centre[1]) > FOOTBALL.joinRange) return tell(`Walk over to ${pitch.name} to join a side.`);
    let match = this.matches.get(pitch.id);
    if (!match || match.phase === "finished") {
      match = this.fresh(pitch);
      this.matches.set(pitch.id, match);
    }
    const current = this.matchOf(sessionId);
    if (current && current.match !== match) return tell("You're already playing in another match.");
    if (current) {
      if (current.entry.team === input.team) return;
      if (match.phase !== "lobby") return tell("You can't change sides once the ball is rolling.");
      if (match.entries.filter((entry) => entry.team === input.team).length >= FOOTBALL.teamMax) return tell(`${FOOTBALL_KITS[input.team].name} are full.`);
      current.entry.team = input.team;
      this.pickKeepers(match);
      return this.publish(match);
    }
    if (match.joining.has(sessionId)) return;
    if (match.entries.filter((entry) => entry.team === input.team).length >= FOOTBALL.teamMax) return tell(`${FOOTBALL_KITS[input.team].name} are full. Join the other side.`);
    const stake = match.entries.length || match.joining.size ? match.stake : input.stake;
    match.stake = stake;
    match.joining.add(sessionId);
    try {
      if (stake > 0) await this.deps.stake(person.userId, match.id, stake, pitch.name);
    } catch (error) {
      tell(error instanceof Error && error.message.includes("Insufficient") ? `You need ₦${stake.toLocaleString("en-NG")} for the stake.` : "Your stake didn't go through. Try again.");
      return;
    } finally {
      match.joining.delete(sessionId);
    }
    if (this.matches.get(pitch.id) !== match || match.phase === "finished") {
      if (stake > 0) await this.deps.payOut(person.userId, match.id, stake, "match_refund", `Street football stake back · ${pitch.name}`).catch(() => undefined);
      return tell("That match just ended. Join the next one.");
    }
    match.entries.push({ sessionId, userId: person.userId, name: person.name, team: input.team, keeper: false, paid: stake, tackleAt: 0, lostAt: 0 });
    match.pot += stake;
    this.pickKeepers(match);
    this.say(match, "kickoff", `${person.name} joined ${FOOTBALL_KITS[input.team].name}.`, now);
    this.publish(match);
  }

  /** The first player on each side keeps goal until they leave. */
  private pickKeepers(match: Match) {
    for (const team of FOOTBALL_TEAMS) {
      const side = match.entries.filter((entry) => entry.team === team);
      const keeper = side.find((entry) => entry.keeper) ?? side[0];
      for (const entry of side) entry.keeper = entry === keeper;
    }
  }

  kickoff(sessionId: string, now = Date.now()) {
    const found = this.matchOf(sessionId);
    if (!found || found.match.phase !== "lobby") return;
    const { match } = found;
    if (FOOTBALL_TEAMS.some((team) => !match.entries.some((entry) => entry.team === team))) {
      return this.deps.notify(sessionId, { tone: "error", text: "Both sides need at least one player to kick off." });
    }
    match.phase = "playing";
    match.endsAt = now + FOOTBALL.matchMs;
    match.ball = restingBall();
    match.holder = null;
    this.say(match, "kickoff", "Kick off!", now);
    this.publish(match);
  }

  async leave(sessionId: string, reason: "walked" | "left" = "left", now = Date.now()) {
    const found = this.matchOf(sessionId);
    if (!found) return;
    const { match, entry } = found;
    match.entries = match.entries.filter((candidate) => candidate !== entry);
    if (match.holder === sessionId) match.holder = null;
    if (match.phase === "lobby") {
      match.pot -= entry.paid;
      if (entry.paid > 0) await this.deps.payOut(entry.userId, match.id, entry.paid, "match_refund", `Street football stake back · ${match.pitch.name}`).catch((error) => console.error("Match refund failed", error));
      if (!match.entries.length) this.matches.delete(match.pitch.id);
      else this.pickKeepers(match);
    } else if (match.phase === "playing") {
      if (reason === "walked" && entry.paid > 0) this.deps.notify(sessionId, { tone: "info", text: `You walked off mid-match; your ₦${entry.paid.toLocaleString("en-NG")} stays in the pot.` });
      this.pickKeepers(match);
      const left = FOOTBALL_TEAMS.filter((team) => match.entries.some((candidate) => candidate.team === team));
      if (left.length === 1) await this.finish(match, left[0]!, now, `${FOOTBALL_KITS[otherTeam(left[0]!)].name} walked off.`);
      else if (!left.length) this.matches.delete(match.pitch.id);
    }
    if (this.matches.get(match.pitch.id) === match) this.publish(match);
  }

  private async finish(match: Match, winner: FootballTeam | "draw", now: number, why?: string) {
    match.phase = "finished";
    match.winner = winner;
    match.finishedAt = now;
    match.holder = null;
    match.restartAt = null;
    const score = `${match.score.green}–${match.score.gold}`;
    this.say(match, "full_time", `${why ? `${why} ` : ""}${winner === "draw" ? `Full time, ${score}. A draw, so everyone gets their stake back.` : `Full time, ${score}. ${FOOTBALL_KITS[winner].name} win${match.pot ? ` ₦${match.pot.toLocaleString("en-NG")}` : ""}!`}`, now, winner === "draw" ? undefined : winner);
    this.publish(match);
    const label = `Street football · ${match.pitch.name} · ${score}`;
    if (winner === "draw") {
      const paidIn = match.entries.reduce((sum, entry) => sum + entry.paid, 0);
      const extra = match.entries.length ? Math.floor((match.pot - paidIn) / match.entries.length) : 0;
      for (const entry of match.entries) await this.deps.payOut(entry.userId, match.id, entry.paid + extra, "match_refund", label).catch((error) => console.error("Match refund failed", error));
      return;
    }
    const winners = match.entries.filter((entry) => entry.team === winner);
    const share = winners.length ? Math.floor(match.pot / winners.length) : 0;
    for (const [index, entry] of winners.entries()) {
      const amount = share + (index === 0 ? match.pot - share * winners.length : 0);
      await this.deps.payOut(entry.userId, match.id, amount, "match_win", label).catch((error) => console.error("Match payout failed", error));
      if (amount > 0) this.deps.notify(entry.sessionId, { tone: "success", text: `You won ₦${amount.toLocaleString("en-NG")} at ${match.pitch.name}.` });
    }
  }

  private local(match: Match, person: Footballer) {
    return toPitch(match.pitch, person.x, person.z);
  }

  kick(sessionId: string, input: { kind: "pass" | "shoot"; yaw: number }, now = Date.now()) {
    const found = this.matchOf(sessionId);
    const person = this.person(sessionId);
    if (!found || !person || found.match.phase !== "playing" || found.match.restartAt) return;
    const { match, entry } = found;
    const me = this.local(match, person);
    const ball = match.ball;
    const reach = Math.hypot(ball.along - me.along, ball.across - me.across);
    if (match.holder !== sessionId && (match.holder || reach > FOOTBALL.kickRange || ball.h > 1.2)) return;
    const facing = pitchDirection(match.pitch, input.yaw);
    let aim = facing;
    let speed: number = input.kind === "shoot" ? FOOTBALL.shotSpeed : FOOTBALL.passSpeed;
    let lift = 0;
    if (input.kind === "shoot") {
      const goal = { along: attackSign(entry.team) * (match.pitch.length / 2 + 0.5), across: (this.random() - 0.5) * (FOOTBALL.goalWidth - 0.8) };
      const toGoal = { along: goal.along - ball.along, across: goal.across - ball.across };
      const length = Math.hypot(toGoal.along, toGoal.across);
      if ((toGoal.along * facing.along + toGoal.across * facing.across) / length > Math.cos((70 * Math.PI) / 180)) aim = { along: toGoal.along / length, across: toGoal.across / length };
      lift = FOOTBALL.shotLift * (0.6 + this.random() * 0.5);
    } else {
      let best: { along: number; across: number; distance: number; score: number } | null = null;
      for (const mate of match.entries) {
        if (mate === entry || mate.team !== entry.team) continue;
        const other = this.person(mate.sessionId);
        if (!other) continue;
        const at = this.local(match, other);
        const offset = { along: at.along - ball.along, across: at.across - ball.across };
        const distance = Math.hypot(offset.along, offset.across);
        if (distance < 2 || distance > 28) continue;
        const cos = (offset.along * facing.along + offset.across * facing.across) / distance;
        if (cos < Math.cos((50 * Math.PI) / 180)) continue;
        const score = cos - distance / 60;
        if (!best || score > best.score) best = { along: offset.along / distance, across: offset.across / distance, distance, score };
      }
      if (best) {
        aim = best;
        speed = Math.min(FOOTBALL.passSpeed + 3, Math.max(6, best.distance * 1.1 + 2.5));
      }
    }
    match.ball = { along: ball.along + aim.along * 0.3, across: ball.across + aim.across * 0.3, h: Math.max(ball.h, 0.12), va: aim.along * speed, vc: aim.across * speed, vh: lift };
    match.holder = null;
    match.lastKicker = sessionId;
    match.kickedAt = now;
  }

  tackle(sessionId: string, now = Date.now()) {
    const found = this.matchOf(sessionId);
    const person = this.person(sessionId);
    if (!found || !person || found.match.phase !== "playing" || !found.match.holder) return;
    const { match, entry } = found;
    const holder = match.entries.find((candidate) => candidate.sessionId === match.holder);
    const victim = holder ? this.person(holder.sessionId) : undefined;
    if (!holder || !victim || holder.team === entry.team || now - entry.tackleAt < FOOTBALL.tackleCooldownMs) return;
    if (Math.hypot(victim.x - person.x, victim.z - person.z) > FOOTBALL.tackleRange) return;
    entry.tackleAt = now;
    if (this.random() > FOOTBALL.tackleChance) return this.deps.notify(sessionId, { tone: "info", text: `${holder.name} skipped past your tackle.` });
    holder.lostAt = now;
    match.holder = sessionId;
    this.say(match, "tackle", `${entry.name} wins it off ${holder.name}.`, now, entry.team, entry.name);
  }

  tick(dt: number, now = Date.now()) {
    this.ticks++;
    if (!this.matches.size) return;
    const people = new Map(this.deps.people().map((person) => [person.sessionId, person]));
    for (const match of [...this.matches.values()]) {
      if (match.phase === "finished") {
        if (now - match.finishedAt > FOOTBALL.finishedMs) {
          this.matches.delete(match.pitch.id);
          this.publish({ ...this.fresh(match.pitch), entries: [] });
        }
        continue;
      }
      for (const entry of match.entries) {
        const person = people.get(entry.sessionId);
        if (person && person.free && Math.hypot(person.x - match.pitch.centre[0], person.z - match.pitch.centre[1]) < FOOTBALL.leaveRange) continue;
        void this.leave(entry.sessionId, person ? "walked" : "left", now);
      }
      if (match.phase !== "playing") continue;
      if (match.endsAt && now >= match.endsAt) {
        const { green, gold } = match.score;
        void this.finish(match, green === gold ? "draw" : green > gold ? "green" : "gold", now);
        continue;
      }
      if (match.restartAt) {
        if (now < match.restartAt) continue;
        match.restartAt = null;
        match.ball = restingBall();
        match.holder = null;
      }
      this.moveBall(match, people, dt, now);
      if (this.ticks % 2 === 0 && match.phase === "playing") this.publish(match);
    }
  }

  private moveBall(match: Match, people: Map<string, Footballer>, dt: number, now: number) {
    const { pitch } = match;
    const holder = match.holder ? people.get(match.holder) : undefined;
    if (holder) {
      const at = this.local(match, holder);
      const facing = pitchDirection(pitch, holder.yaw);
      const inside = Math.abs(at.along) < pitch.length / 2 + 1 && Math.abs(at.across) < pitch.width / 2 + 1;
      const along = Math.max(-pitch.length / 2 + 0.3, Math.min(pitch.length / 2 - 0.3, at.along + facing.along * 0.6));
      const across = Math.max(-pitch.width / 2 + 0.3, Math.min(pitch.width / 2 - 0.3, at.across + facing.across * 0.6));
      match.ball = { along, across, h: 0, va: 0, vc: 0, vh: 0 };
      if (!inside) match.holder = null;
      return;
    }
    match.holder = null;
    const scored = stepBall(match.ball, pitch, dt / 1_000);
    if (scored) {
      match.score[scored]++;
      const scorer = match.entries.find((entry) => entry.sessionId === match.lastKicker);
      const own = scorer && scorer.team !== scored;
      this.say(match, "goal", `GOAL! ${scorer ? `${scorer.name}${own ? " (own goal)" : ""}` : FOOTBALL_KITS[scored].name} · ${match.score.green}–${match.score.gold}`, now, scored, scorer?.name);
      match.restartAt = now + FOOTBALL.restartMs;
      if (match.score[scored] >= FOOTBALL.goalsToWin) void this.finish(match, scored, now);
      return;
    }
    const ball = match.ball;
    const speed = Math.hypot(ball.va, ball.vc);
    let taker: { entry: Entry; distance: number; save: boolean } | null = null;
    for (const entry of match.entries) {
      const person = people.get(entry.sessionId);
      if (!person) continue;
      if (entry.sessionId === match.lastKicker && now - match.kickedAt < 350) continue;
      if (now - entry.lostAt < 800) continue;
      const at = this.local(match, person);
      const distance = Math.hypot(at.along - ball.along, at.across - ball.across);
      const ownEnd = -attackSign(entry.team) * (pitch.length / 2);
      const inBox = Math.abs(at.along - ownEnd) < FOOTBALL.boxDepth && Math.abs(at.across) < FOOTBALL.goalWidth + 2;
      const keeping = entry.keeper && inBox && ball.h < FOOTBALL.goalHeight + 0.3;
      const reach = keeping ? FOOTBALL.keeperReach : FOOTBALL.dribbleRange;
      if (distance > reach || (!keeping && (ball.h > 0.7 || speed > 14))) continue;
      if (!taker || distance < taker.distance) taker = { entry, distance, save: keeping && speed > 6 && entry.sessionId !== match.lastKicker };
    }
    if (!taker) return;
    match.holder = taker.entry.sessionId;
    match.ball.h = 0;
    if (taker.save) this.say(match, "save", `What a save from ${taker.entry.name}!`, now, taker.entry.team, taker.entry.name);
  }
}
