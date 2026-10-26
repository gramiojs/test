import type {
	TelegramContact,
	TelegramInlineQueryChatType,
	TelegramLocation,
	TelegramMessage,
	TelegramMessageEntity,
	TelegramPreCheckoutQuery,
	TelegramReactionTypeEmojiEmoji,
	TelegramShippingQuery,
	TelegramSticker,
	TelegramSuccessfulPayment,
	TelegramUser,
} from "@gramio/types";
import { FormattableString, TelegramError } from "gramio";
import type { TelegramTestEnvironment } from "../index.ts";
import { diceValue, genFile, replySnapshot, snapshot } from "../utils.ts";
import { CallbackQueryObject } from "./callback-query.ts";
import { ChatObject } from "./chat.ts";
import { ChosenInlineResultObject } from "./chosen-inline-result.ts";
import { InlineQueryObject } from "./inline-query.ts";
import { MessageObject } from "./message.ts";
import { PreCheckoutQueryObject } from "./pre-checkout-query.ts";
import { ReactObject } from "./react.ts";
import { ShippingQueryObject } from "./shipping-query.ts";
import { UserInChatScope, UserOnMessageScope } from "./user-scopes.ts";

export let lastUserId = 0;

export interface MessageOptions {
	/** Extra entities to merge into the message (or use a FormattableString for text). */
	entities?: TelegramMessageEntity[];
	/** Message to reply to. */
	reply_to?: MessageObject;
	/** Explicit discussion/forum topic. Replies otherwise inherit their target's thread. */
	message_thread_id?: number;
}

export interface MediaOptions extends MessageOptions {
	/** Caption text. Accepts a plain string or a `format\`\`` FormattableString. */
	caption?: string | FormattableString;
	/** Set has_media_spoiler = true. */
	spoiler?: boolean;
}

function applyReplyOptions(
	payload: Partial<TelegramMessage>,
	opts?: MessageOptions,
	environment?: TelegramTestEnvironment,
) {
	if (opts?.reply_to) {
		environment?.assertMessage(opts.reply_to);
		if (opts.reply_to.isDeleted)
			throw new Error("Reply target has been deleted");
		if (
			opts.message_thread_id !== undefined &&
			opts.reply_to.payload.message_thread_id !== undefined &&
			opts.message_thread_id !== opts.reply_to.payload.message_thread_id
		)
			throw new Error("Reply target belongs to another thread");
		payload.reply_to_message = replySnapshot(opts.reply_to);
		const thread =
			opts.message_thread_id ?? opts.reply_to.payload.message_thread_id;
		if (thread !== undefined) payload.message_thread_id = thread;
	} else if (opts?.message_thread_id !== undefined)
		payload.message_thread_id = opts.message_thread_id;
}

export interface StopMessageGenerationOptions {
	/** Chat containing the draft. Defaults to the user's private chat. */
	chat?: ChatObject;
	/** Identifier of the topic containing the draft. */
	messageThreadId?: number;
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
	if (typeof input !== "string")
		throw new TypeError("Message text must be a string or FormattableString");
	return { text: input };
}

