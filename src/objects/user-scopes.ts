import type { TelegramReactionTypeEmojiEmoji } from "@gramio/types";
import type { ChatObject } from "./chat.ts";
import type { MessageObject } from "./message.ts";
import type { ReactObject } from "./react.ts";
import type { UserObject } from "./user.ts";

export class UserOnMessageScope {
	constructor(
		private readonly user: UserObject,
		private readonly message: MessageObject,
	) {}

	/** React to the scoped message. Old reactions are tracked automatically. */
	react(
		reactOrEmojis: ReactObject | TelegramReactionTypeEmojiEmoji | TelegramReactionTypeEmojiEmoji[],
	) {
		return this.user.react(reactOrEmojis as TelegramReactionTypeEmojiEmoji, this.message);
	}

	/** Click an inline button on the scoped message. */
	click(callbackData: string) {
		return this.user.click(callbackData, this.message);
	}
}

export class UserInChatScope {
	constructor(
		private readonly user: UserObject,
		private readonly chat: ChatObject,
	) {}

	/** Send a text message to the scoped chat. */
	sendMessage(text: string) {
		return this.user.sendMessage(this.chat, text);
	}

	/**
	 * Send an inline query attributed to the scoped chat.
	 * Sets `chat_type` automatically from the chat's type.
	 */
	sendInlineQuery(query: string, options?: { offset?: string }) {
		return this.user.sendInlineQuery(query, this.chat, options);
	}

	/** Join the scoped chat. */
	join() {
		return this.user.join(this.chat);
	}

	/** Leave the scoped chat. */
	leave() {
		return this.user.leave(this.chat);
	}

	/** Scope further to a specific message, enabling `.react()` and `.click()`. */
	on(message: MessageObject): UserOnMessageScope {
		return new UserOnMessageScope(this.user, message);
	}
}
