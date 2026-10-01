import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// Tests run the real VaultService and WebCrypto; under parallel workers the first list can
// exceed the default 1 s findBy* timeout.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
});
