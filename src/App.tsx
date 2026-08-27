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
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Download,
  FileDown,
  FileUp,
  Link,
  List,
  Minus,
  Moon,
  MoreHorizontal,
  Pencil,
  Plus,
  Redo2,
  RotateCcw,
  Settings,
  Share2,
  Sun,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import LZString from "lz-string";
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
type Precision = "year" | "month" | "day";
type LineStyle = "straight" | "curve";

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
  datePrecision: z.enum(["year", "month", "day"]),
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
  inputPrecision: z.enum(["year", "month", "day"]),
  lineStyle: z.enum(["straight", "curve"]),
  events: z.array(eventSchema),
  updatedAt: z.string(),
});

const today = new Date();
const defaultBirth = `${getYear(today) - 30}-01-01`;
const defaultEndAge = differenceInYears(today, parseISO(defaultBirth));
const defaultDocument: TimelineDocument = {
  schemaVersion: 6,
  id: crypto.randomUUID(),
  title: "わたしの人生グラフ",
  mode: "lifetime",
  birth: defaultBirth,
  range: { start: defaultBirth, end: `${getYear(today) + 70}-01-01` },
  endAge: defaultEndAge,
  displayYear: getYear(today),
  yearStartMonth: 1,
  showCalendarYear: true,
  inputPrecision: "year",
  lineStyle: "curve",
  events: [{ id: "birth", occurredAt: defaultBirth, datePrecision: "day", score: 0, title: "誕生", description: "" }],
  updatedAt: new Date().toISOString(),
};

