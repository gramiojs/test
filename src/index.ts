import {
	TelegramError,
	type AnyBot,
	type TelegramChat,
	type TelegramUpdate,
	type TelegramUser,
} from "gramio";
import type {
	APIMethods,
	APIMethodParams,
	APIMethodReturn,
	TelegramAPIResponseError,
	TelegramResponseParameters,
} from "@gramio/types";
import { CallbackQueryObject } from "./objects/callback-query.ts";
import { ChatObject } from "./objects/chat.ts";
import { ChosenInlineResultObject } from "./objects/chosen-inline-result.ts";
import { InlineQueryObject } from "./objects/inline-query.ts";
import { MessageObject } from "./objects/message.ts";
import { PreCheckoutQueryObject } from "./objects/pre-checkout-query.ts";
import { ReactObject } from "./objects/react.ts";
import { ShippingQueryObject } from "./objects/shipping-query.ts";
import { UserInChatScope, UserOnMessageScope } from "./objects/user-scopes.ts";
import { UserObject } from "./objects/user.ts";
import { normalizeParams } from "./utils.ts";

export { CallbackQueryObject, ChatObject, ChosenInlineResultObject, InlineQueryObject, MessageObject, PreCheckoutQueryObject, ReactObject, ShippingQueryObject, UserInChatScope, UserOnMessageScope, UserObject };
export type { MediaOptions, MessageOptions } from "./objects/user.ts";

export let lastUpdateId = 0;

export interface ApiCall<Method extends keyof APIMethods = keyof APIMethods> {
	method: Method;
	params: APIMethodParams<Method>;
	response: APIMethodReturn<Method>;
}

/**
 * Create a TelegramError for use with `env.onApi()`.
 * The proxy re-creates it with the correct method and params at call time.
 */
export function apiError(
	code: number,
	description: string,
	parameters?: TelegramResponseParameters,
): TelegramError<never> {
	return new TelegramError<never>(
		{
			ok: false,
			error_code: code,
			description,
			parameters: parameters ?? {},
		},
		"" as never,
		undefined as never,
	);
}

export class TelegramTestEnvironment {
	private bot: AnyBot;

	public users: UserObject[] = [];

	public chats: ChatObject[] = [];

	public apiCalls: ApiCall[] = [];

	private lastMockMessageId = 0;

	private apiHandlers = new Map<
		keyof APIMethods,
		(params: never) => unknown
	>();

	/** Cached bubble instances keyed by `${chatId}:${messageId}`. */
	private bubbleCache = new Map<string, MessageObject>();

	constructor(bot: AnyBot) {
		this.bot = bot;
		this.interceptApi();
	}

	private interceptApi() {
		const env = this;

		const proxy = new Proxy(
			{},
			{
				get(_target, prop: string | symbol) {
					if (typeof prop === "symbol" || prop === "then" || prop === "toJSON") {
						return undefined;
					}

					const method = prop as keyof APIMethods;

					return (params: Record<string, unknown> = {}) => {
						const handler = env.apiHandlers.get(method);
						const response = handler
							? handler(params as never)
							: env.mockApiResponse(method, params);

						const recordedParams = normalizeParams(params);
						env.apiCalls.push({
							method,
							params: recordedParams,
							response,
						} as ApiCall);
						env.updateBubbleFor(method, recordedParams, response);

						if (response instanceof TelegramError) {
							return Promise.reject(
								new TelegramError(
									{
										ok: false,
										error_code: response.code,
										description: response.message,
										parameters: response.payload ?? {},
									},
									prop as never,
									params as never,
								),
							);
						}

						return Promise.resolve(response);
					};
				},
			},
		);

		Object.defineProperty(this.bot, "api", {
			value: proxy,
			writable: true,
			configurable: true,
		});
	}

	private mockApiResponse(
		method: keyof APIMethods,
		params: Record<string, unknown>,
	): unknown {
		if (method === "sendMessage") {
			return {
				message_id: ++this.lastMockMessageId,
				date: Math.floor(Date.now() / 1000),
				chat: { id: params.chat_id, type: "private" },
				text: params.text,
			};
		}

		return true;
	}

	onApi<Method extends keyof APIMethods>(
		method: Method,
		handler:
			| APIMethodReturn<Method>
			| TelegramError<Method>
			| ((
					params: APIMethodParams<Method>,
			  ) => APIMethodReturn<Method> | TelegramError<Method>),
	) {
		if (typeof handler === "function") {
			this.apiHandlers.set(
				method,
				handler as (params: never) => unknown,
			);
		} else {
			this.apiHandlers.set(method, () => handler);
		}
	}

	offApi(method?: keyof APIMethods) {
		if (method) {
			this.apiHandlers.delete(method);
		} else {
			this.apiHandlers.clear();
		}
	}

	/** Clear all recorded API calls (also drops cached bot-message bubbles). */
	clearApiCalls() {
		this.apiCalls = [];
		this.bubbleCache.clear();
	}

	/** Return the last recorded API call for `method`, or `undefined` if none. */
	lastApiCall<Method extends keyof APIMethods>(
		method: Method,
	): ApiCall<Method> | undefined {
		for (let i = this.apiCalls.length - 1; i >= 0; i--) {
			if (this.apiCalls[i].method === method)
				return this.apiCalls[i] as ApiCall<Method>;
		}
		return undefined;
	}

	/** Return all recorded API calls for `method` with typed params and response. */
	filterApiCalls<Method extends keyof APIMethods>(
		method: Method,
	): ApiCall<Method>[] {
		return this.apiCalls.filter(
			(c): c is ApiCall<Method> => c.method === method,
		);
	}

