export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

let lastFileId = 0;
export function genFile() {
	const id = ++lastFileId;
	return { file_id: `file_${id}`, file_unique_id: `unique_${id}` };
}

/** Tracks the last message ID assigned per chat ID. */
export const lastMessageIdPerChat = new Map<number, number>();

/**
 * If `value` is a Builder-like object with a `.toJSON()` method (e.g. an
 * `InlineKeyboard` / `Keyboard` / `ForceReply` instance from `@gramio/keyboards`),
 * return its JSON projection. Otherwise return the value as-is.
 */
function unwrapToJSON(value: unknown): unknown {
	if (
		value !== null &&
		typeof value === "object" &&
		typeof (value as { toJSON?: unknown }).toJSON === "function"
	) {
		return (value as { toJSON: () => unknown }).toJSON();
	}
	return value;
}

/**
 * Normalize API-call params so what's recorded in `env.apiCalls` mirrors what
 * Telegram actually receives — plain JSON, not Builder instances.
 *
 * Currently targets `reply_markup` (top-level) and `results[].reply_markup`
 * (for `answerInlineQuery`). Intentionally not a deep recursive walk: other
 * fields with a `toJSON` method (Date, URL, Buffer, ...) are not Builder-like
 * and must not be collapsed.
 */
export function normalizeParams(
	params: Record<string, unknown>,
): Record<string, unknown> {
	let out: Record<string, unknown> | undefined;

	if (params.reply_markup !== undefined) {
		const normalized = unwrapToJSON(params.reply_markup);
		if (normalized !== params.reply_markup) {
			out ??= { ...params };
			out.reply_markup = normalized;
		}
	}

	if (Array.isArray(params.results)) {
		let resultsChanged = false;
		const normalizedResults = params.results.map((result) => {
			if (
				result !== null &&
				typeof result === "object" &&
				"reply_markup" in result &&
				(result as { reply_markup?: unknown }).reply_markup !== undefined
			) {
				const rm = (result as { reply_markup?: unknown }).reply_markup;
				const normalizedRm = unwrapToJSON(rm);
				if (normalizedRm !== rm) {
					resultsChanged = true;
					return { ...result, reply_markup: normalizedRm };
				}
			}
			return result;
		});
		if (resultsChanged) {
			out ??= { ...params };
			out.results = normalizedResults;
		}
	}

	return out ?? params;
}
