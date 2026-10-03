import { useEffect, useRef, useState, type DragEvent } from "react";
import type { AccountView, GroupView } from "../contract/views";
import { Icon } from "../components/Icon";
import { ACCOUNT_DRAG } from "../dragTypes";
import { NO_GROUP_KEY, sortSectionsOf } from "../groups";
import { useT } from "../i18n/i18n";
import { dropPlacement } from "../reorder";

type Dir = "up" | "down";
type Over = { kind: "row"; id: string } | { kind: "group"; key: string };

const arrowButton =
  "flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-ring bg-transparent p-0 text-text disabled:cursor-default disabled:opacity-30";
const dropRow = "bg-hair shadow-[inset_0_2px_0_var(--color-line)]";
const dropHeader = "bg-hair shadow-[inset_0_-2px_0_var(--color-line)]";

export function SortList({
  accounts,
  siteIds,
  groups,
  onMove,
  onSwap,
  onDone,
}: {
  accounts: AccountView[];
  siteIds: ReadonlySet<string>;
  groups: GroupView[];
  onMove: (id: string, groupId: string | null, beforeId: string | null) => Promise<void>;
  onSwap: (id: string, otherId: string) => Promise<void>;
  onDone: () => void;
}) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const dragRef = useRef<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<Over | null>(null);
  const [tick, setTick] = useState(0);
  // Focus is applied after the reloaded list has rendered, not right after the await.
  const pending = useRef<{ id: string; dir: Dir; base: AccountView[] } | null>(null);

  useEffect(() => {
    const p = pending.current;
    if (!p || p.base === accounts) return;
    const find = (d: Dir) =>
      rootRef.current?.querySelector<HTMLButtonElement>(`[data-sort-${d}="${CSS.escape(p.id)}"]`) ??
      null;
    let button = find(p.dir);
    if (button?.disabled) button = find(p.dir === "up" ? "down" : "up");
    if (button && !button.disabled) button.focus();
    pending.current = null;
  }, [accounts, tick]);

  async function run(action: () => Promise<void>, id: string, dir: Dir) {
    // The ref blocks a second action before the first one has reloaded the list.
    if (busy.current) return;
    busy.current = true;
    const base = accounts;
    try {
      await action();
    } finally {
      busy.current = false;
      pending.current = { id, dir, base };
      setTick((n) => n + 1);
    }
  }

  function clearDrag() {
    dragRef.current = null;
    setDragId(null);
    setOver(null);
  }

  const siteRows = accounts.filter((a) => siteIds.has(a.id));
  const sections = sortSectionsOf(
    accounts.filter((a) => !siteIds.has(a.id)),
    groups,
  );
  const headed = groups.length > 0;

  // The dragged row can vanish mid-drag (deleted elsewhere); its dragend never fires then.
  function liveDrag(): string | null {
    const id = dragRef.current;
    if (id === null) return null;
    if (accounts.some((a) => a.id === id)) return id;
    clearDrag();
    return null;
  }

  // Same target keeps the previous state object, so dragover (every ~50 ms) does not re-render.
  function hover(next: Over | null) {
    setOver((prev) => {
      if (prev === next) return prev;
      if (prev && next && prev.kind === next.kind) {
        if (prev.kind === "row" && next.kind === "row" && prev.id === next.id) return prev;
        if (prev.kind === "group" && next.kind === "group" && prev.key === next.key) return prev;
      }
      return next;
    });
  }

  function accept(event: DragEvent) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  }

  function dropOnRow(event: DragEvent, target: string) {
    event.preventDefault();
    const dragged = liveDrag();
    clearDrag();
    if (!dragged) return;
    const placement = dropPlacement(accounts, dragged, target);
    if (placement)
      void run(() => onMove(dragged, placement.groupId, placement.beforeId), dragged, "up");
  }

  function dropOnGroup(event: DragEvent, groupId: string | null) {
    event.preventDefault();
    const dragged = liveDrag();
    clearDrag();
    if (!dragged) return;
    const first = accounts.find(
      (a) => !a.pinned && a.id !== dragged && (a.groupId ?? null) === groupId,
    );
    void run(() => onMove(dragged, groupId, first?.id ?? null), dragged, "up");
  }

  const label = (a: AccountView) => a.issuer || a.label;

  function fixedRow(a: AccountView, tag: boolean) {
    return (
      <li
        key={a.id}
        aria-disabled="true"
        className="flex min-h-11 items-center gap-2.5 border-b border-hair py-2 opacity-55"
      >
        <span aria-hidden="true" className="flex w-5 justify-center opacity-30">
          <Icon name="grip" size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px]">{a.issuer || a.label}</span>
          {a.issuer ? <span className="block truncate text-xs text-muted">{a.label}</span> : null}
          {!tag ? <span className="block text-xs text-muted">{t("sort.sitePinned")}</span> : null}
        </span>
        {tag ? <span className="text-xs text-muted">{t("sort.fixed")}</span> : null}
      </li>
    );
  }

  function movableRow(a: AccountView, index: number, peers: AccountView[]) {
    const name = label(a);
    const neighbour = (d: -1 | 1) => peers[index + d];
    const swap = (d: -1 | 1, dir: Dir) => {
      const other = neighbour(d);
      if (other) void run(() => onSwap(a.id, other.id), a.id, dir);
    };
    return (
      <li
        key={a.id}
        data-sort-row={a.id}
        draggable
        onDragStart={(e) => {
          e.dataTransfer?.setData(ACCOUNT_DRAG, a.id);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
          dragRef.current = a.id;
          setDragId(a.id);
        }}
        onDragEnd={clearDrag}
        onDragOver={(e) => {
          const dragged = liveDrag();
          if (!dragged || dropPlacement(accounts, dragged, a.id) === null) {
            hover(null);
            return;
          }
          accept(e);
          hover({ kind: "row", id: a.id });
        }}
        onDrop={(e) => dropOnRow(e, a.id)}
        className={`flex min-h-11 items-center gap-2.5 border-b border-hair py-2 ${
          dragId === a.id ? "opacity-35" : ""
        } ${over?.kind === "row" && over.id === a.id ? dropRow : ""}`}
      >
        <span aria-hidden="true" className="flex w-5 cursor-grab justify-center text-muted">
          <Icon name="grip" size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px]">{name}</span>
          {a.issuer ? <span className="block truncate text-xs text-muted">{a.label}</span> : null}
        </span>
        <button
          type="button"
          data-sort-up={a.id}
          aria-label={t("sort.up", { name })}
          disabled={index === 0}
          className={arrowButton}
          onClick={() => swap(-1, "up")}
        >
          {"↑"}
        </button>
        <button
          type="button"
          data-sort-down={a.id}
          aria-label={t("sort.down", { name })}
          disabled={index === peers.length - 1}
          className={arrowButton}
          onClick={() => swap(1, "down")}
        >
          {"↓"}
        </button>
      </li>
    );
  }

  return (
    <>
      <div className="px-7 pt-2">
        <div className="flex items-center gap-2.5 border-b border-hair py-2.5 text-xs text-muted">
          <span>{t("sort.hint")}</span>
          <button
            type="button"
            onClick={onDone}
            className="ml-auto min-h-11 shrink-0 cursor-pointer rounded-full border-0 bg-btn px-4 text-xs font-medium text-btn-text"
          >
            {t("sort.done")}
          </button>
        </div>
      </div>
      <div
        ref={rootRef}
        className="min-h-0 flex-1 overflow-auto px-7 pb-[72px]"
        onDragEnd={clearDrag}
        onDrop={clearDrag}
        onDragOver={(e) => {
          // Row and header handlers run first; anything else here is not a drop target.
          if (!(e.target as Element).closest("[data-sort-row],[data-sort-group]")) hover(null);
        }}
      >
        {siteRows.length > 0 ? (
          <section aria-label={t("codes.thisSite")}>
            <h2 className="m-0 pt-5 pb-1 text-[11px] font-normal text-muted">
              {t("codes.thisSite")}
            </h2>
            <ul className="m-0 list-none p-0">{siteRows.map((a) => fixedRow(a, false))}</ul>
          </section>
        ) : null}
        {sections.map((s) => {
          const key = s.group?.id ?? NO_GROUP_KEY;
          const title = s.group?.name ?? t("group.none");
          return (
            <section key={key} aria-label={headed ? title : undefined}>
              {headed ? (
                <h2
                  data-sort-group={key}
                  onDragOver={(e) => {
                    if (!liveDrag()) {
                      hover(null);
                      return;
                    }
                    accept(e);
                    hover({ kind: "group", key });
                  }}
                  onDrop={(e) => dropOnGroup(e, s.group?.id ?? null)}
                  className={`m-0 flex min-h-11 items-end gap-2 pb-1 text-[11px] font-normal text-muted ${
                    over?.kind === "group" && over.key === key ? dropHeader : ""
                  }`}
                >
                  <span className="flex-1">{title}</span>
                  <span className="font-mono">{s.fixed.length + s.movable.length}</span>
                </h2>
              ) : null}
              <ul className="m-0 list-none p-0">
                {s.fixed.map((a) => fixedRow(a, true))}
                {s.movable.map((a, i) => movableRow(a, i, s.movable))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
