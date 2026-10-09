// Rename-safe app configuration (SPEC §2). Never hard-code these anywhere else.
export const APP_NAME = "Magnus Profectus"; // Latin: "great progress"
export const APP_SHORT_NAME = "Profectus"; // PWA short_name
export const APP_SLUG = "rp-tracker"; // IndexedDB names, storage keys
export const PROTOCOL_NAME = "Rest-Pause Set"; // name of the working-set method, will change

/** Placeholder user id until Supabase auth exists (DECISIONS: local-only mode). */
export const LOCAL_USER_ID = "local";

export const APP_VERSION = "0.1.0";

/** Public donation page (Ko-fi). Empty string hides the donation entry
 * points (page keeps rendering as "coming soon"). Set once, wire everywhere. */
export const DONATION_URL = "";
