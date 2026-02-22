import type {
	TelegramContact,
	TelegramInlineQueryChatType,
	TelegramLocation,
	TelegramMessage,
	TelegramMessageEntity,
	TelegramReactionTypeEmojiEmoji,
	TelegramSticker,
	TelegramUser,
} from "@gramio/types";
import { FormattableString } from "gramio";
import type { TelegramTestEnvironment } from "../index.ts";
import { genFile } from "../utils.ts";
import { CallbackQueryObject } from "./callback-query.ts";
import { ChatObject } from "./chat.ts";
import { ChosenInlineResultObject } from "./chosen-inline-result.ts";
import { InlineQueryObject } from "./inline-query.ts";
import { MessageObject, lastMessageIdPerChat } from "./message.ts";
import { ReactObject } from "./react.ts";
import { UserInChatScope, UserOnMessageScope } from "./user-scopes.ts";

export let lastUserId = 0;

export interface MessageOptions {
	/** Extra entities to merge into the message (or use a FormattableString for text). */
	entities?: TelegramMessageEntity[];
	/** Message to reply to. */
	reply_to?: MessageObject;
}

export interface MediaOptions {
	/** Caption text. Accepts a plain string or a `format\`\`` FormattableString. */
	caption?: string | FormattableString;
	/** Set has_media_spoiler = true. */
	spoiler?: boolean;
}

/** Resolve a string or FormattableString to plain text + optional entities. */
function resolveText(input: string | FormattableString): {
	text: string;
	entities?: TelegramMessageEntity[];
} {
	if (input instanceof FormattableString) {
		return {
			text: input.text,
			...(input.entities.length > 0 ? { entities: input.entities } : {}),
		};
	}
	return { text: input };
}

