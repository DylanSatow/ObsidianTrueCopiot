/**
 * Shim for import.meta.url compatibility in CommonJS environment.
 *
 * Provides module URL resolution for 'pglite' dependency which uses
 * ESM-specific import.meta.url while being bundled as CommonJS.
 */

const import_meta_url =
  typeof document === 'undefined'
    ? require('url').pathToFileURL(__filename).href
    : (document.currentScript && document.currentScript.src) ||
      new URL('main.js', document.baseURI).href

export { import_meta_url }
