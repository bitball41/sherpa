const store = $store(
	{
		url: "https://google.com",
		wispurl:
			_CONFIG?.wispurl ||
			(location.protocol === "https:" ? "wss" : "ws") +
				"://" +
				location.host +
				"/wisp/",
		bareurl:
			_CONFIG?.bareurl ||
			(location.protocol === "https:" ? "https" : "http") +
				"://" +
				location.host +
				"/bare/",
		proxy: "",
		transport: _CONFIG?.transport || "/epoxy/index.mjs",
	},
	{ ident: "settings", backing: "localstorage", autosave: "auto" }
);
self.store = store;

function sherpaTransportOptions(transport) {
	return transport === "/baremod/index.mjs"
		? [store.bareurl]
		: [{ wisp: store.wispurl }];
}
self.sherpaTransportOptions = sherpaTransportOptions;
