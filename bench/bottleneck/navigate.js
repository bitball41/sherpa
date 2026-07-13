// Shared iframe-navigation + timing-extraction harness code. Inlined into
// both the direct-load harness (served by the fixture origin) and the
// proxied harness (served by the sherpa host), so both measure identically:
// same iframe navigation, same load-event timing, same in-document
// Performance API extraction.
function pickEntry(e) {
	return {
		name: e.name,
		entryType: e.entryType,
		initiatorType: e.initiatorType,
		startTime: e.startTime,
		duration: e.duration,
		fetchStart: e.fetchStart,
		workerStart: e.workerStart,
		requestStart: e.requestStart,
		responseStart: e.responseStart,
		responseEnd: e.responseEnd,
		domContentLoadedEventStart: e.domContentLoadedEventStart,
		loadEventStart: e.loadEventStart,
		transferSize: e.transferSize,
		encodedBodySize: e.encodedBodySize,
		decodedBodySize: e.decodedBodySize,
	};
}

function makeNavigator(go, ensureFrame) {
	let defaultFrame = null;
	const ensure =
		ensureFrame ||
		(() => {
			if (!defaultFrame) {
				defaultFrame = document.createElement("iframe");
				defaultFrame.style.width = "1000px";
				defaultFrame.style.height = "800px";
				document.body.appendChild(defaultFrame);
			}

			return defaultFrame;
		});

	window.benchBlank = () => {
		const f = ensure();

		return new Promise((r) => {
			const on = () => {
				f.removeEventListener("load", on);
				r();
			};
			f.addEventListener("load", on);
			f.src = "about:blank";
		});
	};

	return (url) => {
		const f = ensure();

		return new Promise((resolveNav, rejectNav) => {
			const onLoad = () => {
				let href = "";
				try {
					href = f.contentWindow.location.href;
				} catch {}
				if (href === "" || href === "about:blank") return;
				const total = performance.now() - t0;
				clearTimeout(timeout);
				f.removeEventListener("load", onLoad);
				// let late perf entries land, then extract from inside the document
				setTimeout(() => {
					let nav = null;
					let resources = [];
					try {
						const w = f.contentWindow;
						const n = w.performance.getEntriesByType("navigation")[0];
						nav = n ? pickEntry(n) : null;
						resources = w.performance
							.getEntriesByType("resource")
							.map(pickEntry);
					} catch {}
					resolveNav({ total, nav, resources });
				}, 60);
			};
			const timeout = setTimeout(() => {
				f.removeEventListener("load", onLoad);
				rejectNav(new Error("navigation timed out: " + url));
			}, 30000);
			f.addEventListener("load", onLoad);
			const t0 = performance.now();
			go(f, url);
		});
	};
}