/** Apply MediaOptions caption/spoiler fields onto a partial TelegramMessage payload. */
function applyMediaOptions(
	payload: Partial<TelegramMessage>,
	opts?: MediaOptions,
): void {
	if (!opts) return;
	if (opts.caption) {
		if (opts.caption instanceof FormattableString) {
			payload.caption = opts.caption.text;
			if (opts.caption.entities.length > 0)
				payload.caption_entities = opts.caption.entities;
		} else {
			payload.caption = opts.caption;
		}
	}
	if (opts.spoiler) payload.has_media_spoiler = true;
}

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

	private _checkEnvironment(): void {
		if (!this.environment) {
			throw new Error(
				"UserObject is not attached to a TelegramTestEnvironment. Use env.createUser() to create users.",
			);
		}
	}

	private async _emitMessage(
		chat: ChatObject,
		payload: Partial<TelegramMessage>,
	): Promise<MessageObject> {
		const chatId = chat.payload.id;
		const nextMsgId = (lastMessageIdPerChat.get(chatId) ?? 0) + 1;
		lastMessageIdPerChat.set(chatId, nextMsgId);

		const message = new MessageObject({
			message_id: nextMsgId,
			date: Math.floor(Date.now() / 1000),
			chat: chat.payload,
			from: this.payload,
			...payload,
		});

		message._chat = chat;
		chat.messages.push(message);

		await this.environment!.emitUpdate({
			update_id: 0,
			message: message.payload as MessageObject["payload"] & {
				chat: NonNullable<MessageObject["payload"]["chat"]>;
			},
		});

		return message;
	}

	async sendMessage(
		chatOrText: ChatObject | string | FormattableString,
		textOrOptions?: string | FormattableString | MessageOptions,
		options?: MessageOptions,
	): Promise<MessageObject> {
		this._checkEnvironment();

		let chat: ChatObject;
		let rawText: string | FormattableString;
		let opts: MessageOptions | undefined;

		if (chatOrText instanceof ChatObject) {
			chat = chatOrText;
			rawText = textOrOptions as string | FormattableString;
			opts = options;
		} else {
			chat = this.asChat;
			rawText = chatOrText;
			opts = textOrOptions as MessageOptions | undefined;
		}

		const resolved = resolveText(rawText);

		if (opts?.entities?.length) {
			resolved.entities = [...(resolved.entities ?? []), ...opts.entities];
		}

		return this._emitMessage(chat, {
			...resolved,
			...(opts?.reply_to
				? { reply_to_message: opts.reply_to.payload as TelegramMessage }
				: {}),
		});
	}

	/** Send a reply to an existing message. */
	async sendReply(
		message: MessageObject,
		text: string | FormattableString,
	): Promise<MessageObject> {
		this._checkEnvironment();
		const chat = message._chat ?? this.asChat;
		return this._emitMessage(chat, {
			...resolveText(text),
			reply_to_message: message.payload as TelegramMessage,
		});
	}

	/** Send a bot command with an auto-generated bot_command entity. */
	async sendCommand(
		chatOrCommand: ChatObject | string,
		commandOrArgs?: string,
		args?: string,
	): Promise<MessageObject> {
		this._checkEnvironment();

		let chat: ChatObject;
		let command: string;
		let cmdArgs: string | undefined;

		if (chatOrCommand instanceof ChatObject) {
			chat = chatOrCommand;
			command = commandOrArgs!;
			cmdArgs = args;
		} else {
			chat = this.asChat;
			command = chatOrCommand;
			cmdArgs = commandOrArgs;
		}

		const text = cmdArgs ? `/${command} ${cmdArgs}` : `/${command}`;
		return this._emitMessage(chat, {
			text,
			entities: [{ type: "bot_command", offset: 0, length: command.length + 1 }],
		});
	}

	/** Send a photo message. File ID and dimensions are auto-generated. */
	async sendPhoto(
		chatOrOptions?: ChatObject | MediaOptions,
		options?: MediaOptions,
	): Promise<MessageObject> {
		this._checkEnvironment();

		const [chat, opts] =
			chatOrOptions instanceof ChatObject
				? [chatOrOptions, options]
				: [this.asChat, chatOrOptions];

		const payload: Partial<TelegramMessage> = {
			photo: [
				{ ...genFile(), width: 100, height: 100 },
				{ ...genFile(), width: 800, height: 600 },
			],
		};
		applyMediaOptions(payload, opts);
		return this._emitMessage(chat, payload);
	}

	/** Send a video message. File fields are auto-generated. */
	async sendVideo(
		chatOrOptions?: ChatObject | MediaOptions,
		options?: MediaOptions,
	): Promise<MessageObject> {
		this._checkEnvironment();

		const [chat, opts] =
			chatOrOptions instanceof ChatObject
				? [chatOrOptions, options]
				: [this.asChat, chatOrOptions];

		const payload: Partial<TelegramMessage> = {
			video: { ...genFile(), width: 1280, height: 720, duration: 10 },
		};
		applyMediaOptions(payload, opts);
		return this._emitMessage(chat, payload);
	}

	/** Send a document message. File fields are auto-generated. */
	async sendDocument(
		chatOrOptions?: ChatObject | MediaOptions,
		options?: MediaOptions,
	): Promise<MessageObject> {
		this._checkEnvironment();

		const [chat, opts] =
			chatOrOptions instanceof ChatObject
				? [chatOrOptions, options]
				: [this.asChat, chatOrOptions];

		const payload: Partial<TelegramMessage> = { document: genFile() };
		applyMediaOptions(payload, opts);
		return this._emitMessage(chat, payload);
	}

	/** Send a voice message. File fields are auto-generated. */
	async sendVoice(
		chatOrOptions?: ChatObject | MediaOptions,
		options?: MediaOptions,
	): Promise<MessageObject> {
		this._checkEnvironment();

		const [chat, opts] =
			chatOrOptions instanceof ChatObject
				? [chatOrOptions, options]
				: [this.asChat, chatOrOptions];

		const payload: Partial<TelegramMessage> = {
			voice: { ...genFile(), duration: 5 },
		};
		applyMediaOptions(payload, opts);
		return this._emitMessage(chat, payload);
	}

	/** Send a sticker. File fields are auto-generated. */
	async sendSticker(
		chatOrOptions?: ChatObject | Partial<TelegramSticker>,
		options?: Partial<TelegramSticker>,
	): Promise<MessageObject> {
		this._checkEnvironment();

		let chat: ChatObject;
		let overrides: Partial<TelegramSticker> | undefined;

		if (chatOrOptions instanceof ChatObject) {
			chat = chatOrOptions;
			overrides = options;
		} else {
			chat = this.asChat;
			overrides = chatOrOptions;
		}

		return this._emitMessage(chat, {
			sticker: {
				...genFile(),
				width: 512,
				height: 512,
				is_animated: false,
				is_video: false,
				type: "regular",
				...overrides,
			},
		});
	}

	/** Send a location. */
	async sendLocation(
		chatOrLocation: ChatObject | Partial<TelegramLocation>,
		location?: Partial<TelegramLocation>,
	): Promise<MessageObject> {
		this._checkEnvironment();

		let chat: ChatObject;
		let loc: Partial<TelegramLocation>;

		if (chatOrLocation instanceof ChatObject) {
			chat = chatOrLocation;
			loc = location ?? {};
		} else {
			chat = this.asChat;
			loc = chatOrLocation;
		}

		return this._emitMessage(chat, {
			location: { latitude: 0, longitude: 0, ...loc },
		});
	}

	/** Send a contact. */
	async sendContact(
		chatOrContact: ChatObject | Partial<TelegramContact>,
		contact?: Partial<TelegramContact>,
	): Promise<MessageObject> {
		this._checkEnvironment();

		let chat: ChatObject;
		let ct: Partial<TelegramContact>;

		if (chatOrContact instanceof ChatObject) {
			chat = chatOrContact;
			ct = contact ?? {};
		} else {
			chat = this.asChat;
			ct = chatOrContact;
		}

		return this._emitMessage(chat, {
			contact: {
				phone_number: "+1234567890",
				first_name: "Contact",
				...ct,
			},
		});
	}

	/** Send a dice. */
	async sendDice(
		chatOrEmoji?: ChatObject | string,
		emoji?: string,
	): Promise<MessageObject> {
		this._checkEnvironment();

		let chat: ChatObject;
		let diceEmoji: string | undefined;

		if (chatOrEmoji instanceof ChatObject) {
			chat = chatOrEmoji;
			diceEmoji = emoji;
		} else {
			chat = this.asChat;
			diceEmoji = chatOrEmoji;
		}

		return this._emitMessage(chat, {
			dice: { emoji: diceEmoji ?? "🎲", value: Math.ceil(Math.random() * 6) },
		});
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
