/** Build identifier: Render sets RENDER_GIT_COMMIT; falls back to the package version. */
export const VERSION = (process.env.RENDER_GIT_COMMIT ?? '').slice(0, 7) || '0.1.0';
