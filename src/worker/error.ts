import { config } from "@/shared";
import { DEFAULT_ERROR_PAGE } from "@/shared/errorPage";

/**
 * Renders the HTML for Sherpa's error page.
 *
 * The look of this page is fully themeable at runtime through the `errorPage`
 * field of the {@link SherpaController} config — see {@link SherpaErrorPageConfig}.
 * Any fields a deployment leaves unset fall back to {@link DEFAULT_ERROR_PAGE},
 * so this always renders a complete, styled page even against an older persisted
 * config that predates theming.
 */
export function errorTemplate(trace: string, fetchedURL: string) {
	// Merge the developer's theme over the built-in defaults. `config` may be
	// momentarily unset in the worker (e.g. an error very early in startup), so
	// guard it and always fall back to a fully-populated default theme.
	const theme = { ...DEFAULT_ERROR_PAGE, ...(config?.errorPage ?? {}) };

	// turn script into a data URI so we don"t have to escape any HTML values.
	// Everything the page displays (trace, URL, title, logo, repo link) is
	// injected here via JSON.stringify so quotes/markup can't break the page.
	const script = `
                errorTrace.value = ${JSON.stringify(trace)};
                fetchedURL.textContent = ${JSON.stringify(fetchedURL)};
                errorTitle.textContent = ${JSON.stringify(theme.title)};
                repoLink.href = ${JSON.stringify(theme.repoUrl)};
                for (const node of document.querySelectorAll("#hostname")) node.textContent = ${JSON.stringify(location.hostname)};
                reload.addEventListener("click", () => location.reload());
                version.textContent = ${JSON.stringify((globalThis as any).$sherpaVersion?.version || "unknown")};
                build.textContent = ${JSON.stringify((globalThis as any).$sherpaVersion?.build || "unknown")};
                ${
									theme.logo
										? `logo.src = ${JSON.stringify(theme.logo)}; logo.hidden = false;`
										: ``
								}

                document.getElementById('copy-button').addEventListener('click', async () => {
                    const text = document.getElementById('errorTrace').value;
                    await navigator.clipboard.writeText(text);
                    const btn = document.getElementById('copy-button');
                    btn.textContent = 'Copied!';
                    setTimeout(() => btn.textContent = 'Copy', 2000);
                });
        `;

	return `<!DOCTYPE html>
            <html>
                <head>
                    <meta charset="utf-8" />
                    <title>Sherpa</title>
                    <style>
                    :root {
                        --background: ${theme.background};
                        --surface: ${theme.surface};
                        --text: ${theme.text};
                        --muted: ${theme.muted};
                        --accent: ${theme.accent};
                        --accent-text: ${theme.accentText};
                        --font-sans: ${theme.fontSans};
                        --font-monospace: ${theme.fontMono};
                    }

                    *:not(div,p,span,ul,li,i,img) {
                        background-color: var(--background);
                        color: var(--text);
                        font-family: var(--font-sans);
                    }

                    a {
                        color: color-mix(in srgb, var(--accent) 60%, var(--text));
                    }

                    #logo {
                        max-height: 72px;
                        width: auto;
                        margin-bottom: 0.25em;
                        background: transparent;
                    }

                    textarea,
                    button {
                        background-color: var(--surface);
                        border-radius: 0.6em;
                        padding: 0.6em;
                        border: none;
                        appearance: none;
                        font-family: var(--font-sans);
                        color: var(--text);
                    }

                    button.primary {
                        background-color: var(--accent);
                        color: var(--accent-text);
                        font-weight: bold;
                        cursor: pointer;
                    }

                    textarea {
                        resize: none;
                        height: 20em;
                        text-align: left;
                        font-family: var(--font-monospace);
                    }

                    body {
                        width: 100vw;
                        height: 100vh;
                        justify-content: center;
                        align-items: center;
                    }

                    body,
                    html,
                    #inner {
                        display: flex;
                        align-items: center;
                        flex-direction: column;
                        gap: 0.5em;
                        overflow: hidden;
                    }

                    #inner {
                        z-index: 100;
                    }

                    #cover {
                        position: absolute;
                        width: 100%;
                        height: 100%;
                        background-color: color-mix(in srgb, var(--background) 70%, transparent);
                        z-index: 99;
                    }

                    #info {
                        display: flex;
                        flex-direction: row;
                        align-items: flex-start;
                        gap: 1em;
                    }

                    #version-wrapper {
                        width: auto;
                        text-align: right;
                        position: absolute;
                        top: 0.5rem;
                        right: 0.5rem;
                        font-size: 0.8rem;
                        color: var(--muted)!important;
                        i {
                            background-color: color-mix(in srgb, var(--background), transparent 50%);
                            border-radius: 9999px;
                            padding: 0.2em 0.5em;
                        }
                        z-index: 101;
                    }

                    #errorTrace-wrapper {
                        position: relative;
                        width: fit-content;
                    }

                    #copy-button {
                        position: absolute;
                        top: 0.5em;
                        right: 0.5em;
                        padding: 0.23em;
                        cursor: pointer;
                        opacity: 0;
                        transition: opacity 0.4s;
                        font-size: 0.9em;
                    }

                    #errorTrace-wrapper:hover #copy-button {
                        opacity: 1;
                    }
                    /* Developer-supplied overrides (errorPage.css) — last wins. */
                    ${theme.css}
                    </style>
                </head>
                <body>
                    <div id="cover"></div>
                    <div id="inner">
                        <img id="logo" hidden alt="" />
                        <h1 id="errorTitle">Uh oh!</h1>
                        <p>There was an error loading <b id="fetchedURL"></b></p>
                        <!-- <p id="errorMessage">Internal Server Error</p> -->

                        <div id="info">
                            <div id="errorTrace-wrapper">
                                <textarea id="errorTrace" cols="40" rows="10" readonly></textarea>
                                <button id="copy-button" class="primary">Copy</button>
                            </div>
                            <div id="troubleshooting">
                                <p>Try:</p>
                                <ul>
                                    <li>Checking your internet connection</li>
                                    <li>Verifying you entered the correct address</li>
                                    <li>Clearing the site data</li>
                                    <li>Contacting <b id="hostname"></b>'s administrator</li>
                                    <li>Verify the server isn't censored</li>
                                </ul>
                                <p>If you're the administrator of <b id="hostname"></b>, try:</p>
                                    <ul>
                                    <li>Restarting your server</li>
                                    <li>Updating Sherpa</li>
                                    <li>Troubleshooting the error on the <a id="repoLink" target="_blank" rel="noreferrer">GitHub repository</a></li>
                                </ul>
                            </div>
                        </div>
                        <br>
                        <button id="reload" class="primary">Reload</button>
                    </div>
                    <p id="version-wrapper"><i>Sherpa v<span id="version"></span> (build <span id="build"></span>)</i></p>
                    <script src="${"data:application/javascript," + encodeURIComponent(script)}"></script>
                </body>
            </html>
        `;
}

export function renderError(err: unknown, fetchedURL: string) {
	const headers = {
		"content-type": "text/html",
	};
	if (crossOriginIsolated) {
		headers["Cross-Origin-Embedder-Policy"] = "require-corp";
	}

	return new Response(errorTemplate(String(err), fetchedURL), {
		status: 500,
		headers: headers,
	});
}
