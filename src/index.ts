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
import { MessageObject } from "./objects/message.ts";
import { UserObject } from "./objects/user.ts";

export { CallbackQueryObject, ChatObject, MessageObject, UserObject };

export let lastUpdateId = 0;

export interface ApiCall {
	method: keyof APIMethods;
	params: unknown;
	response: unknown;
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

						env.apiCalls.push({ method, params, response });

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
		this.chats.push(chat);
		return chat;
	}
}
