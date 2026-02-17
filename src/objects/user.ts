import type { TelegramInlineQueryChatType, TelegramReactionTypeEmojiEmoji, TelegramUser } from "@gramio/types";
import type { TelegramTestEnvironment } from "../index.ts";
import { CallbackQueryObject } from "./callback-query.ts";
import { ChatObject } from "./chat.ts";
import { ChosenInlineResultObject } from "./chosen-inline-result.ts";
import { InlineQueryObject } from "./inline-query.ts";
import { MessageObject, lastMessageIdPerChat } from "./message.ts";
import { ReactObject } from "./react.ts";
import { UserInChatScope, UserOnMessageScope } from "./user-scopes.ts";

export let lastUserId = 0;

export class UserObject {
	payload: TelegramUser;

	asChat: ChatObject;

	/** @internal Set by TelegramTestEnvironment.createUser */
	environment?: TelegramTestEnvironment;

	constructor(payload: Partial<TelegramUser> = {}) {
		const id = ++lastUserId;
		this.payload = {
			id,
			first_name: `User ${id}`,
			is_bot: false,
			...payload,
		};

		this.asChat = new ChatObject({
			id: this.payload.id,
			type: "private",
		});
	}

	async sendMessage(
		chatOrText: ChatObject | string,
		text?: string,
	): Promise<MessageObject> {
		if (!this.environment) {
			throw new Error(
				"UserObject is not attached to a TelegramTestEnvironment. Use env.createUser() to create users.",
			);
		}

		let chat: ChatObject;
		let messageText: string;

		if (typeof chatOrText === "string") {
			chat = this.asChat;
			messageText = chatOrText;
		} else {
			chat = chatOrText;
			messageText = text!;
		}

		const chatId = chat.payload.id;
		const nextMsgId = (lastMessageIdPerChat.get(chatId) ?? 0) + 1;
		lastMessageIdPerChat.set(chatId, nextMsgId);

		const message = new MessageObject({
			message_id: nextMsgId,
			text: messageText,
			date: Math.floor(Date.now() / 1000),
			chat: chat.payload,
			from: this.payload,
		});

		chat.messages.push(message);

		await this.environment.emitUpdate({
			update_id: 0,
			message: message.payload as MessageObject["payload"] & {
				chat: NonNullable<MessageObject["payload"]["chat"]>;
			},
		});

		return message;
	}

	async join(chat: ChatObject): Promise<void> {
		if (!this.environment) {
			throw new Error(
				"UserObject is not attached to a TelegramTestEnvironment. Use env.createUser() to create users.",
			);
		}

		chat.members.add(this);

		await this.environment.emitUpdate({
			update_id: 0,
			chat_member: {
				chat: chat.payload,
				from: this.payload,
				date: Math.floor(Date.now() / 1000),
				old_chat_member: {
					status: "left",
					user: this.payload,
				},
				new_chat_member: {
					status: "member",
					user: this.payload,
				},
			},
		});

		const chatId = chat.payload.id;
		const nextMsgId = (lastMessageIdPerChat.get(chatId) ?? 0) + 1;
		lastMessageIdPerChat.set(chatId, nextMsgId);

		const serviceMessage = new MessageObject({
			message_id: nextMsgId,
			date: Math.floor(Date.now() / 1000),
			chat: chat.payload,
			from: this.payload,
			new_chat_members: [this.payload],
		});

		chat.messages.push(serviceMessage);

		await this.environment.emitUpdate({
			update_id: 0,
			message: serviceMessage.payload as MessageObject["payload"] & {
				chat: NonNullable<MessageObject["payload"]["chat"]>;
			},
		});
	}

	async leave(chat: ChatObject): Promise<void> {
		if (!this.environment) {
			throw new Error(
				"UserObject is not attached to a TelegramTestEnvironment. Use env.createUser() to create users.",
			);
		}

		chat.members.delete(this);

		await this.environment.emitUpdate({
			update_id: 0,
			chat_member: {
				chat: chat.payload,
				from: this.payload,
				date: Math.floor(Date.now() / 1000),
				old_chat_member: {
					status: "member",
					user: this.payload,
				},
				new_chat_member: {
					status: "left",
					user: this.payload,
				},
			},
		});

		const chatId = chat.payload.id;
		const nextMsgId = (lastMessageIdPerChat.get(chatId) ?? 0) + 1;
		lastMessageIdPerChat.set(chatId, nextMsgId);

		const serviceMessage = new MessageObject({
			message_id: nextMsgId,
			date: Math.floor(Date.now() / 1000),
			chat: chat.payload,
			from: this.payload,
			left_chat_member: this.payload,
		});

		chat.messages.push(serviceMessage);

		await this.environment.emitUpdate({
			update_id: 0,
			message: serviceMessage.payload as MessageObject["payload"] & {
				chat: NonNullable<MessageObject["payload"]["chat"]>;
			},
		});
	}

