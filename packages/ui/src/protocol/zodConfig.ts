import { z } from "zod";

// The extension CSP forbids eval; zod's JIT compiler would probe it and log a violation per page.
z.config({ jitless: true });
