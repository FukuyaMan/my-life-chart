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
  Menu,
  Minus,
  Moon,
  MoreHorizontal,
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
  type WheelEvent,
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

type TimelineEvent = {
  id: string;
  occurredAt: string;
  datePrecision: Precision;
  score: number;
  title: string;
  description: string;
};

type TimelineDocument = {
  schemaVersion: 1;
  id: string;
  title: string;
  mode: Mode;
  birth: string;
  range: { start: string; end: string };
  endAge: number;
  showCalendarYear: boolean;
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
  schemaVersion: z.literal(1),
  id: z.string(),
  title: z.string(),
  mode: z.enum(["lifetime", "year", "custom"]),
  birth: z.string(),
  range: z.object({ start: z.string(), end: z.string() }),
  endAge: z.number().min(1).max(120),
  showCalendarYear: z.boolean(),
  events: z.array(eventSchema),
  updatedAt: z.string(),
});

const today = new Date();
const defaultBirth = `${getYear(today) - 30}-01-01`;
const defaultDocument: TimelineDocument = {
  schemaVersion: 1,
  id: crypto.randomUUID(),
  title: "わたしの人生グラフ",
  mode: "lifetime",
  birth: defaultBirth,
  range: { start: defaultBirth, end: `${getYear(today) + 70}-01-01` },
  endAge: 100,
  showCalendarYear: true,
  events: [],
  updatedAt: new Date().toISOString(),
};

const STORAGE_KEY = "jinsei-graph:document:v1";
const THEME_KEY = "jinsei-graph:theme";
const MARGIN = { top: 46, right: 34, bottom: 72, left: 52 };
const GRAPH_HEIGHT = 460;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function systemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function safeDate(value: string, fallback = today) {
  const date = parseISO(value);
  return isValid(date) ? date : fallback;
}

function getFullRange(doc: TimelineDocument): [Date, Date] {
  if (doc.mode === "lifetime") {
    const start = safeDate(doc.birth);
    return [start, addYears(start, doc.endAge)];
  }
  return [safeDate(doc.range.start), safeDate(doc.range.end)];
}

function getModeRange(mode: Mode, doc: TimelineDocument): [Date, Date] {
  if (mode === "lifetime") {
    const start = safeDate(doc.birth);
    return [start, addYears(start, doc.endAge)];
  }
  if (mode === "year") {
    const start = startOfYear(today);
    return [start, addYears(start, 1)];
  }
  return [safeDate(doc.range.start), safeDate(doc.range.end)];
}

function formatRange(start: Date, end: Date) {
  const days = differenceInCalendarDays(end, start);
  if (days > 730) return `${format(start, "yyyy")} — ${format(end, "yyyy")}`;
  if (days > 60) return `${format(start, "yyyy年M月")} — ${format(end, "yyyy年M月")}`;
  return `${format(start, "M月d日")} — ${format(end, "M月d日")}`;
}

function tickSpec(start: Date, end: Date) {
  const days = Math.max(1, differenceInCalendarDays(end, start));
  if (days > 3650) return { unit: "year" as const, step: days > 15000 ? 10 : 5, label: "年" };
  if (days > 730) return { unit: "year" as const, step: 1, label: "年" };
  if (days > 150) return { unit: "month" as const, step: 1, label: "月" };
  if (days > 35) return { unit: "week" as const, step: 1, label: "週" };
  return { unit: "day" as const, step: days > 14 ? 2 : 1, label: "日" };
}

