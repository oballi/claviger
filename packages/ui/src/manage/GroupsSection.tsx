import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import type { AccountView, GroupView } from "../contract/views";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { TextField } from "../components/TextField";
import { errorMessage } from "../errors";
import { useT } from "../i18n/i18n";
import { useUi } from "../platform";
import { ACCOUNT_DRAG, GROUP_DRAG } from "../dragTypes";
import { dropId, moveId } from "./groupOrder";

type Kind = "rename" | "up" | "down" | "delete" | "title" | "toggle" | "member";

/** Design board "Yönetim — gruplar", right column. */
export function GroupsSection({
  groups,
  accounts,
  onChanged,
  dragAccount,
  onDragAccount,
  onMoveToGroup,
}: {
  groups: readonly GroupView[];
  accounts: readonly AccountView[];
  onChanged: (message: string) => void | Promise<void>;
  dragAccount?: { id: string; source: "table" | "member" } | null;
  onDragAccount?: (d: { id: string; source: "member" } | null) => void;
  onMoveToGroup?: (id: string, groupId: string | null) => Promise<boolean>;
}) {
  const { rpc } = useUi();
  const t = useT();
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  // Holds the drag object it belongs to, so a stale highlight never outlives its drag.
  const [over, setOver] = useState<{ drag: object; target: string } | null>(null);
  const busy = useRef(false);
  const sectionRef = useRef<HTMLElement>(null);
  const focusReq = useRef<{ id: string; kind: Kind } | null>(null);
  const [tick, setTick] = useState(0);
  const ids = groups.map((g) => g.id);
  const count = (id: string) => accounts.filter((a) => a.groupId === id).length;

  const groupOf = (id: string) => accounts.find((a) => a.id === id)?.groupId ?? null;
  // State-only: dataTransfer.getData is unreadable during dragover and never trusted.
  const isGroupDrag = (e: DragEvent<HTMLElement>) =>
    Boolean(e.dataTransfer?.types?.includes?.(GROUP_DRAG));
  const accepts = (target: string | null, e: DragEvent<HTMLElement>) => {
    if (!dragAccount || !onMoveToGroup || isGroupDrag(e)) return false;
    const current = groupOf(dragAccount.id);
    if (target === null) return dragAccount.source === "member" && current !== null;
    return current !== target;
  };
  const highlighted = (target: string) =>
    over !== null && over.drag === dragAccount && over.target === target;
  const dropAccount = async (e: DragEvent<HTMLElement>, target: string | null) => {
    if (!accepts(target, e) || !dragAccount) return false;
    e.preventDefault();
    const { id } = dragAccount;
    setOver(null);
    if (await onMoveToGroup!(id, target)) {
      if (target) setOpen((prev) => new Set(prev).add(target));
    }
    return true;
  };
  const onLeave = (e: DragEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
  };

  const members = (id: string) => accounts.filter((a) => a.groupId === id);
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const requestFocus = (id: string, kind: Kind) => {
    focusReq.current = { id, kind };
    setTick((n) => n + 1);
  };

  // Runs after the render that carries the fresh list; a disabled edge button hands focus to its counterpart.
  useEffect(() => {
    const req = focusReq.current;
    focusReq.current = null;
    if (!req) return;
    const find = (kind: Kind) =>
      sectionRef.current?.querySelector<HTMLElement & { disabled?: boolean }>(
        `[data-focus="${req.id}:${kind}"]`,
      );
    let el = find(req.kind);
    if (el?.disabled) el = find(req.kind === "up" ? "down" : "up");
    el?.focus();
  }, [tick]);

  // Serialised so a double click cannot send two overlapping writes.
  async function run(id: string, action: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    try {
      await action();
    } catch (e) {
      setError({ id, text: errorMessage(t, e) });
    } finally {
      busy.current = false;
    }
  }

  const reorder = (id: string, next: string[] | null, kind: Kind | null) =>
    next
      ? run(id, async () => {
          await rpc("reorderGroups", { ids: next });
          // Held until the list reloads so a second click never builds its order from stale data.
          await onChanged(t("groups.reordered"));
          if (kind) requestFocus(id, kind);
        })
      : Promise.resolve();

  const rename = (g: GroupView) =>
    run(g.id, async () => {
      if (!renaming) return;
      await rpc("renameGroup", { id: g.id, name: renaming.value });
      setRenaming(null);
      requestFocus(g.id, "rename");
      await onChanged(t("groups.renamed", { name: renaming.value.trim() }));
    });

  const leaveGroup = (g: GroupView, a: AccountView) =>
    run(g.id, async () => {
      const list = members(g.id);
      const at = list.findIndex((m) => m.id === a.id);
      const next = list[at + 1] ?? list[at - 1];
      await rpc("setAccountGroup", { id: a.id, groupId: null });
      if (next) requestFocus(next.id, "member");
      else requestFocus(g.id, "toggle");
      await onChanged(t("accounts.leftGroup", { name: a.issuer || a.label }));
    });

  const remove = (g: GroupView) =>
    run(g.id, async () => {
      await rpc("deleteGroup", { id: g.id });
      setConfirming(null);
      // The deleted row's buttons vanish, so focus moves to a neighbour or the heading.
      const at = ids.indexOf(g.id);
      const near = ids[at + 1] ?? ids[at - 1];
      if (near) requestFocus(near, "rename");
      else requestFocus("heading", "title");
      await onChanged(t("groups.deleted", { name: g.name }));
    });

  function onRenameKey(event: KeyboardEvent, g: GroupView) {
    if (event.key === "Enter") {
      event.preventDefault();
      void rename(g);
    } else if (event.key === "Escape") {
      event.stopPropagation();
      requestFocus(g.id, "rename");
      setRenaming(null);
      setError(null);
    }
  }

  return (
    <section ref={sectionRef} aria-label={t("groups.title")} className="flex flex-col gap-4">
      <h2
        tabIndex={-1}
        data-focus="heading:title"
        className="m-0 text-[15px] font-medium outline-none"
      >
        {t("groups.title")}
      </h2>
      <ul className="m-0 flex list-none flex-col p-0">
        {groups.map((g, i) => (
          <li
            key={g.id}
            className={`flex min-h-[52px] flex-col justify-center gap-1 border-b border-hair py-1 ${
              highlighted(g.id) ? "bg-hair shadow-[inset_0_-2px_0_var(--color-line)]" : ""
            }`}
            onDragOver={(e) => {
              if (accepts(g.id, e)) {
                e.preventDefault();
                if (dragAccount) setOver({ drag: dragAccount, target: g.id });
              } else if (dragging && dragging !== g.id) e.preventDefault();
            }}
            onDragLeave={onLeave}
            onDrop={(e) => {
              if (accepts(g.id, e)) {
                void dropAccount(e, g.id);
                return;
              }
              e.preventDefault();
              const dragged = dragging;
              setDragging(null);
              if (dragged) void reorder(g.id, dropId(ids, dragged, g.id), null);
            }}
          >
            <div className="flex items-center gap-1">
              <span
                draggable="true"
                aria-hidden="true"
                data-testid="drag-handle"
                title={t("groups.dragHandle", { name: g.name })}
                onDragStart={(e) => {
                  setDragging(g.id);
                  e.dataTransfer?.setData(GROUP_DRAG, g.id);
                  e.dataTransfer?.setData("text/plain", g.id);
                }}
                onDragEnd={() => setDragging(null)}
                className="flex h-11 w-6 shrink-0 cursor-grab items-center justify-center text-muted"
              >
                <Icon name="grip" size={16} />
              </span>
              {renaming?.id === g.id ? (
                <>
                  <TextField
                    id={`rename-${g.id}`}
                    label={t("groups.nameLabel")}
                    value={renaming.value}
                    onChange={(e) => setRenaming({ id: g.id, value: e.target.value })}
                    onKeyDown={(e) => onRenameKey(e, g)}
                    autoFocus
                    className="min-w-0 flex-1"
                  />
                  <Button variant="link" onClick={() => void rename(g)}>
                    {t("common.save")}
                  </Button>
                  <Button
                    variant="link"
                    onClick={() => {
                      requestFocus(g.id, "rename");
                      setRenaming(null);
                      setError(null);
                    }}
                  >
                    {t("common.cancel")}
                  </Button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    data-focus={`${g.id}:toggle`}
                    aria-expanded={open.has(g.id)}
                    aria-controls={`members-${g.id}`}
                    aria-label={t(
                      count(g.id) === 1 ? "groups.toggleAriaOne" : "groups.toggleAria",
                      {
                        name: g.name,
                        count: count(g.id),
                      },
                    )}
                    onClick={() => toggle(g.id)}
                    className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left font-sans text-sm text-text"
                  >
                    <span className="truncate" title={g.name}>
                      {g.name}
                    </span>
                    <span className="font-mono text-xs text-muted">{count(g.id)}</span>
                  </button>
                  <Button
                    variant="link"
                    className="px-1 text-xs"
                    data-focus={`${g.id}:up`}
                    aria-label={t("groups.up", { name: g.name })}
                    disabled={i === 0}
                    onClick={() => void reorder(g.id, moveId(ids, g.id, -1), "up")}
                  >
                    {"\u2191"}
                  </Button>
                  <Button
                    variant="link"
                    className="px-1 text-xs"
                    data-focus={`${g.id}:down`}
                    aria-label={t("groups.down", { name: g.name })}
                    disabled={i === groups.length - 1}
                    onClick={() => void reorder(g.id, moveId(ids, g.id, 1), "down")}
                  >
                    {"\u2193"}
                  </Button>
                  <Button
                    variant="link"
                    className="text-xs font-normal"
                    data-focus={`${g.id}:rename`}
                    aria-label={t("groups.renameAria", { name: g.name })}
                    onClick={() => {
                      setError(null);
                      setConfirming(null);
                      setRenaming({ id: g.id, value: g.name });
                    }}
                  >
                    {t("groups.rename")}
                  </Button>
                  <Button
                    variant="link"
                    className="text-xs font-normal"
                    data-focus={`${g.id}:delete`}
                    aria-label={t("groups.deleteAria", { name: g.name })}
                    onClick={() => {
                      setError(null);
                      setRenaming(null);
                      setConfirming(g.id);
                    }}
                  >
                    {t("groups.delete")}
                  </Button>
                </>
              )}
            </div>
            {renaming?.id !== g.id && open.has(g.id) ? (
              <ul id={`members-${g.id}`} className="m-0 flex list-none flex-col p-0 pl-8">
                {members(g.id).length === 0 ? (
                  <li className="py-2 text-xs text-muted">{t("groups.emptyDrop")}</li>
                ) : (
                  members(g.id).map((a) => (
                    <li
                      key={a.id}
                      draggable="true"
                      onDragStart={(e) => {
                        e.stopPropagation();
                        e.dataTransfer?.setData(ACCOUNT_DRAG, a.id);
                        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
                        onDragAccount?.({ id: a.id, source: "member" });
                      }}
                      onDragEnd={() => onDragAccount?.(null)}
                      className="flex min-h-11 items-center gap-2 text-sm"
                    >
                      <span
                        className="min-w-0 flex-1 truncate"
                        title={`${a.issuer} ${a.label}`.trim()}
                      >
                        {a.issuer || a.label}
                        {a.issuer && a.label ? (
                          <span className="text-xs text-muted"> {a.label}</span>
                        ) : null}
                      </span>
                      <Button
                        variant="link"
                        className="shrink-0 text-xs font-normal"
                        data-focus={`${a.id}:member`}
                        aria-label={t("groups.removeFromGroupAria", { name: a.issuer || a.label })}
                        onClick={() => void leaveGroup(g, a)}
                      >
                        {t("groups.removeFromGroup")}
                      </Button>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
            {confirming === g.id ? (
              <div className="flex flex-wrap items-center gap-3 pl-8 text-sm">
                <span>
                  {t("groups.deleteConfirm", { name: g.name })}{" "}
                  {t(count(g.id) === 1 ? "groups.deleteCountOne" : "groups.deleteCount", {
                    count: count(g.id),
                  })}
                </span>
                <Button variant="danger" onClick={() => void remove(g)}>
                  {t("groups.delete")}
                </Button>
                <Button
                  onClick={() => {
                    requestFocus(g.id, "delete");
                    setConfirming(null);
                  }}
                >
                  {t("common.cancel")}
                </Button>
              </div>
            ) : null}
            {error?.id === g.id ? (
              <p role="alert" className="m-0 pl-8 text-xs text-warn">
                {error.text}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      {onMoveToGroup ? (
        <div
          data-testid="ungrouped-drop"
          className={`flex min-h-11 items-center justify-center border border-dashed border-line px-3 py-2 text-center text-xs text-muted ${
            highlighted("") ? "bg-hair shadow-[inset_0_2px_0_var(--color-line)]" : ""
          }`}
          onDragOver={(e) => {
            if (!accepts(null, e)) return;
            e.preventDefault();
            if (dragAccount) setOver({ drag: dragAccount, target: "" });
          }}
          onDragLeave={onLeave}
          onDrop={(e) => void dropAccount(e, null)}
        >
          {t("accounts.ungroupedDrop")}
        </div>
      ) : null}
      <p className="m-0 text-xs text-muted">{t("groups.hint")}</p>
    </section>
  );
}
