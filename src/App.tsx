import {
  addDays,
  addMonths,
  addYears,
  differenceInCalendarDays,
  differenceInYears,
  format,
  getYear,
  isValid,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from "date-fns";
import { ja } from "date-fns/locale";
import {
  CalendarDays,
  Check,
  CircleHelp,
  Download,
  FileDown,
  FileUp,
  Link,
  List,
  Moon,
  MoreHorizontal,
  Pencil,
  Plus,
  Redo2,
  Settings,
  Share2,
  Sun,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import LZString from "lz-string";
import { DayPicker } from "@daypicker/react";
import "@daypicker/react/style.css";
import {
  type ChangeEvent,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { z } from "zod";

type Theme = "auto" | "light" | "dark";
type Mode = "lifetime" | "year" | "custom";
type Precision = "year" | "quarter" | "month" | "day";
type LineStyle = "straight" | "curve";
type StaticPage = "about" | "privacy-policy" | "agreement";

const MODE_PATHS: Record<Mode, string> = {
  lifetime: "/life",
  year: "/year",
  custom: "/period",
};

const MODE_LABELS: Record<Mode, string> = {
  lifetime: "人生グラフ",
  year: "一年グラフ",
  custom: "期間指定",
};

const LIFE_TITLE_SUFFIX = "の人生グラフ";

function lifetimeName(title: string) {
  if (title.endsWith(LIFE_TITLE_SUFFIX)) return title.slice(0, -LIFE_TITLE_SUFFIX.length);
  if (title === "人生グラフ") return "わたし";
  return title;
}

function lifetimeTitle(name: string) {
  return `${name}${LIFE_TITLE_SUFFIX}`;
}

function modePath(mode: Mode, viewOnly = false) {
  return `${MODE_PATHS[mode]}/${viewOnly ? "view" : "edit"}`;
}

function modeFromPath(pathname = window.location.pathname): Mode {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.includes("year")) return "year";
  if (segments.includes("period")) return "custom";
  return "lifetime";
}

function isViewPath(pathname = window.location.pathname) {
  return pathname.split("/").filter(Boolean).at(-1) === "view";
}

function staticPageFromPath(pathname = window.location.pathname): StaticPage | null {
  const page = pathname.split("/").filter(Boolean).at(-1);
  return page === "about" || page === "privacy-policy" || page === "agreement" ? page : null;
}

type TimelineEvent = {
  id: string;
  occurredAt: string;
  datePrecision: Precision;
  score: number;
  title: string;
  description: string;
};

type TimelineDocument = {
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

const eventSchema = z.object({
  id: z.string(),
  occurredAt: z.string(),
  datePrecision: z.enum(["year", "quarter", "month", "day"]),
  score: z.number().min(-100).max(100),
  title: z.string().min(1).max(60),
  description: z.string().max(500),
});

const documentSchema = z.object({
  schemaVersion: z.literal(6),
  id: z.string(),
  title: z.string(),
  mode: z.enum(["lifetime", "year", "custom"]),
  birth: z.string(),
  range: z.object({ start: z.string(), end: z.string() }),
  endAge: z.number().min(1).max(120),
  displayYear: z.number().int().min(1).max(9999),
  yearStartMonth: z.number().int().min(1).max(12),
  showCalendarYear: z.boolean(),
  inputPrecision: z.enum(["year", "quarter", "month", "day"]),
  lineStyle: z.enum(["straight", "curve"]),
  events: z.array(eventSchema),
  updatedAt: z.string(),
});

const today = new Date();
const defaultBirth = "";
const defaultEndAge = 30;
const defaultDocument: TimelineDocument = {
  schemaVersion: 6,
  id: crypto.randomUUID(),
  title: "わたしの人生グラフ",
  mode: "lifetime",
  birth: defaultBirth,
  range: { start: format(addYears(today, -1), "yyyy-MM-dd"), end: format(today, "yyyy-MM-dd") },
  endAge: defaultEndAge,
  displayYear: getYear(today),
  yearStartMonth: 1,
  showCalendarYear: true,
  inputPrecision: "year",
  lineStyle: "curve",
  events: [],
  updatedAt: new Date().toISOString(),
};

const STORAGE_KEYS: Record<Mode, string> = {
  lifetime: "jinsei-graph:document:lifetime:v2",
  year: "jinsei-graph:document:year:v2",
  custom: "jinsei-graph:document:custom:v2",
};
const THEME_KEY = "jinsei-graph:theme";
const MARGIN = { top: 46, right: 34, bottom: 72, left: 52 };
const GRAPH_HEIGHT = 460;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function systemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getQuarterStartMonth(month: number): number {
  return Math.floor(month / 3) * 3;
}

function getQuarterSeasonName(month: number): string {
  const q = Math.floor(month / 3);
  if (q === 0) return "春";
  if (q === 1) return "夏";
  if (q === 2) return "秋";
  return "冬";
}

function snapDate(date: Date, precision: Precision): Date {
  if (precision === "quarter") {
    const qStartMonth = getQuarterStartMonth(date.getMonth());
    const current = new Date(date.getFullYear(), qStartMonth, 1);
    const next = addMonths(current, 3);
    return date.getTime() - current.getTime() <= next.getTime() - date.getTime() ? current : next;
  }
  const current = precision === "year" ? startOfYear(date) : precision === "month" ? startOfMonth(date) : startOfDay(date);
  const next = precision === "year" ? addYears(current, 1) : precision === "month" ? addMonths(current, 1) : addDays(current, 1);
  return date.getTime() - current.getTime() <= next.getTime() - date.getTime() ? current : next;
}

function snapDateForDocument(date: Date, precision: Precision, doc: TimelineDocument): Date {
  if (precision !== "year" || doc.mode !== "lifetime") return snapDate(date, precision);
  const birth = safeDate(doc.birth);
  const age = Math.max(0, differenceInYears(date, birth));
  const currentBirthday = addYears(birth, age);
  const nextBirthday = addYears(birth, age + 1);
  if (nextBirthday > getWritableEnd(doc)) return currentBirthday;
  return Math.abs(date.getTime() - currentBirthday.getTime()) <= Math.abs(nextBirthday.getTime() - date.getTime()) ? currentBirthday : nextBirthday;
}

function withBirth(doc: TimelineDocument, birth: string): TimelineDocument {
  const birthDate = safeDate(birth);
  const birthEvent: TimelineEvent = { id: "birth", occurredAt: birth, datePrecision: "day", score: 0, title: "誕生", description: "" };
  const hasBirthEvent = doc.events.some((event) => event.id === "birth");
  return {
    ...doc,
    birth,
    endAge: clamp(differenceInYears(today, birthDate), 1, 120),
    range: { start: birth, end: format(today, "yyyy-MM-dd") },
    events: hasBirthEvent
      ? doc.events.map((event) => event.id === "birth" ? { ...event, occurredAt: birth } : event)
      : [birthEvent, ...doc.events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)),
  };
}

function parseDateInput(value: string): string | null {
  const normalized = value.trim().replace(/[./]/g, "-");
  const match = normalized.match(/^(\d{1,4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return null;
  const iso = `${match[1].padStart(4, "0")}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const parsed = parseISO(iso);
  return isValid(parsed) && format(parsed, "yyyy-MM-dd") === iso ? iso : null;
}

function safeDate(value: string, fallback = today) {
  const date = parseISO(value);
  return isValid(date) ? date : fallback;
}

function getWritableEnd(doc: TimelineDocument): Date {
  if (doc.mode !== "lifetime") return safeDate(doc.range.end);
  const start = safeDate(doc.birth);
  const currentAge = differenceInYears(today, start);
  return doc.endAge === currentAge ? today : addYears(start, doc.endAge);
}

function getFullRange(doc: TimelineDocument): [Date, Date] {
  if (doc.mode === "lifetime") {
    if (!doc.birth) return [addYears(today, -30), addDays(today, 183)];
    const start = safeDate(doc.birth);
    const writableEnd = getWritableEnd(doc);
    const spanDays = Math.max(1, differenceInCalendarDays(writableEnd, start));
    const bufferDays = clamp(Math.round(spanDays * 0.08), 30, 183);
    return [start, addDays(writableEnd, bufferDays)];
  }
  if (doc.mode === "custom" && (!doc.range.start || !doc.range.end)) return [addYears(today, -1), today];
  return [safeDate(doc.range.start), safeDate(doc.range.end)];
}

function getModeRange(mode: Mode, doc: TimelineDocument): [Date, Date] {
  if (mode === "lifetime") {
    const start = safeDate(doc.birth);
    const next = { ...doc, mode };
    return getFullRange(next);
  }
  if (mode === "year") {
    const start = parseISO(`${String(doc.displayYear).padStart(4, "0")}-${String(doc.yearStartMonth).padStart(2, "0")}-01`);
    return [start, addYears(start, 1)];
  }
  return [safeDate(doc.range.start), safeDate(doc.range.end)];
}

function withMode(doc: TimelineDocument, mode: Mode): TimelineDocument {
  const normalized = mode === "lifetime" ? { ...doc, title: lifetimeTitle(lifetimeName(doc.title)) } : doc;
  if (mode === "custom" && (!doc.range.start || !doc.range.end)) return { ...normalized, mode };
  const range = getModeRange(mode, doc);
  return {
    ...normalized,
    mode,
    range: { start: format(range[0], "yyyy-MM-dd"), end: format(range[1], "yyyy-MM-dd") },
  };
}

function createDocument(mode: Mode): TimelineDocument {
  const titles: Record<Mode, string> = {
    lifetime: "わたしの人生グラフ",
    year: "わたしの一年グラフ",
    custom: "わたしのグラフ",
  };
  const base: TimelineDocument = {
    ...defaultDocument,
    id: crypto.randomUUID(),
    title: titles[mode],
    events: mode === "lifetime" ? defaultDocument.events.map((event) => ({ ...event })) : [],
    updatedAt: new Date().toISOString(),
  };
  if (mode === "custom") return { ...base, mode, birth: "", range: { start: "", end: "" } };
  return withMode(base, mode);
}

function loadDocument(mode: Mode): TimelineDocument {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS[mode]);
    return saved ? withMode(documentSchema.parse(JSON.parse(saved)), mode) : createDocument(mode);
  } catch {
    return createDocument(mode);
  }
}

function withYearRange(doc: TimelineDocument, displayYear: number, yearStartMonth: number): TimelineDocument {
  const year = clamp(displayYear, 1, 9999);
  const month = clamp(yearStartMonth, 1, 12);
  const start = parseISO(`${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`);
  return { ...doc, displayYear: year, yearStartMonth: month, range: { start: format(start, "yyyy-MM-dd"), end: format(addYears(start, 1), "yyyy-MM-dd") } };
}

function formatRange(start: Date, end: Date) {
  const days = differenceInCalendarDays(end, start);
  if (days > 730) return `${format(start, "yyyy")} — ${format(end, "yyyy")}`;
  if (days > 60) return `${format(start, "yyyy年M月")} — ${format(end, "yyyy年M月")}`;
  return `${format(start, "M月d日")} — ${format(end, "M月d日")}`;
}

function closestStep(raw: number, choices: number[]) {
  return choices.reduce((best, value) => Math.abs(value - raw) < Math.abs(best - raw) ? value : best, choices[0]);
}

function tickSpec(start: Date, end: Date, width: number, doc: TimelineDocument) {
  const days = Math.max(1, differenceInCalendarDays(end, start));
  const target = clamp(Math.round(width / 74), 6, 18);

  if (doc.mode === "year") {
    if (days > 90) return { unit: "month" as const, step: 1, label: "月" };
    return { unit: "day" as const, step: closestStep(days / target, [1, 2, 3, 5, 7]), label: "日" };
  }

  if (days > 1095) return { unit: "year" as const, step: closestStep(days / 365.25 / target, [1, 2, 5, 10, 20]), label: "年" };
  if (days > 457) return { unit: "quarter" as const, step: 1, label: "四半期" };
  if (days > 90) return { unit: "month" as const, step: closestStep(days / 30.44 / target, [1, 2, 3]), label: "月" };
  return { unit: "day" as const, step: closestStep(days / target, [1, 2, 3, 5, 7]), label: "日" };
}

function makeTicks(start: Date, end: Date, width: number, doc: TimelineDocument) {
  const spec = tickSpec(start, end, width, doc);
  let cursor =
    spec.unit === "year"
      ? startOfYear(start)
      : spec.unit === "quarter"
      ? new Date(start.getFullYear(), getQuarterStartMonth(start.getMonth()), 1)
      : spec.unit === "month"
      ? startOfMonth(start)
      : startOfDay(start);

  const ticks: Date[] = [];
  for (let guard = 0; guard < 200 && cursor <= end; guard += 1) {
    if (cursor >= start) ticks.push(cursor);
    cursor =
      spec.unit === "year"
        ? addYears(cursor, spec.step)
        : spec.unit === "quarter"
        ? addMonths(cursor, spec.step * 3)
        : spec.unit === "month"
        ? addMonths(cursor, spec.step)
        : addDays(cursor, spec.step);
  }
  return { ...spec, ticks };
}

function formatTick(date: Date, unit: string, doc: TimelineDocument) {
  if (doc.mode === "lifetime" && unit === "year") {
    const age = Math.max(0, differenceInYears(date, safeDate(doc.birth)));
    return { primary: `${age}歳`, secondary: doc.showCalendarYear ? `${format(date, "yyyy")}年` : "" };
  }
  if (unit === "year") return { primary: format(date, "yyyy年"), secondary: "" };
  if (unit === "quarter") {
    const season = getQuarterSeasonName(date.getMonth());
    if (doc.mode === "lifetime") {
      const age = Math.max(0, differenceInYears(date, safeDate(doc.birth)));
      return { primary: season, secondary: `${age}歳 · ${format(date, "yyyy")}年` };
    }
    return { primary: season, secondary: `${format(date, "yyyy")}年` };
  }
  if (unit === "month") return { primary: format(date, "M月"), secondary: format(date, "yyyy年") };
  return { primary: format(date, "M/d"), secondary: format(date, "EEE", { locale: ja }) };
}

function eventDateLabel(event: TimelineEvent, doc: TimelineDocument, currentUnit?: string) {
  const date = safeDate(event.occurredAt);
  const precision = event.id === "birth" ? "day" : (event.datePrecision || doc.inputPrecision);
  const datePart =
    precision === "year" && currentUnit !== "quarter"
      ? format(date, "yyyy年")
      : precision === "quarter" || currentUnit === "quarter"
      ? `${format(date, "yyyy年")} ${getQuarterSeasonName(date.getMonth())}`
      : precision === "month"
      ? format(date, "yyyy年M月")
      : format(date, "yyyy年M月d日");
  if (doc.mode !== "lifetime") return datePart;
  const age = differenceInYears(date, safeDate(doc.birth));
  return `${age}歳 · ${datePart}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function eventTone(score: number) {
  return score > 0 ? "positive" : score < 0 ? "negative" : "neutral";
}

function eventLabelIsAbove(score: number, y: number) {
  const isNearTop = y < MARGIN.top + 50;
  const isNearBottom = y > GRAPH_HEIGHT - MARGIN.bottom - 50;
  return !isNearTop && (score >= 0 || isNearBottom);
}

function approximateTextWidth(text: string, fontSize: number) {
  return [...text].reduce((width, character) => width + (character.charCodeAt(0) > 255 ? fontSize : fontSize * 0.58), 0);
}

function wrapPopoverText(text: string, maxWidth: number, fontSize: number, maxLines: number) {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (!paragraph) {
      lines.push(" ");
      continue;
    }
    let line = "";
    for (const character of paragraph) {
      if (line && approximateTextWidth(line + character, fontSize) > maxWidth) {
        lines.push(line);
        line = character;
      } else {
        line += character;
      }
    }
    if (line) lines.push(line);
  }
  if (lines.length <= maxLines) return lines;
  const visible = lines.slice(0, maxLines);
  let last = visible[maxLines - 1].trimEnd();
  while (last && approximateTextWidth(`${last}…`, fontSize) > maxWidth) last = last.slice(0, -1);
  visible[maxLines - 1] = `${last}…`;
  return visible;
}

function IconButton({ label, children, onClick, disabled = false }: { label: string; children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button type="button" className="icon-button" aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</button>;
}

function DatePickerField({ value, onChange, readOnly = false, compact = false, label = "日付", placeholder = "年月日を選択", precision = "day", minDate = new Date(1900, 0, 1), maxDate = new Date(2100, 11, 31) }: { value: string; onChange: (value: string) => void; readOnly?: boolean; compact?: boolean; label?: string; placeholder?: string; precision?: Precision; minDate?: Date; maxDate?: Date }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = safeDate(value);
  const [month, setMonth] = useState(selected);
  const [yearInput, setYearInput] = useState(() => String(getYear(selected)));
  const [monthInput, setMonthInput] = useState(() => String(selected.getMonth() + 1));

  useEffect(() => {
    setMonth(selected);
    setYearInput(String(getYear(selected)));
  }, [value]);

  useEffect(() => {
    setYearInput(String(getYear(month)));
    setMonthInput(String(month.getMonth() + 1));
  }, [month]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const minYear = getYear(minDate);
  const maxYear = getYear(maxDate);

  const handleYearChange = (e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setYearInput(val);
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed) && parsed >= minYear && parsed <= maxYear) {
      setMonth(new Date(parsed, month.getMonth(), 1));
    }
  };

  const handleYearBlur = () => {
    const parsed = parseInt(yearInput, 10);
    if (isNaN(parsed) || parsed < minYear || parsed > maxYear) {
      setYearInput(String(getYear(month)));
    } else {
      setMonth(new Date(parsed, month.getMonth(), 1));
    }
  };

  const handleMonthChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;
    setMonthInput(nextValue);
    const parsed = Number(nextValue);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 12) setMonth(new Date(getYear(month), parsed - 1, 1));
  };

  const handleMonthBlur = () => {
    const parsed = Number(monthInput);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 12) setMonthInput(String(month.getMonth() + 1));
  };

  return <div className={`date-picker-field ${compact ? "compact" : ""}`} ref={rootRef}>
    <button type="button" className="date-picker-trigger" disabled={readOnly} aria-label={value ? `${label} ${format(selected, "yyyy年M月d日")}` : `${label}を選択`} aria-expanded={open} onClick={() => setOpen((current) => !current)}>
      <span>{value ? format(selected, "yyyy / MM / dd") : placeholder}</span><CalendarDays size={15} />
    </button>
    {open && <div className="date-picker-popover">
      <div className="calendar-jump">
        <label>
          <span>年</span>
          <input
            type="number"
            min={minYear}
            max={maxYear}
            value={yearInput}
            onChange={handleYearChange}
            onBlur={handleYearBlur}
          />
        </label>
        {precision === "quarter" ? (
          <label>
            <span>四半期</span>
            <select value={getQuarterStartMonth(month.getMonth())} onChange={(event) => setMonth(new Date(month.getFullYear(), Number(event.target.value), 1))}>
              <option value={0}>春 (1-3月)</option>
              <option value={3}>夏 (4-6月)</option>
              <option value={6}>秋 (7-9月)</option>
              <option value={9}>冬 (10-12月)</option>
            </select>
          </label>
        ) : (
          <label>
            <span>月</span>
            <input type="number" inputMode="numeric" min="1" max="12" value={monthInput} onChange={handleMonthChange} onBlur={handleMonthBlur} />
          </label>
        )}
      </div>
      <DayPicker mode="single" locale={ja} selected={value ? selected : undefined} month={month} onMonthChange={setMonth} startMonth={minDate} endMonth={maxDate} hideNavigation onSelect={(date) => { if (date) { onChange(format(date, "yyyy-MM-dd")); setOpen(false); } }} />
    </div>}
  </div>;
}

function getScoreAtTime(events: TimelineEvent[], date: Date): number {
  if (!events.length) return 0;
  const sorted = [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const t = date.getTime();
  const firstTime = safeDate(sorted[0].occurredAt).getTime();
  if (t <= firstTime) return sorted[0].id === "birth" ? sorted[0].score : 0;

  const lastTime = safeDate(sorted[sorted.length - 1].occurredAt).getTime();
  if (t >= lastTime) return sorted[sorted.length - 1].score;

  for (let i = 0; i < sorted.length - 1; i++) {
    const t1 = safeDate(sorted[i].occurredAt).getTime();
    const t2 = safeDate(sorted[i + 1].occurredAt).getTime();
    if (t >= t1 && t <= t2) {
      const ratio = (t - t1) / (t2 - t1 || 1);
      return sorted[i].score + ratio * (sorted[i + 1].score - sorted[i].score);
    }
  }
  return 0;
}

function App() {
  const staticPage = staticPageFromPath();
  const sharedDocument = useMemo(() => {
    if (!location.hash.startsWith("#share=")) return null;
    try {
      const decoded = LZString.decompressFromEncodedURIComponent(location.hash.slice(7));
      return documentSchema.parse(JSON.parse(decoded));
    } catch {
      return null;
    }
  }, []);

  const [doc, setDoc] = useState<TimelineDocument>(() => {
    const mode = sharedDocument?.mode ?? modeFromPath();
    return sharedDocument ? withMode(sharedDocument, mode) : loadDocument(mode);
  });
  const [history, setHistory] = useState<TimelineDocument[]>([]);
  const [future, setFuture] = useState<TimelineDocument[]>([]);
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem(THEME_KEY) as Theme) || "auto");
  const [view, setView] = useState<[Date, Date]>(() => getFullRange(doc));
  const [modal, setModal] = useState<{ open: boolean; event: TimelineEvent | null }>({ open: false, event: null });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [pointer, setPointer] = useState<{ date: Date; score: number; x: number; y: number } | null>(null);
  const [hoveredEvents, setHoveredEvents] = useState<TimelineEvent[]>([]);
  const hoveredEvent = hoveredEvents[0] || null;
  const hoveredEventIds = useMemo(() => new Set(hoveredEvents.map((item) => item.id)), [hoveredEvents]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [width, setWidth] = useState(900);
  const graphWrapRef = useRef<HTMLDivElement>(null);
  const eventPreviewsRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const dragStartRef = useRef<TimelineDocument | null>(null);
  const hoverOriginRef = useRef<"graph" | "preview" | null>(null);
  const themeCycleOriginRef = useRef<"light" | "dark">(systemTheme());
  const panStartRef = useRef<{ pointerId: number; clientX: number; view: [number, number] } | null>(null);
  const suppressDoubleClickRef = useRef(false);
  const eventDragStartRef = useRef<{ x: number; y: number } | null>(null);
  const eventDragMovedRef = useRef(false);
  const [isPanning, setIsPanning] = useState(false);
  const readOnly = Boolean(sharedDocument) || isViewPath();
  const needsBirth = doc.mode === "lifetime" && !doc.birth;
  const needsPeriod = doc.mode === "custom" && (!doc.range.start || !doc.range.end);
  const needsSetup = needsBirth || needsPeriod;
  const effectiveTheme = theme === "auto" ? systemTheme() : theme;

  const cycleTheme = () => {
    if (theme === "auto") {
      const current = systemTheme();
      themeCycleOriginRef.current = current;
      setTheme(current === "light" ? "dark" : "light");
      return;
    }
    if (theme !== themeCycleOriginRef.current) {
      setTheme(themeCycleOriginRef.current);
      return;
    }
    setTheme("auto");
  };

  const updateDoc = useCallback((updater: (current: TimelineDocument) => TimelineDocument, record = true) => {
    setDoc((current) => {
      const next = { ...updater(current), updatedAt: new Date().toISOString() };
      if (record) {
        setHistory((items) => [...items.slice(-19), current]);
        setFuture([]);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!readOnly) localStorage.setItem(STORAGE_KEYS[doc.mode], JSON.stringify(doc));
    const staticTitles: Record<StaticPage, string> = {
      about: "このサイトについて",
      "privacy-policy": "プライバシーポリシー",
      agreement: "利用規約",
    };
    document.title = staticPage ? `${staticTitles[staticPage]} | My Life Chart` : `${doc.title || "わたしのグラフ"} | My Life Chart`;
  }, [doc, readOnly, staticPage]);

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!graphWrapRef.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(320, entry.contentRect.width)));
    observer.observe(graphWrapRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const currentPath = window.location.pathname.replace(/\/+$/, "");
    if (!currentPath) {
      window.history.replaceState(null, "", `${modePath(doc.mode)}${window.location.search}${window.location.hash}`);
    }

    const handlePopState = () => {
      const mode = modeFromPath();
      const next = sharedDocument ? withMode(sharedDocument, mode) : loadDocument(mode);
      setDoc(next);
      setView(getFullRange(next));
      setHistory([]);
      setFuture([]);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [sharedDocument]);

  useEffect(() => {
    if (!hoveredEvents.length || !eventPreviewsRef.current) return;
    if (hoverOriginRef.current !== "graph") return;
    const first = hoveredEvents[0];
    const target = eventPreviewsRef.current.querySelector<HTMLElement>(`[data-event-id="${first.id}"]`);
    if (!target) return;
    eventPreviewsRef.current.scrollTo({ left: target.offsetLeft - (eventPreviewsRef.current.clientWidth - target.offsetWidth) / 2, behavior: "smooth" });
  }, [hoveredEvents]);

  const plotWidth = Math.max(220, width - MARGIN.left - MARGIN.right);
  const plotHeight = GRAPH_HEIGHT - MARGIN.top - MARGIN.bottom;
  const viewMs = Math.max(1, view[1].getTime() - view[0].getTime());
  const xForDate = (date: Date) => MARGIN.left + ((date.getTime() - view[0].getTime()) / viewMs) * plotWidth;
  const dateForX = (x: number) => new Date(view[0].getTime() + clamp((x - MARGIN.left) / plotWidth, 0, 1) * viewMs);
  const yForScore = (score: number) => MARGIN.top + ((110 - score) / 220) * plotHeight;
  const scoreForY = (y: number) => Math.round(clamp(110 - ((y - MARGIN.top) / plotHeight) * 220, -100, 100) / 10) * 10;
  const tickData = useMemo(() => makeTicks(view[0], view[1], plotWidth, doc), [view, plotWidth, doc]);
  const { unit, step, label: unitLabel } = tickData;
  const ticks = useMemo(() => {
    if (doc.mode !== "lifetime" || unit !== "year") return tickData.ticks;
    const birth = safeDate(doc.birth);
    const result: Date[] = [];
    for (let age = 0; age <= doc.endAge + step; age += step) {
      const tick = addYears(birth, age);
      if (tick >= view[0] && tick <= view[1]) result.push(tick);
    }
    return result;
  }, [doc.mode, doc.birth, doc.endAge, unit, step, tickData.ticks, view]);
  useEffect(() => {
    if (readOnly) return;
    const precision: Precision = unit === "year" ? "year" : unit === "quarter" ? "quarter" : unit === "month" ? "month" : "day";
    setDoc((current) => current.inputPrecision === precision ? current : {
      ...current,
      inputPrecision: precision,
      events: current.events.map((item) => item.id === "birth" ? item : { ...item, datePrecision: precision }),
      updatedAt: new Date().toISOString(),
    });
  }, [unit, readOnly]);
  const visibleEvents = useMemo(() => doc.events.filter((event) => {
    const time = safeDate(event.occurredAt).getTime();
    return time >= view[0].getTime() && time <= view[1].getTime();
  }).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)), [doc.events, view]);
  const writableEnd = getWritableEnd(doc);
  const linePath = useMemo(() => {
    const minX = MARGIN.left;
    const maxX = width - MARGIN.right;
    const sorted = [...doc.events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

    if (!sorted.length) {
      const y0 = yForScore(0);
      return `M ${minX} ${y0} L ${maxX} ${y0}`;
    }

    const startScore = getScoreAtTime(doc.events, view[0]);
    const endScore = getScoreAtTime(doc.events, view[1]);

    const insideEvents = visibleEvents.filter((ev) => {
      const t = safeDate(ev.occurredAt).getTime();
      return t > view[0].getTime() && t < view[1].getTime();
    });

    const points = [
      { x: minX, y: yForScore(startScore) },
      ...insideEvents.map((ev) => ({ x: xForDate(safeDate(ev.occurredAt)), y: yForScore(ev.score) })),
      { x: maxX, y: yForScore(endScore) },
    ];

    return points.reduce((path, pt, idx) => {
      if (idx === 0) return `M ${pt.x} ${pt.y}`;
      const prev = points[idx - 1];
      if (doc.lineStyle === "straight") {
        return `${path} L ${pt.x} ${pt.y}`;
      }
      const midX = (prev.x + pt.x) / 2;
      return `${path} C ${midX} ${prev.y}, ${midX} ${pt.y}, ${pt.x} ${pt.y}`;
    }, "");
  }, [doc.events, doc.lineStyle, doc.mode, doc.birth, doc.endAge, doc.range.start, doc.range.end, visibleEvents, view, plotWidth, width]);

  const zoom = (factor: number, anchorRatio = 0.5) => {
    const anchor = view[0].getTime() + viewMs * clamp(anchorRatio, 0, 1);
    const nextSpan = clamp(viewMs * factor, 7 * 86400000, getFullRange(doc)[1].getTime() - getFullRange(doc)[0].getTime());
    const full = getFullRange(doc);
    let start = anchor - nextSpan * anchorRatio;
    let end = start + nextSpan;
    if (start < full[0].getTime()) { end += full[0].getTime() - start; start = full[0].getTime(); }
    if (end > full[1].getTime()) { start -= end - full[1].getTime(); end = full[1].getTime(); }
    setView([new Date(start), new Date(end)]);
  };

  useEffect(() => {
    const graph = svgRef.current;
    if (!graph) return;
    const handleWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault();
      const rect = graph.getBoundingClientRect();
      const svgX = ((event.clientX - rect.left) / Math.max(1, rect.width)) * width;
      const anchorRatio = clamp((svgX - MARGIN.left) / plotWidth, 0, 1);
      zoom(event.deltaY > 0 ? 1.22 : 0.82, anchorRatio);
    };
    graph.addEventListener("wheel", handleWheel, { passive: false });
    return () => graph.removeEventListener("wheel", handleWheel);
  }, [view, doc]);

  const pointerFromEvent = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * width;
    const y = ((clientY - rect.top) / rect.height) * GRAPH_HEIGHT;
    return { date: dateForX(x), score: scoreForY(y), x, y };
  };

  const openNewEvent = (date = new Date((view[0].getTime() + view[1].getTime()) / 2), score = 0) => {
    if (readOnly) return;
    if (date > getWritableEnd(doc)) {
      setToast("未来の余白には出来事を追加できません");
      return;
    }
    const snapped = snapDateForDocument(date, doc.inputPrecision, doc);
    const snappedDate = snapped > getWritableEnd(doc) ? getWritableEnd(doc) : snapped;
    setModal({
      open: true,
      event: { id: crypto.randomUUID(), occurredAt: format(snappedDate, "yyyy-MM-dd"), datePrecision: doc.inputPrecision, score: Math.round(score / 10) * 10, title: "", description: "" },
    });
  };

  const saveEvent = (event: TimelineEvent) => {
    if (safeDate(event.occurredAt) > getWritableEnd(doc)) {
      setToast("表示範囲より未来の出来事は保存できません");
      return;
    }
    updateDoc((current) => ({ ...current, events: [...current.events.filter((item) => item.id !== event.id), event].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)) }));
    setModal({ open: false, event: null });
    setToast("出来事を保存しました");
  };

  const deleteEvent = (id: string) => {
    updateDoc((current) => ({ ...current, events: current.events.filter((event) => event.id !== id) }));
    setModal({ open: false, event: null });
    setToast("出来事を削除しました");
  };

  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setFuture((items) => [doc, ...items].slice(0, 20));
    setHistory((items) => items.slice(0, -1));
    setDoc(previous);
  };

  const redo = () => {
    const next = future[0];
    if (!next) return;
    setHistory((items) => [...items, doc].slice(-20));
    setFuture((items) => items.slice(1));
    setDoc(next);
  };

  const copyShareLink = async () => {
    const sharedGraph = { ...doc, title: doc.title };
    const payload = LZString.compressToEncodedURIComponent(JSON.stringify(sharedGraph));
    const url = `${location.origin}${modePath(doc.mode, true)}#share=${payload}`;
    if (url.length > 12000) {
      setToast("リンクが長すぎます。JSONか画像をご利用ください");
      return;
    }
    await navigator.clipboard.writeText(url);
    setToast("共有リンクをコピーしました");
  };

  const exportJson = () => downloadBlob(new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }), "jinsei-graph.json");

  const importJson = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = withMode(documentSchema.parse(JSON.parse(await file.text())), doc.mode);
      updateDoc(() => parsed);
      setView(getFullRange(parsed));
      setToast("データを読み込みました");
    } catch {
      setToast("このファイルは読み込めませんでした");
    }
    event.target.value = "";
  };

  const exportPng = async () => {
    if (!svgRef.current) return;
    const clone = svgRef.current.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const css = [...document.styleSheets].flatMap((sheet) => {
      try { return [...sheet.cssRules].map((rule) => rule.cssText); } catch { return []; }
    }).join("\n");
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = css;
    clone.prepend(style);
    const title = document.createElementNS("http://www.w3.org/2000/svg", "text");
    title.setAttribute("x", String(MARGIN.left));
    title.setAttribute("y", "28");
    title.setAttribute("fill", getComputedStyle(document.documentElement).getPropertyValue("--text").trim() || "#24232b");
    title.setAttribute("font-family", getComputedStyle(document.body).fontFamily);
    title.setAttribute("font-size", "18");
    title.setAttribute("font-weight", "700");
    title.textContent = doc.title;
    clone.prepend(title);
    const serialized = new XMLSerializer().serializeToString(clone);
    const image = new Image();
    const source = URL.createObjectURL(new Blob([serialized], { type: "image/svg+xml" }));
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * 2);
      canvas.height = GRAPH_HEIGHT * 2;
      const context = canvas.getContext("2d")!;
      context.scale(2, 2);
      context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() || "#fff";
      context.fillRect(0, 0, width, GRAPH_HEIGHT);
      context.drawImage(image, 0, 0, width, GRAPH_HEIGHT);
      canvas.toBlob((blob) => blob && downloadBlob(blob, "jinsei-graph.png"), "image/png");
      URL.revokeObjectURL(source);
    };
    image.src = source;
  };

  const changeMode = (mode: Mode) => {
    const next = loadDocument(mode);
    setDoc(next);
    setView(getFullRange(next));
    setHistory([]);
    setFuture([]);
    const nextUrl = `${modePath(mode)}${window.location.search}`;
    if (window.location.pathname !== modePath(mode)) window.history.pushState(null, "", nextUrl);
  };

  const changeBirthDate = (birth: string) => {
    const parsed = parseISO(birth);
    if (!birth || !isValid(parsed)) return;
    const next = withBirth(doc, birth);
    updateDoc(() => next);
    setView(getFullRange(next));
  };

  const changeEndAge = (endAge: number) => {
    const next = { ...doc, endAge: clamp(endAge, 1, 120) };
    updateDoc(() => next);
    setView(getFullRange(next));
  };

  const changeYearSettings = (displayYear: number, yearStartMonth: number) => {
    const next = withYearRange(doc, displayYear, yearStartMonth);
    const range = getModeRange("year", next);
    updateDoc(() => next);
    setView(range);
  };

  const changeCustomRange = (key: "start" | "end", value: string) => {
    if (!value) return;
    const range = { ...doc.range, [key]: value };
    if (safeDate(range.start) >= safeDate(range.end)) return;
    const next = { ...doc, range };
    updateDoc(() => next);
    setView([safeDate(range.start), safeDate(range.end)]);
  };

  const initializeCustomRange = (start: string, end: string) => {
    if (!start || !end || safeDate(start) >= safeDate(end)) return;
    const next = { ...doc, birth: "", range: { start, end } };
    updateDoc(() => next);
    const nextView: [Date, Date] = [safeDate(start), safeDate(end)];
    setView(nextView);
    setModal({
      open: true,
      event: { id: crypto.randomUUID(), occurredAt: start, datePrecision: doc.inputPrecision, score: 0, title: "", description: "" },
    });
  };

  const onGraphMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (panStartRef.current) {
      const start = panStartRef.current;
      const moved = event.clientX - start.clientX;
      if (Math.abs(moved) > 3) {
        setIsPanning(true);
        suppressDoubleClickRef.current = true;
      }
      const full = getFullRange(doc);
      const span = start.view[1] - start.view[0];
      const shift = -(moved / Math.max(1, svgRef.current!.getBoundingClientRect().width)) * span;
      let nextStart = start.view[0] + shift;
      let nextEnd = start.view[1] + shift;
      if (nextStart < full[0].getTime()) { nextEnd += full[0].getTime() - nextStart; nextStart = full[0].getTime(); }
      if (nextEnd > full[1].getTime()) { nextStart -= nextEnd - full[1].getTime(); nextEnd = full[1].getTime(); }
      setView([new Date(nextStart), new Date(nextEnd)]);
      setPointer(null);
      return;
    }
    const next = pointerFromEvent(event.clientX, event.clientY);
    if (dragging && eventDragStartRef.current) {
      const dragThreshold = event.pointerType === "touch" ? 8 : 3;
      if (Math.hypot(event.clientX - eventDragStartRef.current.x, event.clientY - eventDragStartRef.current.y) > dragThreshold) eventDragMovedRef.current = true;
    }
    if (dragging && !readOnly) {
      if (!eventDragMovedRef.current) return;
      const end = getWritableEnd(doc);
      const snapped = snapDateForDocument(next.date > end ? end : next.date, doc.inputPrecision, doc);
      const eventDate = snapped > end ? end : snapped;
      updateDoc((current) => ({ ...current, events: current.events.map((item) => item.id === dragging ? { ...item, occurredAt: item.id === "birth" ? item.occurredAt : format(eventDate, "yyyy-MM-dd"), score: next.score } : item) }), false);
    } else {
      if (next.date > getWritableEnd(doc)) {
        setPointer(null);
        if (hoverOriginRef.current === "graph") setHoveredEvents([]);
      } else {
        const snapped = snapDateForDocument(next.date, doc.inputPrecision, doc);
        const snappedDate = snapped > getWritableEnd(doc) ? getWritableEnd(doc) : snapped;
        setPointer({ ...next, date: snappedDate, x: xForDate(snappedDate), y: yForScore(next.score) });

        const xThreshold = 26;
        const matching = visibleEvents.filter((event) => {
          const ex = xForDate(safeDate(event.occurredAt));
          return Math.abs(next.x - ex) <= xThreshold;
        });

        matching.sort((a, b) => Math.abs(next.x - xForDate(safeDate(a.occurredAt))) - Math.abs(next.x - xForDate(safeDate(b.occurredAt))));

        if (matching.length > 0) {
          hoverOriginRef.current = "graph";
          setHoveredEvents(matching);
        } else if (hoverOriginRef.current === "graph") {
          setHoveredEvents([]);
        }
      }
    }
  };

  if (staticPage) {
    return <div className="app-shell static-page-shell">
      <header className="topbar static-topbar">
        <div className="topbar-leading">
          <a className="brand" href={modePath("lifetime")} aria-label="My Life Chart ホーム">
            <img className="brand-mark" src="/favicon.svg" alt="" />
            <span>My Life Chart</span>
          </a>
          <nav className="page-nav" aria-label="グラフの種類">
            {(Object.keys(MODE_PATHS) as Mode[]).map((mode) => <a key={mode} href={modePath(mode)}>{MODE_LABELS[mode]}</a>)}
          </nav>
        </div>
      </header>
      <main className="static-main"><StaticPageContent page={staticPage} /></main>
      <SiteFooter />
    </div>;
  }

  return (
    <div className={`app-shell ${eventsOpen ? "events-panel-open" : ""}`}>
      <header className="topbar">
        <div className="topbar-leading">
          <div className="brand" aria-label="My Life Chart ホーム">
            <img className="brand-mark" src="/favicon.svg" alt="" />
            <span>My Life Chart</span>
          </div>
          {!readOnly ? <nav className="page-nav" aria-label="グラフの種類">
            {(Object.keys(MODE_PATHS) as Mode[]).map((mode) => (
              <a
                key={mode}
                href={modePath(mode)}
                className={doc.mode === mode ? "active" : ""}
                aria-current={doc.mode === mode ? "page" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  if (doc.mode !== mode) changeMode(mode);
                }}
              >
                {MODE_LABELS[mode]}
              </a>
            ))}
          </nav> : <div className="shared-graph-context">
            <nav className="page-nav shared-page-nav" aria-label="グラフの種類">
              {(Object.keys(MODE_LABELS) as Mode[]).map((mode) => <a key={mode} href={modePath(mode)}>{MODE_LABELS[mode]}</a>)}
              <span className="shared-title-tab active" aria-current="page" title={doc.title}>{doc.title}</span>
            </nav>
          </div>}
        </div>
        <div className="top-actions">
          {sharedDocument && <div className="shared-view-status">
            <span>共有された人生グラフを見ています</span>
          </div>}
          {!readOnly && <>
            <IconButton label="元に戻す" onClick={undo} disabled={!history.length}><Undo2 size={15} /></IconButton>
            <IconButton label="やり直す" onClick={redo} disabled={!future.length}><Redo2 size={15} /></IconButton>
          </>}
          <IconButton label={`テーマを変更（現在: ${theme === "auto" ? `自動・${effectiveTheme === "light" ? "ライト" : "ダーク"}` : theme === "light" ? "ライト" : "ダーク"}）`} onClick={cycleTheme}>
            {theme === "auto" ? <span className="auto-theme">A</span> : theme === "dark" ? <Moon size={15} /> : <Sun size={15} />}
          </IconButton>
          {!readOnly && <button className="button secondary compact" onClick={() => setSettingsOpen(true)}><Settings size={14} /><span>設定</span></button>}
          <button className="button primary compact" onClick={() => setShareOpen(true)}><Share2 size={14} /><span>共有</span></button>
        </div>
      </header>

      <main>
        <section className="hero-row">
          <div>
            {readOnly ? <h1 className="readonly-graph-title">{doc.title}</h1> : <div className="title-editor">
              <input ref={titleRef} className="title-input" aria-label={doc.mode === "lifetime" ? "名前" : "グラフのタイトル"} value={doc.mode === "lifetime" ? lifetimeName(doc.title) : doc.title} readOnly={readOnly} maxLength={doc.mode === "lifetime" ? 40 : 60} style={{ width: `${Math.max(2, [...(doc.mode === "lifetime" ? lifetimeName(doc.title) : doc.title)].length + 0.15)}em` }} onChange={(event) => updateDoc((current) => ({ ...current, title: current.mode === "lifetime" ? lifetimeTitle(event.target.value) : event.target.value }))} />
              {doc.mode === "lifetime" && <span className="lifetime-title-suffix">{LIFE_TITLE_SUFFIX}</span>}
            </div>}
            {doc.mode === "lifetime" && doc.birth && <div className="quick-age-settings" aria-label="人生グラフの年齢設定">
              <label><DatePickerField value={doc.birth} onChange={changeBirthDate} readOnly={readOnly} compact label="生年月日" maxDate={today} /><span>生まれ</span></label>
              <span className="quick-divider">·</span>
              <label><input aria-label="何歳まで表示するか" type="number" min="1" max="120" value={doc.endAge} readOnly={readOnly} onChange={(e) => changeEndAge(Number(e.target.value))} /><span>歳まで</span></label>
            </div>}
            {doc.mode === "year" && <div className="quick-period-settings" aria-label="一年モードの期間設定">
              <label><input aria-label="表示する年" type="number" min="1" max="9999" value={doc.displayYear} readOnly={readOnly} onChange={(e) => changeYearSettings(Number(e.target.value), doc.yearStartMonth)} /><span>年</span></label>
              <label><select aria-label="開始月" value={doc.yearStartMonth} disabled={readOnly} onChange={(e) => changeYearSettings(doc.displayYear, Number(e.target.value))}>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}月</option>)}</select><span>始まり</span></label>
            </div>}
            {doc.mode === "custom" && !needsPeriod && <div className="quick-period-settings custom-period-settings" aria-label="期間モードの期間設定">
              <label><span>開始</span><DatePickerField value={doc.range.start} onChange={(value) => changeCustomRange("start", value)} readOnly={readOnly} compact label="開始日" /></label>
              <span className="quick-divider">—</span>
              <label><span>終了</span><DatePickerField value={doc.range.end} onChange={(value) => changeCustomRange("end", value)} readOnly={readOnly} compact label="終了日" /></label>
            </div>}
          </div>
        </section>

        <section className={`graph-card ${needsSetup ? "needs-setup" : ""}`} aria-label="人生グラフ">
          <div className="graph-toolbar">
            <div className="date-window"><CalendarDays size={16} /><span>{formatRange(view[0], view[1])}</span><span className="unit-pill">{unitLabel}表示</span></div>
            {!readOnly && <div className="precision-control"><span>記録単位</span><div>{([['year', '年'], ['quarter', '四半期'], ['month', '月'], ['day', '日']] as const).map(([value, text]) => <button key={value} disabled={needsSetup} className={doc.inputPrecision === value ? "active" : ""} onClick={() => updateDoc((current) => ({ ...current, inputPrecision: value, events: current.events.map((item) => item.id === "birth" ? item : { ...item, datePrecision: value }) }), false)}>{text}</button>)}</div></div>}
            {!readOnly && !needsPeriod && <button className="button primary compact toolbar-add-event" disabled={needsBirth} onClick={() => openNewEvent()}><Plus size={16} />出来事を追加</button>}
          </div>

          <div className={`graph-wrap ${needsSetup ? "awaiting-setup" : ""}`} ref={graphWrapRef}>
            <svg
              ref={svgRef}
              className={`graph ${isPanning ? "is-panning" : ""}`}
              viewBox={`0 0 ${width} ${GRAPH_HEIGHT}`}
              role="img"
              aria-label={`${doc.title}。${doc.events.length}件の出来事があります`}
              onDoubleClick={(event: ReactMouseEvent<SVGSVGElement>) => {
                if (suppressDoubleClickRef.current) return;
                const point = pointerFromEvent(event.clientX, event.clientY);
                openNewEvent(point.date, point.score);
              }}
              onPointerDown={(event) => {
                if (event.button !== 0 || (event.target as Element).closest(".event-node")) return;
                panStartRef.current = { pointerId: event.pointerId, clientX: event.clientX, view: [view[0].getTime(), view[1].getTime()] };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={onGraphMove}
              onPointerLeave={() => { setPointer(null); if (hoverOriginRef.current === "graph") setHoveredEvents([]); }}
              onPointerUp={(event) => {
                if (panStartRef.current) {
                  panStartRef.current = null;
                  setIsPanning(false);
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                  window.setTimeout(() => { suppressDoubleClickRef.current = false; }, 280);
                }
                if (dragging) {
                  const wasMoved = eventDragMovedRef.current;
                  const tappedEvent = doc.events.find((item) => item.id === dragging);
                  if (wasMoved && dragStartRef.current) {
                    setHistory((items) => [...items, dragStartRef.current!].slice(-20));
                    setFuture([]);
                  } else if (tappedEvent && event.pointerType !== "mouse") {
                    setModal({ open: true, event: tappedEvent });
                  }
                  dragStartRef.current = null;
                  eventDragStartRef.current = null;
                  setDragging(null);
                  window.setTimeout(() => { eventDragMovedRef.current = false; }, 360);
                }
              }}
            >
              <defs>
                <linearGradient id="lineGradient" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={MARGIN.top} y2={GRAPH_HEIGHT - MARGIN.bottom}>
                  <stop offset="0%" stopColor="var(--positive)" />
                  <stop offset="42%" stopColor="var(--positive)" />
                  <stop offset="49%" stopColor="var(--zero)" />
                  <stop offset="51%" stopColor="var(--zero)" />
                  <stop offset="58%" stopColor="var(--negative)" />
                  <stop offset="100%" stopColor="var(--negative)" />
                </linearGradient>
              </defs>
              <rect className="graph-bg" x="0" y="0" width={width} height={GRAPH_HEIGHT} rx="11" />
              {[-100, -75, -50, -25, 0, 25, 50, 75, 100].map((score) => (
                <g key={score}>
                  <line className={score === 0 ? "zero-line" : "grid-line"} x1={MARGIN.left} x2={width - MARGIN.right} y1={yForScore(score)} y2={yForScore(score)} />
                  <text className="y-label" x={MARGIN.left - 14} y={yForScore(score) + 4} textAnchor="end">{score > 0 ? `+${score}` : score}</text>
                </g>
              ))}
              <text className="axis-caption" x={14} y={22}>スコア</text>
              {ticks.map((tick) => {
                const label = formatTick(tick, unit, doc);
                return <g key={tick.toISOString()}>
                  <line className="x-grid-line" x1={xForDate(tick)} x2={xForDate(tick)} y1={MARGIN.top} y2={GRAPH_HEIGHT - MARGIN.bottom} />
                  <text className="x-label" x={xForDate(tick)} y={GRAPH_HEIGHT - 43} textAnchor="middle">{label.primary}</text>
                  {label.secondary && <text className="x-sub-label" x={xForDate(tick)} y={GRAPH_HEIGHT - 24} textAnchor="middle">{label.secondary}</text>}
                </g>;
              })}
              <path className="life-line" d={linePath} />

              {visibleEvents.map((event, index) => {
                const date = safeDate(event.occurredAt);
                const x = xForDate(date);
                const y = yForScore(event.score);
                const above = eventLabelIsAbove(event.score, y);
                const labelY = y + (above ? -30 : 34);
                const nearLeft = x < MARGIN.left + 55;
                const labelX = nearLeft ? x + 9 : x;
                const displayTitle = event.title.length > 16 ? `${event.title.slice(0, 15)}…` : event.title;
                const titleWidth = Math.max(34, [...displayTitle].length * 10 + 14);
                const titleX = nearLeft ? labelX - 6 : labelX - titleWidth / 2;
                return <g key={event.id} className="event-node" tabIndex={0} role="button" aria-label={`${eventDateLabel(event, doc)} ${event.title}`} onDoubleClick={(e) => { e.stopPropagation(); if (!eventDragMovedRef.current) setModal({ open: true, event }); }} onKeyDown={(e) => { if (e.key === "Enter") setModal({ open: true, event }); }}>
                  <line className="event-stem" x1={x} x2={x} y1={y} y2={labelY + (above ? 8 : -14)} />
                  <circle className="event-hit-area" cx={x} cy={y} r="14" fill="transparent" style={{ cursor: "grab" }} onPointerDown={(e) => { e.stopPropagation(); dragStartRef.current = doc; eventDragStartRef.current = { x: e.clientX, y: e.clientY }; eventDragMovedRef.current = false; setDragging(event.id); (e.currentTarget as SVGCircleElement).setPointerCapture(e.pointerId); }} />
                  <circle className={`event-dot ${eventTone(event.score)}`} cx={x} cy={y} r="7" style={{ pointerEvents: "none" }} />
                  <rect className="event-title-bg" x={titleX} y={labelY - 14} width={titleWidth} height="20" rx="5" />
                  <text className="event-title" x={labelX} y={labelY} textAnchor={nearLeft ? "start" : "middle"}>{displayTitle}</text>
                  {index === visibleEvents.length - 1 && <title>{event.title}</title>}
                </g>;
              })}

              {hoveredEvent && !dragging && (() => {
                const x = xForDate(safeDate(hoveredEvent.occurredAt));
                const y = yForScore(hoveredEvent.score);
                const title = hoveredEvent.title.length > 20 ? `${hoveredEvent.title.slice(0, 19)}…` : hoveredEvent.title;
                const dateLabel = eventDateLabel(hoveredEvent, doc, unit);
                const summary = hoveredEvent.description.trim();
                const titleFont = 15;
                const dateFont = 13;
                const summaryFont = 11;
                const summaryLines = summary ? wrapPopoverText(summary, 240, summaryFont, 4) : [];
                const titleW = approximateTextWidth(title, titleFont);
                const dateW = approximateTextWidth(dateLabel, dateFont);
                const summaryW = summaryLines.reduce((max, line) => Math.max(max, approximateTextWidth(line, summaryFont)), 0);
                const maxTextW = Math.max(titleW, dateW, summaryW);
                const paddingX = 18;
                const popupWidth = clamp(Math.ceil(maxTextW + paddingX), 60, 272);
                const popupHeight = summaryLines.length ? 57 + summaryLines.length * 15 : 58;
                const preferRight = x + popupWidth + 18 <= width - MARGIN.right;
                const popupX = preferRight ? x + 16 : Math.max(MARGIN.left, x - popupWidth - 16);
                const popupY = clamp(y - popupHeight / 2, MARGIN.top + 4, GRAPH_HEIGHT - MARGIN.bottom - popupHeight - 4);

                return <g className="event-popover" pointerEvents="none" transform={`translate(${popupX},${popupY})`}>
                  <rect width={popupWidth} height={popupHeight} rx="10" />
                  <text className="event-popover-title" x="12" y="23">{title}</text>
                  <text className="event-popover-date" x="12" y="44">{dateLabel}</text>
                  {summaryLines.length > 0 && <text className="event-popover-summary">{summaryLines.map((line, index) => <tspan key={`${index}-${line}`} x="12" y={64 + index * 15}>{line}</tspan>)}</text>}
                </g>;
              })()}

              {pointer && !hoveredEvent && !dragging && pointer.x >= MARGIN.left && pointer.x <= width - MARGIN.right && pointer.y >= MARGIN.top && pointer.y <= GRAPH_HEIGHT - MARGIN.bottom && (
                <g className="crosshair" pointerEvents="none">
                  <line x1={pointer.x} x2={pointer.x} y1={MARGIN.top} y2={GRAPH_HEIGHT - MARGIN.bottom} />
                  <line x1={MARGIN.left} x2={width - MARGIN.right} y1={pointer.y} y2={pointer.y} />
                  {(() => {
                    const label = doc.inputPrecision === "year" && unit !== "quarter" ? (doc.mode === "lifetime" ? `${differenceInYears(pointer.date, safeDate(doc.birth))}歳 · ${format(pointer.date, "yyyy年")}` : format(pointer.date, "yyyy年")) : doc.inputPrecision === "quarter" || unit === "quarter" ? (doc.mode === "lifetime" ? `${differenceInYears(pointer.date, safeDate(doc.birth))}歳 · ${format(pointer.date, "yyyy年")} ${getQuarterSeasonName(pointer.date.getMonth())}` : `${format(pointer.date, "yyyy年")} ${getQuarterSeasonName(pointer.date.getMonth())}`) : doc.inputPrecision === "month" ? format(pointer.date, "yyyy年M月") : format(pointer.date, "yyyy/M/d");
                    const labelFont = 15;
                    let textW = 0;
                    for (const char of label) {
                      textW += char.charCodeAt(0) > 255 ? labelFont : labelFont * 0.58;
                    }
                    const popupWidth = clamp(Math.ceil(textW + 16), 48, 224);
                    const popupX = pointer.x + popupWidth + 12 <= width - MARGIN.right
                      ? pointer.x + 9
                      : pointer.x - popupWidth - 9;
                    return <g transform={`translate(${clamp(popupX, MARGIN.left, width - MARGIN.right - popupWidth)},${clamp(pointer.y - 48, MARGIN.top, GRAPH_HEIGHT - MARGIN.bottom - 38)})`}><rect width={popupWidth} height="38" rx="9" /><text x="8" y="25">{label}</text></g>;
                  })()}
                </g>
              )}

              {dragging && (() => {
                const draggingEvent = doc.events.find((e) => e.id === dragging);
                if (!draggingEvent) return null;
                const dragX = xForDate(safeDate(draggingEvent.occurredAt));
                const dragY = yForScore(draggingEvent.score);
                const scoreText = draggingEvent.score > 0 ? `+${draggingEvent.score}` : `${draggingEvent.score}`;
                const badgeWidth = scoreText.length > 3 ? 56 : 46;
                const badgeHeight = 26;

                const fill = draggingEvent.score > 0 ? "var(--positive)" : draggingEvent.score < 0 ? "var(--negative)" : "var(--zero)";

                const badgeX = clamp(dragX - badgeWidth / 2, MARGIN.left, width - MARGIN.right - badgeWidth);
                const titleIsAbove = eventLabelIsAbove(draggingEvent.score, dragY);
                const titleY = dragY + (titleIsAbove ? -30 : 34);
                const gap = 6;
                const badgeY = titleIsAbove
                  ? titleY - 14 - gap - badgeHeight
                  : titleY + 6 + gap;

                return (
                  <g className="dragging-score-bubble" pointerEvents="none" transform={`translate(${badgeX},${badgeY})`}>
                    <rect width={badgeWidth} height={badgeHeight} rx="13" fill={fill} filter="drop-shadow(0 2px 6px rgba(0,0,0,0.25))" />
                    <text x={badgeWidth / 2} y="17" fill="#ffffff" fontSize="12" fontWeight="700" textAnchor="middle">{scoreText}</text>
                  </g>
                );
              })()}
            </svg>
            {needsBirth && <div className="birth-onboarding">
              <strong>{readOnly ? "誕生日が設定されていません" : "誕生日を設定"}</strong>
              {!readOnly && <DatePickerField value={doc.birth} onChange={changeBirthDate} label="誕生日" placeholder="生年月日" maxDate={today} />}
            </div>}
            {needsPeriod && <PeriodOnboarding readOnly={readOnly} onSubmit={initializeCustomRange} />}
          </div>

        </section>

        <div className="section-header event-strip-header">
          <h2 className="graph-title">人生年表</h2>
          <button className="text-button" onClick={() => setEventsOpen(true)}><List size={17} />一覧を見る</button>
        </div>

        <section className="event-strip">
          <div className="event-previews" ref={eventPreviewsRef}>
            {[...doc.events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).map((event) => <button key={event.id} data-event-id={event.id} className={`${eventTone(event.score)} ${hoveredEventIds.has(event.id) ? "is-highlighted" : ""}`} onPointerEnter={() => { hoverOriginRef.current = "preview"; setHoveredEvents([event]); }} onPointerLeave={() => { hoverOriginRef.current = null; setHoveredEvents([]); }} onClick={() => setModal({ open: true, event })}><span>{eventDateLabel(event, doc)}</span>{event.title}</button>)}
            {!doc.events.length && <span className="muted">まだ出来事はありません。</span>}
          </div>
        </section>
      </main>

      <SiteFooter />

      {modal.open && modal.event && <EventDialog event={modal.event} doc={doc} readOnly={readOnly} onClose={() => setModal({ open: false, event: null })} onSave={saveEvent} onDelete={deleteEvent} />}
      {settingsOpen && <SettingsPanel doc={doc} theme={theme} onTheme={setTheme} onClose={() => setSettingsOpen(false)} onChange={(next) => { updateDoc(() => next); setView(getFullRange(next)); }} />}
      {eventsOpen && <EventsPanel doc={doc} readOnly={readOnly} onClose={() => setEventsOpen(false)} onSelect={(event) => { setEventsOpen(false); setModal({ open: true, event }); }} onAdd={() => { setEventsOpen(false); openNewEvent(); }} />}
      {shareOpen && <ShareDialog readOnly={readOnly} onClose={() => setShareOpen(false)} onLink={copyShareLink} onPng={exportPng} onJson={exportJson} onImport={() => importRef.current?.click()} />}
      <input ref={importRef} className="sr-only" type="file" accept="application/json" onChange={importJson} />
      {toast && <div className="toast" role="status"><Check size={17} />{toast}</div>}
    </div>
  );
}

