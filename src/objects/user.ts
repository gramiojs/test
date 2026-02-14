import type { TelegramUser } from "@gramio/types";
import type { TelegramTestEnvironment } from "../index.ts";
import { CallbackQueryObject } from "./callback-query.ts";
import { ChatObject } from "./chat.ts";
import { MessageObject, lastMessageIdPerChat } from "./message.ts";

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
}