const STORAGE_KEY = "jinsei-graph:document:v7";
const THEME_KEY = "jinsei-graph:theme";
const MARGIN = { top: 46, right: 34, bottom: 72, left: 52 };
const GRAPH_HEIGHT = 460;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function systemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function snapDate(date: Date, precision: Precision): Date {
  if (precision === "year") return startOfYear(date);
  if (precision === "month") return startOfMonth(date);
  return parseISO(format(date, "yyyy-MM-dd"));
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
  return {
    ...doc,
    birth,
    endAge: clamp(differenceInYears(today, birthDate), 1, 120),
    events: doc.events.map((event) => event.id === "birth" ? { ...event, occurredAt: birth } : event),
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
    const start = safeDate(doc.birth);
    const writableEnd = getWritableEnd(doc);
    const spanDays = Math.max(1, differenceInCalendarDays(writableEnd, start));
    const bufferDays = clamp(Math.round(spanDays * 0.08), 30, 183);
    return [start, addDays(writableEnd, bufferDays)];
  }
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

function tickSpec(start: Date, end: Date, width: number) {
  const days = Math.max(1, differenceInCalendarDays(end, start));
  const target = clamp(Math.round(width / 74), 6, 18);
  if (days > 730) return { unit: "year" as const, step: closestStep(days / 365.25 / target, [1, 2, 5, 10, 20]), label: "年" };
  if (days > 90) return { unit: "month" as const, step: closestStep(days / 30.44 / target, [1, 2, 3, 6]), label: "月" };
  if (days > 28) return { unit: "week" as const, step: closestStep(days / 7 / target, [1, 2, 4]), label: "週" };
  return { unit: "day" as const, step: closestStep(days / target, [1, 2, 3, 5, 7]), label: "日" };
}

function makeTicks(start: Date, end: Date, width: number) {
  const spec = tickSpec(start, end, width);
  let cursor = spec.unit === "year" ? startOfYear(start) : spec.unit === "month" ? startOfMonth(start) : spec.unit === "week" ? startOfWeek(start, { weekStartsOn: 1 }) : startOfDay(start);
  const ticks: Date[] = [];
  for (let guard = 0; guard < 200 && cursor <= end; guard += 1) {
    if (cursor >= start) ticks.push(cursor);
    cursor = spec.unit === "year" ? addYears(cursor, spec.step) : spec.unit === "month" ? addMonths(cursor, spec.step) : addDays(cursor, spec.unit === "week" ? 7 : spec.step);
  }
  return { ...spec, ticks };
}

function formatTick(date: Date, unit: string, doc: TimelineDocument) {
  if (doc.mode === "lifetime" && unit === "year") {
    const age = Math.max(0, differenceInYears(date, safeDate(doc.birth)));
    return { primary: `${age}歳`, secondary: doc.showCalendarYear ? `${format(date, "yyyy")}年` : "" };
  }
  if (unit === "year") return { primary: format(date, "yyyy年"), secondary: "" };
  if (unit === "month") return { primary: format(date, "M月"), secondary: format(date, "yyyy") };
  return { primary: format(date, "M/d"), secondary: unit === "week" ? "月" : format(date, "EEE", { locale: ja }) };
}

function eventDateLabel(event: TimelineEvent, doc: TimelineDocument) {
  const date = safeDate(event.occurredAt);
  const precision = event.id === "birth" ? "day" : doc.inputPrecision;
  const datePart = precision === "year" ? format(date, "yyyy年") : precision === "month" ? format(date, "yyyy年M月") : format(date, "yyyy年M月d日");
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

function IconButton({ label, children, onClick, disabled = false }: { label: string; children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button type="button" className="icon-button" aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</button>;
}

function App() {
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
    if (sharedDocument) return sharedDocument;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? documentSchema.parse(JSON.parse(saved)) : defaultDocument;
    } catch {
      return defaultDocument;
    }
  });
  const [history, setHistory] = useState<TimelineDocument[]>([]);
  const [future, setFuture] = useState<TimelineDocument[]>([]);
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem(THEME_KEY) as Theme) || "auto");
  const [birthDraft, setBirthDraft] = useState(doc.birth.replaceAll("-", "/"));
  const [view, setView] = useState<[Date, Date]>(() => getFullRange(sharedDocument || doc));
  const [modal, setModal] = useState<{ open: boolean; event: TimelineEvent | null }>({ open: false, event: null });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [pointer, setPointer] = useState<{ date: Date; score: number; x: number; y: number } | null>(null);
  const [hoveredEvent, setHoveredEvent] = useState<TimelineEvent | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [width, setWidth] = useState(900);
  const graphWrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const dragStartRef = useRef<TimelineDocument | null>(null);
  const themeCycleOriginRef = useRef<"light" | "dark">(systemTheme());
  const panStartRef = useRef<{ pointerId: number; clientX: number; view: [number, number] } | null>(null);
  const suppressDoubleClickRef = useRef(false);
  const eventDragStartRef = useRef<{ x: number; y: number } | null>(null);
  const eventDragMovedRef = useRef(false);
  const [isPanning, setIsPanning] = useState(false);
  const readOnly = Boolean(sharedDocument);
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
    if (!readOnly) localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
    document.title = `${doc.title} | 人生グラフ`;
  }, [doc, readOnly]);

  useEffect(() => setBirthDraft(doc.birth.replaceAll("-", "/")), [doc.birth]);

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

  const plotWidth = Math.max(220, width - MARGIN.left - MARGIN.right);
  const plotHeight = GRAPH_HEIGHT - MARGIN.top - MARGIN.bottom;
  const viewMs = Math.max(1, view[1].getTime() - view[0].getTime());
  const xForDate = (date: Date) => MARGIN.left + ((date.getTime() - view[0].getTime()) / viewMs) * plotWidth;
  const dateForX = (x: number) => new Date(view[0].getTime() + clamp((x - MARGIN.left) / plotWidth, 0, 1) * viewMs);
  const yForScore = (score: number) => MARGIN.top + ((110 - score) / 220) * plotHeight;
  const scoreForY = (y: number) => Math.round(clamp(110 - ((y - MARGIN.top) / plotHeight) * 220, -100, 100) / 10) * 10;
  const tickData = useMemo(() => makeTicks(view[0], view[1], plotWidth), [view, plotWidth]);
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
    const precision: Precision = unit === "year" ? "year" : unit === "month" ? "month" : "day";
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
  const lineIsNeutral = doc.events.every((event) => event.score === 0);

  const linePath = useMemo(() => {
    const sorted = [...doc.events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    const previous = sorted.filter((event) => safeDate(event.occurredAt) <= view[0]).at(-1);
    const startScore = previous?.score ?? 0;
    const eventsAfterStart = visibleEvents.filter((event) => safeDate(event.occurredAt) > view[0]);
    const endScore = eventsAfterStart.at(-1)?.score ?? startScore;
    const points = [
      { date: view[0], score: startScore },
      ...eventsAfterStart.map((event) => ({ date: safeDate(event.occurredAt), score: event.score })),
      { date: writableEnd < view[1] ? writableEnd : view[1], score: endScore },
    ].map((item) => ({ x: xForDate(item.date), y: yForScore(item.score) }));
    if (!points.length) return "";
    return points.slice(1).reduce((path, point, index) => {
      const previousPoint = points[index];
      if (doc.lineStyle === "straight") return `${path} L ${point.x} ${point.y}`;
      const middle = (previousPoint.x + point.x) / 2;
      return `${path} C ${middle} ${previousPoint.y}, ${middle} ${point.y}, ${point.x} ${point.y}`;
    }, `M ${points[0].x} ${points[0].y}`);
  }, [doc.events, doc.lineStyle, visibleEvents, view, plotWidth, writableEnd]);

  const zoom = (factor: number) => {
    const center = (view[0].getTime() + view[1].getTime()) / 2;
    const nextSpan = clamp(viewMs * factor, 7 * 86400000, getFullRange(doc)[1].getTime() - getFullRange(doc)[0].getTime());
    const full = getFullRange(doc);
    let start = center - nextSpan / 2;
    let end = center + nextSpan / 2;
    if (start < full[0].getTime()) { end += full[0].getTime() - start; start = full[0].getTime(); }
    if (end > full[1].getTime()) { start -= end - full[1].getTime(); end = full[1].getTime(); }
    setView([new Date(start), new Date(end)]);
  };

  const pan = (direction: -1 | 1) => {
    const shift = viewMs * 0.35 * direction;
    const full = getFullRange(doc);
    let start = view[0].getTime() + shift;
    let end = view[1].getTime() + shift;
    if (start < full[0].getTime()) { end += full[0].getTime() - start; start = full[0].getTime(); }
    if (end > full[1].getTime()) { start -= end - full[1].getTime(); end = full[1].getTime(); }
    setView([new Date(start), new Date(end)]);
  };

  useEffect(() => {
    const graph = svgRef.current;
    if (!graph) return;
    const handleWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault();
      zoom(event.deltaY > 0 ? 1.22 : 0.82);
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
    const payload = LZString.compressToEncodedURIComponent(JSON.stringify(doc));
    const url = `${location.origin}${location.pathname}#share=${payload}`;
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
      const parsed = documentSchema.parse(JSON.parse(await file.text()));
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
    const range = getModeRange(mode, doc);
    updateDoc((current) => ({ ...current, mode, range: { start: format(range[0], "yyyy-MM-dd"), end: format(range[1], "yyyy-MM-dd") } }));
    setView(range);
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

  const duplicateShared = () => {
    const editable = { ...doc, id: crypto.randomUUID(), updatedAt: new Date().toISOString() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(editable));
    window.history.replaceState(null, "", location.pathname);
    location.reload();
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
    if (dragging && !readOnly) {
      const end = getWritableEnd(doc);
      const snapped = snapDateForDocument(next.date > end ? end : next.date, doc.inputPrecision, doc);
      const eventDate = snapped > end ? end : snapped;
      if (eventDragStartRef.current && Math.hypot(event.clientX - eventDragStartRef.current.x, event.clientY - eventDragStartRef.current.y) > 3) eventDragMovedRef.current = true;
      updateDoc((current) => ({ ...current, events: current.events.map((item) => item.id === dragging ? { ...item, occurredAt: item.id === "birth" ? item.occurredAt : format(eventDate, "yyyy-MM-dd"), score: next.score } : item) }), false);
    } else {
      if (next.date > getWritableEnd(doc)) {
        setPointer(null);
      } else {
        const snapped = snapDateForDocument(next.date, doc.inputPrecision, doc);
        const snappedDate = snapped > getWritableEnd(doc) ? getWritableEnd(doc) : snapped;
        setPointer({ ...next, date: snappedDate, x: xForDate(snappedDate), y: yForScore(next.score) });
      }
    }
  };

  return (
    <div className={`app-shell ${eventsOpen ? "events-panel-open" : ""}`}>
      <header className="topbar">
        <div className="brand" aria-label="人生グラフ ホーム">
          <img className="brand-mark" src="/favicon.svg" alt="" />
          <span>人生グラフ</span>
        </div>
        <div className="top-actions">
          {!readOnly && <>
            <IconButton label="元に戻す" onClick={undo} disabled={!history.length}><Undo2 size={18} /></IconButton>
            <IconButton label="やり直す" onClick={redo} disabled={!future.length}><Redo2 size={18} /></IconButton>
          </>}
          <IconButton label={`テーマを変更（現在: ${theme === "auto" ? `自動・${effectiveTheme === "light" ? "ライト" : "ダーク"}` : theme === "light" ? "ライト" : "ダーク"}）`} onClick={cycleTheme}>
            {theme === "auto" ? <span className="auto-theme">A</span> : theme === "dark" ? <Moon size={18} /> : <Sun size={18} />}
          </IconButton>
          {!readOnly && <button className="button secondary compact" onClick={() => setSettingsOpen(true)}><Settings size={17} /><span>設定</span></button>}
          <button className="button primary compact" onClick={() => setShareOpen(true)}><Share2 size={17} /><span>共有</span></button>
        </div>
      </header>

      <main>
        {readOnly && (
          <div className="shared-banner">
            <span>共有された人生グラフを見ています</span>
            <button onClick={duplicateShared}>自分用にコピーして編集</button>
          </div>
        )}

        <section className="hero-row">
          <div>
            <p className="eyebrow">MY LIFE, IN ONE LINE</p>
            <div className="title-editor">
              <input ref={titleRef} className="title-input" aria-label="人生グラフのタイトル" value={doc.title} readOnly={readOnly} maxLength={60} style={{ width: `${Math.max(4, [...doc.title].length + 0.15)}em` }} onChange={(event) => updateDoc((current) => ({ ...current, title: event.target.value }))} />
              {!readOnly && <IconButton label="タイトルを編集" onClick={() => { titleRef.current?.focus(); titleRef.current?.select(); }}><Pencil size={15} /></IconButton>}
            </div>
            {doc.mode === "lifetime" && <div className="quick-age-settings" aria-label="人生グラフの年齢設定">
              <label><input className="birth-text-date" aria-label="生年月日" type="text" inputMode="numeric" placeholder="YYYY/MM/DD" value={birthDraft.replaceAll("-", "/")} readOnly={readOnly} onChange={(e) => { setBirthDraft(e.target.value); const parsed = parseDateInput(e.target.value); if (parsed) changeBirthDate(parsed); }} /><span>生まれ</span></label>
              <span className="quick-divider">·</span>
              <label><input aria-label="何歳まで表示するか" type="number" min="1" max="120" value={doc.endAge} readOnly={readOnly} onChange={(e) => changeEndAge(Number(e.target.value))} /><span>歳まで</span></label>
            </div>}
            {doc.mode === "year" && <div className="quick-period-settings" aria-label="一年モードの期間設定">
              <label><input aria-label="表示する年" type="number" min="1" max="9999" value={doc.displayYear} readOnly={readOnly} onChange={(e) => changeYearSettings(Number(e.target.value), doc.yearStartMonth)} /><span>年</span></label>
              <label><select aria-label="開始月" value={doc.yearStartMonth} disabled={readOnly} onChange={(e) => changeYearSettings(doc.displayYear, Number(e.target.value))}>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}月</option>)}</select><span>始まり</span></label>
            </div>}
            {doc.mode === "custom" && <div className="quick-period-settings custom-period-settings" aria-label="期間モードの期間設定">
              <label><span>開始</span><input type="date" value={doc.range.start} readOnly={readOnly} onChange={(e) => changeCustomRange("start", e.target.value)} /></label>
              <span className="quick-divider">—</span>
              <label><span>終了</span><input type="date" value={doc.range.end} readOnly={readOnly} onChange={(e) => changeCustomRange("end", e.target.value)} /></label>
            </div>}
          </div>
          <div className="mode-switch" aria-label="表示期間">
            {([['lifetime', '人生'], ['year', '一年'], ['custom', '期間']] as const).map(([value, text]) => (
              <button key={value} className={doc.mode === value ? "active" : ""} onClick={() => changeMode(value)}>{text}</button>
            ))}
          </div>
        </section>

        <section className="graph-card" aria-label="人生グラフ">
          <div className="graph-toolbar">
            <div className="date-window"><CalendarDays size={16} /><span>{formatRange(view[0], view[1])}</span><span className="unit-pill">{unitLabel}表示</span></div>
            {!readOnly && <div className="precision-control"><span>記録単位</span><div>{([['year', '年'], ['month', '月'], ['day', '日']] as const).map(([value, text]) => <button key={value} className={doc.inputPrecision === value ? "active" : ""} onClick={() => updateDoc((current) => ({ ...current, inputPrecision: value, events: current.events.map((item) => item.id === "birth" ? item : { ...item, datePrecision: value }) }))}>{text}</button>)}</div></div>}
            <div className="zoom-controls">
              <IconButton label="前の期間へ" onClick={() => pan(-1)}><ChevronLeft size={17} /></IconButton>
              <IconButton label="縮小" onClick={() => zoom(1.7)}><Minus size={17} /></IconButton>
              <button className="reset-button" onClick={() => setView(getFullRange(doc))}>全期間</button>
              <IconButton label="拡大" onClick={() => zoom(0.58)}><Plus size={17} /></IconButton>
              <IconButton label="次の期間へ" onClick={() => pan(1)}><ChevronRight size={17} /></IconButton>
            </div>
          </div>

          <div className="graph-wrap" ref={graphWrapRef}>
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
              onPointerLeave={() => setPointer(null)}
              onPointerUp={(event) => {
                if (panStartRef.current) {
                  panStartRef.current = null;
                  setIsPanning(false);
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                  window.setTimeout(() => { suppressDoubleClickRef.current = false; }, 280);
                }
                if (dragging) { if (dragStartRef.current) setHistory((items) => [...items, dragStartRef.current!].slice(-20)); dragStartRef.current = null; eventDragStartRef.current = null; setFuture([]); setDragging(null); window.setTimeout(() => { eventDragMovedRef.current = false; }, 360); }
              }}
            >
              <defs>
                <linearGradient id="lineGradient" x1="0" x2="1">
                  <stop offset="0" stopColor="var(--accent)" />
                  <stop offset="1" stopColor="var(--positive)" />
                </linearGradient>
              </defs>
              <rect className="graph-bg" x="0" y="0" width={width} height={GRAPH_HEIGHT} rx="18" />
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
              <path className={`life-line life-line-shadow ${lineIsNeutral ? "neutral" : ""}`} d={linePath} />
              <path className={`life-line ${lineIsNeutral ? "neutral" : ""}`} d={linePath} />

              {visibleEvents.map((event, index) => {
                const date = safeDate(event.occurredAt);
                const x = xForDate(date);
                const y = yForScore(event.score);
                const above = event.score >= 0;
                const labelY = y + (above ? -30 : 34);
                const nearLeft = x < MARGIN.left + 55;
                const labelX = nearLeft ? x + 9 : x;
                const displayTitle = event.title.length > 16 ? `${event.title.slice(0, 15)}…` : event.title;
                const titleWidth = Math.max(34, [...displayTitle].length * 10 + 14);
                const titleX = nearLeft ? labelX - 6 : labelX - titleWidth / 2;
                return <g key={event.id} className="event-node" tabIndex={0} role="button" aria-label={`${eventDateLabel(event, doc)} ${event.title}`} onPointerEnter={() => setHoveredEvent(event)} onPointerLeave={() => setHoveredEvent(null)} onDoubleClick={(e) => { e.stopPropagation(); if (!eventDragMovedRef.current) setModal({ open: true, event }); }} onKeyDown={(e) => { if (e.key === "Enter") setModal({ open: true, event }); }}>
                  <line className="event-stem" x1={x} x2={x} y1={y} y2={labelY + (above ? 8 : -14)} />
                  <circle className={`event-dot ${eventTone(event.score)}`} cx={x} cy={y} r="7" onPointerDown={(e) => { e.stopPropagation(); dragStartRef.current = doc; eventDragStartRef.current = { x: e.clientX, y: e.clientY }; eventDragMovedRef.current = false; setDragging(event.id); (e.currentTarget as SVGCircleElement).setPointerCapture(e.pointerId); }} />
                  <rect className="event-title-bg" x={titleX} y={labelY - 14} width={titleWidth} height="20" rx="5" />
                  <text className="event-title" x={labelX} y={labelY} textAnchor={nearLeft ? "start" : "middle"}>{displayTitle}</text>
                  {index === visibleEvents.length - 1 && <title>{event.title}</title>}
                </g>;
              })}

              {hoveredEvent && !dragging && (() => {
                const x = xForDate(safeDate(hoveredEvent.occurredAt));
                const y = yForScore(hoveredEvent.score);
                const popupX = clamp(x - 120, MARGIN.left, width - MARGIN.right - 240);
                const popupY = y > MARGIN.top + 105 ? y - 96 : y + 18;
                const summary = hoveredEvent.description.trim() || "詳細はまだ記録されていません";
                return <g className="event-popover" pointerEvents="none" transform={`translate(${popupX},${popupY})`}>
                  <rect width="240" height="78" rx="12" />
                  <text className="event-popover-title" x="14" y="22">{hoveredEvent.title.length > 20 ? `${hoveredEvent.title.slice(0, 19)}…` : hoveredEvent.title}</text>
                  <text className="event-popover-date" x="14" y="40">{eventDateLabel(hoveredEvent, doc)}</text>
                  <text className="event-popover-summary" x="14" y="61">{summary.length > 28 ? `${summary.slice(0, 27)}…` : summary}</text>
                </g>;
              })()}

              {pointer && !hoveredEvent && !dragging && pointer.x >= MARGIN.left && pointer.x <= width - MARGIN.right && pointer.y >= MARGIN.top && pointer.y <= GRAPH_HEIGHT - MARGIN.bottom && (
                <g className="crosshair" pointerEvents="none">
                  <line x1={pointer.x} x2={pointer.x} y1={MARGIN.top} y2={GRAPH_HEIGHT - MARGIN.bottom} />
                  <line x1={MARGIN.left} x2={width - MARGIN.right} y1={pointer.y} y2={pointer.y} />
                  <g transform={`translate(${clamp(pointer.x - 82, MARGIN.left, width - MARGIN.right - 164)},${clamp(pointer.y - 54, MARGIN.top, GRAPH_HEIGHT - MARGIN.bottom - 42)})`}>
                    <rect width="164" height="42" rx="11" />
                    <text x="14" y="26">{doc.inputPrecision === "year" ? (doc.mode === "lifetime" ? `${differenceInYears(pointer.date, safeDate(doc.birth))}歳 · ${format(pointer.date, "yyyy年")}` : format(pointer.date, "yyyy年")) : doc.inputPrecision === "month" ? format(pointer.date, "yyyy年M月") : format(pointer.date, "yyyy/M/d")}</text>
                  </g>
                </g>
              )}
            </svg>
          </div>

          <div className="graph-footer">
            {!readOnly && <button className="button primary add-event" onClick={() => openNewEvent()}><Plus size={18} />出来事を追加</button>}
          </div>
        </section>

        <section className="event-strip">
          <div className="event-previews">
            {[...doc.events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).map((event) => <button key={event.id} className={eventTone(event.score)} onClick={() => setModal({ open: true, event })}><span>{eventDateLabel(event, doc)}</span>{event.title}</button>)}
            {!doc.events.length && <span className="muted">まだ出来事はありません。</span>}
          </div>
          <button className="text-button" onClick={() => setEventsOpen(true)}><List size={17} />一覧を見る</button>
        </section>
      </main>

      {modal.open && modal.event && <EventDialog event={modal.event} doc={doc} readOnly={readOnly} onClose={() => setModal({ open: false, event: null })} onSave={saveEvent} onDelete={deleteEvent} />}
      {settingsOpen && <SettingsPanel doc={doc} theme={theme} onTheme={setTheme} onClose={() => setSettingsOpen(false)} onChange={(next) => { updateDoc(() => next); setView(getFullRange(next)); }} />}
      {eventsOpen && <EventsPanel doc={doc} readOnly={readOnly} onClose={() => setEventsOpen(false)} onSelect={(event) => { setEventsOpen(false); setModal({ open: true, event }); }} onAdd={() => { setEventsOpen(false); openNewEvent(); }} />}
      {shareOpen && <ShareDialog readOnly={readOnly} onClose={() => setShareOpen(false)} onLink={copyShareLink} onPng={exportPng} onJson={exportJson} onImport={() => importRef.current?.click()} />}
      <input ref={importRef} className="sr-only" type="file" accept="application/json" onChange={importJson} />
      {toast && <div className="toast" role="status"><Check size={17} />{toast}</div>}
    </div>
  );
}

