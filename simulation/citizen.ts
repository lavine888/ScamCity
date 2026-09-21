import { FIRST_NAMES, INITIAL_THOUGHTS, LAST_NAMES, OCCUPATIONS, ZONES } from "@/data/citizen-data";
import type { Citizen, Location, TimelineEvent } from "@/types";
import { clamp, round, SeededRandom } from "@/simulation/seeded-random";

const EVENT_ID_PREFIX = "citizen-event";

function createLocation(random: SeededRandom): Location {
  return {
    x: random.int(5, 95),
    y: random.int(8, 92),
    zone: random.pick(ZONES),
  };
}

function initialEvent(id: string, name: string): TimelineEvent {
  return {
    id,
    tick: 0,
    time: "Day 1 · 08:00",
    type: "routine",
    message: `${name} started a normal day in ScamCity.`,
  };
}

export function createSyntheticCitizens(random: SeededRandom, count = 100): Citizen[] {
  const citizens: Citizen[] = [];
  for (let index = 0; index < count; index += 1) {
    const age = random.int(18, 80);
    const ageGroup = age >= 68 ? "retired" : age <= 23 ? "student" : "working";
    const availableOccupations =
      ageGroup === "retired"
        ? (["Retired Worker", "Teacher", "Small Business Owner", "Freelancer"] as const)
        : ageGroup === "student"
          ? (["Student", "Designer", "Freelancer", "Software Engineer"] as const)
          : OCCUPATIONS.filter((occupation) => occupation !== "Student");
    const occupation = random.pick(availableOccupations);
    const assetBase =
      ageGroup === "retired" ? random.int(180_000, 1_600_000) : random.int(12_000, 850_000);
    const digitalLiteracy = clamp(
      ageGroup === "student"
        ? random.int(62, 98)
        : ageGroup === "retired"
          ? random.int(22, 72)
          : random.int(40, 95),
    );
    const riskAwareness = clamp(
      25 + digitalLiteracy * 0.45 + random.int(-20, 20) - (ageGroup === "retired" ? 7 : 0),
    );
    const stress = clamp(random.int(8, 78) + (occupation === "Small Business Owner" ? 10 : 0));
    const loneliness = clamp(
      random.int(8, 64) + (ageGroup === "retired" ? 12 : 0) - (occupation === "Student" ? 5 : 0),
    );
    const familyTrust = clamp(random.int(58, 98));
    const strangerTrust = clamp(random.int(12, 64) + (loneliness > 55 ? 8 : 0));
    const authorityTrust = clamp(
      random.int(22, 92) + (ageGroup === "retired" ? 7 : 0) - (digitalLiteracy > 80 ? 6 : 0),
    );
    const impulsiveness = clamp(random.int(12, 88) + (stress > 65 ? 7 : 0));
    const socialInfluence = clamp(random.int(12, 78) + (occupation === "Teacher" ? 14 : 0));
    const name = `${FIRST_NAMES[index % FIRST_NAMES.length]} ${LAST_NAMES[Math.floor(index / FIRST_NAMES.length) % LAST_NAMES.length]}`;
    const id = `citizen-${String(index + 1).padStart(3, "0")}`;

    citizens.push({
      id,
      name,
      age,
      occupation,
      assets: Math.round(assetBase / 100) * 100,
      digitalLiteracy: round(digitalLiteracy),
      riskAwareness: round(riskAwareness),
      stress: round(stress),
      loneliness: round(loneliness),
      familyTrust: round(familyTrust),
      strangerTrust: round(strangerTrust),
      authorityTrust: round(authorityTrust),
      impulsiveness: round(impulsiveness),
      socialInfluence: round(socialInfluence),
      connections: [],
      location: createLocation(random),
      state: "safe",
      currentThought: random.pick(INITIAL_THOUGHTS),
      timeline: [initialEvent(`${EVENT_ID_PREFIX}-${index}-0`, name)],
      warningsReceived: 0,
      warningFatigue: 0,
      previousScamAttempts: 0,
    });
  }
  return citizens;
}

export function appendCitizenTimeline(
  citizen: Citizen,
  event: Omit<TimelineEvent, "id"> & { id?: string },
  maxEntries = 24,
): void {
  citizen.timeline.push({
    ...event,
    id: event.id ?? `${citizen.id}-event-${citizen.timeline.length + 1}`,
  });
  if (citizen.timeline.length > maxEntries) citizen.timeline.splice(0, citizen.timeline.length - maxEntries);
}

export function moveCitizen(citizen: Citizen, random: SeededRandom): void {
  const drift = citizen.state === "victim" ? 1 : 2;
  citizen.location = {
    ...citizen.location,
    x: clamp(citizen.location.x + random.int(-drift, drift), 4, 96),
    y: clamp(citizen.location.y + random.int(-drift, drift), 6, 94),
  };
}

