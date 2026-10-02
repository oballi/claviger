import { useRef, useState, type KeyboardEvent } from "react";
import type { AccountView, GroupView } from "../contract/views";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { TextField } from "../components/TextField";
import { errorMessage } from "../errors";
import { useT } from "../i18n/i18n";
import { useUi } from "../platform";
import { dropId, moveId } from "./groupOrder";

/** Design board "Yönetim — gruplar", right column. */
export function GroupsSection({
  groups,
  accounts,
  onChanged,
}: {
  groups: readonly GroupView[];
  accounts: readonly AccountView[];
  onChanged: (message: string) => void;
}) {
  const { rpc } = useUi();
  const t = useT();
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  const busy = useRef(false);
  const ids = groups.map((g) => g.id);
  const count = (id: string) => accounts.filter((a) => a.groupId === id).length;

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

  const reorder = (id: string, next: string[] | null) =>
    next
      ? run(id, async () => {
          await rpc("reorderGroups", { ids: next });
          onChanged(t("groups.reordered"));
        })
      : Promise.resolve();

  const rename = (g: GroupView) =>
    run(g.id, async () => {
      if (!renaming) return;
      await rpc("renameGroup", { id: g.id, name: renaming.value });
      setRenaming(null);
      onChanged(t("groups.renamed", { name: renaming.value.trim() }));
    });

  const remove = (g: GroupView) =>
    run(g.id, async () => {
      await rpc("deleteGroup", { id: g.id });
      setConfirming(null);
      onChanged(t("groups.deleted", { name: g.name }));
    });

  function onRenameKey(event: KeyboardEvent, g: GroupView) {
    if (event.key === "Enter") {
      event.preventDefault();
      void rename(g);
    } else if (event.key === "Escape") {
      event.stopPropagation();
      setRenaming(null);
      setError(null);
    }
  }

  return (
    <section aria-label={t("groups.title")} className="flex flex-col gap-4">
      <h2 className="m-0 text-[15px] font-medium">{t("groups.title")}</h2>
      <ul className="m-0 flex list-none flex-col p-0">
        {groups.map((g, i) => (
          <li
            key={g.id}
            className="flex min-h-[52px] flex-col justify-center gap-1 border-b border-hair py-1"
            onDragOver={(e) => {
              if (dragging && dragging !== g.id) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              const dragged = dragging;
              setDragging(null);
              if (dragged) void reorder(g.id, dropId(ids, dragged, g.id));
            }}
          >
            <div className="flex items-center gap-2">
              <span
                draggable="true"
                aria-hidden="true"
                data-testid="drag-handle"
                title={t("groups.dragHandle", { name: g.name })}
                onDragStart={(e) => {
                  setDragging(g.id);
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
                      setRenaming(null);
                      setError(null);
                    }}
                  >
                    {t("common.cancel")}
                  </Button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-sm">{g.name}</span>
                  <span className="font-mono text-xs text-muted">{count(g.id)}</span>
                  <Button
                    variant="link"
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
                    aria-label={t("groups.deleteAria", { name: g.name })}
                    onClick={() => {
                      setError(null);
                      setRenaming(null);
                      setConfirming(g.id);
                    }}
                  >
                    {t("groups.delete")}
                  </Button>
                  <Button
                    variant="link"
                    aria-label={t("groups.up", { name: g.name })}
                    disabled={i === 0}
                    onClick={() => void reorder(g.id, moveId(ids, g.id, -1))}
                  >
                    {"↑"}
                  </Button>
                  <Button
                    variant="link"
                    aria-label={t("groups.down", { name: g.name })}
                    disabled={i === groups.length - 1}
                    onClick={() => void reorder(g.id, moveId(ids, g.id, 1))}
                  >
                    {"↓"}
                  </Button>
                </>
              )}
            </div>
            {confirming === g.id ? (
              <div className="flex flex-wrap items-center gap-3 pl-8 text-sm">
                <span>
                  {t("groups.deleteConfirm", { name: g.name })}{" "}
                  {t("groups.deleteCount", { count: count(g.id) })}
                </span>
                <Button variant="danger" onClick={() => void remove(g)}>
                  {t("groups.delete")}
                </Button>
                <Button onClick={() => setConfirming(null)}>{t("common.cancel")}</Button>
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
      <p className="m-0 text-xs text-muted">{t("groups.hint")}</p>
    </section>
  );
}
