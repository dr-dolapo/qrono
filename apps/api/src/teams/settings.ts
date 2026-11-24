import { z } from "zod";
import { timezoneField } from "../validation";

/** Reminder times on offer, in minutes before the start. */
export const REMINDER_OFFSETS = [10080, 1440, 180, 60] as const; // 1 week, 1 day, 3 hours, 1 hour
export const INVITE_EXPIRY_DAYS = [3, 7, 14, 30] as const;
export const LIVE_WARNING_MINUTES = [1, 2, 5] as const;
/** Largest logo we keep: a small image, stored inline. */
export const MAX_LOGO_BYTES = 150_000;

export interface TeamSettings {
  name: string;
  logo: string | null;
  defaultVenue: string | null;
  timezone: string;
  clockFormat: "12h" | "24h";
  weekStart: "monday" | "sunday";
  defaultStartTime: string | null;
  defaultProgression: "auto" | "manual";
  requireApproval: boolean;
  allowSelfApproval: boolean;
  defaultApproverIds: string[];
  remindersEnabled: boolean;
  reminderOffsets: number[];
  inviteDefaultRole: "admin" | "member";
  inviteExpiryDays: number;
  inviteLinkEnabled: boolean;
  linkRequiresApproval: boolean;
  liveWarningMinutes: number;
  liveShowNames: boolean;
}

export interface TeamRow {
  id: string;
  name: string;
  logo_data: string | null;
  default_venue: string | null;
  timezone: string;
  clock_format: "12h" | "24h";
  week_start: "monday" | "sunday";
  default_start_time: string | null;
  default_progression: "auto" | "manual";
  require_approval: number;
  allow_self_approval: number;
  reminders_enabled: number;
  reminder_offsets: string;
  invite_default_role: "admin" | "member";
  invite_expiry_days: number;
  invite_link_enabled: number;
  link_requires_approval: number;
  live_warning_minutes: number;
  live_show_names: number;
}

export async function loadTeam(db: D1Database, teamId: string): Promise<TeamRow | null> {
  return db.prepare("SELECT * FROM teams WHERE id = ?").bind(teamId).first<TeamRow>();
}

export function parseOffsets(raw: string): number[] {
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((n): n is number => typeof n === "number").sort((a, b) => b - a) : [];
  } catch {
    return [];
  }
}

export async function loadSettings(db: D1Database, teamId: string): Promise<TeamSettings | null> {
  const [t, approvers] = await Promise.all([
    loadTeam(db, teamId),
    db
      .prepare(
        `SELECT d.user_id FROM team_default_approvers d
           JOIN team_memberships m ON m.team_id = d.team_id AND m.user_id = d.user_id
          WHERE d.team_id = ? AND m.role = 'approver' AND m.status = 'active'`,
      )
      .bind(teamId)
      .all<{ user_id: string }>(),
  ]);
  if (!t) return null;
  return {
    name: t.name,
    logo: t.logo_data,
    defaultVenue: t.default_venue,
    timezone: t.timezone,
    clockFormat: t.clock_format,
    weekStart: t.week_start,
    defaultStartTime: t.default_start_time,
    defaultProgression: t.default_progression,
    requireApproval: t.require_approval === 1,
    allowSelfApproval: t.allow_self_approval === 1,
    defaultApproverIds: approvers.results.map((r) => r.user_id),
    remindersEnabled: t.reminders_enabled === 1,
    reminderOffsets: parseOffsets(t.reminder_offsets),
    inviteDefaultRole: t.invite_default_role,
    inviteExpiryDays: t.invite_expiry_days,
    inviteLinkEnabled: t.invite_link_enabled === 1,
    linkRequiresApproval: t.link_requires_approval === 1,
    liveWarningMinutes: t.live_warning_minutes,
    liveShowNames: t.live_show_names === 1,
  };
}

const oneOf = <T extends readonly number[]>(list: T, message: string) => z.number().refine((n) => (list as readonly number[]).includes(n), { error: message });

