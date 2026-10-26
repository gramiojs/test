import type { TelegramChat, TelegramMessage } from "@gramio/types";
import { FormattableString } from "gramio";
import type { TelegramTestEnvironment } from "../index.ts";
import { MessageObject } from "./message.ts";
import type { UserObject } from "./user.ts";

export let lastChatId = 0;

export class ChatObject {
	public type = "chat";

	public payload: TelegramChat;

	public members = new Set<UserObject>();

	public messages: MessageObject[] = [];
	public pinnedMessage?: MessageObject;

	/** @internal Set by TelegramTestEnvironment.createChat */
	environment?: TelegramTestEnvironment;

	constructor(payload: Partial<TelegramChat> = {}) {
		const sequence = ++lastChatId;
		this.payload = {
			id:
				payload.type && payload.type !== "private"
					? -sequence
					: 1_000_000_000 + sequence,
			type: "private",
			...payload,
		};
	}

	/**
	 * Post a message to this channel (no `from` field — anonymous channel post).
	 * Emits a `channel_post` update. The chat should be of type `"channel"`.
	 */
	async post(text: string | FormattableString): Promise<MessageObject> {
		if (this.payload.type !== "channel")
			throw new Error("post() requires a channel chat");
		if (!this.environment) {
			throw new Error(
				"ChatObject is not attached to a TelegramTestEnvironment. Use env.createChat() to create chats.",
			);
		}

		const chatId = this.payload.id;
		const nextMsgId = this.environment.nextMessageId(chatId);

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
		this.environment.registerMessage(message, this);

		await this.environment.emitUpdate({
			update_id: 0,
			channel_post: message.payload as TelegramMessage & {
				chat: NonNullable<TelegramMessage["chat"]>;
			},
		});

		return message;
	}

	/** Edit a channel post and deliver the correct edited_channel_post update. */
	async editPost(message: MessageObject, text: string | FormattableString) {
		if (!this.environment)
			throw new Error(
				"ChatObject is not attached to a TelegramTestEnvironment",
			);
		this.environment.assertMessage(message);
		if (
			this.payload.type !== "channel" ||
			message.payload.chat?.id !== this.payload.id
		)
			throw new Error("Post belongs to another channel");
		message.text(text);
		message.payload.edit_date = Math.floor(Date.now() / 1000);
		await this.environment.emitUpdate({
			update_id: 0,
			edited_channel_post: message.payload as TelegramMessage,
		});
		return message;
	}
}
