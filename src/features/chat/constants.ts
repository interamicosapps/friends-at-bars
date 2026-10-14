/** Max message length (enforced in UI + Supabase). */
export const CHAT_MAX_CHARS = 150;

/** Hourly send cap is paused. Not enforced until create_chat_post checks it again. */
export const CHAT_MAX_POSTS_PER_HOUR = 5;

/** Soft-hide threshold (server-enforced via vote trigger). */
export const CHAT_HIDE_SCORE_THRESHOLD = -4;