/** What Admins and Planners can change. Every field is optional: send only what changed. */
export const settingsPatch = z
  .object({
    name: z.string().trim().min(2, { error: "Use at least 2 characters." }).max(80, { error: "Use at most 80 characters." }),
    logo: z
      .string()
      .regex(/^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/, { error: "Use a PNG, JPG, WebP or SVG image." })
      .max(Math.ceil((MAX_LOGO_BYTES * 4) / 3) + 40, { error: "Use an image under 150 KB." })
      .nullable(),
    defaultVenue: z.string().trim().max(120, { error: "Use at most 120 characters." }).nullable(),
    timezone: timezoneField,
    clockFormat: z.enum(["12h", "24h"]),
    weekStart: z.enum(["monday", "sunday"]),
    defaultStartTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):(00|15|30|45)$/, { error: "Choose a time on the quarter hour." })
      .nullable(),
    defaultProgression: z.enum(["auto", "manual"]),
    requireApproval: z.boolean(),
    allowSelfApproval: z.boolean(),
    defaultApproverIds: z.array(z.string()).max(20),
    remindersEnabled: z.boolean(),
    reminderOffsets: z.array(oneOf(REMINDER_OFFSETS, "Choose reminder times from the list.")).max(REMINDER_OFFSETS.length),
    inviteDefaultRole: z.enum(["admin", "member"]),
    inviteExpiryDays: oneOf(INVITE_EXPIRY_DAYS, "Choose 3, 7, 14 or 30 days."),
    inviteLinkEnabled: z.boolean(),
    linkRequiresApproval: z.boolean(),
    liveWarningMinutes: oneOf(LIVE_WARNING_MINUTES, "Choose 1, 2 or 5 minutes."),
    liveShowNames: z.boolean(),
  })
  .partial();

export type SettingsPatch = z.infer<typeof settingsPatch>;

/** Column updates for a patch (everything except default approvers, which live in their own table). */
export function settingsColumns(p: SettingsPatch): [string, unknown][] {
  const b = (v: boolean | undefined) => (v === undefined ? undefined : v ? 1 : 0);
  const cols: [string, unknown][] = [
    ["name", p.name],
    ["logo_data", p.logo],
    ["default_venue", p.defaultVenue === undefined ? undefined : p.defaultVenue || null],
    ["timezone", p.timezone],
    ["clock_format", p.clockFormat],
    ["week_start", p.weekStart],
    ["default_start_time", p.defaultStartTime],
    ["default_progression", p.defaultProgression],
    ["require_approval", b(p.requireApproval)],
    ["allow_self_approval", b(p.allowSelfApproval)],
    ["reminders_enabled", b(p.remindersEnabled)],
    ["reminder_offsets", p.reminderOffsets === undefined ? undefined : JSON.stringify([...new Set(p.reminderOffsets)].sort((a, b) => b - a))],
    ["invite_default_role", p.inviteDefaultRole],
    ["invite_expiry_days", p.inviteExpiryDays],
    ["invite_link_enabled", b(p.inviteLinkEnabled)],
    ["link_requires_approval", b(p.linkRequiresApproval)],
    ["live_warning_minutes", p.liveWarningMinutes],
    ["live_show_names", b(p.liveShowNames)],
  ];
  return cols.filter(([, v]) => v !== undefined);
}

/** How a team appears on emails about its programs. The logo is served from a public URL, since mail apps block inline images. */
export function emailBrand(appOrigin: string, team: { id: string; name: string; logo_data: string | null; default_venue: string | null }) {
  // A cheap version tag, so mail apps don't keep showing an old logo after it changes.
  const v = team.logo_data ? team.logo_data.length.toString(36) + team.logo_data.slice(-8).replace(/[^A-Za-z0-9]/g, "") : "";
  return {
    teamName: team.name,
    logoUrl: team.logo_data ? `${appOrigin}/api/teams/${team.id}/logo?v=${v}` : null,
    venue: team.default_venue,
  };
}
