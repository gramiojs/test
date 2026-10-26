import type {
	APIMethodParams,
	APIMethodReturn,
	APIMethods,
	TelegramChat,
	TelegramInlineQueryResult,
	TelegramMessage,
	TelegramUpdate,
	TelegramUser,
} from "@gramio/types";
import { type AnyBot, TelegramError } from "gramio";
import { interceptApi } from "./api.ts";
import { FileRegistry, resolveUploads } from "./files.ts";
import { isSendMethod, MockApi } from "./mock-api.ts";
import { CallbackQueryObject } from "./objects/callback-query.ts";
import { ChatObject } from "./objects/chat.ts";
import { ChosenInlineResultObject } from "./objects/chosen-inline-result.ts";
import { InlineQueryObject } from "./objects/inline-query.ts";
import { MessageObject } from "./objects/message.ts";
import { PreCheckoutQueryObject } from "./objects/pre-checkout-query.ts";
import { ReactObject } from "./objects/react.ts";
import { ShippingQueryObject } from "./objects/shipping-query.ts";
import { UserObject } from "./objects/user.ts";
import { UserInChatScope, UserOnMessageScope } from "./objects/user-scopes.ts";
import { normalizeParams, snapshot } from "./utils.ts";

export {
	CallbackQueryObject,
	ChatObject,
	ChosenInlineResultObject,
	InlineQueryObject,
	MessageObject,
	PreCheckoutQueryObject,
	ReactObject,
	ShippingQueryObject,
	UserInChatScope,
	UserOnMessageScope,
	UserObject,
};
export { apiError } from "./api.ts";
export type {
	MediaOptions,
	MessageOptions,
	StopMessageGenerationOptions,
} from "./objects/user.ts";

/** @deprecated Update identifiers are now allocated per environment. */
export let lastUpdateId = 0;
export interface ApiCall<Method extends keyof APIMethods = keyof APIMethods> {
	method: Method;
	params: APIMethodParams<Method>;
	response: APIMethodReturn<Method> | TelegramError<Method>;
}
function isMessage(value: unknown): value is TelegramMessage {
	return (
		!!value &&
		typeof value === "object" &&
		"message_id" in value &&
		typeof value.message_id === "number" &&
		"chat" in value &&
		!!value.chat &&
		typeof value.chat === "object"
	);
}

export class TelegramTestEnvironment {
	public users: UserObject[] = [];
	public chats: ChatObject[] = [];
	public apiCalls: ApiCall[] = [];
	public updates: TelegramUpdate[] = [];
	/** Handler failures remain observable even when the bot has an onError hook. */
	public errors: { updateId: number; error: unknown }[] = [];
	private inlineMessages = new Map<string, MessageObject>();
	private inlineAnswers = new Map<string, TelegramInlineQueryResult[]>();
	private guestMessages = new Map<string, MessageObject>();
	private files = new FileRegistry();
	private restoreFiles: () => void;
	private messageIds = new Map<number, number>();
	private messages = new Map<string, MessageObject>();
	private botMessages = new Set<MessageObject>();
	private apiHandlers = new Map<keyof APIMethods, (params: never) => unknown>();
	private updateId = 0;
	private sequence = 0;
	private restoreApi: () => void;
	private disposed = false;
	private mockApi = new MockApi(this);
	readonly botUser: TelegramUser;

