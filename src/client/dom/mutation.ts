import type { SherpaClient } from "@client/index";
import { unrewriteUrl } from "@rewriters/url";
import {
	SHADOW_ATTRIBUTE_PREFIX,
	shadowedAttributeNames,
} from "@/shared/shadowAttributes";

/**
 * `MutationObserver` is how a page watches its own DOM, and Sherpa's rewriting
 * is a DOM mutation like any other - so an observer with `attributes: true` saw
 * all of it. Every URL-valued `setAttribute` produced *two* records: one for
 * the `sherpa-attr-*` copy that keeps the authored value, and one for the real
 * attribute whose `oldValue` was the previous *proxied* URL.
 *
 * That is not a cosmetic leak. Lazy-loading libraries, framework attribute
 * mirrors and analytics all walk these records; an unknown `sherpa-attr-src`
 * gets copied onto clones, echoed into logs, and counted as a change the page
 * never made, and an `oldValue` on the proxy's origin is simply wrong.
 *
 * The records a page receives are therefore filtered: the shadow ones are
 * Sherpa's bookkeeping and are dropped, and the real one is handed the authored
 * value the dropped record was carrying. The shadow write always immediately
 * precedes the real one (`setAttribute` records before it rewrites), so the two
 * are paired by adjacency rather than by guessing.
 */
export default function (client: SherpaClient, self: Self) {
	if (!self.MutationObserver) return;

	type AttributeRecord = MutationRecord & { attributeName: string };

	const isShadow = (record: MutationRecord): record is AttributeRecord =>
		record.type === "attributes" &&
		record.attributeName !== null &&
		record.attributeName.startsWith(SHADOW_ATTRIBUTE_PREFIX);

	const isShadowed = (record: MutationRecord): record is AttributeRecord =>
		record.type === "attributes" &&
		record.attributeName !== null &&
		shadowedAttributeNames.has(record.attributeName);

	function withOldValue(
		record: MutationRecord,
		oldValue: string | null
	): MutationRecord {
		return new Proxy(record, {
			get(target, prop) {
				if (prop === "oldValue") return oldValue;

				const value = Reflect.get(target, prop, target);
				if (typeof value === "function") return value.bind(target);

				return value;
			},
		});
	}

	function visibleRecords(
		records: readonly MutationRecord[]
	): MutationRecord[] | readonly MutationRecord[] {
		// The overwhelming majority of mutation batches touch no shadowed
		// attribute at all, and this sits in front of every observer callback.
		let interesting = false;
		for (let i = 0; i < records.length; i++) {
			if (isShadow(records[i]) || isShadowed(records[i])) {
				interesting = true;
				break;
			}
		}
		if (!interesting) return records;

		const visible: MutationRecord[] = [];
		let pendingShadow: AttributeRecord | null = null;

		for (let i = 0; i < records.length; i++) {
			const record = records[i];

			if (isShadow(record)) {
				pendingShadow = record;
				continue;
			}

			if (isShadowed(record)) {
				const paired =
					pendingShadow !== null &&
					pendingShadow.target === record.target &&
					pendingShadow.attributeName ===
						SHADOW_ATTRIBUTE_PREFIX + record.attributeName;
				pendingShadow = null;

				visible.push(
					paired
						? withOldValue(record, records[i - 1].oldValue)
						: // No shadow write to pair with (an attribute removed by a
							// path that writes them in the other order). Unrewriting is
							// a no-op on anything that is not a proxied URL, so it is
							// safe on any attribute value.
							withOldValue(
								record,
								record.oldValue === null ? null : unrewriteUrl(record.oldValue)
							)
				);
				continue;
			}

			pendingShadow = null;
			visible.push(record);
		}

		return visible;
	}

	client.Proxy("MutationObserver", {
		construct(ctx) {
			const callback = ctx.args[0];
			if (typeof callback !== "function") return;

			ctx.args[0] = function (
				this: unknown,
				records: MutationRecord[],
				observer: MutationObserver
			) {
				return Reflect.apply(callback, this, [visibleRecords(records), observer]);
			};
		},
	});

	client.Proxy("MutationObserver.prototype.takeRecords", {
		apply(ctx) {
			ctx.return(visibleRecords(ctx.call() as MutationRecord[]));
		},
	});
}