function EventDialog({ event, doc, readOnly, onClose, onSave, onDelete }: { event: TimelineEvent; doc: TimelineDocument; readOnly: boolean; onClose: () => void; onSave: (event: TimelineEvent) => void; onDelete: (id: string) => void }) {
  const [draft, setDraft] = useState(event);
  const isExisting = doc.events.some((item) => item.id === event.id);
  const isBirth = draft.id === "birth";
  const precision = isBirth ? "day" : doc.inputPrecision;
  const dateValue = precision === "year" ? draft.occurredAt.slice(0, 4) : precision === "month" ? draft.occurredAt.slice(0, 7) : draft.occurredAt;
  const writableEnd = getWritableEnd(doc);
  const maxDateValue = precision === "year" ? format(writableEnd, "yyyy") : precision === "month" ? format(writableEnd, "yyyy-MM") : format(writableEnd, "yyyy-MM-dd");
  const changeEventDate = (value: string) => {
    const occurredAt = precision === "year" ? `${value}-01-01` : precision === "month" ? `${value}-01` : value;
    setDraft({ ...draft, occurredAt });
  };
  const submit = (formEvent: FormEvent) => {
    formEvent.preventDefault();
    if (!draft.title.trim()) return;
    onSave({ ...draft, datePrecision: precision, title: draft.title.trim(), score: Math.round(clamp(Number(draft.score), -100, 100) / 10) * 10 });
  };
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <form className="dialog" onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
      <div className="dialog-header"><div><p className="eyebrow">LIFE EVENT</p><h2>{readOnly ? "出来事" : isExisting ? "出来事を編集" : "出来事を追加"}</h2></div><IconButton label="閉じる" onClick={onClose}><X size={20} /></IconButton></div>
      <label>タイトル<input autoFocus={!readOnly && !isBirth} required maxLength={60} readOnly={readOnly || isBirth} value={draft.title} placeholder="どんな出来事でしたか？" onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
      <label className="event-date-field"><span>{precision === "year" ? "年" : precision === "month" ? "年月" : "日付"}<small>グラフの記録単位に合わせて入力します</small></span><div><input type={precision === "year" ? "number" : precision === "month" ? "month" : "date"} inputMode={precision === "year" ? "numeric" : undefined} min={precision === "year" ? "1900" : undefined} max={maxDateValue} readOnly={readOnly || isBirth} value={dateValue} onChange={(e) => changeEventDate(e.target.value)} /><b>{precision === "year" ? "年単位" : precision === "month" ? "月単位" : "日単位"}</b></div></label>
      <label>スコア <output>{draft.score > 0 ? `+${draft.score}` : draft.score}</output><input autoFocus={!readOnly && isBirth} className="score-range" type="range" min="-100" max="100" step="10" disabled={readOnly} value={draft.score} onChange={(e) => setDraft({ ...draft, score: Number(e.target.value) })} /><span className="range-labels"><span>つらかった</span><span>穏やか</span><span>最高だった</span></span></label>
      <label>ひとこと <span className="optional">任意</span><textarea maxLength={500} readOnly={readOnly || isBirth} value={draft.description} placeholder="そのときの気持ちや、覚えておきたいこと" onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
      {!readOnly && <div className="dialog-actions">{isExisting && draft.id !== "birth" ? <button type="button" className="button danger" onClick={() => onDelete(draft.id)}><Trash2 size={17} />削除</button> : <span />}<div><button type="button" className="button secondary" onClick={onClose}>キャンセル</button><button type="submit" className="button primary">保存する</button></div></div>}
    </form>
  </div>;
}