function SiteFooter() {
  return <footer className="site-footer">
    <nav aria-label="フッターナビゲーション">
      <a href="/about">このサイトについて</a>
      <a href="/privacy-policy">プライバシーポリシー</a>
      <a href="/agreement">利用規約</a>
    </nav>
    <span>© 2026 My Life Chart | わたしの人生グラフ</span>
  </footer>;
}

function StaticPageContent({ page }: { page: StaticPage }) {
  if (page === "about") return <article className="static-content">
    <p className="eyebrow">ABOUT</p>
    <h1>このサイトについて</h1>
    <p>My Life Chartは、人生の出来事とそのときの気持ちを一本のグラフに記録し、自分の歩みを振り返るためのサービスです。</p>
    <h2>グラフの種類</h2>
    <p>人生全体を振り返る「人生グラフ」、一年を詳しく記録する「一年グラフ」、自由な開始日と終了日を設定できる「期間指定」を用意しています。</p>
    <h2>記録と共有</h2>
    <p>作成したグラフはこの端末のブラウザに保存されます。共有リンクを作成すると、リンクを知っている人に閲覧専用のグラフを共有できます。</p>
  </article>;

  if (page === "privacy-policy") return <article className="static-content">
    <p className="eyebrow">PRIVACY POLICY</p>
    <h1>プライバシーポリシー</h1>
    <p>My Life Chartは、利用者の記録を大切に扱います。</p>
    <h2>保存される情報</h2>
    <p>入力したグラフ、出来事、設定は、原則として利用中のブラウザ内に保存されます。本サービスのデータベースへ自動的に送信・保存することはありません。</p>
    <h2>共有リンク</h2>
    <p>共有リンクにはグラフのデータが含まれます。リンクを知っている人は内容を閲覧できるため、個人情報や公開したくない情報の入力・共有にはご注意ください。</p>
    <h2>外部サービス</h2>
    <p>サイトの配信や安定した提供のため、ホスティング事業者がアクセス情報を取り扱う場合があります。その取扱いには各事業者の方針が適用されます。</p>
    <h2>改定</h2>
    <p>機能や運用方法の変更に応じて、本ポリシーを改定することがあります。</p>
  </article>;

  return <article className="static-content">
    <p className="eyebrow">TERMS OF USE</p>
    <h1>利用規約</h1>
    <p>本規約は、My Life Chartを利用する際の条件を定めるものです。サービスを利用した時点で、本規約に同意したものとみなします。</p>
    <h2>利用上の注意</h2>
    <p>法令または公序良俗に反する行為、第三者の権利を侵害する行為、サービスの運営を妨げる行為は禁止します。</p>
    <h2>データの管理</h2>
    <p>ブラウザのデータ削除や端末の変更により、保存したグラフが失われる場合があります。必要に応じてJSONの書き出し機能でバックアップしてください。</p>
    <h2>免責事項</h2>
    <p>本サービスは現状有姿で提供されます。利用または利用できなかったことによって生じた損害について、法令上認められる範囲で責任を負いません。</p>
    <h2>サービスと規約の変更</h2>
    <p>必要に応じて、事前の予告なくサービス内容または本規約を変更することがあります。</p>
  </article>;
}

