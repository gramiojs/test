import type { TelegramChat, TelegramMessage } from "@gramio/types";
import { FormattableString } from "gramio";
import type { TelegramTestEnvironment } from "../index.ts";
import { lastMessageIdPerChat } from "../utils.ts";
import { MessageObject } from "./message.ts";
import type { UserObject } from "./user.ts";

export let lastChatId = 0;

export class ChatObject {
	public type = "chat";

	public payload: TelegramChat;

	public members = new Set<UserObject>();

	public messages: MessageObject[] = [];

	/** @internal Set by TelegramTestEnvironment.createChat */
	environment?: TelegramTestEnvironment;

	constructor(payload: Partial<TelegramChat> = {}) {
		this.payload = {
			id: ++lastChatId,
			type: "private",
			...payload,
		};
	}

	/**
	 * Post a message to this channel (no `from` field — anonymous channel post).
	 * Emits a `channel_post` update. The chat should be of type `"channel"`.
	 */
	async post(text: string | FormattableString): Promise<MessageObject> {
		if (!this.environment) {
			throw new Error(
				"ChatObject is not attached to a TelegramTestEnvironment. Use env.createChat() to create chats.",
			);
		}

		const chatId = this.payload.id;
		const nextMsgId = (lastMessageIdPerChat.get(chatId) ?? 0) + 1;
		lastMessageIdPerChat.set(chatId, nextMsgId);

		let msgText: string;
		let entities: TelegramMessage["entities"];
		if (text instanceof FormattableString) {
			msgText = text.text;
			entities = text.entities.length > 0 ? text.entities : undefined;
		} else {
			msgText = text;
			entities = undefined;
		}

		const message = new MessageObject({
			message_id: nextMsgId,
			date: Math.floor(Date.now() / 1000),
			chat: this.payload,
			text: msgText,
			...(entities ? { entities } : {}),
		});

		message._chat = this;
		this.messages.push(message);

		await this.environment.emitUpdate({
			update_id: 0,
			channel_post: message.payload as TelegramMessage & {
				chat: NonNullable<TelegramMessage["chat"]>;
			},
		});

		return message;
	}
}
