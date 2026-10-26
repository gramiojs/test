import type {
	APIMethodParams,
	APIMethods,
	TelegramCurrencies,
	TelegramInlineQueryResult,
	TelegramMessage,
	TelegramMessageOrigin,
} from "@gramio/types";
import { apiError } from "./api.ts";
import type { TelegramTestEnvironment } from "./index.ts";
import { MessageObject } from "./objects/message.ts";
import { replySnapshot, snapshot } from "./utils.ts";

function originOf(message: MessageObject): TelegramMessageOrigin {
	return snapshot(
		message.payload.forward_origin ??
			(message.payload.chat?.type === "channel"
				? {
						type: "channel",
						date: message.payload.date,
						chat: message.payload.chat,
						message_id: message.payload.message_id,
					}
				: message.payload.from
					? {
							type: "user",
							date: message.payload.date,
							sender_user: message.payload.from,
						}
					: {
							type: "hidden_user",
							date: message.payload.date,
							sender_user_name: "Unknown",
						}),
	);
}

export const mediaMethods = new Map<string, string>([
	["sendPhoto", "photo"],
	["sendVideo", "video"],
	["sendDocument", "document"],
	["sendAudio", "audio"],
	["sendVoice", "voice"],
	["sendAnimation", "animation"],
	["sendVideoNote", "video_note"],
	["sendSticker", "sticker"],
	["sendLocation", "location"],
	["sendContact", "contact"],
	["sendDice", "dice"],
	["sendVenue", "venue"],
	["sendPoll", "poll"],
]);
export const sendMethods = new Set<keyof APIMethods>([
	"sendMessage",
	"sendMediaGroup",
	"sendInvoice",
	"forwardMessage",
	"forwardMessages",
	"copyMessage",
	"copyMessages",
]);
export function isSendMethod(method: keyof APIMethods) {
	return sendMethods.has(method) || mediaMethods.has(method);
}
const booleanMethods = new Set([
	"answerCallbackQuery",
	"answerInlineQuery",
	"answerPreCheckoutQuery",
	"answerShippingQuery",
	"sendChatAction",
	"setMyCommands",
	"deleteMyCommands",
	"setWebhook",
	"deleteWebhook",
	"setMessageReaction",
	"sendMessageDraft",
	"sendRichMessageDraft",
	"refundStarPayment",
]);

/** State-backed defaults. Unimplemented Telegram methods require an explicit mock. */
export class MockApi {
	private ephemeralId = 0;
	private commands = new Map<string, unknown>();
	private settings = new Map<string, unknown>();
	private originalBotName?: string;
	private prepared = new Map<
		string,
		{
			params: APIMethodParams<"savePreparedInlineMessage">;
			expiration_date: number;
		}
	>();
	private answeredGuests = new Set<string>();
	constructor(private readonly env: TelegramTestEnvironment) {}

	preparedResult(id: string, userId: number, chat: TelegramMessage["chat"]) {
		const entry = this.prepared.get(id);
		if (!entry || entry.expiration_date <= Math.floor(Date.now() / 1000))
			throw new Error("Prepared inline message is missing or expired");
		if (entry.params.user_id !== userId)
			throw new Error("Prepared inline message belongs to another user");
		const allowed =
			chat.type === "channel"
				? entry.params.allow_channel_chats
				: chat.type === "private"
					? chat.id === this.env.botUser.id ||
						this.env.users.some(
							(user) => user.payload.id === chat.id && user.payload.is_bot,
						)
						? entry.params.allow_bot_chats
						: entry.params.allow_user_chats
					: entry.params.allow_group_chats;
		if (!allowed)
			throw new Error(
				"Prepared inline message is not allowed in this chat type",
			);
		return snapshot(entry.params.result);
	}