function SettingsPanel({ doc, theme, onTheme, onClose, onChange }: { doc: TimelineDocument; theme: Theme; onTheme: (theme: Theme) => void; onClose: () => void; onChange: (doc: TimelineDocument) => void }) {
  const [draft, setDraft] = useState(doc);
  const [birthInput, setBirthInput] = useState(doc.birth.replaceAll("-", "/"));
  return <div className="drawer-backdrop" onMouseDown={onClose}><aside className="drawer" onMouseDown={(e) => e.stopPropagation()}><div className="dialog-header"><div><p className="eyebrow">PREFERENCES</p><h2>グラフの設定</h2></div><IconButton label="閉じる" onClick={onClose}><X size={20} /></IconButton></div>
    <label>タイトル<input maxLength={60} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
    <label>何歳まで表示するか<div className="setting-with-suffix"><input aria-label="終了年齢" type="number" min="1" max="120" value={draft.endAge} onChange={(e) => setDraft({ ...draft, endAge: clamp(Number(e.target.value), 1, 120) })} /><span>歳まで</span></div></label>
    {draft.mode === "year" && <div className="field-row"><label>表示する年<input type="number" min="1" max="9999" value={draft.displayYear} onChange={(e) => setDraft(withYearRange(draft, Number(e.target.value), draft.yearStartMonth))} /></label><label>開始月<select value={draft.yearStartMonth} onChange={(e) => setDraft(withYearRange(draft, draft.displayYear, Number(e.target.value)))}>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}月</option>)}</select></label></div>}
    {draft.mode === "custom" && <div className="field-row"><label>開始日<input type="date" value={draft.range.start} onChange={(e) => setDraft({ ...draft, range: { ...draft.range, start: e.target.value } })} /></label><label>終了日<input type="date" value={draft.range.end} onChange={(e) => setDraft({ ...draft, range: { ...draft.range, end: e.target.value } })} /></label></div>}
    <label className="toggle-row"><span><strong>西暦を表示</strong><small>年齢の下に西暦を添えます</small></span><input type="checkbox" checked={draft.showCalendarYear} onChange={(e) => setDraft({ ...draft, showCalendarYear: e.target.checked })} /></label>
    <label className="birth-year-field">生年月日<input type="text" inputMode="numeric" placeholder="YYYY/MM/DD" value={birthInput.replaceAll("-", "/")} onChange={(e) => { setBirthInput(e.target.value); const parsed = parseDateInput(e.target.value); if (parsed) setDraft(withBirth(draft, parsed)); }} /><small>西暦／月／日の順に入力します。曜日欄は表示されません</small></label>
    <fieldset><legend>グラフの線</legend><div className="theme-options line-style-options">{([['curve', '曲線'], ['straight', '直線']] as const).map(([value, text]) => <button type="button" key={value} className={draft.lineStyle === value ? "selected" : ""} onClick={() => setDraft({ ...draft, lineStyle: value })}>{text}{draft.lineStyle === value && <Check size={15} />}</button>)}</div></fieldset>
    <fieldset><legend>テーマ</legend><div className="theme-options">{([['auto', '自動', CircleHelp], ['light', 'ライト', Sun], ['dark', 'ダーク', Moon]] as const).map(([value, text, Icon]) => <button type="button" key={value} className={theme === value ? "selected" : ""} onClick={() => onTheme(value)}><Icon size={18} />{text}{theme === value && <Check size={15} />}</button>)}</div></fieldset>
    <div className="clear-events"><div><strong>出来事をクリア</strong><small>誕生を残して、追加した出来事をすべて削除します</small></div><button type="button" className="button danger" disabled={!draft.events.some((item) => item.id !== "birth")} onClick={() => { if (window.confirm("「誕生」以外の出来事をすべて削除しますか？")) setDraft({ ...draft, events: draft.events.filter((item) => item.id === "birth") }); }}><Trash2 size={16} />クリア</button></div>
    <button className="button primary full" onClick={() => { onChange(draft); onClose(); }}>設定を保存</button>
  </aside></div>;
}