function makeTicks(start: Date, end: Date) {
  const spec = tickSpec(start, end);
  let cursor = spec.unit === "year" ? startOfYear(start) : spec.unit === "month" ? startOfMonth(start) : spec.unit === "week" ? startOfWeek(start, { weekStartsOn: 1 }) : start;
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
  const datePart = event.datePrecision === "year" ? format(date, "yyyy年") : event.datePrecision === "month" ? format(date, "yyyy年M月") : format(date, "yyyy年M月d日");
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

function IconButton({ label, children, onClick, disabled = false }: { label: string; children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button className="icon-button" aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</button>;
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
  const [view, setView] = useState<[Date, Date]>(() => getFullRange(sharedDocument || doc));
  const [modal, setModal] = useState<{ open: boolean; event: TimelineEvent | null }>({ open: false, event: null });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [pointer, setPointer] = useState<{ date: Date; score: number; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [width, setWidth] = useState(900);
  const graphWrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const dragStartRef = useRef<TimelineDocument | null>(null);
  const themeCycleOriginRef = useRef<"light" | "dark">(systemTheme());
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
  const yForScore = (score: number) => MARGIN.top + ((100 - score) / 200) * plotHeight;
  const scoreForY = (y: number) => Math.round(clamp(100 - ((y - MARGIN.top) / plotHeight) * 200, -100, 100));
  const { unit, label: unitLabel, ticks } = useMemo(() => makeTicks(view[0], view[1]), [view]);
  const visibleEvents = useMemo(() => doc.events.filter((event) => {
    const time = safeDate(event.occurredAt).getTime();
    return time >= view[0].getTime() && time <= view[1].getTime();
  }).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)), [doc.events, view]);

  const linePoints = useMemo(() => {
    const points = [
      { date: view[0], score: 0 },
      ...visibleEvents.map((event) => ({ date: safeDate(event.occurredAt), score: event.score })),
      { date: view[1], score: 0 },
    ];
    return points.map((item) => `${xForDate(item.date)},${yForScore(item.score)}`).join(" ");
  }, [visibleEvents, view, plotWidth]);

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

  const pointerFromEvent = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * width;
    const y = ((clientY - rect.top) / rect.height) * GRAPH_HEIGHT;
    return { date: dateForX(x), score: scoreForY(y), x, y };
  };

  const openNewEvent = (date = new Date((view[0].getTime() + view[1].getTime()) / 2), score = 0) => {
    if (readOnly) return;
    setModal({
      open: true,
      event: { id: crypto.randomUUID(), occurredAt: format(date, "yyyy-MM-dd"), datePrecision: unit === "year" ? "year" : unit === "month" ? "month" : "day", score, title: "", description: "" },
    });
  };

  const saveEvent = (event: TimelineEvent) => {
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

  const duplicateShared = () => {
    const editable = { ...doc, id: crypto.randomUUID(), updatedAt: new Date().toISOString() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(editable));
    window.history.replaceState(null, "", location.pathname);
    location.reload();
  };

  const onGraphMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const next = pointerFromEvent(event.clientX, event.clientY);
    if (dragging && !readOnly) {
      updateDoc((current) => ({ ...current, events: current.events.map((item) => item.id === dragging ? { ...item, occurredAt: format(next.date, "yyyy-MM-dd"), score: next.score } : item) }), false);
    } else {
      setPointer(next);
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label="人生グラフ ホーム">
          <span className="brand-mark"><span /></span>
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
          <IconButton label="メニュー" onClick={() => setEventsOpen(true)}><Menu size={20} /></IconButton>
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
            <input
              className="title-input"
              aria-label="人生グラフのタイトル"
              value={doc.title}
              readOnly={readOnly}
              maxLength={60}
              onChange={(event) => updateDoc((current) => ({ ...current, title: event.target.value }))}
            />
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
              className="graph"
              viewBox={`0 0 ${width} ${GRAPH_HEIGHT}`}
              role="img"
              aria-label={`${doc.title}。${doc.events.length}件の出来事があります`}
              onDoubleClick={(event: ReactMouseEvent<SVGSVGElement>) => {
                const point = pointerFromEvent(event.clientX, event.clientY);
                openNewEvent(point.date, point.score);
              }}
              onPointerMove={onGraphMove}
              onPointerLeave={() => { setPointer(null); setDragging(null); }}
              onPointerUp={() => { if (dragging) { if (dragStartRef.current) setHistory((items) => [...items, dragStartRef.current!].slice(-20)); dragStartRef.current = null; setFuture([]); setDragging(null); } }}
              onWheel={(event: WheelEvent<SVGSVGElement>) => { event.preventDefault(); zoom(event.deltaY > 0 ? 1.22 : 0.82); }}
            >
              <defs>
                <linearGradient id="lineGradient" x1="0" x2="1">
                  <stop offset="0" stopColor="var(--accent)" />
                  <stop offset="1" stopColor="var(--positive)" />
                </linearGradient>
              </defs>
              <rect className="graph-bg" x="0" y="0" width={width} height={GRAPH_HEIGHT} rx="18" />
              {[-100, -50, 0, 50, 100].map((score) => (
                <g key={score}>
                  <line className={score === 0 ? "zero-line" : "grid-line"} x1={MARGIN.left} x2={width - MARGIN.right} y1={yForScore(score)} y2={yForScore(score)} />
                  <text className="y-label" x={MARGIN.left - 14} y={yForScore(score) + 4} textAnchor="end">{score > 0 ? `+${score}` : score}</text>
                </g>
              ))}
              <text className="axis-caption" x={14} y={22}>実感スコア</text>
              {ticks.map((tick) => {
                const label = formatTick(tick, unit, doc);
                return <g key={tick.toISOString()}>
                  <line className="x-grid-line" x1={xForDate(tick)} x2={xForDate(tick)} y1={MARGIN.top} y2={GRAPH_HEIGHT - MARGIN.bottom} />
                  <text className="x-label" x={xForDate(tick)} y={GRAPH_HEIGHT - 43} textAnchor="middle">{label.primary}</text>
                  {label.secondary && <text className="x-sub-label" x={xForDate(tick)} y={GRAPH_HEIGHT - 24} textAnchor="middle">{label.secondary}</text>}
                </g>;
              })}
              <polyline className="life-line life-line-shadow" points={linePoints} />
              <polyline className="life-line" points={linePoints} />

              {!doc.events.length && (
                <g className="empty-hint" onClick={() => openNewEvent()}>
                  <circle cx={MARGIN.left + plotWidth / 2} cy={yForScore(0)} r="19" />
                  <path d={`M${MARGIN.left + plotWidth / 2 - 7} ${yForScore(0)}h14M${MARGIN.left + plotWidth / 2} ${yForScore(0) - 7}v14`} />
                  <text x={MARGIN.left + plotWidth / 2} y={yForScore(0) + 48} textAnchor="middle">ダブルクリックして、出来事を追加</text>
                </g>
              )}

              {visibleEvents.map((event, index) => {
                const date = safeDate(event.occurredAt);
                const x = xForDate(date);
                const y = yForScore(event.score);
                const above = event.score >= 0;
                const labelY = y + (above ? -30 : 34);
                return <g key={event.id} className="event-node" tabIndex={0} role="button" aria-label={`${eventDateLabel(event, doc)} ${event.title}`} onClick={() => setModal({ open: true, event })} onKeyDown={(e) => { if (e.key === "Enter") setModal({ open: true, event }); }}>
                  <line className="event-stem" x1={x} x2={x} y1={y} y2={labelY + (above ? 8 : -14)} />
                  <circle className="event-halo" cx={x} cy={y} r="13" />
                  <circle className={event.score >= 0 ? "event-dot positive" : "event-dot negative"} cx={x} cy={y} r="7" onPointerDown={(e) => { e.stopPropagation(); dragStartRef.current = doc; setDragging(event.id); (e.currentTarget as SVGCircleElement).setPointerCapture(e.pointerId); }} />
                  <text className="event-title" x={x} y={labelY} textAnchor="middle">{event.title.length > 16 ? `${event.title.slice(0, 15)}…` : event.title}</text>
                  <text className="event-score" x={x} y={labelY + 16} textAnchor="middle">{event.score > 0 ? `+${event.score}` : event.score}</text>
                  {index === visibleEvents.length - 1 && <title>{event.title}</title>}
                </g>;
              })}

              {pointer && !dragging && pointer.x >= MARGIN.left && pointer.x <= width - MARGIN.right && pointer.y >= MARGIN.top && pointer.y <= GRAPH_HEIGHT - MARGIN.bottom && (
                <g className="crosshair" pointerEvents="none">
                  <line x1={pointer.x} x2={pointer.x} y1={MARGIN.top} y2={GRAPH_HEIGHT - MARGIN.bottom} />
                  <line x1={MARGIN.left} x2={width - MARGIN.right} y1={pointer.y} y2={pointer.y} />
                  <g transform={`translate(${clamp(pointer.x - 58, MARGIN.left, width - MARGIN.right - 116)},${clamp(pointer.y - 48, MARGIN.top, GRAPH_HEIGHT - MARGIN.bottom - 40)})`}>
                    <rect width="116" height="38" rx="9" />
                    <text x="10" y="16">{format(pointer.date, "yyyy/M/d")}</text>
                    <text x="10" y="30">スコア {pointer.score > 0 ? `+${pointer.score}` : pointer.score}</text>
                  </g>
                </g>
              )}
            </svg>
          </div>

          <div className="graph-footer">
            <span><i className="legend positive" />心が上向いた時間</span>
            <span><i className="legend negative" />立ち止まった時間</span>
            {!readOnly && <button className="button primary add-event" onClick={() => openNewEvent()}><Plus size={18} />出来事を追加</button>}
          </div>
        </section>

        <section className="event-strip">
          <div>
            <span className="count">{doc.events.length}</span>
            <span>個の出来事</span>
          </div>
          <div className="event-previews">
            {doc.events.slice(0, 3).map((event) => <button key={event.id} onClick={() => setModal({ open: true, event })}><span>{eventDateLabel(event, doc)}</span>{event.title}</button>)}
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
  const submit = (formEvent: FormEvent) => {
    formEvent.preventDefault();
    if (!draft.title.trim()) return;
    onSave({ ...draft, title: draft.title.trim(), score: clamp(Number(draft.score), -100, 100) });
  };
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <form className="dialog" onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
      <div className="dialog-header"><div><p className="eyebrow">LIFE EVENT</p><h2>{readOnly ? "出来事" : isExisting ? "出来事を編集" : "出来事を追加"}</h2></div><IconButton label="閉じる" onClick={onClose}><X size={20} /></IconButton></div>
      <label>タイトル<input autoFocus={!readOnly} required maxLength={60} readOnly={readOnly} value={draft.title} placeholder="どんな出来事でしたか？" onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
      <div className="field-row">
        <label>日付<input type="date" readOnly={readOnly} value={draft.occurredAt} onChange={(e) => setDraft({ ...draft, occurredAt: e.target.value })} /></label>
        <label>記録の細かさ<select disabled={readOnly} value={draft.datePrecision} onChange={(e) => setDraft({ ...draft, datePrecision: e.target.value as Precision })}><option value="day">日まで</option><option value="month">月まで</option><option value="year">年まで</option></select></label>
      </div>
      <label>実感スコア <output>{draft.score > 0 ? `+${draft.score}` : draft.score}</output><input className="score-range" type="range" min="-100" max="100" step="1" disabled={readOnly} value={draft.score} onChange={(e) => setDraft({ ...draft, score: Number(e.target.value) })} /><span className="range-labels"><span>つらかった</span><span>穏やか</span><span>最高だった</span></span></label>
      <label>ひとこと <span className="optional">任意</span><textarea maxLength={500} readOnly={readOnly} value={draft.description} placeholder="そのときの気持ちや、覚えておきたいこと" onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
      {!readOnly && <div className="dialog-actions">{isExisting ? <button type="button" className="button danger" onClick={() => onDelete(draft.id)}><Trash2 size={17} />削除</button> : <span />}<div><button type="button" className="button secondary" onClick={onClose}>キャンセル</button><button type="submit" className="button primary">保存する</button></div></div>}
    </form>
  </div>;
}

function SettingsPanel({ doc, theme, onTheme, onClose, onChange }: { doc: TimelineDocument; theme: Theme; onTheme: (theme: Theme) => void; onClose: () => void; onChange: (doc: TimelineDocument) => void }) {
  const [draft, setDraft] = useState(doc);
  const birthYear = getYear(safeDate(draft.birth));
  return <div className="drawer-backdrop" onMouseDown={onClose}><aside className="drawer" onMouseDown={(e) => e.stopPropagation()}><div className="dialog-header"><div><p className="eyebrow">PREFERENCES</p><h2>グラフの設定</h2></div><IconButton label="閉じる" onClick={onClose}><X size={20} /></IconButton></div>
    <label>タイトル<input maxLength={60} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
    <fieldset className="age-range-fieldset"><legend>人生グラフの範囲</legend><div className="age-range-setting"><label>開始年齢<span className="fixed-age">0歳</span></label><span className="range-arrow">—</span><label>何歳まで<input aria-label="終了年齢" type="number" min="1" max="120" value={draft.endAge} onChange={(e) => setDraft({ ...draft, endAge: clamp(Number(e.target.value), 1, 120) })} /><b>歳</b></label></div><small>人生グラフは0歳から始まります</small></fieldset>
    {draft.mode === "custom" && <div className="field-row"><label>開始日<input type="date" value={draft.range.start} onChange={(e) => setDraft({ ...draft, range: { ...draft.range, start: e.target.value } })} /></label><label>終了日<input type="date" value={draft.range.end} onChange={(e) => setDraft({ ...draft, range: { ...draft.range, end: e.target.value } })} /></label></div>}
    <label className="toggle-row"><span><strong>西暦を表示</strong><small>年齢の下に西暦を添えます</small></span><input type="checkbox" checked={draft.showCalendarYear} onChange={(e) => setDraft({ ...draft, showCalendarYear: e.target.checked })} /></label>
    {draft.showCalendarYear && <label className="birth-year-field">生まれた年<div><input type="number" min="1900" max={getYear(today)} value={birthYear} onChange={(e) => setDraft({ ...draft, birth: `${clamp(Number(e.target.value), 1900, getYear(today))}-01-01` })} /><span>年生まれ</span></div><small>年齢に対応する西暦を表示します</small></label>}
    <fieldset><legend>テーマ</legend><div className="theme-options">{([['auto', '自動', CircleHelp], ['light', 'ライト', Sun], ['dark', 'ダーク', Moon]] as const).map(([value, text, Icon]) => <button type="button" key={value} className={theme === value ? "selected" : ""} onClick={() => onTheme(value)}><Icon size={18} />{text}{theme === value && <Check size={15} />}</button>)}</div></fieldset>
    <button className="button primary full" onClick={() => { onChange(draft); onClose(); }}>設定を保存</button>
  </aside></div>;
}

function EventsPanel({ doc, readOnly, onClose, onSelect, onAdd }: { doc: TimelineDocument; readOnly: boolean; onClose: () => void; onSelect: (event: TimelineEvent) => void; onAdd: () => void }) {
  return <div className="drawer-backdrop" onMouseDown={onClose}><aside className="drawer events-drawer" onMouseDown={(e) => e.stopPropagation()}><div className="dialog-header"><div><p className="eyebrow">LIFE EVENTS</p><h2>出来事の一覧</h2></div><IconButton label="閉じる" onClick={onClose}><X size={20} /></IconButton></div>
    <div className="all-events">{[...doc.events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).map((event) => <button key={event.id} onClick={() => onSelect(event)}><i className={event.score >= 0 ? "positive" : "negative"} /><span><small>{eventDateLabel(event, doc)}</small><strong>{event.title}</strong>{event.description && <em>{event.description}</em>}</span><b>{event.score > 0 ? `+${event.score}` : event.score}</b></button>)}{!doc.events.length && <div className="empty-list"><MoreHorizontal size={28} /><p>まだ出来事はありません</p></div>}</div>
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
