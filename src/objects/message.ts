import type { TelegramReactionTypeEmojiEmoji } from "@gramio/types";
import type {
	TelegramAnimation,
	TelegramAudio,
	TelegramChat,
	TelegramContact,
	TelegramDice,
	TelegramDocument,
	TelegramGame,
	TelegramLinkPreviewOptions,
	TelegramLocation,
	TelegramMessage,
	TelegramMessageEntity,
	TelegramPhotoSize,
	TelegramPoll,
	TelegramSticker,
	TelegramStory,
	TelegramUser,
	TelegramVenue,
	TelegramVideo,
	TelegramVideoNote,
	TelegramVoice,
} from "gramio";
import { FormattableString } from "gramio";
import type { Optional } from "../utils.ts";
import { genFile } from "../utils.ts";
import { ChatObject } from "./chat.ts";
import { UserObject } from "./user.ts";

export const lastMessageIdPerChat = new Map<number, number>();

export class MessageObject {
	public type = "message";
	public payload: Optional<TelegramMessage, "chat">;

	/** @internal Set by UserObject to enable sendReply chat lookup. */
	public _chat?: ChatObject;

	/** Per-user reaction state. Keyed by `user.payload.id`. Updated automatically by `user.react()`. */
	public reactions = new Map<number, TelegramReactionTypeEmojiEmoji[]>();

	constructor(payload: Partial<TelegramMessage> = {}) {
		this.payload = {
			message_id: lastMessageIdPerChat.get(payload.chat?.id ?? 0) ?? 0,
			date: Date.now(),
			...payload,
		};
	}

	from(user: TelegramUser | UserObject) {
		if (user instanceof UserObject) {
			this.payload.from = user.payload;
		} else {
			this.payload.from = user;
		}

		if (!this.payload.chat) {
			this.payload.chat = new ChatObject({
				id: this.payload.from.id,
				type: "private",
			}).payload;

			if (!lastMessageIdPerChat.has(this.payload.chat.id)) {
				lastMessageIdPerChat.set(
					this.payload.chat.id,
					this.payload.message_id ?? 0,
				);
			}
		}

		return this;
	}

	chat(chat: ChatObject | TelegramChat) {
		if (chat instanceof ChatObject) {
			this.payload.chat = chat.payload;
		} else {
			this.payload.chat = chat;
		}

		if (!lastMessageIdPerChat.has(this.payload.chat.id)) {
			lastMessageIdPerChat.set(
				this.payload.chat.id,
				this.payload.message_id ?? 0,
			);
		}

		return this;
	}

	/** Set message text. Accepts a plain string or a `format\`\`` FormattableString (auto-extracts text and entities). */
	text(text: string | FormattableString): this {
		if (text instanceof FormattableString) {
			this.payload.text = text.text;
			if (text.entities.length > 0) this.payload.entities = text.entities;
		} else {
			this.payload.text = text;
		}
		return this;
	}

	/** Set message caption. Accepts a plain string or a `format\`\`` FormattableString. */
	caption(caption: string | FormattableString): this {
		if (caption instanceof FormattableString) {
			this.payload.caption = caption.text;
			if (caption.entities.length > 0)
				this.payload.caption_entities = caption.entities;
		} else {
			this.payload.caption = caption;
		}
		return this;
	}

	/** Append formatting entities to the message text. */
	entities(...entities: TelegramMessageEntity[]): this {
		this.payload.entities = [...(this.payload.entities ?? []), ...entities];
		return this;
	}

	/** Append formatting entities to the message caption. */
	captionEntities(...entities: TelegramMessageEntity[]): this {
		this.payload.caption_entities = [
			...(this.payload.caption_entities ?? []),
			...entities,
		];
		return this;
	}

	/** Attach a photo. Sizes are auto-generated if not provided. */
	photo(overrides?: Partial<TelegramPhotoSize>[]): this {
		if (overrides) {
			this.payload.photo = overrides.map((o, i) => ({
				...genFile(),
				width: 100 * (i + 1),
				height: 100 * (i + 1),
				...o,
			}));
		} else {
			this.payload.photo = [
				{ ...genFile(), width: 100, height: 100 },
				{ ...genFile(), width: 800, height: 600 },
			];
		}
		return this;
	}

	/** Attach a video. Fields are auto-generated if not provided. */
	video(overrides?: Partial<TelegramVideo>): this {
		this.payload.video = {
			...genFile(),
			width: 1280,
			height: 720,
			duration: 10,
			...overrides,
		};
		return this;
	}

	/** Attach a document. Fields are auto-generated if not provided. */
	document(overrides?: Partial<TelegramDocument>): this {
		this.payload.document = { ...genFile(), ...overrides };
		return this;
	}