	inlineContent(result: TelegramInlineQueryResult): Partial<TelegramMessage> {
		const raw = result as unknown as Record<string, unknown>;
		const input = raw.input_message_content as
			| Record<string, unknown>
			| undefined;
		const message = new MessageObject();
		if (input) {
			if (typeof input.message_text === "string") {
				message.payload.text = input.message_text;
				message.payload.entities =
					input.entities as TelegramMessage["entities"];
				message.payload.link_preview_options =
					input.link_preview_options as TelegramMessage["link_preview_options"];
			} else if ("latitude" in input)
				this.attachMedia(
					message,
					"title" in input ? "venue" : "location",
					input,
				);
			else if ("phone_number" in input)
				this.attachMedia(message, "contact", input);
			else if (
				typeof input.currency === "string" &&
				Array.isArray(input.prices)
			)
				message.payload.invoice = {
					title: String(input.title),
					description: String(input.description),
					currency: input.currency as TelegramCurrencies,
					start_parameter: String(input.start_parameter ?? ""),
					total_amount: (input.prices as { amount: number }[]).reduce(
						(sum, price) => sum + price.amount,
						0,
					),
				};
			else
				throw new Error(
					"Unsupported inline input_message_content; supply text, location, venue, contact or invoice content",
				);
		} else {
			const kind =
				raw.type === "gif" || raw.type === "mpeg4_gif"
					? "animation"
					: String(raw.type);
			const prefix = raw.type === "mpeg4_gif" ? "mpeg4" : raw.type;
			const source = raw[`${prefix}_file_id`] ?? raw[`${prefix}_url`];
			this.attachMedia(message, kind, {
				...raw,
				media: source,
				width: raw[`${prefix}_width`],
				height: raw[`${prefix}_height`],
				duration: raw[`${prefix}_duration`],
			});
			if (raw.caption !== undefined) {
				message.payload.caption = String(raw.caption);
				message.payload.caption_entities =
					raw.caption_entities as TelegramMessage["caption_entities"];
			}
		}
		const { message_id: _id, date: _date, ...content } = message.payload;
		return { ...content, reply_markup: result.reply_markup };
	}
	private outgoing(
		params: Record<string, unknown>,
		content: Partial<TelegramMessage>,
	): TelegramMessage {
		const chat = this.env.resolveChat(params.chat_id as number | string);
		const reply = params.reply_parameters as
			| {
					message_id?: number;
					chat_id?: number | string;
					allow_sending_without_reply?: boolean;
			  }
			| undefined;
		const sourceChat =
			reply?.chat_id === undefined ? chat : this.env.resolveChat(reply.chat_id);
		const external = sourceChat.payload.id !== chat.payload.id;
		const original =
			reply?.message_id === undefined
				? undefined
				: this.env.message(sourceChat.payload.id, reply.message_id);
		if (
			reply?.message_id !== undefined &&
			!original &&
			(!reply.allow_sending_without_reply || external)
		)
			throw apiError(400, "Bad Request: message to reply not found");
		const thread =
			params.message_thread_id ??
			(external ? undefined : original?.payload.message_thread_id);
		if (
			thread !== undefined &&
			(!Number.isInteger(thread) || Number(thread) <= 0)
		)
			throw apiError(400, "Bad Request: invalid message thread id");
		if (
			params.message_thread_id !== undefined &&
			!external &&
			original?.payload.message_thread_id !== undefined &&
			params.message_thread_id !== original.payload.message_thread_id
		)
			throw apiError(
				400,
				"Bad Request: reply target belongs to another thread",
			);
		return {
			message_id: this.env.nextMessageId(chat.payload.id),
			date: Math.floor(Date.now() / 1000),
			chat: snapshot(chat.payload),
			from: snapshot(this.env.botUser),
			...(thread === undefined ? {} : { message_thread_id: Number(thread) }),
			...(thread !== undefined && chat.payload.is_forum
				? { is_topic_message: true }
				: {}),
			...(original && !external
				? { reply_to_message: replySnapshot(original) }
				: {}),
			...(original && external
				? {
						external_reply: {
							origin: originOf(original),
							...(sourceChat.payload.type === "supergroup" ||
							sourceChat.payload.type === "channel"
								? {
										chat: snapshot(sourceChat.payload),
										message_id: original.payload.message_id,
									}
								: {}),
							...snapshot(
								Object.fromEntries(
									[
										"link_preview_options",
										"animation",
										"audio",
										"document",
										"live_photo",
										"paid_media",
										"photo",
										"sticker",
										"story",
										"video",
										"video_note",
										"voice",
										"has_media_spoiler",
										"checklist",
										"contact",
										"dice",
										"game",
										"giveaway",
										"giveaway_winners",
										"invoice",
										"location",
										"poll",
										"venue",
									]
										.filter(
											(key) => Reflect.get(original.payload, key) !== undefined,
										)
										.map((key) => [
											key,
											Reflect.get(original.payload, key) as unknown,
										]),
								),
							),
						},
					}
				: {}),
			...(params.protect_content ? { has_protected_content: true } : {}),
			...content,
		};
	}

