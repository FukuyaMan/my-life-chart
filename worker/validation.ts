/**
 * Strict server-side validation for TimelineDocument payloads.
 */

export type Precision = "year" | "quarter" | "month" | "day";
export type Mode = "lifetime" | "year" | "custom";
export type LineStyle = "straight" | "curve";

export type TimelineEvent = {
  id: string;
  occurredAt: string;
  datePrecision: Precision;
  score: number;
  title: string;
  description: string;
};

export type TimelineDocument = {
  schemaVersion: 6;
  id: string;
  title: string;
  mode: Mode;
  birth: string;
  range: { start: string; end: string };
  endAge: number;
  displayYear: number;
  yearStartMonth: number;
  showCalendarYear: boolean;
  inputPrecision: Precision;
  lineStyle: LineStyle;
  events: TimelineEvent[];
  updatedAt: string;
};

const VALID_MODES = new Set<Mode>(["lifetime", "year", "custom"]);
const VALID_PRECISIONS = new Set<Precision>(["year", "quarter", "month", "day"]);
const VALID_LINE_STYLES = new Set<LineStyle>(["straight", "curve"]);
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(str: string): boolean {
  if (!ISO_DATE_REGEX.test(str)) return false;
  const d = new Date(str);
  return !isNaN(d.getTime()) && d.toISOString().startsWith(str);
}

export function validateTimelineDocument(data: unknown): { success: true; document: TimelineDocument } | { success: false; error: string } {
  if (typeof data !== "object" || data === null) {
    return { success: false, error: "Document must be an object" };
  }

  const obj = data as Record<string, unknown>;

  if (obj.schemaVersion !== 6) {
    return { success: false, error: "Invalid schemaVersion (expected 6)" };
  }

  if (typeof obj.id !== "string" || obj.id.length < 1 || obj.id.length > 64) {
    return { success: false, error: "Invalid id" };
  }

  if (typeof obj.title !== "string" || obj.title.length < 1 || obj.title.length > 60) {
    return { success: false, error: "Title must be between 1 and 60 characters" };
  }

  if (typeof obj.mode !== "string" || !VALID_MODES.has(obj.mode as Mode)) {
    return { success: false, error: "Invalid mode" };
  }

  if (typeof obj.birth !== "string" || (obj.birth !== "" && !isValidIsoDate(obj.birth))) {
    return { success: false, error: "Invalid birth date" };
  }

  if (typeof obj.range !== "object" || obj.range === null) {
    return { success: false, error: "Invalid range" };
  }
  const rangeObj = obj.range as Record<string, unknown>;
  if (
    typeof rangeObj.start !== "string" ||
    typeof rangeObj.end !== "string" ||
    (rangeObj.start !== "" && !isValidIsoDate(rangeObj.start)) ||
    (rangeObj.end !== "" && !isValidIsoDate(rangeObj.end))
  ) {
    return { success: false, error: "Invalid range format" };
  }

  if (
    typeof obj.endAge !== "number" ||
    !Number.isInteger(obj.endAge) ||
    obj.endAge < 1 ||
    obj.endAge > 120
  ) {
    return { success: false, error: "endAge must be an integer between 1 and 120" };
  }

  if (
    typeof obj.displayYear !== "number" ||
    !Number.isInteger(obj.displayYear) ||
    obj.displayYear < 1 ||
    obj.displayYear > 9999
  ) {
    return { success: false, error: "displayYear must be an integer between 1 and 9999" };
  }

  if (
    typeof obj.yearStartMonth !== "number" ||
    !Number.isInteger(obj.yearStartMonth) ||
    obj.yearStartMonth < 1 ||
    obj.yearStartMonth > 12
  ) {
    return { success: false, error: "yearStartMonth must be an integer between 1 and 12" };
  }

  if (typeof obj.showCalendarYear !== "boolean") {
    return { success: false, error: "showCalendarYear must be a boolean" };
  }

  if (typeof obj.inputPrecision !== "string" || !VALID_PRECISIONS.has(obj.inputPrecision as Precision)) {
    return { success: false, error: "Invalid inputPrecision" };
  }

  if (typeof obj.lineStyle !== "string" || !VALID_LINE_STYLES.has(obj.lineStyle as LineStyle)) {
    return { success: false, error: "Invalid lineStyle" };
  }

  if (!Array.isArray(obj.events)) {
    return { success: false, error: "events must be an array" };
  }

  if (obj.events.length > 500) {
    return { success: false, error: "Too many events (max 500)" };
  }

  const validatedEvents: TimelineEvent[] = [];
  for (let i = 0; i < obj.events.length; i++) {
    const item = obj.events[i];
    if (typeof item !== "object" || item === null) {
      return { success: false, error: `Invalid event at index ${i}` };
    }
    const ev = item as Record<string, unknown>;

    if (typeof ev.id !== "string" || ev.id.length < 1 || ev.id.length > 64) {
      return { success: false, error: `Invalid event id at index ${i}` };
    }

    if (typeof ev.occurredAt !== "string" || !isValidIsoDate(ev.occurredAt)) {
      return { success: false, error: `Invalid event occurredAt at index ${i}` };
    }

    if (typeof ev.datePrecision !== "string" || !VALID_PRECISIONS.has(ev.datePrecision as Precision)) {
      return { success: false, error: `Invalid event datePrecision at index ${i}` };
    }

    if (
      typeof ev.score !== "number" ||
      isNaN(ev.score) ||
      ev.score < -100 ||
      ev.score > 100
    ) {
      return { success: false, error: `Invalid event score at index ${i} (-100 to 100)` };
    }

    if (typeof ev.title !== "string" || ev.title.length < 1 || ev.title.length > 60) {
      return { success: false, error: `Invalid event title at index ${i} (1 to 60 characters)` };
    }

    if (typeof ev.description !== "string" || ev.description.length > 500) {
      return { success: false, error: `Invalid event description at index ${i} (max 500 characters)` };
    }

    validatedEvents.push({
      id: ev.id,
      occurredAt: ev.occurredAt,
      datePrecision: ev.datePrecision as Precision,
      score: ev.score,
      title: ev.title,
      description: ev.description,
    });
  }

  if (typeof obj.updatedAt !== "string" || isNaN(new Date(obj.updatedAt).getTime())) {
    return { success: false, error: "Invalid updatedAt ISO string" };
  }

  const cleanDoc: TimelineDocument = {
    schemaVersion: 6,
    id: obj.id,
    title: obj.title,
    mode: obj.mode as Mode,
    birth: obj.birth,
    range: {
      start: (obj.range as { start: string }).start,
      end: (obj.range as { end: string }).end,
    },
    endAge: obj.endAge,
    displayYear: obj.displayYear,
    yearStartMonth: obj.yearStartMonth,
    showCalendarYear: obj.showCalendarYear,
    inputPrecision: obj.inputPrecision as Precision,
    lineStyle: obj.lineStyle as LineStyle,
    events: validatedEvents,
    updatedAt: obj.updatedAt,
  };

  return { success: true, document: cleanDoc };
}
