import type {
	AnyBot,
	TelegramChat,
	TelegramUpdate,
	TelegramUser,
} from "gramio";
import { CallbackQueryObject } from "./objects/callback-query.ts";
import { ChatObject } from "./objects/chat.ts";
import { MessageObject } from "./objects/message.ts";
import { UserObject } from "./objects/user.ts";

export { CallbackQueryObject, ChatObject, MessageObject, UserObject };

export let lastUpdateId = 0;

export interface ApiCall {
	method: string;
	params: Record<string, unknown>;
	response: unknown;
}

export class TelegramTestEnvironment {
	private bot: AnyBot;

	public users: UserObject[] = [];

	public chats: ChatObject[] = [];

	public apiCalls: ApiCall[] = [];

	private lastMockMessageId = 0;

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

					return (params: Record<string, unknown> = {}) => {
						const response = env.mockApiResponse(prop, params);
						env.apiCalls.push({ method: prop, params, response });
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
		method: string,
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
