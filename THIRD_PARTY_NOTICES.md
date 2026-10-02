# Third-party notices

otp-vault ships the following third-party components in its built extension. Their licenses are reproduced or linked below; full license texts are also included in each package under `node_modules/<package>/`.

| Component                                                                                                          | Used for                            | License                   |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------- | ------------------------- |
| [hash-wasm](https://github.com/Daninet/hash-wasm)                                                                  | Argon2id and scrypt key derivation  | MIT                       |
| [zod](https://github.com/colinhacks/zod)                                                                           | Validating stored and imported data | MIT                       |
| [tldts](https://github.com/remusao/tldts)                                                                          | Matching accounts to sites          | MIT                       |
| [Public Suffix List](https://publicsuffix.org/) (bundled in tldts)                                                 | Determining registrable domains     | MPL-2.0                   |
| [React](https://github.com/facebook/react) and react-dom, scheduler                                                | User interface                      | MIT                       |
| [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)                                              | Showing an account as a QR code     | MIT                       |
| [zxing-wasm](https://github.com/Sec-ant/zxing-wasm) (based on [zxing-cpp](https://github.com/zxing-cpp/zxing-cpp)) | Reading QR codes from images        | Apache-2.0                |
| [Geist and Geist Mono](https://github.com/vercel/geist-font) (via Fontsource)                                      | Bundled fonts                       | SIL Open Font License 1.1 |

Build and test tools (WXT, Vite, Tailwind CSS, TypeScript, Vitest, ESLint, Prettier and others) are not shipped in the extension.

## Notes

- **Public Suffix List** data is licensed under the Mozilla Public License 2.0 (<https://mozilla.org/MPL/2.0/>). It is used unmodified.
- **Geist fonts** are licensed under the SIL Open Font License 1.1 (<https://openfontlicense.org/>). The fonts are bundled unmodified and are not sold on their own.

This list is updated whenever a shipped dependency is added or removed.