	/**
	 * Return a `MessageObject` mirror of the most recent bot-originated message
	 * (currently tracks `sendMessage`). Text / caption / reply_markup are kept
	 * in sync with subsequent `editMessageText`, `editMessageCaption`, and
	 * `editMessageReplyMarkup` calls — so `user.on(bubble).clickByText(...)`
	 * always sees the current buttons without a manual refresh, even on a
	 * reference captured before the edit.
	 *
	 * Repeated calls return the same instance for the same `(chat_id, message_id)`.
	 *
	 * Filters (all optional, combined with AND):
	 * - `chat` — only consider sends to this chat
	 * - `withReplyMarkup` — require the send to carry a `reply_markup` (useful
	 *   when the bot emits a status message right after the interactive one)
	 * - `where` — arbitrary predicate on the `sendMessage` call record
	 */
	lastBotMessage(opts?: {
		chat?: ChatObject | number;
		withReplyMarkup?: boolean;
		where?: (call: ApiCall<"sendMessage">) => boolean;
	}): MessageObject | undefined {
		const chatId =
			opts?.chat instanceof ChatObject
				? opts.chat.payload.id
				: typeof opts?.chat === "number"
					? opts.chat
					: undefined;

		for (let i = this.apiCalls.length - 1; i >= 0; i--) {
			const call = this.apiCalls[i];
			if (call.method !== "sendMessage") continue;
			const params = call.params as {
				chat_id?: number | string;
				reply_markup?: unknown;
			};
			const response = call.response as { message_id?: number } | undefined;
			if (chatId !== undefined && params.chat_id !== chatId) continue;
			if (
				typeof response?.message_id !== "number" ||
				params.chat_id === undefined
			)
				continue;
			if (opts?.withReplyMarkup && !params.reply_markup) continue;
			if (opts?.where && !opts.where(call as ApiCall<"sendMessage">)) continue;
			return this.bubbleCache.get(`${params.chat_id}:${response.message_id}`);
		}
		return undefined;
	}

	/**
	 * Return the `MessageObject` bubble for a specific `(chat_id, message_id)`,
	 * or `undefined` if the bot never sent that message.
	 */
	botMessage(
		chatId: number | string,
		messageId: number,
	): MessageObject | undefined {
		return this.bubbleCache.get(`${chatId}:${messageId}`);
	}

	/**
	 * @internal Called from the proxy after each recorded API call. Eagerly
	 * creates / mutates a cached `MessageObject` bubble so references captured
	 * before an edit stay up-to-date.
	 */
	updateBubbleFor(
		method: keyof APIMethods,
		params: Record<string, unknown>,
		response: unknown,
	) {
		if (method === "sendMessage") {
			const chatId = params.chat_id as number | string | undefined;
			const res = response as
				| { message_id?: number; chat?: TelegramChat; date?: number }
				| undefined;
			if (chatId === undefined || typeof res?.message_id !== "number") return;

			const key = `${chatId}:${res.message_id}`;
			let bubble = this.bubbleCache.get(key);
			if (!bubble) {
				bubble = new MessageObject({
					message_id: res.message_id,
					chat:
						res.chat ??
						({ id: chatId as number, type: "private" } as TelegramChat),
					date: res.date ?? Math.floor(Date.now() / 1000),
				});
				this.bubbleCache.set(key, bubble);
			}
			bubble.payload.text = params.text as string | undefined;
			bubble.payload.caption = params.caption as string | undefined;
			bubble.payload.reply_markup = params.reply_markup as never;
			bubble.payload.entities = params.entities as never;
			bubble.payload.caption_entities = params.caption_entities as never;
			return;
		}

		if (
			method === "editMessageText" ||
			method === "editMessageCaption" ||
			method === "editMessageReplyMarkup"
		) {
			const chatId = params.chat_id as number | string | undefined;
			const messageId = params.message_id as number | undefined;
			if (chatId === undefined || typeof messageId !== "number") return;

			const bubble = this.bubbleCache.get(`${chatId}:${messageId}`);
			if (!bubble) return;

			if (method === "editMessageText") {
				bubble.payload.text = params.text as string | undefined;
				if ("reply_markup" in params)
					bubble.payload.reply_markup = params.reply_markup as never;
				if ("entities" in params)
					bubble.payload.entities = params.entities as never;
			} else if (method === "editMessageCaption") {
				bubble.payload.caption = params.caption as string | undefined;
				if ("reply_markup" in params)
					bubble.payload.reply_markup = params.reply_markup as never;
				if ("caption_entities" in params)
					bubble.payload.caption_entities = params.caption_entities as never;
			} else {
				bubble.payload.reply_markup = params.reply_markup as never;
			}
		}
	}

	emitUpdate(update: TelegramUpdate | MessageObject) {
		if (update instanceof MessageObject) {
			return this.bot.updates.handleUpdate({
				update_id: lastUpdateId++,
				//@ts-expect-error
				message: update.payload,
			});
		}

		update.update_id = lastUpdateId++;
		return this.bot.updates.handleUpdate(update);
	}

	createUser(user: Partial<TelegramUser> | UserObject = {}) {
		if (user instanceof UserObject) {
			user.environment = this;
			this.users.push(user);
			return user;
		}

		const newUser = new UserObject(user);
		newUser.environment = this;
		this.users.push(newUser);
		return newUser;
	}

	createChat(payload: Partial<TelegramChat> = {}) {
		const chat = new ChatObject(payload);
		chat.environment = this;
		this.chats.push(chat);
		return chat;
	}
}
