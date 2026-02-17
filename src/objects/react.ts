import type { TelegramChat, TelegramReactionType, TelegramUser } from "@gramio/types";
import type { TelegramReactionTypeEmojiEmoji } from "@gramio/types";
import type { ChatObject } from "./chat.ts";
import type { MessageObject } from "./message.ts";
import type { UserObject } from "./user.ts";

export class ReactObject {
	public payload: {
		chat?: TelegramChat;
		message_id?: number;
		user?: TelegramUser;
		date: number;
		old_reaction: TelegramReactionType[];
		new_reaction: TelegramReactionType[];
	};

	/** @internal Used by `user.react()` to auto-read/write reaction state. */
	_message?: MessageObject;

	constructor() {
		this.payload = {
			date: Math.floor(Date.now() / 1000),
			old_reaction: [],
			new_reaction: [],
		};
	}

	/** Set the user who reacted. Filled automatically when passed to `user.react()`. */
	from(user: UserObject) {
		this.payload.user = user.payload;
		return this;
	}

	/** Set the message being reacted to. Infers chat and enables reaction state tracking. */
	on(message: MessageObject) {
		this._message = message;
		this.payload.message_id = message.payload.message_id;
		if (message.payload.chat) {
			this.payload.chat = message.payload.chat;
		}
		return this;
	}

	/** Override the chat (useful when the message has no chat set). */
	inChat(chat: ChatObject) {
		this.payload.chat = chat.payload;
		return this;
	}

	/** Append emojis to new_reaction (reactions the user is adding). */
	add(...emojis: TelegramReactionTypeEmojiEmoji[]) {
		for (const emoji of emojis) {
			this.payload.new_reaction.push({ type: "emoji", emoji });
		}
		return this;
	}

	/** Append emojis to old_reaction (reactions the user had before). */
	remove(...emojis: TelegramReactionTypeEmojiEmoji[]) {
		for (const emoji of emojis) {
			this.payload.old_reaction.push({ type: "emoji", emoji });
		}
		return this;
	}
}
