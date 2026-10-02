import { z } from "zod";

// Extension and desktop CSPs forbid eval; zod's JIT compiler would probe it and log a violation per page.
z.config({ jitless: true });