function PeriodOnboarding({ readOnly, onSubmit }: { readOnly: boolean; onSubmit: (start: string, end: string) => void }) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const valid = Boolean(start && end && safeDate(start) < safeDate(end));

  return <div className="period-onboarding">
    <strong>{readOnly ? "期間が設定されていません" : "期間を設定"}</strong>
    {!readOnly && <>
      <div className="period-onboarding-fields">
        <label><span>開始日</span><DatePickerField value={start} onChange={setStart} label="開始日" /></label>
        <span className="period-separator">—</span>
        <label><span>終了日</span><DatePickerField value={end} onChange={setEnd} label="終了日" minDate={start ? safeDate(start) : new Date(1900, 0, 1)} /></label>
      </div>
      <button type="button" className="button primary period-add-button" disabled={!valid} onClick={() => onSubmit(start, end)}><Plus size={15} />出来事を追加</button>
    </>}
  </div>;
}

function EventDialog({ event, doc, readOnly, onClose, onSave, onDelete }: { event: TimelineEvent; doc: TimelineDocument; readOnly: boolean; onClose: () => void; onSave: (event: TimelineEvent) => void; onDelete: (id: string) => void }) {
  const [draft, setDraft] = useState(event);
  const isExisting = doc.events.some((item) => item.id === event.id);
  const isBirth = draft.id === "birth";
  const precision = isBirth ? "day" : doc.inputPrecision;
  const writableEnd = getWritableEnd(doc);
  const changeEventDate = (value: string) => {
    const snapped = snapDateForDocument(safeDate(value), precision, doc);
    setDraft({ ...draft, occurredAt: format(snapped > writableEnd ? writableEnd : snapped, "yyyy-MM-dd") });
  };
  const submit = (formEvent: FormEvent) => {
    formEvent.preventDefault();
    if (!draft.title.trim()) return;
    onSave({ ...draft, datePrecision: precision, title: draft.title.trim(), score: Math.round(clamp(Number(draft.score), -100, 100) / 10) * 10 });
  };
  const scorePct = (draft.score + 100) / 200;

  return <div className="modal-backdrop" onMouseDown={onClose}>
    <form className="dialog" onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
      <div className="dialog-header"><div><p className="eyebrow">LIFE EVENT</p><h2>{readOnly ? "出来事" : isExisting ? "出来事を編集" : "出来事を追加"}</h2></div><IconButton label="閉じる" onClick={onClose}><X size={20} /></IconButton></div>
      <label>タイトル<input autoFocus={!readOnly} required maxLength={60} readOnly={readOnly} value={draft.title} placeholder="必須" onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
      <label className="event-date-field">{precision === "year" ? "年" : precision === "quarter" ? "四半期" : precision === "month" ? "年月" : "年月日"}<DatePickerField value={draft.occurredAt} onChange={changeEventDate} readOnly={readOnly || isBirth} precision={precision} label={precision === "year" ? "年" : precision === "quarter" ? "四半期" : precision === "month" ? "年月" : "年月日"} maxDate={writableEnd} /></label>
      <label className="score-field"><span>スコア</span><div className="score-slider-wrap"><output className="score-bubble" style={{ left: `calc(8px + (100% - 16px) * ${scorePct})` }}>{draft.score > 0 ? `+${draft.score}` : draft.score}</output><input className="score-range" type="range" min="-100" max="100" step="10" disabled={readOnly} value={draft.score} onChange={(e) => setDraft({ ...draft, score: Number(e.target.value) })} /></div><div className="range-labels"><span>-100</span><span>0</span><span>100</span></div></label>
      {(!readOnly || draft.description.trim()) && <label>ひとこと<textarea maxLength={500} readOnly={readOnly} value={draft.description} placeholder="任意" onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>}
      {!readOnly && <div className="dialog-actions">{isExisting && draft.id !== "birth" ? <button type="button" className="button danger" onClick={() => onDelete(draft.id)}><Trash2 size={17} />削除</button> : <span />}<div><button type="button" className="button secondary" onClick={onClose}>キャンセル</button><button type="submit" className="button primary">保存する</button></div></div>}
    </form>
  </div>;
}

