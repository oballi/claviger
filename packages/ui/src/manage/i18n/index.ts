import { manageEn } from "./en";
import { manageTr } from "./tr";

export type { ManageKey } from "./tr";
export const manageMessages = { tr: manageTr, en: manageEn };
