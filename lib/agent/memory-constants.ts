/** Raw user+assistant turns kept in the LLM context for one thread. */
export const SHORT_TERM_WINDOW_TURNS = 7;

/** Cap for cross-thread visitor memory stored on the lead row (~20k tokens). */
export const LONG_TERM_MEMORY_MAX_CHARS = 80000;

/** Target size when merging long-term memory (leaves headroom under cap). */
export const LONG_TERM_MEMORY_TARGET_CHARS = 64000;