function SettingsPanel({ doc, theme, onTheme, onClose, onChange }: { doc: TimelineDocument; theme: Theme; onTheme: (theme: Theme) => void; onClose: () => void; onChange: (doc: TimelineDocument) => void }) {
  const [draft, setDraft] = useState(doc);
  const [draftTheme, setDraftTheme] = useState(theme);
  const comparable = (value: TimelineDocument) => {
    const { updatedAt: _updatedAt, mode: _mode, inputPrecision: _inputPrecision, ...settings } = value;
    return JSON.stringify(settings);
  };
  const isDirty = comparable(draft) !== comparable(doc) || draftTheme !== theme;
  return <div className="drawer-backdrop" onMouseDown={onClose}><aside className="drawer" onMouseDown={(e) => e.stopPropagation()}><div className="dialog-header"><div><p className="eyebrow">PREFERENCES</p><h2>グラフの設定</h2></div><IconButton label="閉じる" onClick={onClose}><X size={20} /></IconButton></div>
    <label>{draft.mode === "lifetime" ? "名前" : "タイトル"}<div className={draft.mode === "lifetime" ? "setting-title-with-suffix" : undefined}><input maxLength={draft.mode === "lifetime" ? 40 : 60} value={draft.mode === "lifetime" ? lifetimeName(draft.title) : draft.title} onChange={(e) => setDraft({ ...draft, title: draft.mode === "lifetime" ? lifetimeTitle(e.target.value) : e.target.value })} />{draft.mode === "lifetime" && <span>{LIFE_TITLE_SUFFIX}</span>}</div></label>
    <label>何歳まで表示するか<div className="setting-with-suffix"><input aria-label="終了年齢" type="number" min="1" max="120" value={draft.endAge} onChange={(e) => setDraft({ ...draft, endAge: clamp(Number(e.target.value), 1, 120) })} /><span>歳まで</span></div></label>
    {draft.mode === "year" && <div className="field-row"><label>表示する年<input type="number" min="1" max="9999" value={draft.displayYear} onChange={(e) => setDraft(withYearRange(draft, Number(e.target.value), draft.yearStartMonth))} /></label><label>開始月<select value={draft.yearStartMonth} onChange={(e) => setDraft(withYearRange(draft, draft.displayYear, Number(e.target.value)))}>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}月</option>)}</select></label></div>}
    {draft.mode === "custom" && <div className="field-row"><label>開始日<DatePickerField value={draft.range.start} onChange={(value) => setDraft({ ...draft, range: { ...draft.range, start: value } })} label="開始日" /></label><label>終了日<DatePickerField value={draft.range.end} onChange={(value) => setDraft({ ...draft, range: { ...draft.range, end: value } })} label="終了日" /></label></div>}
    <label className="toggle-row"><span><strong>西暦を表示</strong><small>年齢の下に西暦を添えます</small></span><input type="checkbox" checked={draft.showCalendarYear} onChange={(e) => setDraft({ ...draft, showCalendarYear: e.target.checked })} /></label>
    {draft.mode !== "custom" && <label className="birth-year-field">生年月日<DatePickerField value={draft.birth} onChange={(birth) => setDraft(withBirth(draft, birth))} label="生年月日" maxDate={today} /><small>カレンダーから選択します。入力欄に曜日は表示されません</small></label>}
    <fieldset><legend>グラフの線</legend><div className="theme-options line-style-options">{([['curve', '曲線'], ['straight', '直線']] as const).map(([value, text]) => <button type="button" key={value} className={draft.lineStyle === value ? "selected" : ""} onClick={() => setDraft({ ...draft, lineStyle: value })}>{text}{draft.lineStyle === value && <Check size={15} />}</button>)}</div></fieldset>
    <fieldset><legend>テーマ</legend><div className="theme-options">{([['auto', '自動', CircleHelp], ['light', 'ライト', Sun], ['dark', 'ダーク', Moon]] as const).map(([value, text, Icon]) => <button type="button" key={value} className={draftTheme === value ? "selected" : ""} onClick={() => setDraftTheme(value)}><Icon size={18} />{text}{draftTheme === value && <Check size={15} />}</button>)}</div></fieldset>
    <div className="clear-events"><div><strong>出来事をクリア</strong><small>誕生を残して、追加した出来事をすべて削除します</small></div><button type="button" className="button danger" disabled={!draft.events.some((item) => item.id !== "birth")} onClick={() => { if (window.confirm("「誕生」以外の出来事をすべて削除しますか？")) setDraft({ ...draft, events: draft.events.filter((item) => item.id === "birth") }); }}><Trash2 size={16} />クリア</button></div>
    <button className="button primary full" disabled={!isDirty} onClick={() => { onTheme(draftTheme); onChange({ ...draft, mode: doc.mode, inputPrecision: doc.inputPrecision, events: draft.events.map((event) => event.id === "birth" ? event : { ...event, datePrecision: doc.inputPrecision }) }); }}>設定を保存</button>
  </aside></div>;
}

