import type { TelegramContact, TelegramLocation, TelegramReactionTypeEmojiEmoji, TelegramSticker } from "@gramio/types";
import type { FormattableString } from "gramio";
import type { ChatObject } from "./chat.ts";
import type { MediaOptions, MessageOptions } from "./user.ts";
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
	sendMessage(text: string | FormattableString, options?: MessageOptions) {
		return this.user.sendMessage(this.chat, text, options);
	}

	/** Send a reply to an existing message in the scoped chat. */
	sendReply(message: MessageObject, text: string | FormattableString) {
		return this.user.sendReply(message, text);
	}

	/** Send a bot command to the scoped chat. */
	sendCommand(command: string, args?: string) {
		return this.user.sendCommand(this.chat, command, args);
	}

	/** Send a photo to the scoped chat. */
	sendPhoto(options?: MediaOptions) {
		return this.user.sendPhoto(this.chat, options);
	}

	/** Send a video to the scoped chat. */
	sendVideo(options?: MediaOptions) {
		return this.user.sendVideo(this.chat, options);
	}

	/** Send a document to the scoped chat. */
	sendDocument(options?: MediaOptions) {
		return this.user.sendDocument(this.chat, options);
	}

	/** Send a voice message to the scoped chat. */
	sendVoice(options?: MediaOptions) {
		return this.user.sendVoice(this.chat, options);
	}

	/** Send a sticker to the scoped chat. */
	sendSticker(options?: Partial<TelegramSticker>) {
		return this.user.sendSticker(this.chat, options);
	}

	/** Send a location to the scoped chat. */
	sendLocation(location: Partial<TelegramLocation>) {
		return this.user.sendLocation(this.chat, location);
	}

	/** Send a contact to the scoped chat. */
	sendContact(contact: Partial<TelegramContact>) {
		return this.user.sendContact(this.chat, contact);
	}

	/** Send a dice to the scoped chat. */
	sendDice(emoji?: string) {
		return this.user.sendDice(this.chat, emoji);
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