	response(method: keyof APIMethods, params: Record<string, unknown>): unknown {
		if (method === "savePreparedInlineMessage") {
			const id = this.env.nextId("prepared");
			const expiration_date = Math.floor(Date.now() / 1000) + 300;
			this.prepared.set(id, {
				params: snapshot(
					params,
				) as unknown as APIMethodParams<"savePreparedInlineMessage">,
				expiration_date,
			});
			return { id, expiration_date };
		}
		if (method === "answerGuestQuery") {
			const id = String(params.guest_query_id);
			const guest = this.env.guestMessage(id);
			if (!guest || this.answeredGuests.has(id))
				return apiError(
					400,
					"Bad Request: guest query is invalid or already answered",
				);
			const user = this.env.users.find(
				(user) => user.payload.id === guest.payload.from?.id,
			);
			if (!user || !guest._chat)
				return apiError(400, "Bad Request: guest user or chat not found");
			const bubble = this.env.materializeInline(
				params.result as TelegramInlineQueryResult,
				user,
				guest._chat,
				{ message_thread_id: guest.payload.message_thread_id },
			);
			this.env.registerInlineMessage(bubble);
			this.answeredGuests.add(id);
			return { inline_message_id: bubble.inlineMessageId };
		}
		const setting = [
			{
				get: "getMyName",
				set: "setMyName",
				field: "name",
				initial: this.env.botUser.first_name,
			},
			{
				get: "getMyDescription",
				set: "setMyDescription",
				field: "description",
				initial: "",
			},
			{
				get: "getMyShortDescription",
				set: "setMyShortDescription",
				field: "short_description",
				initial: "",
			},
			{
				get: "getChatMenuButton",
				set: "setChatMenuButton",
				field: "menu_button",
				initial: { type: "default" },
			},
		].find((item) => item.get === method || item.set === method);
		if (setting) {
			const scope =
				setting.field === "menu_button"
					? (params.chat_id ?? "")
					: (params.language_code ?? "");
			const key = JSON.stringify([setting.get, scope]);
			if (method === setting.set) {
				if (setting.field === "name" && scope === "") {
					this.originalBotName ??= this.env.botUser.first_name;
					this.env.botUser.first_name =
						typeof params.name === "string" && params.name
							? params.name
							: this.originalBotName;
				}
				if (params[setting.field] === undefined || params[setting.field] === "")
					this.settings.delete(key);
				else this.settings.set(key, snapshot(params[setting.field]));
				return true;
			}
			const value = snapshot(
				this.settings.get(key) ??
					this.settings.get(JSON.stringify([setting.get, ""])) ??
					setting.initial,
			);
			return setting.field === "menu_button"
				? value
				: { [setting.field]: value };
		}
		if (method === "getUserProfilePhotos")
			return { total_count: 0, photos: [] };
		if (
			method === "forwardMessage" ||
			method === "copyMessage" ||
			method === "forwardMessages" ||
			method === "copyMessages"
		) {
			const batch = method === "forwardMessages" || method === "copyMessages";
			const copy = method === "copyMessage" || method === "copyMessages";
			const sourceChat = this.env.resolveChat(
				params.from_chat_id as number | string,
			);
			const ids = batch
				? (params.message_ids as number[])
				: [Number(params.message_id)];
			const albums = new Map<string, string>();
			const messages: TelegramMessage[] = [];
			for (const id of ids) {
				const source = this.env.message(sourceChat.payload.id, id);
				const content = source?.payload;
				const hasContent =
					content &&
					[
						"text",
						"photo",
						"video",
						"document",
						"audio",
						"voice",
						"animation",
						"video_note",
						"sticker",
						"location",
						"contact",
						"dice",
						"venue",
						"poll",
						"game",
						"story",
					].some((key) => Reflect.get(content, key) !== undefined);
				if (
					!source ||
					!hasContent ||
					(!copy && content?.has_protected_content) ||
					(copy &&
						content?.poll?.type === "quiz" &&
						!content.poll.correct_option_ids)
				) {
					if (batch) continue;
					return apiError(
						400,
						`Bad Request: message can't be ${copy ? "copied" : "forwarded"}`,
					);
				}
				messages.push(this.relay(source, params, copy, albums));
			}
			// Copy/batch methods return only IDs, but their messages still belong to the world.
			if (copy || batch) {
				this.env.updateBubbleFor(method, params, messages);
				const result = messages.map((message) => ({
					message_id: message.message_id,
				}));
				return batch ? result : result[0];
			}
			return messages[0];
		}
		if (method === "stopPoll") {
			const chat = this.env.resolveChat(params.chat_id as number | string);
			const message = this.env.botMessage(
				chat.payload.id,
				Number(params.message_id),
			);
			if (!message?.payload.poll || message.payload.poll.is_closed)
				return apiError(
					400,
					"Bad Request: poll to stop not found or already closed",
				);
			const result = snapshot(message.payload);
			if (!result.poll) throw new Error("Missing poll");
			result.poll.is_closed = true;
			if ("reply_markup" in params)
				result.reply_markup =
					params.reply_markup as TelegramMessage["reply_markup"];
			this.env.updateBubbleFor(method, params, result);
			return snapshot(result.poll);
		}
		if (
			method === "editMessageLiveLocation" ||
			method === "stopMessageLiveLocation"
		) {
			const message = params.inline_message_id
				? this.env.inlineMessage(String(params.inline_message_id))
				: this.env.botMessage(
						this.env.resolveChat(params.chat_id as number | string).payload.id,
						Number(params.message_id),
					);
			const location = message?.payload.location;
			if (
				!message ||
				!location?.live_period ||
				(location.live_period !== 0x7fffffff &&
					message.payload.date + location.live_period <=
						Math.floor(Date.now() / 1000))
			)
				return apiError(400, "Bad Request: live location is not active");
			const result = snapshot(message.payload);
			if (!result.location) throw new Error("Missing location");
			if (method === "stopMessageLiveLocation")
				delete result.location.live_period;
			else {
				result.location.latitude = Number(params.latitude);
				result.location.longitude = Number(params.longitude);
				for (const key of [
					"live_period",
					"horizontal_accuracy",
					"heading",
					"proximity_alert_radius",
				] as const)
					if (params[key] !== undefined)
						result.location[key] = Number(params[key]);
			}
			if ("reply_markup" in params)
				result.reply_markup =
					params.reply_markup as TelegramMessage["reply_markup"];
			result.edit_date = Math.floor(Date.now() / 1000);
			return this.editResult(message, result);
		}
		if (
			method === "getMyCommands" ||
			method === "setMyCommands" ||
			method === "deleteMyCommands"
		) {
			const key = JSON.stringify([
				params.scope ?? { type: "default" },
				params.language_code ?? "",
			]);
			if (method === "getMyCommands")
				return snapshot(this.commands.get(key) ?? []);
			if (method === "setMyCommands")
				this.commands.set(key, snapshot(params.commands));
			else this.commands.delete(key);
			return true;
		}
		if (method === "getMe") return snapshot(this.env.botUser);
		if (method === "getChat")
			return {
				...snapshot(
					this.env.resolveChat(params.chat_id as number | string).payload,
				),
				accent_color_id: 0,
				max_reaction_count: 1,
				pinned_message: snapshot(
					this.env.resolveChat(params.chat_id as number | string).pinnedMessage
						?.payload,
				),
			};
		if (method === "getChatMember") {
			const chat = this.env.resolveChat(params.chat_id as number | string);
			const user =
				this.env.users.find((item) => item.payload.id === params.user_id)
					?.payload ??
				(params.user_id === this.env.botUser.id ? this.env.botUser : undefined);
			if (!user) return apiError(400, "Bad Request: user not found");
			const actor = this.env.users.find((item) => item.payload.id === user.id);
			return {
				status:
					user.id === this.env.botUser.id || (actor && chat.members.has(actor))
						? "member"
						: "left",
				user: snapshot(user),
			};
		}
		if (method === "getChatMemberCount")
			return this.env.resolveChat(params.chat_id as number | string).members
				.size;
		if (method === "getFile")
			return (
				this.env.file(String(params.file_id)) ??
				apiError(400, "Bad Request: file not found")
			);
		if (method === "sendMediaGroup") {
			if (
				!Array.isArray(params.media) ||
				params.media.length < 2 ||
				params.media.length > 10
			)
				return apiError(400, "Bad Request: media group requires 2–10 items");
			const groupId = this.env.nextId("album");
			return (params.media as Record<string, unknown>[]).map((item) => {
				const message = new MessageObject();
				this.attachMedia(message, String(item.type), item);
				const { message_id: _id, date: _date, ...content } = message.payload;
				return this.outgoing(params, {
					...content,
					media_group_id: groupId,
					caption: item.caption as string,
					caption_entities:
						item.caption_entities as TelegramMessage["caption_entities"],
				});
			});
		}
		if (
			method === "sendMessage" ||
			mediaMethods.has(method) ||
			method === "sendInvoice"
		) {
			const message = new MessageObject();
			if (method === "sendMessage") message.text(String(params.text));
			else if (method === "sendInvoice")
				message.payload.invoice = {
					title: String(params.title),
					description: String(params.description),
					start_parameter: String(params.start_parameter ?? ""),
					currency: params.currency as TelegramCurrencies,
					total_amount: (params.prices as { amount: number }[]).reduce(
						(sum, p) => sum + p.amount,
						0,
					),
				};
			else
				this.attachMedia(
					message,
					mediaMethods.get(method) ?? "document",
					params,
				);
			const { message_id: _id, date: _date, ...content } = message.payload;
			const result = this.outgoing(params, {
				...content,
				...(params.entities
					? { entities: params.entities as TelegramMessage["entities"] }
					: {}),
				...(params.caption !== undefined
					? {
							caption: String(params.caption),
							caption_entities:
								params.caption_entities as TelegramMessage["caption_entities"],
						}
					: {}),
				...(params.reply_markup
					? {
							reply_markup:
								params.reply_markup as TelegramMessage["reply_markup"],
						}
					: {}),
			});
			const ephemeral = params.ephemeral_message_parameters as
				| { receiver_user_id?: number }
				| undefined;
			if (ephemeral?.receiver_user_id !== undefined) {
				result.receiver_user = this.env.users.find(
					(u) => u.payload.id === ephemeral.receiver_user_id,
				)?.payload ?? {
					id: ephemeral.receiver_user_id,
					is_bot: false,
					first_name: "Receiver",
				};
				result.ephemeral_message_id = ++this.ephemeralId;
			}
			return result;
		}
		if (
			method === "editMessageText" ||
			method === "editMessageCaption" ||
			method === "editMessageReplyMarkup" ||
			method === "editMessageMedia"
		) {
			const message = params.inline_message_id
				? this.env.inlineMessage(String(params.inline_message_id))
				: this.env.message(Number(params.chat_id), Number(params.message_id));
			if (!message)
				return apiError(400, "Bad Request: message to edit not found");
			if (
				!message.inlineMessageId &&
				message.payload.chat?.type !== "channel" &&
				message.payload.from?.id !== this.env.botUser.id
			)
				return apiError(400, "Bad Request: message can't be edited by the bot");
			if (method === "editMessageText" && message.payload.text === undefined)
				return apiError(400, "Bad Request: message has no text to edit");
			if (
				method === "editMessageCaption" &&
				!message.payload.photo &&
				!message.payload.video &&
				!message.payload.document &&
				!message.payload.audio &&
				!message.payload.animation &&
				!message.payload.voice
			)
				return apiError(400, "Bad Request: message has no editable caption");
			const result = snapshot(message.payload);
			if (method === "editMessageText") {
				result.text = String(params.text);
				result.entities = params.entities as TelegramMessage["entities"];
			}
			if (method === "editMessageCaption") {
				result.caption = params.caption as string;
				result.caption_entities =
					params.caption_entities as TelegramMessage["caption_entities"];
			}
			if (method === "editMessageMedia") {
				const media = params.media as Record<string, unknown>;
				if (
					!["photo", "video", "audio", "document", "animation"].includes(
						String(media.type),
					)
				)
					return apiError(400, "Bad Request: unsupported editable media type");
				if (
					message.inlineMessageId &&
					(typeof media.media !== "string" ||
						media.thumbnail instanceof Blob ||
						media.cover instanceof Blob)
				)
					return apiError(
						400,
						"Bad Request: inline messages cannot upload new files",
					);
				const replacement = new MessageObject();
				this.attachMedia(replacement, String(media.type), media);
				for (const key of [
					"photo",
					"video",
					"document",
					"audio",
					"animation",
					"voice",
					"text",
					"entities",
				] as const)
					delete result[key];
				const {
					message_id: _id,
					date: _date,
					...content
				} = replacement.payload;
				Object.assign(result, content, {
					caption: media.caption,
					caption_entities: media.caption_entities,
				});
			}
			if ("reply_markup" in params || method === "editMessageReplyMarkup")
				result.reply_markup =
					params.reply_markup as TelegramMessage["reply_markup"];
			result.edit_date = Math.floor(Date.now() / 1000);
			return this.editResult(message, result);
		}
		if (method === "deleteMessage" || method === "deleteMessages") return true;
		if (method === "pinChatMessage")
			return this.env.message(Number(params.chat_id), Number(params.message_id))
				? true
				: apiError(400, "Bad Request: message to pin not found");
		if (method === "unpinChatMessage" || method === "unpinAllChatMessages")
			return true;
		if (booleanMethods.has(method)) return true;
		throw new Error(
			`No default mock for ${method}. Register env.onApi("${method}", handler).`,
		);
	}