	constructor(
		private bot: AnyBot,
		private options: { throwOnError?: boolean } = {},
	) {
		this.botUser = snapshot(
			bot.info ?? {
				id: 999_999_999,
				is_bot: true,
				first_name: "Test Bot",
				username: "test_bot",
			},
		);
		bot.info ??= this.botUser;
		this.restoreApi = interceptApi(
			bot,
			async (method, params) => {
				if (this.disposed)
					throw new Error("Test environment has been disposed");
				const normalized = normalizeParams(await resolveUploads(params));
				const recordedParams = snapshot(normalized);
				const handler = this.apiHandlers.get(method);
				let response: unknown;
				try {
					response = handler
						? await handler(normalized as never)
						: this.mockApi.response(method, normalized);
				} catch (error) {
					if (!(error instanceof TelegramError)) throw error;
					response = error;
				}
				if (response instanceof TelegramError)
					response = new TelegramError(
						{
							ok: false,
							error_code: response.code,
							description: response.message,
							parameters: response.payload ?? {},
						},
						method,
						recordedParams as NonNullable<APIMethodParams<typeof method>>,
					);
				this.apiCalls.push({
					method,
					params: recordedParams,
					response:
						response instanceof TelegramError ? response : snapshot(response),
				} as ApiCall);
				if (method === "answerInlineQuery" && response === true)
					this.inlineAnswers.set(
						String(normalized.inline_query_id),
						snapshot(normalized.results as TelegramInlineQueryResult[]),
					);
				if (!(response instanceof TelegramError))
					this.updateBubbleFor(method, normalized, response);
				return response;
			},
			(error, updateId) => {
				this.errors.push({ error, updateId });
			},
		);
		const originalFiles = bot.options.files;
		const testFiles = {
			...originalFiles,
			source: (file: { file_id: string }) => this.files.bytes(file.file_id),
		};
		bot.options.files = testFiles;
		this.restoreFiles = () => {
			if (bot.options.files === testFiles) bot.options.files = originalFiles;
		};
	}

	/** Restore the original bot API; no process-global state is patched. */
	dispose() {
		if (!this.disposed) {
			this.restoreApi();
			this.restoreFiles();
			this.disposed = true;
		}
	}

	/** Supply upload bytes once; sends/getFile/downloads then share the same identity. */
	registerFile(input: string | Blob, metadata: Record<string, unknown> = {}) {
		if (this.disposed) throw new Error("Test environment has been disposed");
		return this.files.register(input, metadata);
	}
	file(fileId: string) {
		return this.files.get(fileId);
	}

	inlineMessage(id: string) {
		const message = this.inlineMessages.get(id);
		return message?.isDeleted ? undefined : message;
	}
	/** Successful answers remain selectable after clearApiCalls(). */
	inlineResult(queryId: string, resultId: string) {
		return snapshot(
			this.inlineAnswers.get(queryId)?.find((result) => result.id === resultId),
		);
	}
	guestMessage(id: string) {
		return this.guestMessages.get(id);
	}
	/** @internal */
	registerGuestMessage(message: MessageObject) {
		if (!message.payload.guest_query_id)
			throw new Error("Missing guest query id");
		this.registerMessage(message);
		this.guestMessages.set(message.payload.guest_query_id, message);
	}
	/** @internal */
	registerInlineMessage(bubble: MessageObject) {
		bubble.inlineMessageId ??= this.nextId("inline");
		this.inlineMessages.set(bubble.inlineMessageId, bubble);
	}
	/** @internal */
	preparedResult(id: string, user: UserObject, chat: ChatObject) {
		this.assertChat(chat);
		return this.mockApi.preparedResult(id, user.payload.id, chat.payload);
	}

	/** @internal Materialize locally without inventing an incoming message update. */
	materializeInline(
		result: TelegramInlineQueryResult,
		user: UserObject,
		chat: ChatObject,
		options: Partial<TelegramMessage> = {},
	) {
		this.assertChat(chat);
		if (
			options.reply_to_message?.chat.id !== undefined &&
			options.reply_to_message.chat.id !== chat.payload.id
		)
			throw new Error("Reply target belongs to another chat");
		if (
			options.message_thread_id !== undefined &&
			(!Number.isSafeInteger(options.message_thread_id) ||
				options.message_thread_id <= 0)
		)
			throw new Error("Invalid message thread id");
		const content = this.mockApi.inlineContent(result);
		const bubble = new MessageObject({
			...content,
			...options,
			message_id: this.nextMessageId(chat.payload.id),
			chat: chat.payload,
			from: user.payload,
			via_bot: this.botUser,
			...(options.message_thread_id !== undefined && chat.payload.is_forum
				? { is_topic_message: true }
				: {}),
		});
		this.registerMessage(bubble, chat);
		if (result.reply_markup) {
			this.registerInlineMessage(bubble);
		}
		return bubble;
	}