function EventsPanel({ doc, readOnly, onClose, onSelect, onAdd }: { doc: TimelineDocument; readOnly: boolean; onClose: () => void; onSelect: (event: TimelineEvent) => void; onAdd: () => void }) {
  return <div className="drawer-backdrop events-panel-backdrop" onMouseDown={onClose}><aside className="drawer events-drawer" onMouseDown={(e) => e.stopPropagation()}><div className="dialog-header"><div><p className="eyebrow">LIFE EVENTS</p><h2>出来事の一覧</h2></div><IconButton label="閉じる" onClick={onClose}><X size={20} /></IconButton></div>
    <div className="all-events">{[...doc.events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).map((event) => <button key={event.id} onClick={() => onSelect(event)}><i className={eventTone(event.score)} /><span><small>{eventDateLabel(event, doc)}</small><strong>{event.title}</strong>{event.description && <em>{event.description}</em>}</span><b>{event.score > 0 ? `+${event.score}` : event.score}</b></button>)}{!doc.events.length && <div className="empty-list"><MoreHorizontal size={28} /><p>まだ出来事はありません</p></div>}</div>
    {!readOnly && <button className="button primary full" onClick={onAdd}><Plus size={18} />出来事を追加</button>}
  </aside></div>;
}

function ShareDialog({ readOnly, onClose, onLink, onPng, onJson, onImport }: { readOnly: boolean; onClose: () => void; onLink: () => void; onPng: () => void; onJson: () => void; onImport: () => void }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="dialog share-dialog" onMouseDown={(e) => e.stopPropagation()}><div className="dialog-header"><div><p className="eyebrow">SHARE YOUR STORY</p><h2>人生グラフを共有</h2></div><IconButton label="閉じる" onClick={onClose}><X size={20} /></IconButton></div>
    <div className="share-options"><button onClick={onLink}><span className="share-icon accent"><Link size={22} /></span><span><strong>リンクをコピー</strong><small>データはリンクの中だけに保存されます</small></span></button><button onClick={onPng}><span className="share-icon coral"><Download size={22} /></span><span><strong>画像として保存</strong><small>SNSへの投稿におすすめです</small></span></button><button onClick={onJson}><span className="share-icon blue"><FileDown size={22} /></span><span><strong>JSONを書き出す</strong><small>バックアップとして保存します</small></span></button>{!readOnly && <button onClick={onImport}><span className="share-icon neutral"><FileUp size={22} /></span><span><strong>JSONを読み込む</strong><small>保存したグラフを復元します</small></span></button>}</div>
    <p className="privacy-note">共有リンクを知っている人は内容を見ることができます。個人情報の入力にはご注意ください。</p>
  </div></div>;
}

export default App;
