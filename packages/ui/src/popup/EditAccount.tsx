import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { AccountView, GroupView } from "../contract/views";
import { Button } from "../components/Button";
import { DomainChips } from "../components/DomainChips";
import { GroupSelect } from "../components/GroupSelect";
import { Icon } from "../components/Icon";
import { TextField } from "../components/TextField";
import { errorMessage } from "../errors";
import { useT } from "../i18n/i18n";
import { useUi } from "../platform";

export function EditAccount({
  account,
  groups,
  onBack,
  onSaved,
}: {
  account: AccountView;
  groups: readonly GroupView[];
  onBack: () => void;
  onSaved: (name: string) => void;
}) {
  const { rpc } = useUi();
  const t = useT();
  const [issuer, setIssuer] = useState(account.issuer);
  const [label, setLabel] = useState(account.label);
  const [domains, setDomains] = useState(account.domains);
  const [groupId, setGroupId] = useState(account.groupId ?? "");
  const [known, setKnown] = useState(groups);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [groupError, setGroupError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const newGroupButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    document.getElementById("edit-issuer")?.focus();
  }, []);

  // The ref blocks a repeat submit before the disabled state has rendered.
  async function guarded(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await action();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    if ((event.target as HTMLElement).id === "edit-new-group") {
      event.stopPropagation();
      closeNewGroup();
      newGroupButton.current?.focus();
      return;
    }
    onBack();
  }

  function closeNewGroup() {
    setCreating(false);
    setNewName("");
    setGroupError(null);
  }

  const createGroup = () => guarded(createGroupNow);
  async function createGroupNow() {
    setGroupError(null);
    try {
      const group = await rpc("createGroup", { name: newName });
      setKnown((list) => [...list, group]);
      setGroupId(group.id);
      setCreating(false);
      setNewName("");
    } catch (e) {
      setGroupError(errorMessage(t, e));
    }
  }

  const save = (event: FormEvent) => {
    event.preventDefault();
    return guarded(saveNow);
  };
  async function saveNow() {
    setError(null);
    try {
      await rpc("updateAccount", {
        id: account.id,
        patch: {
          issuer: issuer.trim(),
          label: label.trim(),
          domains,
          // Untouched group is not resent: it may have been deleted elsewhere meanwhile.
          ...(groupId !== (account.groupId ?? "") && { groupId: groupId || null }),
        },
      });
      onSaved(issuer.trim() || label.trim());
    } catch (e) {
      setError(errorMessage(t, e));
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between pt-2 pr-7 pl-4">
        <button
          type="button"
          aria-label={t("common.back")}
          onClick={onBack}
          className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-text"
        >
          <Icon name="back" size={18} />
        </button>
        <div className="font-mono text-xs tracking-wide">{t("app.name")}</div>
      </header>
      <form
        onSubmit={(e) => void save(e)}
        onKeyDown={onKeyDown}
        className="flex min-h-0 flex-1 flex-col px-7 pb-5"
      >
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto">
          <h1 className="m-0 pt-4 text-2xl font-medium tracking-tight">{t("edit.title")}</h1>
          <TextField
            id="edit-issuer"
            label={t("add.issuer")}
            value={issuer}
            onChange={(e) => setIssuer(e.target.value)}
          />
          <TextField
            id="edit-label"
            label={t("add.label")}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <div className="flex flex-col gap-2">
            <div className="flex items-end gap-2">
              <GroupSelect
                id="edit-group"
                className="flex-1"
                value={groupId}
                groups={known}
                onChange={setGroupId}
              />
              <Button ref={newGroupButton} onClick={() => setCreating(true)} className="shrink-0">
                {t("group.new")}
              </Button>
            </div>
            {creating ? (
              <div className="flex flex-col gap-2">
                <TextField
                  id="edit-new-group"
                  label={t("group.newName")}
                  value={newName}
                  error={groupError}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    void createGroup();
                  }}
                />
                <div className="flex gap-2">
                  <Button variant="primary" disabled={busy} onClick={() => void createGroup()}>
                    {t("common.save")}
                  </Button>
                  <Button onClick={closeNewGroup}>{t("common.cancel")}</Button>
                </div>
              </div>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted">{t("edit.sites")}</span>
            <DomainChips
              domains={domains}
              onRemove={(d) => setDomains((list) => list.filter((x) => x !== d))}
            />
          </div>
          {error ? (
            <p role="alert" className="m-0 text-xs text-warn">
              {error}
            </p>
          ) : null}
        </div>
        <div className="flex gap-2 pt-4">
          <Button type="submit" variant="primary" disabled={busy}>
            {t("common.save")}
          </Button>
          <Button onClick={onBack}>{t("common.cancel")}</Button>
        </div>
      </form>
    </div>
  );
}
