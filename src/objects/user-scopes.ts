import type {
	TelegramContact,
	TelegramLocation,
	TelegramReactionTypeEmojiEmoji,
	TelegramSticker,
	TelegramSuccessfulPayment,
} from "@gramio/types";
import type { FormattableString } from "gramio";
import type { ChatObject } from "./chat.ts";
import type { InlineQueryObject } from "./inline-query.ts";
import { MessageObject } from "./message.ts";
import type { ReactObject } from "./react.ts";
import type { MediaOptions, MessageOptions, UserObject } from "./user.ts";

export class UserOnMessageScope {
	constructor(
		private readonly user: UserObject,
		private readonly message: MessageObject,
	) {}

	reply(text: string | FormattableString) {
		return this.user.sendReply(this.message, text);
	}
	edit(text: string | FormattableString) {
		return this.user.editMessage(this.message, text);
	}
	editCaption(text: string | FormattableString) {
		return this.user.editCaption(this.message, text);
	}
	forward(chat?: ChatObject) {
		return this.user.forwardMessage(this.message, chat);
	}
	pin() {
		return this.user.pinMessage(this.message);
	}
	press(text: string) {
		return this.user.press(text, this.message);
	}
	vote(options: number[]) {
		return this.user.vote(this.message, options);
	}

	/** React to the scoped message. Old reactions are tracked automatically. */
	react(
		reactOrEmojis:
			| ReactObject
			| TelegramReactionTypeEmojiEmoji
			| TelegramReactionTypeEmojiEmoji[],
	) {
		return this.user.react(reactOrEmojis, this.message);
	}

	/** Click an inline button on the scoped message by its callback data. */
	click(callbackData: string) {
		return this.user.click(callbackData, this.message);
	}

	/**
	 * Find an inline button by its visible text and click it.
	 * Throws if the message has no inline keyboard or no matching button.
	 *
	 * Tolerates `reply_markup` set to a Builder instance (e.g. `InlineKeyboard`
	 * from `@gramio/keyboards`) by calling its `toJSON()` if present.
	 */
	clickByText(buttonText: string) {
		this.user.environment?.assertMessage(this.message);
		const raw = this.message.payload.reply_markup as
			| { inline_keyboard?: unknown; toJSON?: () => unknown }
			| undefined;
		const markup =
			raw && typeof raw.toJSON === "function"
				? (raw.toJSON() as { inline_keyboard?: unknown })
				: raw;
		if (!markup || !("inline_keyboard" in markup)) {
			throw new Error("Message has no inline keyboard");
		}
		const rows = markup.inline_keyboard as Array<
			Array<{ text?: string; callback_data?: string }>
		>;
		for (const row of rows) {
			for (const btn of row) {
				if (btn.text === buttonText && btn.callback_data !== undefined) {
					return this.user.click(btn.callback_data, this.message);
				}
			}
		}
		throw new Error(`No inline button with text "${buttonText}" found`);
	}
}

export class UserInChatScope {
	constructor(
		private readonly user: UserObject,
		private readonly chat: ChatObject,
		private readonly threadId?: number,
	) {}

	/** Scope messages and media to a forum topic or discussion thread. */
	inTopic(threadId: number) {
		if (!Number.isSafeInteger(threadId) || threadId <= 0)
			throw new Error("Thread id must be a positive integer");
		return new UserInChatScope(this.user, this.chat, threadId);
	}
	private options(options?: MediaOptions): MediaOptions | undefined {
		if (this.threadId === undefined) return options;
		if (
			options?.message_thread_id !== undefined &&
			options.message_thread_id !== this.threadId
		)
			throw new Error("Message thread conflicts with scoped topic");
		return { ...options, message_thread_id: this.threadId };
	}

	/** Send a text message to the scoped chat. */
	sendMessage(text: string | FormattableString, options?: MessageOptions) {
		return this.user.sendMessage(this.chat, text, this.options(options));
	}

	/** Send a reply to an existing message in the scoped chat. */
	sendReply(message: MessageObject, text: string | FormattableString) {
		if (
			message.payload.chat &&
			message.payload.chat.id !== this.chat.payload.id
		)
			throw new Error("Reply target conflicts with scoped chat");
		return this.user.sendMessage(
			this.chat,
			text,
			this.options({ reply_to: message }),
		);
	}

