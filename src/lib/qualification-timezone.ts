import { isValidTimezone } from "@/lib/date-only";

type UnitContext = { id: string; timezone: string; organizationId?: string | null };
type LegacyUnitContext = { unitId: string; unit: UnitContext | null };

export type QualificationOwnerContext = {
  organizationId: string;
  unitId: string | null;
  unit: UnitContext | null;
  legacyPilot?: LegacyUnitContext | null;
};

/** A migrated holder's unit is authoritative; conflicting mappings need review. */
export function memberQualificationTimezone(person: QualificationOwnerContext): string | null {
  const { unit, legacyPilot } = person;
  if (!unit || person.unitId !== unit.id) return null;
  if (unit.organizationId && unit.organizationId !== person.organizationId) return null;
  if (legacyPilot && legacyPilot.unitId !== person.unitId) return null;
  return isValidTimezone(unit.timezone) ? unit.timezone : null;
}

export function pilotQualificationTimezone(
  pilot: LegacyUnitContext & {
    person?: Omit<QualificationOwnerContext, "legacyPilot"> | null;
  },
): string | null {
  if (pilot.person) return memberQualificationTimezone({ ...pilot.person, legacyPilot: pilot });
  return pilot.unit && pilot.unit.id === pilot.unitId && isValidTimezone(pilot.unit.timezone)
    ? pilot.unit.timezone
    : null;
}