function EventsPanel({ doc, readOnly, onClose, onSelect, onAdd }: { doc: TimelineDocument; readOnly: boolean; onClose: () => void; onSelect: (event: TimelineEvent) => void; onAdd: () => void }) {
  return <div className="drawer-backdrop events-panel-backdrop" onMouseDown={onClose}><aside className="drawer events-drawer" onMouseDown={(e) => e.stopPropagation()}><div className="dialog-header"><div><p className="eyebrow">LIFE EVENTS</p><h2>出来事の一覧</h2></div><IconButton label="閉じる" onClick={onClose}><X size={20} /></IconButton></div>
    <div className="all-events">{[...doc.events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).map((event) => <button key={event.id} onClick={() => onSelect(event)}><i className={eventTone(event.score)} /><span><small>{eventDateLabel(event, doc)}</small><strong>{event.title}</strong>{event.description && <em>{event.description}</em>}</span><b>{event.score > 0 ? `+${event.score}` : event.score}</b></button>)}{!doc.events.length && <div className="empty-list"><MoreHorizontal size={28} /><p>まだ出来事はありません</p></div>}</div>
    {!readOnly && <button className="button primary full" onClick={onAdd}><Plus size={18} />出来事を追加</button>}
  </aside></div>;
}

function ShareDialog({ readOnly, onClose, onLink, onPng, onJson, onImport }: { readOnly: boolean; onClose: () => void; onLink: () => void; onPng: () => void; onJson: () => void; onImport: () => void }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="dialog share-dialog" onMouseDown={(e) => e.stopPropagation()}><div className="dialog-header"><div><h2>人生グラフを共有</h2></div><IconButton label="閉じる" onClick={onClose}><X size={20} /></IconButton></div>
    <div className="share-options"><button onClick={onLink}><span className="share-icon accent"><Link size={22} /></span><span><strong>リンクをコピー</strong><small>データはリンクの中だけに保存されます</small></span></button><button onClick={onPng}><span className="share-icon coral"><Download size={22} /></span><span><strong>PNGで保存</strong></span></button><button onClick={onJson}><span className="share-icon blue"><FileDown size={22} /></span><span><strong>インポート</strong></span></button>{!readOnly && <button onClick={onImport}><span className="share-icon neutral"><FileUp size={22} /></span><span><strong>エクスポート</strong></span></button>}</div>
    <p className="privacy-note">共有リンクを知っている人は内容を見ることができます。個人情報の入力にはご注意ください。</p>
  </div></div>;
}

export default App;