	/** Wait for an observable outcome, including timer-driven retries. Never patches global timers. */
	async waitFor(
		predicate: () => unknown | Promise<unknown>,
		options: { timeout?: number; interval?: number } = {},
	) {
		const timeout = options.timeout ?? 1000;
		const interval = options.interval ?? 5;
		if (
			!Number.isFinite(timeout) ||
			timeout < 0 ||
			!Number.isFinite(interval) ||
			interval <= 0
		)
			throw new Error(
				"waitFor requires a non-negative timeout and positive interval",
			);
		let timer: ReturnType<typeof setTimeout> | undefined;
		let pollTimer: ReturnType<typeof setTimeout> | undefined;
		const deadline = new Promise<never>((_, reject) => {
			timer = setTimeout(
				() => reject(new Error(`waitFor timed out after ${timeout}ms`)),
				timeout,
			);
		});
		try {
			while (true) {
				if (this.disposed)
					throw new Error("Test environment has been disposed");
				if (await Promise.race([Promise.resolve().then(predicate), deadline]))
					return;
				await Promise.race([
					new Promise((resolve) => {
						pollTimer = setTimeout(resolve, interval);
					}),
					deadline,
				]);
			}
		} finally {
			clearTimeout(timer);
			clearTimeout(pollTimer);
		}
	}

	/** Deterministic identifiers, also safe when the test clock is frozen. */
	nextId(prefix: string) {
		return `${prefix}_${++this.sequence}`;
	}
	nextMessageId(chatId: number) {
		if (this.disposed) throw new Error("Test environment has been disposed");
		const next = (this.messageIds.get(chatId) ?? 0) + 1;
		this.messageIds.set(chatId, next);
		return next;
	}

	assertChat(chat: ChatObject) {
		if (this.disposed) throw new Error("Test environment has been disposed");
		if (chat.environment && chat.environment !== this)
			throw new Error("Chat belongs to another test environment");
		const existing = this.chats.find(
			(item) => item.payload.id === chat.payload.id,
		);
		if (existing && existing !== chat)
			throw new Error(`Chat id ${chat.payload.id} is already registered`);
		chat.environment = this;
		if (!existing) this.chats.push(chat);
	}

	resolveChat(chat: TelegramChat | number | string): ChatObject {
		const existing = this.chats.find((item) =>
			typeof chat === "object"
				? item.payload.id === chat.id
				: item.payload.id === chat ||
					item.payload.username === String(chat).replace(/^@/, ""),
		);
		if (existing) return existing;
		if (typeof chat === "string")
			throw new Error(
				`Unknown chat ${chat}; create it with env.createChat({ username }) first`,
			);
		return this.createChat(
			typeof chat === "number"
				? { id: chat, type: chat < 0 ? "supergroup" : "private" }
				: chat,
		);
	}

	assertMessage(message: MessageObject) {
		if (message.isDeleted) throw new Error("Message has been deleted");
		if (message._chat) this.assertChat(message._chat);
		if (message.payload.chat)
			this.messageIds.set(
				message.payload.chat.id,
				Math.max(
					this.messageIds.get(message.payload.chat.id) ?? 0,
					message.payload.message_id,
				),
			);
	}