	/** Attach an audio file. Fields are auto-generated if not provided. */
	audio(overrides?: Partial<TelegramAudio>): this {
		this.payload.audio = { ...genFile(), duration: 30, ...overrides };
		return this;
	}

	/** Attach a sticker. Fields are auto-generated if not provided. */
	sticker(overrides?: Partial<TelegramSticker>): this {
		this.payload.sticker = {
			...genFile(),
			width: 512,
			height: 512,
			is_animated: false,
			is_video: false,
			type: "regular",
			...overrides,
		};
		return this;
	}

	/** Attach a voice message. Fields are auto-generated if not provided. */
	voice(overrides?: Partial<TelegramVoice>): this {
		this.payload.voice = { ...genFile(), duration: 5, ...overrides };
		return this;
	}

	/** Attach a video note. Fields are auto-generated if not provided. */
	videoNote(overrides?: Partial<TelegramVideoNote>): this {
		this.payload.video_note = {
			...genFile(),
			length: 240,
			duration: 10,
			...overrides,
		};
		return this;
	}

	/** Attach an animation (GIF). Fields are auto-generated if not provided. */
	animation(overrides?: Partial<TelegramAnimation>): this {
		this.payload.animation = {
			...genFile(),
			width: 480,
			height: 270,
			duration: 3,
			...overrides,
		};
		return this;
	}

	/** Attach a contact. */
	contact(contact: Partial<TelegramContact>): this {
		this.payload.contact = {
			phone_number: "+1234567890",
			first_name: "Contact",
			...contact,
		};
		return this;
	}

	/** Attach a location. */
	location(location: Partial<TelegramLocation>): this {
		this.payload.location = { latitude: 0, longitude: 0, ...location };
		return this;
	}

	/** Attach a dice. */
	dice(overrides?: Partial<TelegramDice>): this {
		this.payload.dice = {
			emoji: "🎲",
			value: Math.ceil(Math.random() * 6),
			...overrides,
		};
		return this;
	}

	/** Attach a venue. */
	venue(venue: Partial<TelegramVenue>): this {
		this.payload.venue = {
			location: { latitude: 0, longitude: 0 },
			title: "Venue",
			address: "Address",
			...venue,
		};
		return this;
	}

	/** Attach a game. */
	game(game: Partial<TelegramGame>): this {
		this.payload.game = {
			title: "Game",
			description: "Description",
			photo: [],
			...game,
		};
		return this;
	}

	/** Attach a story. */
	story(story: Partial<TelegramStory>): this {
		this.payload.story = story as TelegramStory;
		return this;
	}

	/** Attach a poll. */
	poll(poll: Partial<TelegramPoll>): this {
		this.payload.poll = {
			id: String(Date.now()),
			question: "Question",
			options: [],
			total_voter_count: 0,
			is_closed: false,
			is_anonymous: true,
			type: "regular",
			allows_multiple_answers: false,
			...poll,
		};
		return this;
	}

	/** Set the message this one is replying to. */
	replyTo(message: MessageObject): this {
		this.payload.reply_to_message = message.payload as TelegramMessage;
		return this;
	}

	/** Set has_media_spoiler = true. */
	spoiler(): this {
		this.payload.has_media_spoiler = true;
		return this;
	}

	/** Set has_protected_content = true. */
	protect(): this {
		this.payload.has_protected_content = true;
		return this;
	}

	/** Set is_topic_message = true. */
	topicMessage(): this {
		this.payload.is_topic_message = true;
		return this;
	}

	/** Set media_group_id. */
	mediaGroupId(id: string): this {
		this.payload.media_group_id = id;
		return this;
	}

	/** Set effect_id. */
	effectId(id: string): this {
		this.payload.effect_id = id;
		return this;
	}

	/** Set via_bot. */
	viaBot(bot: TelegramUser | UserObject): this {
		this.payload.via_bot = bot instanceof UserObject ? bot.payload : bot;
		return this;
	}

	/** Set the quoted portion of the reply. Accepts a plain string or FormattableString. */
	quote(text: string | FormattableString, entities?: TelegramMessageEntity[]): this {
		if (text instanceof FormattableString) {
			this.payload.quote = {
				text: text.text,
				entities: entities ?? (text.entities.length > 0 ? text.entities : undefined),
				position: 0,
			};
		} else {
			this.payload.quote = { text, entities, position: 0 };
		}
		return this;
	}

	/** Set link_preview_options. */
	linkPreviewOptions(options: Partial<TelegramLinkPreviewOptions>): this {
		this.payload.link_preview_options = options;
		return this;
	}
}