	/** Send a bot command to the scoped chat. */
	sendCommand(command: string, args?: string) {
		if (this.threadId === undefined)
			return this.user.sendCommand(this.chat, command, args);
		const name = command.replace(/^\//, "");
		if (!/^[a-zA-Z0-9_]+(?:@[a-zA-Z0-9_]+)?$/.test(name))
			throw new Error("Invalid bot command");
		return this.sendMessage(`/${name}${args ? ` ${args}` : ""}`);
	}

	/** Send a photo to the scoped chat. */
	sendPhoto(options?: MediaOptions) {
		return this.user.sendPhoto(this.chat, this.options(options));
	}

	/** Send a video to the scoped chat. */
	sendVideo(options?: MediaOptions) {
		return this.user.sendVideo(this.chat, this.options(options));
	}

	/** Send a document to the scoped chat. */
	sendDocument(options?: MediaOptions) {
		return this.user.sendDocument(this.chat, this.options(options));
	}

	/** Send a voice message to the scoped chat. */
	sendVoice(options?: MediaOptions) {
		return this.user.sendVoice(this.chat, this.options(options));
	}

	/** Send an audio file to the scoped chat. */
	sendAudio(options?: MediaOptions) {
		return this.user.sendAudio(this.chat, this.options(options));
	}

	/** Send an animation (GIF) to the scoped chat. */
	sendAnimation(options?: MediaOptions) {
		return this.user.sendAnimation(this.chat, this.options(options));
	}

	/** Send a video note (circle video) to the scoped chat. */
	sendVideoNote(options?: MediaOptions) {
		return this.user.sendVideoNote(this.chat, this.options(options));
	}

	/** Send a sticker to the scoped chat. */
	sendSticker(options?: Partial<TelegramSticker>) {
		if (this.threadId !== undefined)
			return this.user.send(
				new MessageObject({ message_thread_id: this.threadId })
					.chat(this.chat)
					.sticker(options),
			);
		return this.user.sendSticker(this.chat, options);
	}

	/** Send a location to the scoped chat. */
	sendLocation(location: Partial<TelegramLocation>) {
		if (this.threadId !== undefined)
			return this.user.send(
				new MessageObject({ message_thread_id: this.threadId })
					.chat(this.chat)
					.location(location),
			);
		return this.user.sendLocation(this.chat, location);
	}

	/** Send a contact to the scoped chat. */
	sendContact(contact: Partial<TelegramContact>) {
		if (this.threadId !== undefined)
			return this.user.send(
				new MessageObject({ message_thread_id: this.threadId })
					.chat(this.chat)
					.contact(contact),
			);
		return this.user.sendContact(this.chat, contact);
	}

	/** Send a dice to the scoped chat. */
	sendDice(emoji?: string) {
		if (this.threadId !== undefined)
			return this.user.send(
				new MessageObject({ message_thread_id: this.threadId })
					.chat(this.chat)
					.dice(emoji ? { emoji } : undefined),
			);
		return this.user.sendDice(this.chat, emoji);
	}

	/**
	 * Send an inline query attributed to the scoped chat.
	 * Sets `chat_type` automatically from the chat's type.
	 */
	sendInlineQuery(query: string, options?: { offset?: string }) {
		return this.user.sendInlineQuery(query, this.chat, options);
	}

	sendInlineResult(resultId: string, query: InlineQueryObject) {
		return this.user.sendInlineResult(
			resultId,
			query,
			this.chat,
			this.options(),
		);
	}

	sendPreparedInlineMessage(id: string) {
		return this.user.sendPreparedInlineMessage(id, this.chat, this.options());
	}

	sendGuestMessage(input: string | FormattableString | MessageObject) {
		return this.user.sendGuestMessage(input, this.chat, this.options());
	}

	/** Send a successful payment service message to the scoped chat. */
	sendSuccessfulPayment(overrides?: Partial<TelegramSuccessfulPayment>) {
		return this.user.sendSuccessfulPayment(
			this.chat,
			overrides,
			this.options(),
		);
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
		if (message.payload.chat?.id !== this.chat.payload.id)
			throw new Error("Message conflicts with scoped chat");
		if (
			this.threadId !== undefined &&
			message.payload.message_thread_id !== this.threadId
		)
			throw new Error("Message conflicts with scoped topic");
		return new UserOnMessageScope(this.user, message);
	}
}