/** Apply MediaOptions caption/spoiler fields onto a partial TelegramMessage payload. */
function applyMediaOptions(
	payload: Partial<TelegramMessage>,
	opts?: MediaOptions,
	environment?: TelegramTestEnvironment,
): void {
	if (!opts) return;
	applyReplyOptions(payload, opts, environment);
	if (opts.caption !== undefined) {
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

	private _checkEnvironment(): asserts this is this & {
		environment: TelegramTestEnvironment;
	} {
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
		this._checkEnvironment();
		const environment = this.environment;
		if (!environment) throw new Error("Missing test environment");
		environment.assertChat(chat);
		if (chat.payload.type === "channel")
			throw new Error("Use channel.post() for channel posts");
		if (
			payload.message_thread_id !== undefined &&
			(!Number.isSafeInteger(payload.message_thread_id) ||
				payload.message_thread_id <= 0)
		)
			throw new Error("Thread id must be a positive integer");
		if (
			payload.reply_to_message?.chat.id !== undefined &&
			payload.reply_to_message.chat.id !== chat.payload.id
		)
			throw new Error("Reply target belongs to another chat");
		const nextMsgId = environment.nextMessageId(chat.payload.id);

		const message = new MessageObject({
			...payload,
			message_id: nextMsgId,
			date: Math.floor(Date.now() / 1000),
			chat: chat.payload,
			from: this.payload,
			...(payload.message_thread_id !== undefined && chat.payload.is_forum
				? { is_topic_message: true }
				: {}),
		});

		message._chat = chat;
		environment.registerMessage(message, chat);

		await this.environment.emitUpdate({
			update_id: 0,
			message: message.payload as MessageObject["payload"] & {
				chat: NonNullable<MessageObject["payload"]["chat"]>;
			},
		});

		return message;
	}

	sendMessage(
		text: string | FormattableString,
		options?: MessageOptions,
	): Promise<MessageObject>;
	sendMessage(
		chat: ChatObject,
		text: string | FormattableString,
		options?: MessageOptions,
	): Promise<MessageObject>;
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
		if (opts?.reply_to) this.environment?.assertMessage(opts.reply_to);

		if (opts?.entities?.length) {
			resolved.entities = [...(resolved.entities ?? []), ...opts.entities];
		}

		const payload: Partial<TelegramMessage> = { ...resolved };
		if (
			!payload.entities?.some(
				(entity) => entity.type === "bot_command" && entity.offset === 0,
			)
		) {
			const command = resolved.text.match(
				/^\/[a-zA-Z0-9_]+(?:@[a-zA-Z0-9_]+)?(?=\s|$)/,
			);
			if (command)
				payload.entities = [
					{ type: "bot_command", offset: 0, length: command[0].length },
					...(payload.entities ?? []),
				];
		}
		applyReplyOptions(payload, opts, this.environment);
		return this._emitMessage(chat, payload);
	}

	/** Send a reply to an existing message, preserving its thread identifier. */
	async sendReply(
		message: MessageObject,
		text: string | FormattableString,
	): Promise<MessageObject> {
		this._checkEnvironment();
		this.environment?.assertMessage(message);
		const chat =
			message._chat ??
			(message.payload.chat
				? this.environment?.resolveChat(message.payload.chat)
				: undefined) ??
			this.asChat;
		return this.sendMessage(chat, text, { reply_to: message });
	}

	/** Send a builder as this user, with normal state tracking and update delivery. */
	async send(message: MessageObject): Promise<MessageObject> {
		this._checkEnvironment();
		if (message.isDeleted) throw new Error("Message has been deleted");
		if (message._chat) this.environment.assertChat(message._chat);
		const chat =
			message._chat ??
			(message.payload.chat
				? this.environment?.resolveChat(message.payload.chat)
				: undefined) ??
			this.asChat;
		const {
			message_id: _id,
			date: _date,
			from: _from,
			chat: _chat,
			...content
		} = message.payload;
		return this._emitMessage(chat, snapshot(content));
	}

	/** Send a bot command with an auto-generated bot_command entity. */
	sendCommand(command: string, args?: string): Promise<MessageObject>;
	sendCommand(
		chat: ChatObject,
		command: string,
		args?: string,
	): Promise<MessageObject>;
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
			command = commandOrArgs ?? "";
			cmdArgs = args;
		} else {
			chat = this.asChat;
			command = chatOrCommand;
			cmdArgs = commandOrArgs;
		}

		command = command.replace(/^\//, "");
		if (!/^[a-zA-Z0-9_]+(?:@[a-zA-Z0-9_]+)?$/.test(command))
			throw new Error("Invalid bot command");
		const text = cmdArgs ? `/${command} ${cmdArgs}` : `/${command}`;
		return this._emitMessage(chat, {
			text,
			entities: [
				{ type: "bot_command", offset: 0, length: command.length + 1 },
			],
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
		applyMediaOptions(payload, opts, this.environment);
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
		applyMediaOptions(payload, opts, this.environment);
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
		applyMediaOptions(payload, opts, this.environment);
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
		applyMediaOptions(payload, opts, this.environment);
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
			dice: { emoji: diceEmoji ?? "🎲", value: diceValue(diceEmoji ?? "🎲") },
		});
	}

	/** Send an audio file. File fields are auto-generated. */
	async sendAudio(
		chatOrOptions?: ChatObject | MediaOptions,
		options?: MediaOptions,
	): Promise<MessageObject> {
		this._checkEnvironment();

		const [chat, opts] =
			chatOrOptions instanceof ChatObject
				? [chatOrOptions, options]
				: [this.asChat, chatOrOptions];

		const payload: Partial<TelegramMessage> = {
			audio: { ...genFile(), duration: 30 },
		};
		applyMediaOptions(payload, opts, this.environment);
		return this._emitMessage(chat, payload);
	}

	/** Send an animation (GIF). File fields are auto-generated. */
	async sendAnimation(
		chatOrOptions?: ChatObject | MediaOptions,
		options?: MediaOptions,
	): Promise<MessageObject> {
		this._checkEnvironment();

		const [chat, opts] =
			chatOrOptions instanceof ChatObject
				? [chatOrOptions, options]
				: [this.asChat, chatOrOptions];

		const payload: Partial<TelegramMessage> = {
			animation: { ...genFile(), width: 480, height: 270, duration: 3 },
		};
		applyMediaOptions(payload, opts, this.environment);
		return this._emitMessage(chat, payload);
	}

	/** Send a video note (circle video). File fields are auto-generated. */
	async sendVideoNote(
		chatOrOptions?: ChatObject | MediaOptions,
		options?: MediaOptions,
	): Promise<MessageObject> {
		this._checkEnvironment();

		const [chat, opts] =
			chatOrOptions instanceof ChatObject
				? [chatOrOptions, options]
				: [this.asChat, chatOrOptions];

		const payload: Partial<TelegramMessage> = {
			video_note: { ...genFile(), length: 240, duration: 10 },
		};
		applyMediaOptions(payload, opts, this.environment);
		return this._emitMessage(chat, payload);
	}

	/** Edit the text of an existing message. Updates the message in-place and emits `edited_message`. */
	async editMessage(
		message: MessageObject,
		text: string | FormattableString,
	): Promise<MessageObject> {
		this._checkEnvironment();
		this.environment?.assertMessage(message);
		if (
			message.payload.chat?.type === "channel" ||
			message.payload.from?.id !== this.payload.id
		)
			throw new Error(
				"Users can only edit their own messages. Use channel.editPost() for channel posts",
			);
		if (message.payload.text === undefined)
			throw new Error("Message has no text; use editCaption() for media");

		const resolved = resolveText(text);
		message.payload.text = resolved.text;
		if (resolved.entities) {
			message.payload.entities = resolved.entities;
		} else {
			delete message.payload.entities;
		}
		message.payload.edit_date = Math.floor(Date.now() / 1000);

		await this.environment.emitUpdate({
			update_id: 0,
			edited_message: message.payload as TelegramMessage & {
				chat: NonNullable<TelegramMessage["chat"]>;
			},
		});

		return message;
	}

	/** Edit a user's media caption without creating an impossible text+media message. */
	async editCaption(
		message: MessageObject,
		caption: string | FormattableString,
	): Promise<MessageObject> {
		this._checkEnvironment();
		this.environment?.assertMessage(message);
		if (message.payload.from?.id !== this.payload.id)
			throw new Error("Users can only edit their own messages");
		if (
			!message.payload.photo &&
			!message.payload.video &&
			!message.payload.document &&
			!message.payload.audio &&
			!message.payload.animation &&
			!message.payload.voice
		)
			throw new Error("Message has no editable caption");
		message.caption(caption);
		message.payload.edit_date = Math.floor(Date.now() / 1000);
		await this.environment.emitUpdate({
			update_id: 0,
			edited_message: message.payload as TelegramMessage,
		});
		return message;
	}

	/**
	 * Forward a message to a chat (defaults to this user's PM chat).
	 * The forwarded message gets `forward_origin` set to the original sender.
	 */
	async forwardMessage(
		message: MessageObject,
		toChat?: ChatObject,
	): Promise<MessageObject> {
		this._checkEnvironment();

		const chat = toChat ?? this.asChat;
		this.environment?.assertMessage(message);
		if (message.payload.has_protected_content)
			throw new Error("Cannot forward protected content");
		const {
			message_id: originalId,
			date,
			chat: originalChat,
			from,
			edit_date: _ed,
			forward_origin,
			reply_to_message: _rtm,
			message_thread_id: _thread,
			is_topic_message: _topic,
			sender_chat: _sender,
			is_automatic_forward: _automatic,
			...content
		} = message.payload as TelegramMessage;

		return this._emitMessage(chat, {
			...content,
			forward_origin:
				forward_origin ??
				(originalChat.type === "channel"
					? {
							type: "channel",
							date,
							chat: originalChat,
							message_id: originalId,
						}
					: {
							type: "user" as const,
							date,
							sender_user: from ?? this.payload,
						}),
		});
	}

	/**
	 * Send a media group (album): multiple messages sharing the same `media_group_id`.
	 * Each element in `payloads` becomes its own `message` update.
	 */
	async sendMediaGroup(
		chatOrPayloads: ChatObject | Partial<TelegramMessage>[],
		payloads?: Partial<TelegramMessage>[],
	): Promise<MessageObject[]> {
		this._checkEnvironment();

		let chat: ChatObject;
		let msgs: Partial<TelegramMessage>[];

		if (chatOrPayloads instanceof ChatObject) {
			chat = chatOrPayloads;
			msgs = payloads ?? [];
		} else {
			chat = this.asChat;
			msgs = chatOrPayloads;
		}

		if (msgs.length < 2 || msgs.length > 10)
			throw new Error("A media group must contain 2–10 messages");
		const groupId = this.environment.nextId("album");
		const results: MessageObject[] = [];

		for (const payload of msgs) {
			const msg = await this._emitMessage(chat, {
				...payload,
				media_group_id: groupId,
			});
			results.push(msg);
		}

		return results;
	}

	/**
	 * Pin a message in a chat (emits a service message with `pinned_message`).
	 * Uses the message's own chat, or `inChat` if provided.
	 */
	async pinMessage(
		message: MessageObject,
		inChat?: ChatObject,
	): Promise<MessageObject> {
		this._checkEnvironment();

		this.environment?.assertMessage(message);
		const chat =
			inChat ??
			message._chat ??
			(message.payload.chat
				? this.environment?.resolveChat(message.payload.chat)
				: undefined) ??
			this.asChat;
		if (message.payload.chat && message.payload.chat.id !== chat.payload.id)
			throw new Error("Pinned message belongs to another chat");
		chat.pinnedMessage = message;
		return this._emitMessage(chat, {
			pinned_message: replySnapshot(message),
		});
	}

	async join(chat: ChatObject): Promise<void> {
		if (!this.environment) {
			throw new Error(
				"UserObject is not attached to a TelegramTestEnvironment. Use env.createUser() to create users.",
			);
		}

		this.environment.assertChat(chat);
		if (chat.members.has(this)) return;
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
		const nextMsgId = this.environment.nextMessageId(chatId);

		const serviceMessage = new MessageObject({
			message_id: nextMsgId,
			date: Math.floor(Date.now() / 1000),
			chat: chat.payload,
			from: this.payload,
			new_chat_members: [this.payload],
		});

		this.environment.registerMessage(serviceMessage, chat);

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

		this.environment.assertChat(chat);
		if (!chat.members.has(this)) return;
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
		const nextMsgId = this.environment.nextMessageId(chatId);

		const serviceMessage = new MessageObject({
			message_id: nextMsgId,
			date: Math.floor(Date.now() / 1000),
			chat: chat.payload,
			from: this.payload,
			left_chat_member: this.payload,
		});

		this.environment.registerMessage(serviceMessage, chat);

		await this.environment.emitUpdate({
			update_id: 0,
			message: serviceMessage.payload as MessageObject["payload"] & {
				chat: NonNullable<MessageObject["payload"]["chat"]>;
			},
		});
	}

	/** Stop an in-progress rich-message draft and emit the Bot API update. */
	async stopMessageGeneration(
		draftId: number,
		options: StopMessageGenerationOptions = {},
	): Promise<void> {
		this._checkEnvironment();
		const chat = options.chat ?? this.asChat;

		await this.environment.emitUpdate({
			update_id: 0,
			stopped_message_generation: {
				chat: chat.payload,
				draft_id: draftId,
				...(options.messageThreadId === undefined
					? {}
					: { message_thread_id: options.messageThreadId }),
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
			chat_instance: String(
				message?.payload.chat?.id ?? this.asChat.payload.id,
			),
		});

		if (message) {
			this.environment.assertMessage(message);
			if (message.inlineMessageId)
				cbQuery.payload.inline_message_id = message.inlineMessageId;
			else cbQuery.message(message);
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
			reactionPayload = snapshot(reactOrEmojis.payload);
			trackedMessage = reactOrEmojis._message ?? message;

			if (!reactionPayload.user) reactionPayload.user = this.payload;
			if (trackedMessage) {
				reactionPayload.chat ??=
					trackedMessage.payload.chat ?? this.asChat.payload;
				reactionPayload.message_id ??= trackedMessage.payload.message_id;
			}
			// auto-populate old_reaction from memory when .remove() was never called
			if (!reactOrEmojis.hasExplicitOldReactions && trackedMessage) {
				const prev =
					trackedMessage.reactions.get(reactionPayload.user.id) ?? [];
				reactionPayload.old_reaction = prev.map((emoji) => ({
					type: "emoji" as const,
					emoji,
				}));
			}
		} else {
			trackedMessage = message;
			const newEmojis = Array.isArray(reactOrEmojis)
				? reactOrEmojis
				: [reactOrEmojis];
			const prevEmojis = message?.reactions.get(this.payload.id) ?? [];
			reactionPayload = {
				chat: message?.payload.chat ?? this.asChat.payload,
				message_id: message?.payload.message_id ?? 0,
				user: this.payload,
				date: Math.floor(Date.now() / 1000),
				old_reaction: prevEmojis.map((emoji) => ({
					type: "emoji" as const,
					emoji,
				})),
				new_reaction: newEmojis.map((emoji) => ({
					type: "emoji" as const,
					emoji,
				})),
			};
		}

		// persist new reaction state on the message
		if (trackedMessage) {
			this.environment.assertMessage(trackedMessage);
			const newEmojis = reactionPayload.new_reaction
				.filter(
					(r): r is { type: "emoji"; emoji: TelegramReactionTypeEmojiEmoji } =>
						r.type === "emoji",
				)
				.map((r) => r.emoji);
			if (newEmojis.length === 0) {
				trackedMessage.reactions.delete(
					reactionPayload.user?.id ?? this.payload.id,
				);
			} else {
				trackedMessage.reactions.set(
					reactionPayload.user?.id ?? this.payload.id,
					newEmojis,
				);
			}
		}
		await this.environment.emitUpdate({
			update_id: 0,
			message_reaction: reactionPayload as Required<ReactObject["payload"]>,
		});
	}

	async sendInlineQuery(
		query: string,
		chatOrOptions?:
			| ChatObject
			| { offset?: string; chat_type?: TelegramInlineQueryChatType },
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

	async sendPreCheckoutQuery(
		overrides?: Partial<TelegramPreCheckoutQuery>,
	): Promise<PreCheckoutQueryObject> {
		this._checkEnvironment();
		const query = new PreCheckoutQueryObject({
			from: this.payload,
			...overrides,
		});
		await this.environment.emitUpdate({
			update_id: 0,
			pre_checkout_query: query.payload,
		});
		return query;
	}

	async sendShippingQuery(
		overrides?: Partial<TelegramShippingQuery>,
	): Promise<ShippingQueryObject> {
		this._checkEnvironment();
		const query = new ShippingQueryObject({
			from: this.payload,
			...overrides,
		});
		await this.environment.emitUpdate({
			update_id: 0,
			shipping_query: query.payload,
		});
		return query;
	}

	async sendSuccessfulPayment(
		chatOrOverrides?: ChatObject | Partial<TelegramSuccessfulPayment>,
		overrides?: Partial<TelegramSuccessfulPayment>,
		options?: MessageOptions,
	): Promise<MessageObject> {
		this._checkEnvironment();

		let chat: ChatObject;
		let opts: Partial<TelegramSuccessfulPayment> | undefined;

		if (chatOrOverrides instanceof ChatObject) {
			chat = chatOrOverrides;
			opts = overrides;
		} else {
			chat = this.asChat;
			opts = chatOrOverrides;
		}

		const payment: TelegramSuccessfulPayment = {
			currency: "XTR",
			total_amount: 1,
			invoice_payload: "default_payload",
			telegram_payment_charge_id: this.environment.nextId("tg_charge"),
			provider_payment_charge_id: this.environment.nextId("provider_charge"),
			...opts,
		};

		// Telegram always sends pre_checkout_query before successful_payment
		const preCheckout = new PreCheckoutQueryObject({
			from: this.payload,
			currency: payment.currency,
			total_amount: payment.total_amount,
			invoice_payload: payment.invoice_payload,
			shipping_option_id: payment.shipping_option_id,
			order_info: payment.order_info,
		});

		await this.environment.emitUpdate({
			update_id: 0,
			pre_checkout_query: preCheckout.payload,
		});

		// Check that the bot approved the pre-checkout query
		const answerCall = this.environment.apiCalls
			.filter(
				(c) =>
					c.method === "answerPreCheckoutQuery" &&
					(c.params as { pre_checkout_query_id?: string })
						.pre_checkout_query_id === preCheckout.payload.id,
			)
			.pop();

		if (!answerCall) {
			throw new Error(
				"Bot did not call answerPreCheckoutQuery. Register a pre_checkout_query handler that calls ctx.answerPreCheckoutQuery({ ok: true }).",
			);
		}
		if (answerCall.response instanceof TelegramError)
			throw new Error(
				"Pre-checkout approval failed at the API; Telegram would not send successful_payment",
			);

		if (!(answerCall.params as { ok?: boolean }).ok) {
			throw new Error(
				`Bot rejected pre_checkout_query (ok: false). Telegram would not send successful_payment. Error: ${(answerCall.params as { error_message?: string }).error_message ?? "none"}`,
			);
		}

		const payload: Partial<TelegramMessage> = { successful_payment: payment };
		applyReplyOptions(payload, options, this.environment);
		return this._emitMessage(chat, payload);
	}

	/** Scope this user to a chat, enabling fluent actions: `.sendMessage()`, `.sendInlineQuery()`, `.join()`, `.leave()`, `.on(msg)`. */
	/** Press a reply-keyboard button. Contact buttons share this user's identity. */
	async press(
		buttonText: string,
		message: MessageObject,
	): Promise<MessageObject> {
		this._checkEnvironment();
		this.environment?.assertMessage(message);
		const markup: unknown = message.payload.reply_markup;
		const keyboard: unknown =
			markup && typeof markup === "object"
				? Reflect.get(markup, "keyboard")
				: undefined;
		if (!Array.isArray(keyboard))
			throw new Error("Message has no reply keyboard");
		for (const row of keyboard) {
			if (!Array.isArray(row)) continue;
			for (const button of row) {
				const label: unknown =
					typeof button === "string"
						? button
						: button && typeof button === "object"
							? Reflect.get(button, "text")
							: undefined;
				if (label !== buttonText) continue;
				const chat =
					message._chat ??
					(message.payload.chat
						? this.environment?.resolveChat(message.payload.chat)
						: undefined) ??
					this.asChat;
				if (typeof button === "object" && button !== null) {
					if (Reflect.get(button, "request_contact"))
						return this.sendContact(chat, {
							user_id: this.payload.id,
							first_name: this.payload.first_name,
							last_name: this.payload.last_name,
						});
					if (
						Object.keys(button).some(
							(key) =>
								key !== "text" &&
								key !== "style" &&
								key !== "icon_custom_emoji_id",
						)
					)
						throw new Error(
							"This button requires explicit input; use sendLocation(), send(), or sendMessage() to provide it",
						);
				}
				return this.sendMessage(chat, buttonText);
			}
		}
		throw new Error(`No reply button with text "${buttonText}" found`);
	}

	/** Vote, change a vote, or retract with [] on a non-anonymous poll. */
	async vote(message: MessageObject, optionIds: number[]): Promise<void> {
		this._checkEnvironment();
		this.environment?.assertMessage(message);
		const poll = message.payload.poll;
		if (!poll || poll.is_anonymous || poll.is_closed)
			throw new Error("Voting requires an open, non-anonymous poll");
		if (
			new Set(optionIds).size !== optionIds.length ||
			optionIds.some(
				(id) => !Number.isInteger(id) || id < 0 || id >= poll.options.length,
			)
		)
			throw new Error("Invalid poll option indices");
		if (!poll.allows_multiple_answers && optionIds.length > 1)
			throw new Error("Poll accepts only one answer");
		const previous = message.pollVotes.get(this.payload.id) ?? [];
		if (previous.length && !poll.allows_revoting)
			throw new Error("Poll does not allow revoting");
		for (const id of previous) poll.options[id].voter_count--;
		for (const id of optionIds) poll.options[id].voter_count++;
		if (optionIds.length)
			message.pollVotes.set(this.payload.id, [...optionIds]);
		else message.pollVotes.delete(this.payload.id);
		poll.total_voter_count +=
			(optionIds.length ? 1 : 0) - (previous.length ? 1 : 0);
		await this.environment.emitUpdate({
			update_id: 0,
			poll_answer: {
				poll_id: poll.id,
				user: this.payload,
				option_ids: [...optionIds],
				option_persistent_ids: optionIds.map(
					(id) => poll.options[id].persistent_id,
				),
			},
		});
	}

	/** Materialize a returned inline result; only chosen_inline_result is delivered to the bot. */
	async sendInlineResult(
		resultId: string,
		query: InlineQueryObject,
		chat: ChatObject = this.asChat,
		options?: MessageOptions,
	): Promise<MessageObject> {
		this._checkEnvironment();
		if (query.payload.from.id !== this.payload.id)
			throw new Error("Inline query belongs to another user");
		const result = this.environment.inlineResult(query.payload.id, resultId);
		if (!result)
			throw new Error("No successful inline answer contains this result id");
		this.environment.assertChat(chat);
		const payload: Partial<TelegramMessage> = {};
		applyReplyOptions(payload, options, this.environment);
		if (
			payload.reply_to_message?.chat.id !== undefined &&
			payload.reply_to_message.chat.id !== chat.payload.id
		)
			throw new Error("Reply target belongs to another chat");
		if (
			payload.message_thread_id !== undefined &&
			(!Number.isInteger(payload.message_thread_id) ||
				payload.message_thread_id <= 0)
		)
			throw new Error("Invalid message thread id");
		const bubble = this.environment.materializeInline(
			result,
			this,
			chat,
			payload,
		);
		await this.chooseInlineResult(resultId, query.payload.query, {
			inline_message_id: bubble.inlineMessageId,
		});
		return bubble;
	}

	/** Share a saved Mini App message without fabricating a bot message update. */
	async sendPreparedInlineMessage(
		id: string,
		chat: ChatObject = this.asChat,
		options?: MessageOptions,
	): Promise<MessageObject> {
		this._checkEnvironment();
		const result = this.environment.preparedResult(id, this, chat);
		const payload: Partial<TelegramMessage> = {};
		applyReplyOptions(payload, options, this.environment);
		return this.environment.materializeInline(result, this, chat, payload);
	}

	/** Summon the bot as a guest with text or a media fixture. */
	async sendGuestMessage(
		input: string | FormattableString | MessageObject,
		chat: ChatObject = this.asChat,
		options?: MessageOptions,
	): Promise<MessageObject> {
		this._checkEnvironment();
		this.environment.assertChat(chat);
		if (
			input instanceof MessageObject &&
			input._chat?.environment &&
			input._chat.environment !== this.environment
		)
			throw new Error("Message belongs to another test environment");
		const content: Partial<TelegramMessage> =
			input instanceof MessageObject
				? snapshot(input.payload)
				: resolveText(input);
		applyReplyOptions(content, options, this.environment);
		if (
			content.reply_to_message?.chat.id !== undefined &&
			content.reply_to_message.chat.id !== chat.payload.id
		)
			throw new Error("Reply target belongs to another chat");
		if (
			content.message_thread_id !== undefined &&
			(!Number.isSafeInteger(content.message_thread_id) ||
				content.message_thread_id <= 0)
		)
			throw new Error("Invalid message thread id");
		const message = new MessageObject({
			...content,
			chat: chat.payload,
			from: this.payload,
			message_id: this.environment.nextMessageId(chat.payload.id),
			guest_query_id: this.environment.nextId("guest"),
			...(content.message_thread_id !== undefined && chat.payload.is_forum
				? { is_topic_message: true }
				: {}),
		});
		message._chat = chat;
		this.environment.registerGuestMessage(message);
		await this.environment.emitUpdate({
			update_id: 0,
			guest_message: message.payload as TelegramMessage,
		});
		return message;
	}

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
