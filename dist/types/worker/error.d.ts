/**
 * Renders the HTML for Sherpa's error page.
 *
 * The look of this page is fully themeable at runtime through the `errorPage`
 * field of the {@link SherpaController} config — see {@link SherpaErrorPageConfig}.
 * Any fields a deployment leaves unset fall back to {@link DEFAULT_ERROR_PAGE},
 * so this always renders a complete, styled page even against an older persisted
 * config that predates theming.
 */
export declare function errorTemplate(trace: string, fetchedURL: string): string;
export declare function renderError(err: unknown, fetchedURL: string): Response;
