import { config } from "zod";

// Browser entry only: keep identical validators without optional code generation.
config({ jitless: true });