	async click(
		callbackData: string,
		message?: MessageObject,
	): Promise<CallbackQueryObject> {
		if (!this.environment) {
			throw new Error(
				"UserObject is not attached to a TelegramTestEnvironment. Use env.createUser() to create users.",
			);
		}

		const cbQuery = new CallbackQueryObject({
			from: this.payload,
			data: callbackData,
			chat_instance: String(Date.now()),
		});

		if (message) {
			cbQuery.message(message);
		}

		await this.environment.emitUpdate({
			update_id: 0,
			callback_query: cbQuery.payload,
		});

		return cbQuery;
	}

	async react(
		reactOrEmojis:
			| ReactObject
			| TelegramReactionTypeEmojiEmoji
			| TelegramReactionTypeEmojiEmoji[],
		message?: MessageObject,
	): Promise<void> {
		if (!this.environment) {
			throw new Error(
				"UserObject is not attached to a TelegramTestEnvironment. Use env.createUser() to create users.",
			);
		}

		let reactionPayload: ReactObject["payload"];
		let trackedMessage: MessageObject | undefined;

		if (reactOrEmojis instanceof ReactObject) {
			reactionPayload = reactOrEmojis.payload;
			trackedMessage = reactOrEmojis._message ?? message;

			if (!reactionPayload.user) reactionPayload.user = this.payload;
			if (!reactionPayload.chat && trackedMessage) {
				reactionPayload.chat = trackedMessage.payload.chat ?? this.asChat.payload;
				reactionPayload.message_id ??= trackedMessage.payload.message_id;
			}
			// auto-populate old_reaction from memory when .remove() was never called
			if (reactionPayload.old_reaction.length === 0 && trackedMessage) {
				const prev = trackedMessage.reactions.get(this.payload.id) ?? [];
				reactionPayload.old_reaction = prev.map((emoji) => ({ type: "emoji" as const, emoji }));
			}
		} else {
			trackedMessage = message;
			const newEmojis = Array.isArray(reactOrEmojis) ? reactOrEmojis : [reactOrEmojis];
			const prevEmojis = message?.reactions.get(this.payload.id) ?? [];
			reactionPayload = {
				chat: message?.payload.chat ?? this.asChat.payload,
				message_id: message?.payload.message_id ?? 0,
				user: this.payload,
				date: Math.floor(Date.now() / 1000),
				old_reaction: prevEmojis.map((emoji) => ({ type: "emoji" as const, emoji })),
				new_reaction: newEmojis.map((emoji) => ({ type: "emoji" as const, emoji })),
			};
		}

		await this.environment.emitUpdate({
			update_id: 0,
			message_reaction: reactionPayload as Required<ReactObject["payload"]>,
		});

		// persist new reaction state on the message
		if (trackedMessage) {
			const newEmojis = reactionPayload.new_reaction
				.filter((r): r is { type: "emoji"; emoji: TelegramReactionTypeEmojiEmoji } => r.type === "emoji")
				.map((r) => r.emoji);
			if (newEmojis.length === 0) {
				trackedMessage.reactions.delete(this.payload.id);
			} else {
				trackedMessage.reactions.set(this.payload.id, newEmojis);
			}
		}
	}

	async sendInlineQuery(
		query: string,
		chatOrOptions?: ChatObject | { offset?: string; chat_type?: TelegramInlineQueryChatType },
		options?: { offset?: string },
	): Promise<InlineQueryObject> {
		if (!this.environment) {
			throw new Error(
				"UserObject is not attached to a TelegramTestEnvironment. Use env.createUser() to create users.",
			);
		}

		let chat_type: TelegramInlineQueryChatType | undefined;
		let offset = "";

		if (chatOrOptions instanceof ChatObject) {
			chat_type = chatOrOptions.payload.type as TelegramInlineQueryChatType;
			offset = options?.offset ?? "";
		} else {
			chat_type = chatOrOptions?.chat_type;
			offset = chatOrOptions?.offset ?? "";
		}

		const inlineQuery = new InlineQueryObject({
			from: this.payload,
			query,
			offset,
			chat_type,
		});

		await this.environment.emitUpdate({
			update_id: 0,
			inline_query: inlineQuery.payload,
		});

		return inlineQuery;
	}

	/** Scope this user to a chat, enabling fluent actions: `.sendMessage()`, `.sendInlineQuery()`, `.join()`, `.leave()`, `.on(msg)`. */
	in(chat: ChatObject): UserInChatScope {
		return new UserInChatScope(this, chat);
	}

	/** Scope this user to a message, enabling fluent actions: `.react()`, `.click()`. */
	on(message: MessageObject): UserOnMessageScope {
		return new UserOnMessageScope(this, message);
	}

	async chooseInlineResult(
		resultId: string,
		query: string,
		options?: { inline_message_id?: string },
	): Promise<ChosenInlineResultObject> {
		if (!this.environment) {
			throw new Error(
				"UserObject is not attached to a TelegramTestEnvironment. Use env.createUser() to create users.",
			);
		}

		const result = new ChosenInlineResultObject({
			from: this.payload,
			result_id: resultId,
			query,
			inline_message_id: options?.inline_message_id,
		});

		await this.environment.emitUpdate({
			update_id: 0,
			chosen_inline_result: result.payload,
		});

		return result;
	}
}
