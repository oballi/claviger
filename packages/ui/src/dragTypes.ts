// Custom MIME types: Firefox needs setData to start a drag, and text/plain would leak ids into text fields.
export const ACCOUNT_DRAG = "application/x-otp-vault-account";
export const GROUP_DRAG = "application/x-otp-vault-group";