	registerMessage(message: MessageObject, chat?: ChatObject): MessageObject {
		const target =
			chat ??
			message._chat ??
			(message.payload.chat
				? this.resolveChat(message.payload.chat)
				: undefined);
		if (!target)
			throw new Error("Message has no chat. Use .chat(chat) or .from(user)");
		this.assertChat(target);
		message._chat = target;
		message.payload.chat = target.payload;
		this.messageIds.set(
			target.payload.id,
			Math.max(
				this.messageIds.get(target.payload.id) ?? 0,
				message.payload.message_id,
			),
		);
		const key = `${target.payload.id}:${message.payload.message_id}`;
		const existing = this.messages.get(key);
		if (existing && existing !== message)
			throw new Error(`Message ${key} already exists`);
		this.messages.set(key, message);
		for (const kind of [
			"photo",
			"video",
			"audio",
			"document",
			"voice",
			"animation",
			"video_note",
			"sticker",
		] as const) {
			const attachment = message.payload[kind];
			for (const file of Array.isArray(attachment)
				? attachment
				: attachment
					? [attachment]
					: [])
				this.files.register(file.file_id, { ...file });
		}
		if (!target.messages.includes(message)) target.messages.push(message);
		return message;
	}

	message(chatId: number, messageId: number) {
		const message = this.messages.get(`${chatId}:${messageId}`);
		return message?.isDeleted ? undefined : message;
	}

	onApi<Method extends keyof APIMethods>(
		method: Method,
		handler:
			| APIMethodReturn<Method>
			| TelegramError<Method>
			| ((
					params: APIMethodParams<Method>,
			  ) =>
					| APIMethodReturn<Method>
					| TelegramError<Method>
					| Promise<APIMethodReturn<Method> | TelegramError<Method>>),
	) {
		this.apiHandlers.set(
			method,
			typeof handler === "function"
				? (handler as (params: never) => unknown)
				: () => handler,
		);
	}
	offApi(method?: keyof APIMethods) {
		if (method) this.apiHandlers.delete(method);
		else this.apiHandlers.clear();
	}
	/** Clear observations, not the simulated conversation. */
	clearApiCalls() {
		this.apiCalls = [];
	}
	lastApiCall<Method extends keyof APIMethods>(
		method: Method,
	): ApiCall<Method> | undefined {
		return this.apiCalls.findLast((call) => call.method === method) as
			| ApiCall<Method>
			| undefined;
	}
	filterApiCalls<Method extends keyof APIMethods>(
		method: Method,
	): ApiCall<Method>[] {
		return this.apiCalls.filter(
			(call): call is ApiCall<Method> => call.method === method,
		);
	}
	lastBotMessage(opts?: {
		chat?: ChatObject | number;
		withReplyMarkup?: boolean;
		where?: (call: ApiCall<"sendMessage">) => boolean;
	}): MessageObject | undefined {
		const chatId =
			opts?.chat instanceof ChatObject ? opts.chat.payload.id : opts?.chat;
		for (const call of [...this.apiCalls].reverse()) {
			if (!isSendMethod(call.method)) continue;
			const responses = Array.isArray(call.response)
				? [...call.response].reverse()
				: [call.response];
			for (const response of responses) {
				if (
					!response ||
					typeof response !== "object" ||
					!("message_id" in response) ||
					typeof response.message_id !== "number"
				)
					continue;
				const destination = isMessage(response)
					? response.chat
					: this.resolveChat(
							(call.params as { chat_id: number | string }).chat_id,
						).payload;
				const bubble = this.botMessage(destination.id, response.message_id);
				if (
					!bubble ||
					(chatId !== undefined && bubble.payload.chat?.id !== chatId)
				)
					continue;
				if (opts?.withReplyMarkup && !bubble.payload.reply_markup) continue;
				if (
					opts?.where &&
					(call.method !== "sendMessage" ||
						!opts.where(call as ApiCall<"sendMessage">))
				)
					continue;
				return bubble;
			}
		}
		return undefined;
	}
	botMessage(chatId: number | string, messageId: number) {
		const message = this.messages.get(`${chatId}:${messageId}`);
		return message && this.botMessages.has(message) && !message.isDeleted
			? message
			: undefined;
	}
	updateBubbleFor(
		method: keyof APIMethods,
		params: Record<string, unknown>,
		response: unknown,
	) {
		if (response instanceof TelegramError) return;
		if (
			method === "pinChatMessage" ||
			method === "unpinChatMessage" ||
			method === "unpinAllChatMessages"
		) {
			const chat = this.resolveChat(params.chat_id as number | string);
			if (method === "pinChatMessage")
				chat.pinnedMessage = this.message(
					chat.payload.id,
					Number(params.message_id),
				);
			else if (
				params.message_id === undefined ||
				chat.pinnedMessage?.payload.message_id === params.message_id
			)
				chat.pinnedMessage = undefined;
			return;
		}
		if (method === "deleteMessage" || method === "deleteMessages") {
			const ids =
				method === "deleteMessage"
					? [Number(params.message_id)]
					: (params.message_ids as number[]);
			for (const id of ids) {
				const message = this.message(Number(params.chat_id), id);
				if (message) {
					message.isDeleted = true;
					if (message._chat?.pinnedMessage === message)
						message._chat.pinnedMessage = undefined;
					const history = message._chat?.messages;
					if (history?.includes(message))
						history.splice(history.indexOf(message), 1);
				}
			}
			return;
		}
		for (const result of Array.isArray(response) ? response : [response]) {
			if (!isMessage(result)) continue;
			const existing = this.message(result.chat.id, result.message_id);
			if (existing) {
				if (isSendMethod(method))
					throw new Error(
						`Mock ${method} returned duplicate message id ${result.message_id} in chat ${result.chat.id}`,
					);
				for (const key of Object.keys(existing.payload))
					Reflect.deleteProperty(existing.payload, key);
				Object.assign(existing.payload, snapshot(result));
			} else {
				const message = this.registerMessage(
					new MessageObject(snapshot(result)),
				);
				this.botMessages.add(message);
			}
		}
	}

