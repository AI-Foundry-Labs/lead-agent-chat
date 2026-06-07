/** Raw user+assistant turns kept in the LLM context for one thread. */
export const SHORT_TERM_WINDOW_TURNS = 5;

/** Cap for cross-thread visitor memory stored on the lead row. */
export const LONG_TERM_MEMORY_MAX_CHARS = 2400;

/** Target size when merging long-term memory (leaves headroom under cap). */
export const LONG_TERM_MEMORY_TARGET_CHARS = 1800;
