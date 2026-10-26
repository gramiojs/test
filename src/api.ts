import type { APIMethods, TelegramResponseParameters } from "@gramio/types";
import { type AnyBot, type Hooks, TelegramError } from "gramio";

const attachedBots = new WeakSet<AnyBot>();

/** Construct a Telegram failure; method and params are filled at execution time. */
export function apiError(
	code: number,
	description: string,
	parameters?: TelegramResponseParameters,
): TelegramError<never> {
	return new TelegramError<never>(
		{ ok: false, error_code: code, description, parameters: parameters ?? {} },
		"" as never,
		undefined as never,
	);
}

/** Compatibility boundary for GramIO's instance-local request lifecycle.
 * GramIO 0.14 exposes neither an injectable transport nor public hook runners.
 * Keep the only access to its internal store here; never patch global fetch.
 */
function hookStore(bot: AnyBot): Hooks.Store<Record<string, never>> {
	const value: unknown = Reflect.get(bot, "hooks");
	if (
		!value ||
		typeof value !== "object" ||
		![
			"preRequest",
			"onResponse",
			"onResponseError",
			"onApiCall",
			"onError",
		].every((key) => Array.isArray(Reflect.get(value, key)))
	)
		throw new Error(
			"Unsupported GramIO hook store. @gramio/test requires GramIO >=0.14 with request hooks.",
		);
	return value as Hooks.Store<Record<string, never>>;
}

export function interceptApi(
	bot: AnyBot,
	execute: (
		method: keyof APIMethods,
		params: Record<string, unknown>,
	) => Promise<unknown>,
	onError?: (error: unknown, updateId: number) => void,
) {
	if (attachedBots.has(bot))
		throw new Error(
			"Bot already has a test environment; dispose it before attaching another",
		);
	const hooks = hookStore(bot);
	const errorHook: Hooks.OnError<Record<string, never>> = ({
		error,
		context,
	}) => {
		if (context.updateId !== undefined) onError?.(error, context.updateId);
	};
	const original = Object.getOwnPropertyDescriptor(bot, "api");
	const proxy = new Proxy(
		{},
		{
			get(_target, prop) {
				if (typeof prop !== "string" || prop === "then" || prop === "toJSON")
					return undefined;
				const method = prop as keyof APIMethods;
				return (params: Record<string, unknown> = {}) => {
					// Telegram method/params correlation is established by bot.api's public types.
					const initial = { method, params } as Hooks.PreRequestContext<
						keyof APIMethods
					>;
					let run = async (): Promise<unknown> => {
						let context = initial;
						for (const hook of hooks.preRequest) context = await hook(context);
						const normalized = (context.params ?? {}) as Record<
							string,
							unknown
						>;
						const response = await execute(method, normalized);
						if (response instanceof TelegramError) {
							const error = new TelegramError(
								{
									ok: false,
									error_code: response.code,
									description: response.message,
									parameters: response.payload ?? {},
								},
								method,
								context.params,
							);
							for (const hook of hooks.onResponseError)
								await hook(
									error as Parameters<Hooks.OnResponseError>[0],
									bot.api,
								);
							if (normalized.suppress) return error;
							throw error;
						}
						const result = {
							...context,
							response,
						} as Parameters<Hooks.OnResponse>[0];
						for (const hook of hooks.onResponse) await hook(result);
						return response;
					};
					for (const hook of [...hooks.onApiCall].reverse()) {
						const next = run;
						run = () => hook(initial, next);
					}
					return run();
				};
			},
		},
	);
	Object.defineProperty(bot, "api", {
		value: proxy,
		writable: true,
		configurable: true,
	});
	attachedBots.add(bot);
	if (onError) hooks.onError.unshift(errorHook);
	return () => {
		if (original) Object.defineProperty(bot, "api", original);
		else Reflect.deleteProperty(bot, "api");
		const index = hooks.onError.indexOf(errorHook);
		if (index !== -1) hooks.onError.splice(index, 1);
		attachedBots.delete(bot);
	};
}