	/** Low-level update injection: records a snapshot but deliberately does not mutate world state. */
	async emitUpdate(update: TelegramUpdate | MessageObject) {
		if (this.disposed) throw new Error("Test environment has been disposed");
		const payload =
			update instanceof MessageObject
				? { update_id: 0, message: update.payload as TelegramMessage }
				: update;
		const wire = snapshot({ ...payload, update_id: this.updateId++ });
		lastUpdateId++;
		this.updates.push(snapshot(wire));
		await this.bot.updates.handleUpdate(wire);
		const failure = this.errors.find(
			(item) => item.updateId === wire.update_id,
		);
		if (failure && this.options.throwOnError !== false) throw failure.error;
	}
	createUser(user: Partial<TelegramUser> | UserObject = {}) {
		const actor = user instanceof UserObject ? user : new UserObject(user);
		if (actor.environment && actor.environment !== this)
			throw new Error("User belongs to another test environment");
		if (
			this.users.some(
				(item) => item !== actor && item.payload.id === actor.payload.id,
			)
		)
			throw new Error(`User id ${actor.payload.id} is already registered`);
		actor.environment = this;
		this.assertChat(actor.asChat);
		if (!this.users.includes(actor)) this.users.push(actor);
		return actor;
	}
	createChat(payload: Partial<TelegramChat> = {}) {
		const chat = new ChatObject(payload);
		this.assertChat(chat);
		return chat;
	}

	/** Explicitly model the automatic forward that starts a channel discussion. */
	async createDiscussion(post: MessageObject, group: ChatObject) {
		this.assertMessage(post);
		this.assertChat(group);
		if (
			post.payload.chat?.type !== "channel" ||
			group.payload.type !== "supergroup"
		)
			throw new Error("A discussion requires a channel post and a supergroup");
		const id = this.nextMessageId(group.payload.id);
		const {
			reply_to_message: _reply,
			message_thread_id: _thread,
			...content
		} = snapshot(post.payload);
		const root = new MessageObject({
			...content,
			chat: group.payload,
			message_id: id,
			message_thread_id: id,
			sender_chat: post.payload.chat,
			is_automatic_forward: true,
			from: { id: 777000, is_bot: false, first_name: "Telegram" },
			forward_origin: {
				type: "channel",
				date: post.payload.date,
				chat: post.payload.chat,
				message_id: post.payload.message_id,
			},
		});
		this.registerMessage(root, group);
		await this.emitUpdate(root);
		return root;
	}
}
