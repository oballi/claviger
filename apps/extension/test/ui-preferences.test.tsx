// @vitest-environment jsdom
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PreferencesScreen } from "@claviger/ui/manage";
import { harness, renderUi } from "./helpers/ui";

afterEach(cleanup);

const region = (name: string) => screen.getByRole("region", { name });

describe("PreferencesScreen", () => {
  it("shows the moved rows in three numbered sections without a password field", async () => {
    const h = await harness();
    renderUi(<PreferencesScreen state={await h.service.getState()} onChanged={() => {}} />, h.ui);
    expect(screen.getByRole("heading", { name: "Tercihler." })).toBeTruthy();
    ["Görünüm", "Açılış", "Kısayollar ve kodlar"].forEach((title, i) => {
      expect(within(region(title)).getByText(`0${i + 1}`)).toBeTruthy();
    });
    const look = region("Görünüm");
    expect(within(look).getByRole("radiogroup", { name: "Tema" })).toBeTruthy();
    expect(within(look).getByRole("radiogroup", { name: "Dil" })).toBeTruthy();
    expect(within(look).getByLabelText("Görünüm")).toBeTruthy();
    const opening = region("Açılış");
    expect(within(opening).getByLabelText("Açılış biçimi")).toBeTruthy();
    expect(within(opening).getByLabelText("Pop-up boyutu")).toBeTruthy();
    const more = region("Kısayollar ve kodlar");
    expect(within(more).getByText("Klavye kısayolu: Alt+Shift+O")).toBeTruthy();
    expect(within(more).getByText("Kilitleme kısayolu")).toBeTruthy();
    expect(within(more).getByText("Saat kontrolü")).toBeTruthy();
    expect(screen.queryByLabelText("Ana parola")).toBeNull();
  });
});