	private editResult(message: MessageObject, result: MessageObject["payload"]) {
		if (!message.inlineMessageId) return result;
		for (const key of Object.keys(message.payload))
			Reflect.deleteProperty(message.payload, key);
		Object.assign(message.payload, result);
		return true;
	}

	private attachMedia(
		message: MessageObject,
		kind: string,
		params: Record<string, unknown>,
	) {
		const input = params.media ?? params[kind];
		const metadata: Record<string, unknown> = {};
		for (const key of [
			"title",
			"performer",
			"duration",
			"width",
			"height",
			"length",
			"file_name",
			"mime_type",
		])
			if (params[key] !== undefined) metadata[key] = params[key];
		if (
			params.thumbnail instanceof Blob ||
			typeof params.thumbnail === "string"
		)
			metadata.thumbnail = {
				width: 90,
				height: 90,
				...this.env.registerFile(params.thumbnail),
			};
		const file =
			typeof input === "string" || input instanceof Blob
				? this.env.registerFile(input, metadata)
				: {};
		switch (kind) {
			case "photo":
				message.photo([file]);
				break;
			case "video":
				message.video(file);
				break;
			case "document":
				message.document(file);
				break;
			case "audio":
				message.audio(file);
				break;
			case "voice":
				message.voice(file);
				break;
			case "animation":
				message.animation(file);
				break;
			case "video_note":
				message.videoNote(file);
				break;
			case "sticker":
				message.sticker(file);
				break;
			case "location":
				message.location({
					latitude: Number(params.latitude),
					longitude: Number(params.longitude),
					...(params.live_period === undefined
						? {}
						: { live_period: Number(params.live_period) }),
					...(params.horizontal_accuracy === undefined
						? {}
						: { horizontal_accuracy: Number(params.horizontal_accuracy) }),
					...(params.heading === undefined
						? {}
						: { heading: Number(params.heading) }),
					...(params.proximity_alert_radius === undefined
						? {}
						: {
								proximity_alert_radius: Number(params.proximity_alert_radius),
							}),
				});
				break;
			case "contact":
				message.contact({
					phone_number: String(params.phone_number),
					first_name: String(params.first_name),
					...(typeof params.last_name === "string"
						? { last_name: params.last_name }
						: {}),
					...(typeof params.vcard === "string" ? { vcard: params.vcard } : {}),
				});
				break;
			case "dice":
				message.dice({ emoji: String(params.emoji ?? "🎲"), value: 1 });
				break;
			case "venue":
				message.venue({
					title: String(params.title),
					address: String(params.address),
					location: {
						latitude: Number(params.latitude),
						longitude: Number(params.longitude),
					},
				});
				break;
			case "poll":
				message.poll({
					id: this.env.nextId("poll"),
					question: String(params.question),
					is_anonymous: params.is_anonymous !== false,
					type: params.type === "quiz" ? "quiz" : "regular",
					is_closed: params.is_closed === true,
					allows_revoting:
						typeof params.allows_revoting === "boolean"
							? params.allows_revoting
							: params.type !== "quiz",
					members_only: params.members_only === true,
					correct_option_ids: params.correct_option_ids as number[] | undefined,
					allows_multiple_answers: params.allows_multiple_answers === true,
					options: (params.options as { text: string }[]).map(
						(option, index) => ({
							text: option.text,
							persistent_id: String(index),
							voter_count: 0,
						}),
					),
				});
				break;
			default:
				throw new Error(`Unsupported media type: ${kind}`);
		}
	}

	private relay(
		source: MessageObject,
		params: Record<string, unknown>,
		copy: boolean,
		albums: Map<string, string>,
	): TelegramMessage {
		const {
			message_id: _id,
			date: _date,
			chat: _chat,
			from: _from,
			sender_chat: _sender,
			author_signature: _signature,
			edit_date: _edit,
			reply_to_message: _reply,
			external_reply: _external,
			quote: _quote,
			message_thread_id: _thread,
			is_topic_message: _topic,
			is_automatic_forward: _automatic,
			reply_markup: _markup,
			forward_origin: _origin,
			media_group_id: album,
			...content
		} = snapshot(source.payload);
		if (copy && params.remove_caption) {
			delete content.caption;
			delete content.caption_entities;
		} else if (copy && params.caption !== undefined) {
			content.caption = String(params.caption);
			content.caption_entities =
				params.caption_entities as TelegramMessage["caption_entities"];
		}
		if (album && !albums.has(album))
			albums.set(album, this.env.nextId("album"));
		return this.outgoing(params, {
			...content,
			...(copy ? {} : { forward_origin: originOf(source) }),
			...(album ? { media_group_id: albums.get(album) } : {}),
			...(copy && params.reply_markup
				? {
						reply_markup:
							params.reply_markup as TelegramMessage["reply_markup"],
					}
				: {}),
			...(params.protect_content ? { has_protected_content: true } : {}),
		});
	}
}
